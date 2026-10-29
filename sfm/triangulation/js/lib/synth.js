// 合成场景生成：相机沿圆弧环绕一团 3D 点，世界系固定为第 0 个相机坐标系。
import { rng, mulv3, T3, sub, scale, add, mul3 } from './linalg.js';
import { lookAt, projectCam, camCenter } from './geom.js';

export const IMG = { w: 1280, h: 960 };
export const K0 = { f: 900, cx: 640, cy: 480 };

/** 生成场景。opts: nCams, nPts, arcDeg(总弧度), radius, seed, noise(px), dropout, outliers(误匹配比例) */
export function makeScene({ nCams = 6, nPts = 80, arcDeg = 80, radius = 9, seed = 7, noise = 0.5, dropout = 0.2, outliers = 0.04, box = [3, 1.6, 1.6] } = {}) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < nPts; i++) pts.push([(r() * 2 - 1) * box[0], (r() * 2 - 1) * box[1], (r() * 2 - 1) * box[2]]);
  // 世界系 W：y 向下；相机在 xz 平面圆弧上略高于场景（y<0），看向原点
  const camsW = [];
  for (let i = 0; i < nCams; i++) {
    const a = (nCams === 1 ? 0 : (i / (nCams - 1) - 0.5)) * arcDeg * Math.PI / 180;
    const C = [Math.sin(a) * radius, -2.2, -Math.cos(a) * radius];
    camsW.push({ ...lookAt(C, [0, 0, 0]), K: K0 });
  }
  // 变换到第 0 个相机坐标系：X' = R0 (X − C0)
  const R0 = camsW[0].R, C0 = camCenter(camsW[0]);
  const ptsC = pts.map((p) => mulv3(R0, sub(p, C0)));
  const cams = camsW.map((c) => {
    const R = mul3(c.R, T3(R0));
    const C = mulv3(R0, sub(camCenter(c), C0));
    return { R, t: scale(mulv3(R, C), -1), K: K0 };
  });
  const obs = []; // {c,p,u,v,out,gu,gv}
  for (let c = 0; c < nCams; c++) for (let p = 0; p < nPts; p++) {
    const q = projectCam(cams[c], ptsC[p]);
    if (q[2] <= 0 || q[0] < 0 || q[0] >= IMG.w || q[1] < 0 || q[1] >= IMG.h) continue;
    if (r() < dropout) continue;
    let u = q[0] + r.gauss() * noise, v = q[1] + r.gauss() * noise, out = false;
    if (r() < outliers) { u = r() * IMG.w; v = r() * IMG.h; out = true; }
    obs.push({ c, p, u, v, out, gu: q[0], gv: q[1] });
  }
  return { K: K0, cams, pts: ptsC, obs, nCams, nPts, noise };
}
/** 对某相机的观测 → Map(pointIdx → obs) */
export function obsByCam(scene) {
  const m = Array.from({ length: scene.nCams }, () => new Map());
  for (const o of scene.obs) m[o.c].set(o.p, o);
  return m;
}
/** 给相机与点加扰动（旋转 rotDeg 度、平移 trans、点 ptSigma） */
export function perturb(scene, { rotDeg = 2, trans = 0.15, ptSigma = 0.2, seed = 3 } = {}) {
  const r = rng(seed);
  const expm = (w) => { const th = Math.hypot(...w); if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const k = w.map((v) => v / th); const K = [0, -k[2], k[1], k[2], 0, -k[0], -k[1], k[0], 0];
    const K2 = mul3(K, K); return [1, 0, 0, 0, 1, 0, 0, 0, 1].map((v, i) => v + Math.sin(th) * K[i] + (1 - Math.cos(th)) * K2[i]); };
  const cams = scene.cams.map((c, i) => i === 0 ? { R: c.R.slice(), t: c.t.slice() } : {
    R: mul3(expm([r.gauss(), r.gauss(), r.gauss()].map((v) => v * rotDeg * Math.PI / 180)), c.R),
    t: add(c.t, [r.gauss() * trans, r.gauss() * trans, r.gauss() * trans]),
  });
  const pts = scene.pts.map((p) => add(p, [r.gauss() * ptSigma, r.gauss() * ptSigma, r.gauss() * ptSigma]));
  return { cams, pts };
}
