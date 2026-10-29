// 小规模光束法平差（LM + Schur 消元），相机内参固定。
// 相机位姿增量：R ← exp(δω)·R，t ← t + δt；点：X ← X + δX。第 fixedCams 中的相机不参与优化（规范固定）。
import { mul3, add, expSO3, solveLinear, inv3x3rows } from './linalg.js';
import { projectCam } from './geom.js';

export class BundleAdjuster {
  /**
   * cams: [{R,t}]，K: {f,cx,cy}，pts: [[x,y,z]]，obs: [{c,p,u,v}]
   * opts: {huber: 像素或0, fixed: Set<相机下标>}
   */
  constructor(cams, K, pts, obs, { huber = 0, fixed = new Set([0]) } = {}) {
    this.cams = cams.map((c) => ({ R: c.R.slice(), t: c.t.slice() }));
    this.K = K; this.pts = pts.map((p) => p.slice()); this.obs = obs;
    this.huber = huber; this.fixed = fixed;
    this.lambda = 1e-3; this.iter = 0;
    this.camIdx = []; let n = 0;
    cams.forEach((_, i) => { this.camIdx.push(fixed.has(i) ? -1 : n++); });
    this.nc = n;
  }
  residual(i, cams = this.cams, pts = this.pts) {
    const o = this.obs[i];
    const p = projectCam({ ...cams[o.c], K: this.K }, pts[o.p]);
    if (p[2] <= 1e-6) return [1e3, 1e3];
    return [p[0] - o.u, p[1] - o.v];
  }
  weight(r) {
    const s = Math.hypot(r[0], r[1]);
    return this.huber > 0 && s > this.huber ? this.huber / s : 1;
  }
  /** 目标函数：Huber 损失之和（huber=0 时为 ½Σ‖r‖²） */
  cost(cams = this.cams, pts = this.pts) {
    let c = 0;
    for (let i = 0; i < this.obs.length; i++) {
      const r = this.residual(i, cams, pts), s = Math.hypot(r[0], r[1]);
      c += this.huber > 0 && s > this.huber ? this.huber * (s - this.huber / 2) : 0.5 * s * s;
    }
    return c;
  }
  /** 平均重投影误差 MRE（像素）；mask(obs)=false 的观测被排除 */
  mre(mask = null) {
    let s = 0, n = 0;
    for (let i = 0; i < this.obs.length; i++) {
      if (mask && !mask(this.obs[i])) continue;
      const r = this.residual(i); s += Math.hypot(r[0], r[1]); n++;
    }
    return n ? s / n : 0;
  }
  /** 线性化：返回块结构的法方程 */
  linearize() {
    const nc = this.nc, np = this.pts.length;
    const U = Array.from({ length: nc }, () => Array.from({ length: 6 }, () => new Array(6).fill(0)));
    const V = Array.from({ length: np }, () => Array.from({ length: 3 }, () => new Array(3).fill(0)));
    const W = new Map(); // key = c*np+p → 6×3
    const gc = Array.from({ length: nc }, () => new Array(6).fill(0));
    const gp = Array.from({ length: np }, () => new Array(3).fill(0));
    const h = 1e-6;
    for (let i = 0; i < this.obs.length; i++) {
      const o = this.obs[i], ci = this.camIdx[o.c];
      const r0 = this.residual(i), w = this.weight(r0);
      const Jc = [[], []], Jp = [[], []];
      if (ci >= 0) {
        for (let k = 0; k < 6; k++) {
          const f = (s) => {
            const cams = this.cams.slice();
            const c = cams[o.c];
            if (k < 3) { const d = [0, 0, 0]; d[k] = s * h; cams[o.c] = { R: mul3(expSO3(d), c.R), t: c.t }; }
            else { const d = c.t.slice(); d[k - 3] += s * h; cams[o.c] = { R: c.R, t: d }; }
            return this.residual(i, cams);
          };
          const a = f(1), b = f(-1);
          Jc[0][k] = (a[0] - b[0]) / (2 * h); Jc[1][k] = (a[1] - b[1]) / (2 * h);
        }
      }
      for (let k = 0; k < 3; k++) {
        const f = (s) => { const pts = this.pts.slice(); const p = pts[o.p].slice(); p[k] += s * h; pts[o.p] = p; return this.residual(i, this.cams, pts); };
        const a = f(1), b = f(-1);
        Jp[0][k] = (a[0] - b[0]) / (2 * h); Jp[1][k] = (a[1] - b[1]) / (2 * h);
      }
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) V[o.p][a][b] += w * (Jp[0][a] * Jp[0][b] + Jp[1][a] * Jp[1][b]);
        gp[o.p][a] += w * (Jp[0][a] * r0[0] + Jp[1][a] * r0[1]);
      }
      if (ci >= 0) {
        for (let a = 0; a < 6; a++) {
          for (let b = 0; b < 6; b++) U[ci][a][b] += w * (Jc[0][a] * Jc[0][b] + Jc[1][a] * Jc[1][b]);
          gc[ci][a] += w * (Jc[0][a] * r0[0] + Jc[1][a] * r0[1]);
        }
        const key = ci * np + o.p;
        let Wm = W.get(key);
        if (!Wm) { Wm = Array.from({ length: 6 }, () => new Array(3).fill(0)); W.set(key, Wm); }
        for (let a = 0; a < 6; a++) for (let b = 0; b < 3; b++) Wm[a][b] += w * (Jc[0][a] * Jp[0][b] + Jc[1][a] * Jp[1][b]);
      }
    }
    return { U, V, W, gc, gp, nc, np };
  }
  /** Schur 消元求解 (H + λ diag(H)) δ = −g。返回 {dc, dp, reducedSize} */
  solveSchur(L, lam) {
    const { U, V, W, gc, gp, nc, np } = L;
    const n6 = 6 * nc;
    const S = Array.from({ length: n6 }, () => new Array(n6).fill(0));
    const rhs = new Array(n6).fill(0);
    for (let c = 0; c < nc; c++) {
      for (let a = 0; a < 6; a++) {
        for (let b = 0; b < 6; b++) S[c * 6 + a][c * 6 + b] += U[c][a][b] + (a === b ? lam * U[c][a][a] : 0);
        rhs[c * 6 + a] -= gc[c][a];
      }
    }
    const Vinv = V.map((M) => { const D = M.map((r, i) => r.map((v, j) => (i === j ? v * (1 + lam) : v))); return inv3x3rows(D); });
    // 按点收集相机
    const byPt = Array.from({ length: np }, () => []);
    for (const [key, Wm] of W) byPt[key % np].push([Math.floor(key / np), Wm]);
    for (let p = 0; p < np; p++) {
      const lst = byPt[p], Vi = Vinv[p];
      // Y = W Vinv (6×3)
      const Ys = lst.map(([c, Wm]) => Wm.map((r) => [0, 1, 2].map((b) => r[0] * Vi[0][b] + r[1] * Vi[1][b] + r[2] * Vi[2][b])));
      for (let i = 0; i < lst.length; i++) {
        const ci = lst[i][0], Y = Ys[i];
        // rhs += Y gp
        for (let a = 0; a < 6; a++) rhs[ci * 6 + a] += Y[a][0] * gp[p][0] + Y[a][1] * gp[p][1] + Y[a][2] * gp[p][2];
        for (let j = 0; j < lst.length; j++) {
          const cj = lst[j][0], Wj = lst[j][1];
          for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++)
            S[ci * 6 + a][cj * 6 + b] -= Y[a][0] * Wj[b][0] + Y[a][1] * Wj[b][1] + Y[a][2] * Wj[b][2];
        }
      }
    }
    const dcv = n6 ? solveLinear(S, rhs) : [];
    const dp = [];
    for (let p = 0; p < np; p++) {
      const t = [-gp[p][0], -gp[p][1], -gp[p][2]];
      for (const [c, Wm] of byPt[p]) for (let b = 0; b < 3; b++) for (let a = 0; a < 6; a++) t[b] -= Wm[a][b] * dcv[c * 6 + a];
      const Vi = Vinv[p];
      dp.push([0, 1, 2].map((r) => Vi[r][0] * t[0] + Vi[r][1] * t[1] + Vi[r][2] * t[2]));
    }
    return { dcv, dp, reducedSize: n6 };
  }
  /** 稠密求解同一方程（用于和 Schur 对照） */
  solveDense(L, lam) {
    const { U, V, W, gc, gp, nc, np } = L;
    const n = 6 * nc + 3 * np;
    const H = Array.from({ length: n }, () => new Array(n).fill(0)), g = new Array(n).fill(0);
    for (let c = 0; c < nc; c++) for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) H[c * 6 + a][c * 6 + b] = U[c][a][b] + (a === b ? lam * U[c][a][a] : 0);
      g[c * 6 + a] = -gc[c][a];
    }
    for (let p = 0; p < np; p++) for (let a = 0; a < 3; a++) {
      const r = 6 * nc + 3 * p + a;
      for (let b = 0; b < 3; b++) H[r][6 * nc + 3 * p + b] = V[p][a][b] * (a === b ? 1 + lam : 1);
      g[r] = -gp[p][a];
    }
    for (const [key, Wm] of W) {
      const c = Math.floor(key / np), p = key % np;
      for (let a = 0; a < 6; a++) for (let b = 0; b < 3; b++) { H[c * 6 + a][6 * nc + 3 * p + b] = Wm[a][b]; H[6 * nc + 3 * p + b][c * 6 + a] = Wm[a][b]; }
    }
    const x = solveLinear(H, g);
    return { dcv: x.slice(0, 6 * nc), dp: Array.from({ length: np }, (_, p) => x.slice(6 * nc + 3 * p, 6 * nc + 3 * p + 3)), size: n };
  }
  apply(sol) {
    const cams = this.cams.map((c, i) => {
      const k = this.camIdx[i];
      if (k < 0) return c;
      const d = sol.dcv.slice(k * 6, k * 6 + 6);
      return { R: mul3(expSO3(d.slice(0, 3)), c.R), t: add(c.t, d.slice(3)) };
    });
    const pts = this.pts.map((p, i) => add(p, sol.dp[i]));
    return { cams, pts };
  }
  /** 一次 LM 迭代；返回 {accepted, cost, mre, lambda, diff(Schur 与稠密解的差), reduced, full} */
  step({ compareDense = false } = {}) {
    const L = this.linearize();
    const c0 = this.cost();
    const sol = this.solveSchur(L, this.lambda);
    let diff = null, full = 6 * L.nc + 3 * L.np;
    if (compareDense) {
      const d = this.solveDense(L, this.lambda);
      let m = 0, s = 0;
      d.dcv.forEach((v, i) => { m = Math.max(m, Math.abs(v - sol.dcv[i])); s = Math.max(s, Math.abs(v)); });
      d.dp.forEach((p, i) => p.forEach((v, k) => { m = Math.max(m, Math.abs(v - sol.dp[i][k])); s = Math.max(s, Math.abs(v)); }));
      diff = { abs: m, rel: m / (s || 1) };
    }
    const nw = this.apply(sol);
    const c1 = this.cost(nw.cams, nw.pts);
    const accepted = Number.isFinite(c1) && c1 < c0;
    if (accepted) { this.cams = nw.cams; this.pts = nw.pts; this.lambda = Math.max(this.lambda / 3, 1e-9); }
    else this.lambda = Math.min(this.lambda * 4, 1e9);
    this.iter++;
    return { accepted, cost: accepted ? c1 : c0, trial: c1, lambda: this.lambda, diff, reduced: sol.reducedSize, full, relDecrease: (c0 - c1) / (c0 || 1) };
  }
  run(maxIter = 30, tol = 1e-10) {
    const hist = [];
    for (let i = 0; i < maxIter; i++) {
      const r = this.step();
      hist.push({ ...r, mre: this.mre() });
      if (r.accepted && r.relDecrease < tol) break;
    }
    return hist;
  }
}
