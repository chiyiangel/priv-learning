// 多视图几何核心算法：投影、对极几何、8 点法 + RANSAC、E 分解、三角化、PnP
import {
  dot, cross, add, sub, scale, norm, normalize, I3, mul3, mulv3, T3, det3, skew, scale3, inv3,
  svd, svd3, nullVector, expSO3, rotAngle, angleBetween, solveLinear,
} from './linalg.js';

// 相机：{R:mat3, t:[3], K:{f,cx,cy}}；Xc = R X + t，u = f·x/z + cx，v = f·y/z + cy
export const camCenter = (cam) => scale(mulv3(T3(cam.R), cam.t), -1);
export function projectCam(cam, X) {
  const p = add(mulv3(cam.R, X), cam.t);
  return [cam.K.f * p[0] / p[2] + cam.K.cx, cam.K.f * p[1] / p[2] + cam.K.cy, p[2]];
}
export const toNorm = (K, u) => [(u[0] - K.cx) / K.f, (u[1] - K.cy) / K.f];
export const Kmat = (K) => [K.f, 0, K.cx, 0, K.f, K.cy, 0, 0, 1];
export const Kinv = (K) => [1 / K.f, 0, -K.cx / K.f, 0, 1 / K.f, -K.cy / K.f, 0, 0, 1];
export const depthOf = (cam, X) => mulv3(cam.R, X)[2] + cam.t[2];
/** 像素 → 世界系射线 {o, d} */
export function pixelRay(cam, u) {
  const n = toNorm(cam.K, u);
  const dc = normalize([n[0], n[1], 1]);
  return { o: camCenter(cam), d: mulv3(T3(cam.R), dc) };
}
/** lookAt：世界系 y 轴向下（CV 约定）。返回 {R, t} */
export function lookAt(C, target, down = [0, 1, 0]) {
  const z = normalize(sub(target, C));
  const x = normalize(cross(down, z));
  const y = cross(z, x);
  const R = [...x, ...y, ...z];
  return { R, t: scale(mulv3(R, C), -1) };
}

// ---------- 对极几何 ----------
export const essentialFromPose = (R, t) => mul3(skew(t), R);
export const fundamentalFromE = (E, K1, K2) => mul3(T3(Kinv(K2)), mul3(E, Kinv(K1)));
export const essentialFromF = (F, K1, K2) => mul3(T3(Kmat(K2)), mul3(F, Kmat(K1)));
export const epipolarLine = (F, x) => mulv3(F, [x[0], x[1], 1]); // 图 2 中的直线 l = F x1，[a,b,c]：a u + b v + c = 0
export const epipolarResidual = (F, x1, x2) => dot([x2[0], x2[1], 1], mulv3(F, [x1[0], x1[1], 1]));
/** Sampson 距离（像素²，一阶近似的点到极线距离²） */
export function sampson(F, x1, x2) {
  const a = [x1[0], x1[1], 1], b = [x2[0], x2[1], 1];
  const Fa = mulv3(F, a), Ftb = mulv3(T3(F), b);
  const num = dot(b, Fa);
  const den = Fa[0] * Fa[0] + Fa[1] * Fa[1] + Ftb[0] * Ftb[0] + Ftb[1] * Ftb[1];
  return den > 0 ? num * num / den : Infinity;
}

/** Hartley 归一化：平移到质心、缩放使平均距离为 √2 */
export function hartley(pts) {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let d = 0;
  for (const p of pts) d += Math.hypot(p[0] - cx, p[1] - cy);
  d /= n;
  const s = d > 0 ? Math.SQRT2 / d : 1;
  return { T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1], pts: pts.map((p) => [(p[0] - cx) * s, (p[1] - cy) * s]) };
}

