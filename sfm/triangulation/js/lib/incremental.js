// 增量式 SfM 的教学版实现：初始化 → 三角化 → PnP 注册 → 三角化新点 → BA（真实计算）
import { rng, sub, scale, norm, mul3, T3, mulv3, add, rotAngle, angleBetween, I3 } from './linalg.js';
import {
  ransacF, relativePoseFromF, refineRelativePose, triangulateDLT, triangulateRefine, projectCam, depthOf, camCenter, reprojErrors,
  pnpRansac, triAngleDeg, umeyama, applySim,
} from './geom.js';
import { BundleAdjuster } from './ba.js';
import { obsByCam } from './synth.js';

const MAX_REPROJ = 4, MIN_ANGLE = 1.5;

export class IncrementalDemo {
  constructor(scene, seed = 5) {
    this.sc = scene; this.K = scene.K; this.n = scene.nCams;
    this.obs = obsByCam(scene);
    this.est = new Array(this.n).fill(null);
    this.pts = new Map(); this.track = new Map();
    this.reg = []; this.rand = rng(seed);
    this.s = 1 / norm(camCenter(scene.cams[1])); this.stage = 0; // 真值→估计坐标系的尺度：初始基线定为 1
    this.stages = [{ type: 'init' }, { type: 'tri', cam: 1 }];
    for (let k = 2; k < this.n; k++) this.stages.push({ type: 'pnp', cam: k }, { type: 'tri', cam: k }, { type: 'ba', cam: k });
  }
  get done() { return this.stage >= this.stages.length; }
  next() {
    const st = this.stages[this.stage++];
    const info = this[{ init: 'initPair', tri: 'triangulateNew', pnp: 'registerPnP', ba: 'bundle' }[st.type]](st.cam);
    return { ...st, ...info, metrics: this.metrics() };
  }
  camObj(i) { return { ...this.est[i], K: this.K }; }
  initPair() {
    const common = [...this.obs[0].keys()].filter((p) => this.obs[1].has(p));
    const x1 = common.map((p) => [this.obs[0].get(p).u, this.obs[0].get(p).v]), x2 = common.map((p) => [this.obs[1].get(p).u, this.obs[1].get(p).v]);
    const rs = ransacF(x1, x2, { thresh: 1.5, maxIters: 1000, rand: this.rand });
    const pose = relativePoseFromF(rs.F, this.K, this.K, x1, x2, rs.inl);
    const inA = x1.filter((_, i) => rs.inl[i]), inB = x2.filter((_, i) => rs.inl[i]);
    const ref = refineRelativePose(pose.R, pose.t, this.K, this.K, inA, inB); // 在内点上最小化 Sampson 误差
    pose.R = ref.R; pose.t = ref.t;
    this.est[0] = { R: I3(), t: [0, 0, 0] }; this.est[1] = { R: pose.R, t: pose.t };
    this.reg = [0, 1];
    const g = this.sc.cams[1];
    this.initInl = rs.inl; this.initPairPts = common;
    return {
      N: common.length, inliers: rs.count, iters: rs.iters, cheirality: pose.cands.map((c) => c.front), best: pose.best,
      rotErr: rotAngle(mul3(T3(pose.R), g.R)) * 180 / Math.PI, tErr: angleBetween(pose.t, g.t) * 180 / Math.PI,
      fp: rs.inl.filter((v, i) => v && this.obs[1].get(common[i]).out || v && this.obs[0].get(common[i]).out).length,
    };
  }
  triangulateNew(cam) {
    const added = [], rejected = { angle: 0, reproj: 0, few: 0 };
    const regSet = new Set(this.reg);
    for (let p = 0; p < this.sc.nPts; p++) {
      if (this.pts.has(p)) continue;
      const list = this.reg.filter((c) => this.obs[c].has(p));
      if (list.length < 2 || !list.includes(cam) && cam > 1) continue;
      const uv = (c) => { const o = this.obs[c].get(p); return [o.u, o.v]; };
      let best = null;
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const cams = [this.camObj(list[a]), this.camObj(list[b])];
        const X = triangulateDLT(cams, [uv(list[a]), uv(list[b])]);
        if (!X.every(Number.isFinite)) continue;
        const inl = list.filter((c) => { const q = projectCam(this.camObj(c), X); return q[2] > 0 && Math.hypot(q[0] - uv(c)[0], q[1] - uv(c)[1]) < MAX_REPROJ; });
        if (inl.length >= 2 && (!best || inl.length > best.inl.length)) best = { X, inl };
      }
      if (!best) { rejected.reproj++; continue; }
      const cams = best.inl.map((c) => this.camObj(c)), uvs = best.inl.map(uv);
      const X = triangulateRefine(cams, uvs, best.X);
      let ang = 0;
      for (let a = 0; a < cams.length; a++) for (let b = a + 1; b < cams.length; b++) ang = Math.max(ang, triAngleDeg(camCenter(cams[a]), camCenter(cams[b]), X));
      const errs = reprojErrors(cams, uvs, X);
      if (ang < MIN_ANGLE) { rejected.angle++; continue; }
      if (Math.max(...errs) > MAX_REPROJ || cams.some((c) => depthOf(c, X) <= 0)) { rejected.reproj++; continue; }
      this.pts.set(p, X); this.track.set(p, new Set(best.inl)); added.push(p);
    }
    return { added, rejected };
  }
  registerPnP(cam) {
    const ps = [...this.obs[cam].keys()].filter((p) => this.pts.has(p));
    const X = ps.map((p) => this.pts.get(p)), uv = ps.map((p) => [this.obs[cam].get(p).u, this.obs[cam].get(p).v]);
    const r = pnpRansac(X, uv, this.K, { thresh: 3, rand: this.rand, maxIters: 400 });
    if (!r) return { ok: false, N: ps.length };
    this.est[cam] = { R: r.R, t: r.t }; this.reg.push(cam);
    const inlP = [], outP = [];
    ps.forEach((p, i) => { if (r.inl[i]) { inlP.push(p); this.track.get(p).add(cam); } else outP.push(p); });
    const g = this.sc.cams[cam], Ce = camCenter(this.est[cam]);
    return { ok: true, N: ps.length, inliers: inlP.length, inlP, outP, iters: r.iters, trueOut: outP.filter((p) => this.obs[cam].get(p).out).length, rotErr: rotAngle(mul3(T3(r.R), g.R)) * 180 / Math.PI, posErr: norm(sub(Ce, scale(camCenter(g), this.s))) };
  }
  bundle() {
    const regIdx = new Map(this.reg.map((c, i) => [c, i]));
    const ptIds = [...this.pts.keys()].filter((p) => this.track.get(p).size >= 2), pIdx = new Map(ptIds.map((p, i) => [p, i]));
    const obs = [];
    for (const p of ptIds) for (const c of this.track.get(p)) { const o = this.obs[c].get(p); obs.push({ c: regIdx.get(c), p: pIdx.get(p), u: o.u, v: o.v, ref: [c, p] }); }
    const ba = new BundleAdjuster(this.reg.map((c) => this.est[c]), this.K, ptIds.map((p) => this.pts.get(p)), obs, { huber: 2, fixed: new Set([0]) });
    const mre0 = ba.mre();
    const hist = ba.run(15);
    this.reg.forEach((c, i) => { this.est[c] = ba.cams[i]; });
    ptIds.forEach((p, i) => this.pts.set(p, ba.pts[i]));
    // 过滤：重投影误差过大的观测从轨迹里去掉；观测数 < 2 的点删除
    let removedObs = 0, removedPts = 0;
    for (let i = 0; i < obs.length; i++) {
      const r = ba.residual(i);
      if (Math.hypot(r[0], r[1]) > MAX_REPROJ) { this.track.get(obs[i].ref[1]).delete(obs[i].ref[0]); removedObs++; }
    }
    for (const p of ptIds) if (this.track.get(p).size < 2) { this.pts.delete(p); this.track.delete(p); removedPts++; }
    return { mre0, mre1: ba.mre(), iters: hist.length, removedObs, removedPts, hist: hist.map((h) => h.mre) };
  }
  /** 当前的 MRE（只用轨迹内观测）与对真值的误差（相似变换对齐后） */
  metrics() {
    let s = 0, n = 0;
    for (const [p, X] of this.pts) for (const c of this.track.get(p)) {
      const o = this.obs[c].get(p), q = projectCam(this.camObj(c), X); s += Math.hypot(q[0] - o.u, q[1] - o.v); n++;
    }
    const ids = [...this.pts.keys()];
    let rmse = NaN, camErr = NaN;
    if (ids.length >= 4) {
      const A = ids.map((p) => this.pts.get(p)), B = ids.map((p) => this.sc.pts[p]);
      const T = umeyama(A, B);
      rmse = Math.sqrt(A.reduce((a, q, i) => a + norm(sub(applySim(T, q), B[i])) ** 2, 0) / A.length);
      camErr = Math.sqrt(this.reg.reduce((a, c) => a + norm(sub(applySim(T, camCenter(this.est[c])), camCenter(this.sc.cams[c]))) ** 2, 0) / this.reg.length);
      this.alignScale = T.s;
    }
    return { mre: n ? s / n : NaN, nObs: n, nPts: this.pts.size, nReg: this.reg.length, rmse, camErr, gtScale: this.s };
  }
}