/** 归一化 8 点法估计基础矩阵 F（要求 ≥ 8 对点）。返回 3×3 行主序，秩 2，‖F‖=1 */
export function fundamental8(x1, x2) {
  const h1 = hartley(x1), h2 = hartley(x2);
  const A = h1.pts.map((p, i) => {
    const q = h2.pts[i];
    // x2ᵀ F x1 = 0 的每个元素系数（F 行主序展开）
    return [q[0] * p[0], q[0] * p[1], q[0], q[1] * p[0], q[1] * p[1], q[1], p[0], p[1], 1];
  });
  const { x } = nullVector(A);
  const { U, S, V } = svd3(x);
  const Fn = mul3(U, mul3([S[0], 0, 0, 0, S[1], 0, 0, 0, 0], T3(V))); // 强制秩 2
  const F = mul3(T3(h2.T), mul3(Fn, h1.T)); // 反归一化
  const n = Math.sqrt(F.reduce((s, v) => s + v * v, 0));
  return F.map((v) => v / n);
}

/** 自适应迭代次数 N = log(1-p)/log(1-w^s)（这里 pw = w^s） */
function needIters(pw, conf, maxIters) {
  if (!(pw > 1e-14)) return maxIters;
  if (pw >= 1) return 1;
  return Math.max(1, Math.min(maxIters, Math.ceil(Math.log(1 - conf) / Math.log1p(-pw))));
}
/** RANSAC + 8 点法。x1,x2: 像素点数组。thresh: 像素（Sampson 距离阈值，d² < thresh²） */
export function ransacF(x1, x2, { thresh = 1.5, maxIters = 800, conf = 0.99, rand = Math.random, minInliers = 8 } = {}) {
  const N = x1.length;
  let best = { F: null, inl: new Array(N).fill(false), count: 0 };
  const t2 = thresh * thresh;
  let need = maxIters, iters = 0;
  const idx = Array.from({ length: N }, (_, i) => i);
  while (iters < need && iters < maxIters) {
    iters++;
    for (let k = 0; k < 8; k++) { const j = k + Math.floor(rand() * (N - k)); [idx[k], idx[j]] = [idx[j], idx[k]]; }
    const s = idx.slice(0, 8);
    const F = fundamental8(s.map((i) => x1[i]), s.map((i) => x2[i]));
    if (!F.every(Number.isFinite)) continue;
    let c = 0; const inl = new Array(N);
    for (let i = 0; i < N; i++) { inl[i] = sampson(F, x1[i], x2[i]) < t2; if (inl[i]) c++; }
    if (c > best.count) {
      best = { F, inl, count: c };
      const w = c / N;
      need = needIters(Math.pow(w, 8), conf, maxIters);
    }
  }
  // 用全部内点重估 F
  if (best.count >= minInliers) {
    const a = [], b = [];
    best.inl.forEach((v, i) => { if (v) { a.push(x1[i]); b.push(x2[i]); } });
    const F = fundamental8(a, b);
    const inl = x1.map((_, i) => sampson(F, x1[i], x2[i]) < t2);
    const count = inl.filter(Boolean).length;
    if (count >= best.count * 0.9) best = { F, inl, count };
  }
  return { ...best, iters };
}

/** 把任意 3×3 投影到本质矩阵流形：奇异值 (σ,σ,0) */
export function projectToE(E) {
  const { U, S, V } = svd3(E);
  const s = (S[0] + S[1]) / 2;
  return mul3(U, mul3([s, 0, 0, 0, s, 0, 0, 0, 0], T3(V)));
}
/** E 分解得到 4 个 (R,t) 候选，t 为单位向量。候选顺序：(R1,+t) (R1,−t) (R2,+t) (R2,−t) */
export function decomposeE(E) {
  const { U, V } = svd3(E);
  const W = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const R1 = mul3(U, mul3(W, T3(V)));
  const R2 = mul3(U, mul3(T3(W), T3(V)));
  const t = [U[2], U[5], U[8]];
  return [{ R: R1, t }, { R: R1, t: scale(t, -1) }, { R: R2, t }, { R: R2, t: scale(t, -1) }];
}

// ---------- 三角化 ----------
/** 线性 DLT。cams: 相机数组（含 K），uvs: 对应像素。返回 [X,Y,Z] */
export function triangulateDLT(cams, uvs) {
  const A = [];
  cams.forEach((c, i) => {
    const n = toNorm(c.K, uvs[i]);
    const P = [c.R.slice(0, 3).concat(c.t[0]), c.R.slice(3, 6).concat(c.t[1]), c.R.slice(6, 9).concat(c.t[2])];
    A.push(P[2].map((v, k) => n[0] * v - P[0][k]));
    A.push(P[2].map((v, k) => n[1] * v - P[1][k]));
  });
  const { x } = nullVector(A);
  return [x[0] / x[3], x[1] / x[3], x[2] / x[3]];
}
/** 两条射线的最近点（公垂线中点）。返回 {p1,p2,mid,gap} */
export function rayClosest(o1, d1, o2, d2) {
  const w = sub(o1, o2);
  const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2), d = dot(d1, w), e = dot(d2, w);
  const den = a * c - b * b;
  let s, t;
  if (Math.abs(den) < 1e-14) { s = 0; t = e / c; } else { s = (b * e - c * d) / den; t = (a * e - b * d) / den; }
  const p1 = add(o1, scale(d1, s)), p2 = add(o2, scale(d2, t));
  return { p1, p2, mid: scale(add(p1, p2), 0.5), gap: norm(sub(p1, p2)), s, t };
}
/** n 视图中点法：到所有射线距离平方和最小的点 */
export function triangulateMidpoint(cams, uvs) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  cams.forEach((c, i) => {
    const { o, d } = pixelRay(c, uvs[i]);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) A[r][k] += (r === k ? 1 : 0) - d[r] * d[k];
    }
    const Pd = [1 - d[0] * d[0], -d[0] * d[1], -d[0] * d[2], -d[1] * d[0], 1 - d[1] * d[1], -d[1] * d[2], -d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]];
    const v = mulv3(Pd, o);
    b[0] += v[0]; b[1] += v[1]; b[2] += v[2];
  });
  return solveLinear(A, b);
}
/** 重投影误差各视图（像素）*/
export const reprojErrors = (cams, uvs, X) => cams.map((c, i) => {
  const p = projectCam(c, X);
  return Math.hypot(p[0] - uvs[i][0], p[1] - uvs[i][1]);
});
export const rms = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
/** 非线性最小化重投影误差（LM，从 X0 起步） */
export function triangulateRefine(cams, uvs, X0, iters = 15) {
  let X = X0.slice(), lam = 1e-3;
  const cost = (X) => { let s = 0; cams.forEach((c, i) => { const p = projectCam(c, X); if (p[2] <= 0) s += 1e12; else s += (p[0] - uvs[i][0]) ** 2 + (p[1] - uvs[i][1]) ** 2; }); return s; };
  let cur = cost(X);
  for (let it = 0; it < iters; it++) {
    const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
    cams.forEach((c, i) => {
      const p = add(mulv3(c.R, X), c.t), f = c.K.f;
      if (p[2] <= 1e-9) return;
      const u = f * p[0] / p[2] + c.K.cx, v = f * p[1] / p[2] + c.K.cy;
      // d(u,v)/dXc 再乘 R
      const J = [[f / p[2], 0, -f * p[0] / (p[2] * p[2])], [0, f / p[2], -f * p[1] / (p[2] * p[2])]].map((r) => [0, 1, 2].map((k) => r[0] * c.R[k] + r[1] * c.R[3 + k] + r[2] * c.R[6 + k]));
      const r = [u - uvs[i][0], v - uvs[i][1]];
      for (let a = 0; a < 2; a++) for (let m = 0; m < 3; m++) { g[m] += J[a][m] * r[a]; for (let k = 0; k < 3; k++) H[m][k] += J[a][m] * J[a][k]; }
    });
    for (let k = 0; k < 3; k++) H[k][k] *= 1 + lam;
    const dx = solveLinear(H, g.map((v) => -v));
    const Xn = add(X, dx), cn = cost(Xn);
    if (cn < cur) { X = Xn; cur = cn; lam = Math.max(lam / 3, 1e-9); if (norm(dx) < 1e-10) break; } else lam *= 5;
  }
  return X;
}
/** 两视图三角化角度（度） */
export const triAngleDeg = (C1, C2, X) => angleBetween(sub(X, C1), sub(X, C2)) * 180 / Math.PI;

/** 用 4 个候选位姿做 cheirality 检查。x1,x2 为像素点，相机 1 = [I|0]。返回每个候选的前方点数 */
export function cheiralityCandidates(E, K1, K2, x1, x2, mask = null) {
  const cands = decomposeE(E);
  const cam1 = { R: I3(), t: [0, 0, 0], K: K1 };
  return cands.map((c) => {
    const cam2 = { R: c.R, t: c.t, K: K2 };
    let front = 0, total = 0;
    const pts = [];
    for (let i = 0; i < x1.length; i++) {
      if (mask && !mask[i]) continue;
      total++;
      const X = triangulateDLT([cam1, cam2], [x1[i], x2[i]]);
      const z1 = X[2], z2 = depthOf(cam2, X);
      pts.push({ X, z1, z2, ok: z1 > 0 && z2 > 0 });
      if (z1 > 0 && z2 > 0) front++;
    }
    return { R: c.R, t: c.t, front, total, pts };
  });
}
/** 从匹配估计相对位姿：返回 {R,t,E,cands,best}。t 为单位向量（尺度不可恢复） */
export function relativePoseFromF(F, K1, K2, x1, x2, mask = null) {
  const E = projectToE(essentialFromF(F, K1, K2));
  const cands = cheiralityCandidates(E, K1, K2, x1, x2, mask);
  let best = 0;
  cands.forEach((c, i) => { if (c.front > cands[best].front) best = i; });
  return { E, cands, best, R: cands[best].R, t: cands[best].t };
}

// ---------- PnP ----------
/** DLT PnP（≥6 点）。X: 3D 点数组，uv: 像素。返回 {R,t} （Xc = R X + t） */
export function pnpDLT(X, uv, K) {
  const n = X.length;
  const c = [0, 0, 0];
  for (const p of X) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
  let s3 = 0; for (const p of X) s3 += norm(sub(p, c)); s3 = s3 / n || 1;
  const A = [];
  for (let i = 0; i < n; i++) {
    const q = scale(sub(X[i], c), 1 / s3), h = [q[0], q[1], q[2], 1], m = toNorm(K, uv[i]);
    A.push([...h, 0, 0, 0, 0, ...h.map((v) => -m[0] * v)]);
    A.push([0, 0, 0, 0, ...h, ...h.map((v) => -m[1] * v)]);
  }
  const { x } = nullVector(A);
  let P = x;
  const M = [P[0], P[1], P[2], P[4], P[5], P[6], P[8], P[9], P[10]];
  if (det3(M) < 0) P = P.map((v) => -v);
  const Mm = [P[0], P[1], P[2], P[4], P[5], P[6], P[8], P[9], P[10]];
  const { U, S, V } = svd3(Mm);
  const R = mul3(U, T3(V));
  const mu = (S[0] + S[1] + S[2]) / 3 / s3; // P ∝ [s3·R | R c + t]，尺度 mu
  const tp = [P[3] / mu, P[7] / mu, P[11] / mu];
  const t = sub(tp, mulv3(R, c));
  return { R, t };
}
/** 位姿 LM 精化（点固定）。返回 {R,t} */
export function refinePose(R0, t0, K, X, uv, iters = 20) {
  let R = R0.slice(), t = t0.slice(), lam = 1e-3;
  const res = (R, t) => {
    const r = [];
    for (let i = 0; i < X.length; i++) {
      const p = projectCam({ R, t, K }, X[i]);
      r.push(p[0] - uv[i][0], p[1] - uv[i][1]);
    }
    return r;
  };
  const cost = (r) => r.reduce((s, v) => s + v * v, 0);
  let r0 = res(R, t), c0 = cost(r0);
  for (let it = 0; it < iters; it++) {
    const J = [];
    const h = 1e-6;
    const cols = [];
    for (let k = 0; k < 6; k++) {
      const d = [0, 0, 0, 0, 0, 0]; d[k] = h;
      const ap = (s) => k < 3 ? { R: mul3(expSO3(scale([d[0], d[1], d[2]], s)), R), t } : { R, t: add(t, scale([d[3], d[4], d[5]], s)) };
      const a = ap(1), b = ap(-1);
      const ra = res(a.R, a.t), rb = res(b.R, b.t);
      cols.push(ra.map((v, i) => (v - rb[i]) / (2 * h)));
    }
    const H = Array.from({ length: 6 }, () => new Array(6).fill(0)), g = new Array(6).fill(0);
    for (let i = 0; i < r0.length; i++) for (let a = 0; a < 6; a++) { g[a] += cols[a][i] * r0[i]; for (let b = 0; b < 6; b++) H[a][b] += cols[a][i] * cols[b][i]; }
    for (let k = 0; k < 6; k++) H[k][k] *= 1 + lam;
    const dx = solveLinear(H, g.map((v) => -v));
    const Rn = mul3(expSO3(dx.slice(0, 3)), R), tn = add(t, dx.slice(3));
    const rn = res(Rn, tn), cn = cost(rn);
    if (cn < c0) { R = Rn; t = tn; r0 = rn; c0 = cn; lam = Math.max(lam / 3, 1e-9); if (norm(dx) < 1e-10) break; } else lam *= 5;
  }
  return { R, t };
}
/** RANSAC + DLT PnP。thresh 像素 */
export function pnpRansac(X, uv, K, { thresh = 3, maxIters = 300, conf = 0.99, rand = Math.random } = {}) {
  const N = X.length;
  if (N < 6) return null;
  let best = { inl: null, count: 0, pose: null };
  let need = maxIters, iters = 0;
  const idx = Array.from({ length: N }, (_, i) => i);
  const t2 = thresh * thresh;
  const evalPose = (pose) => {
    let c = 0; const inl = new Array(N);
    for (let i = 0; i < N; i++) {
      const p = projectCam({ ...pose, K }, X[i]);
      inl[i] = p[2] > 0 && (p[0] - uv[i][0]) ** 2 + (p[1] - uv[i][1]) ** 2 < t2;
      if (inl[i]) c++;
    }
    return { inl, c };
  };
  while (iters < need) {
    iters++;
    for (let k = 0; k < 6; k++) { const j = k + Math.floor(rand() * (N - k)); [idx[k], idx[j]] = [idx[j], idx[k]]; }
    const s = idx.slice(0, 6);
    const pose = pnpDLT(s.map((i) => X[i]), s.map((i) => uv[i]), K);
    if (![...pose.R, ...pose.t].every(Number.isFinite)) continue;
    const { inl, c } = evalPose(pose);
    if (c > best.count) {
      best = { inl, count: c, pose };
      need = needIters(Math.pow(c / N, 6), conf, maxIters);
    }
  }
  if (!best.pose || best.count < 6) return null;
  const A = [], B = [];
  best.inl.forEach((v, i) => { if (v) { A.push(X[i]); B.push(uv[i]); } });
  let pose = refinePose(best.pose.R, best.pose.t, K, A, B);
  const { inl, c } = evalPose(pose);
  return { ...pose, inl, count: c, iters };
}

// ---------- 相似变换对齐（Umeyama）----------
/** 求 s,R,t 使 dst ≈ s R src + t */
export function umeyama(src, dst) {
  const n = src.length;
  const mu = (P) => P.reduce((a, p) => add(a, scale(p, 1 / n)), [0, 0, 0]);
  const ms = mu(src), md = mu(dst);
  let C = new Array(9).fill(0), vs = 0;
  for (let i = 0; i < n; i++) {
    const a = sub(src[i], ms), b = sub(dst[i], md);
    vs += dot(a, a) / n;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] += b[r] * a[c] / n;
  }
  const { U, S, V } = svd3(C);
  let D = [1, 0, 0, 0, 1, 0, 0, 0, det3(mul3(U, T3(V))) < 0 ? -1 : 1];
  const R = mul3(U, mul3(D, T3(V)));
  const s = (S[0] + S[1] + S[2] * D[8]) / vs;
  const t = sub(md, scale(mulv3(R, ms), s));
  return { s, R, t };
}
export const applySim = (T, p) => add(scale(mulv3(T.R, p), T.s), T.t);
export { rotAngle, angleBetween };

/** 带符号的 Sampson 距离（像素） */
export function sampsonSigned(F, x1, x2) {
  const a = [x1[0], x1[1], 1], b = [x2[0], x2[1], 1];
  const Fa = mulv3(F, a), Ftb = mulv3(T3(F), b);
  const den = Math.sqrt(Fa[0] * Fa[0] + Fa[1] * Fa[1] + Ftb[0] * Ftb[0] + Ftb[1] * Ftb[1]);
  return dot(b, Fa) / (den || 1e-12);
}
/** 在内点上最小化 Sampson 误差，非线性精化相对位姿 (R, t单位向量)。5 个自由度（旋转 3 + 平移方向 2） */
export function refineRelativePose(R0, t0, K1, K2, x1, x2, iters = 25) {
  let R = R0.slice(), t = normalize(t0), lam = 1e-3;
  const res = (R, t) => { const F = fundamentalFromE(essentialFromPose(R, t), K1, K2); return x1.map((p, i) => sampsonSigned(F, p, x2[i])); };
  const basis = (t) => { const a = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const e1 = normalize(cross(t, a)); return [e1, cross(t, e1)]; };
  const cost = (r) => r.reduce((s, v) => s + v * v, 0);
  let r0 = res(R, t), c0 = cost(r0);
  for (let it = 0; it < iters; it++) {
    const [e1, e2] = basis(t), h = 1e-6;
    const step = (d, s) => ({ R: mul3(expSO3(scale(d.slice(0, 3), s)), R), t: normalize(add(t, add(scale(e1, s * d[3]), scale(e2, s * d[4])))) });
    const cols = [];
    for (let k = 0; k < 5; k++) { const d = [0, 0, 0, 0, 0]; d[k] = h; const a = step(d, 1), b = step(d, -1); const ra = res(a.R, a.t), rb = res(b.R, b.t); cols.push(ra.map((v, i) => (v - rb[i]) / (2 * h))); }
    const H = Array.from({ length: 5 }, () => new Array(5).fill(0)), g = new Array(5).fill(0);
    for (let i = 0; i < r0.length; i++) for (let a = 0; a < 5; a++) { g[a] += cols[a][i] * r0[i]; for (let b = 0; b < 5; b++) H[a][b] += cols[a][i] * cols[b][i]; }
    for (let k = 0; k < 5; k++) H[k][k] *= 1 + lam;
    const dx = solveLinear(H, g.map((v) => -v));
    const nw = step(dx, 1), rn = res(nw.R, nw.t), cn = cost(rn);
    if (cn < c0) { R = nw.R; t = nw.t; r0 = rn; c0 = cn; lam = Math.max(lam / 3, 1e-9); if (norm(dx) < 1e-9) break; } else lam *= 5;
  }
  return { R, t };
}

/** 8 点法设计矩阵 A（Hartley 归一化后）的 9 个奇异值，用于观察退化（如平面场景使多个奇异值≈0） */
export function epipolarDesignSV(x1, x2) {
  const h1 = hartley(x1), h2 = hartley(x2);
  const A = h1.pts.map((p, i) => { const q = h2.pts[i]; return [q[0] * p[0], q[0] * p[1], q[0], q[1] * p[0], q[1] * p[1], q[1], p[0], p[1], 1]; });
  return svd(A).S;
}
