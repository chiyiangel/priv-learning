import * as L from '../sfm/triangulation/js/lib/linalg.js';
import * as G from '../sfm/triangulation/js/lib/geom.js';
import { BundleAdjuster } from '../sfm/triangulation/js/lib/ba.js';
import { makeScene, perturb, K0, IMG, obsByCam } from '../sfm/triangulation/js/lib/synth.js';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const r = L.rng(5);

// SVD
{
  const A = Array.from({ length: 12 }, () => Array.from({ length: 5 }, () => r.gauss()));
  const { U, S, V } = L.svd(A);
  let e = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 5; j++) { let s = 0; for (let k = 0; k < 5; k++) s += U[i][k] * S[k] * V[j][k]; e = Math.max(e, Math.abs(s - A[i][j])); }
  ok(e < 1e-12, 'SVD reconstruct err ' + e.toExponential(2));
  const M = [1, 2, 3, 4, 5, 6, 7, 8, 10];
  const s3 = L.svd3(M);
  const Rec = L.mul3(s3.U, L.mul3([s3.S[0], 0, 0, 0, s3.S[1], 0, 0, 0, s3.S[2]], L.T3(s3.V)));
  ok(Math.max(...Rec.map((v, i) => Math.abs(v - M[i]))) < 1e-10 && Math.abs(L.det3(s3.U) - 1) < 1e-10 && Math.abs(L.det3(s3.V) - 1) < 1e-10, 'svd3 reconstruct, dets=+1');
  const M2 = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // rank 2
  const t2 = L.svd3(M2);
  const Rec2 = L.mul3(t2.U, L.mul3([t2.S[0], 0, 0, 0, t2.S[1], 0, 0, 0, t2.S[2]], L.T3(t2.V)));
  ok(Math.max(...Rec2.map((v, i) => Math.abs(v - M2[i]))) < 1e-9, 'svd3 rank-2 reconstruct');
}

// 两视图：8 点 + RANSAC
function twoView(nPts, noise, outFrac, baseline = 1, seed = 1) {
  const rr = L.rng(seed);
  const R = L.expSO3([0.05, 0.25, -0.03]);
  const C2 = [baseline, 0.1 * baseline, 0.15 * baseline];
  const cam1 = { R: L.I3(), t: [0, 0, 0], K: K0 };
  const cam2 = { R, t: L.scale(L.mulv3(R, C2), -1), K: K0 };
  const X = [], x1 = [], x2 = [], out = [];
  for (let i = 0; i < nPts; i++) {
    const P = [(rr() * 2 - 1) * 3, (rr() * 2 - 1) * 2, 6 + rr() * 6];
    const a = G.projectCam(cam1, P), b = G.projectCam(cam2, P);
    X.push(P);
    x1.push([a[0] + rr.gauss() * noise, a[1] + rr.gauss() * noise]);
    let q = [b[0] + rr.gauss() * noise, b[1] + rr.gauss() * noise];
    const o = rr() < outFrac; if (o) q = [rr() * IMG.w, rr() * IMG.h];
    out.push(o); x2.push(q);
  }
  return { cam1, cam2, X, x1, x2, out, R, C2 };
}
{
  const d = twoView(60, 0, 0);
  const F = G.fundamental8(d.x1, d.x2);
  const res = Math.max(...d.x1.map((p, i) => Math.abs(G.epipolarResidual(F, p, d.x2[i]))));
  ok(res < 1e-6, 'F8 noise-free residual ' + res.toExponential(2));
  const Etrue = G.essentialFromPose(d.cam2.R, d.cam2.t);
  const Ftrue = G.fundamentalFromE(Etrue, K0, K0);
  const rtrue = Math.max(...d.x1.map((p, i) => Math.abs(G.epipolarResidual(Ftrue, p, d.x2[i]))));
  ok(rtrue < 1e-7, 'true F satisfies x2^T F x1=0: ' + rtrue.toExponential(2));
}
{
  let rotErrs = [], tErrs = [], passes = 0;
  for (let s = 1; s <= 10; s++) {
    const d = twoView(120, 0.7, 0.3, 1, s);
    const rs = G.ransacF(d.x1, d.x2, { thresh: 1.5, rand: L.rng(s + 100) });
    const pose = G.relativePoseFromF(rs.F, K0, K0, d.x1, d.x2, rs.inl);
    const dR = L.rotAngle(L.mul3(L.T3(pose.R), d.cam2.R)) * 180 / Math.PI;
    const td = d.cam2.t; // 真值 t = -R C2
    const dt = L.angleBetween(pose.t, td) * 180 / Math.PI;
    rotErrs.push(dR); tErrs.push(dt);
    const outIn = rs.inl.filter((v, i) => v && d.out[i]).length;
    if (outIn <= 2) passes++;
  }
  console.log('rot err deg', rotErrs.map((v) => v.toFixed(3)).join(' '));
  console.log('t dir err deg', tErrs.map((v) => v.toFixed(3)).join(' '));
  ok(Math.max(...rotErrs) < 2 && Math.max(...tErrs) < 8, 'RANSAC 30% outliers noise .7px pose OK');
  ok(passes >= 9, 'outliers rejected ' + passes + '/10');
}
// 4 个候选：只有一个通过 cheirality
{
  const d = twoView(80, 0.3, 0, 1, 3);
  const rs = G.ransacF(d.x1, d.x2, { rand: L.rng(9) });
  const pose = G.relativePoseFromF(rs.F, K0, K0, d.x1, d.x2, rs.inl);
  console.log('cheirality front counts', pose.cands.map((c) => c.front + '/' + c.total).join(' '), 'best', pose.best);
  ok(pose.cands.filter((c) => c.front > 0.9 * c.total).length === 1, 'exactly one candidate passes cheirality');
}
// 三角化
{
  const d = twoView(1, 0, 0, 1, 11);
  const X = d.X[0];
  const Xd = G.triangulateDLT([d.cam1, d.cam2], [d.x1[0], d.x2[0]]);
  const Xm = G.triangulateMidpoint([d.cam1, d.cam2], [d.x1[0], d.x2[0]]);
  ok(L.norm(L.sub(Xd, X)) < 1e-8, 'DLT exact ' + L.norm(L.sub(Xd, X)).toExponential(2));
  ok(L.norm(L.sub(Xm, X)) < 1e-8, 'midpoint exact');
  // 加噪后 GN 的重投影误差应不大于 DLT
  const rr = L.rng(2); let better = 0, N = 200, md = 0, mm = 0;
  for (let i = 0; i < N; i++) {
    const uv = [[d.x1[0][0] + rr.gauss(), d.x1[0][1] + rr.gauss()], [d.x2[0][0] + rr.gauss(), d.x2[0][1] + rr.gauss()]];
    const A = G.triangulateDLT([d.cam1, d.cam2], uv), B = G.triangulateRefine([d.cam1, d.cam2], uv, A), M = G.triangulateMidpoint([d.cam1, d.cam2], uv);
    const ea = G.rms(G.reprojErrors([d.cam1, d.cam2], uv, A)), eb = G.rms(G.reprojErrors([d.cam1, d.cam2], uv, B));
    if (eb <= ea + 1e-9) better++;
    md += L.norm(L.sub(A, X)) / N; mm += L.norm(L.sub(M, X)) / N;
  }
  ok(better === N, 'refine ≤ DLT reproj in all samples (' + better + '/' + N + ')');
  console.log('mean 3D err DLT', md.toFixed(4), 'midpoint', mm.toFixed(4));
  const ang = G.triAngleDeg(G.camCenter(d.cam1), G.camCenter(d.cam2), X);
  console.log('tri angle', ang.toFixed(2));
}
// PnP
{
  const sc = makeScene({ nCams: 4, nPts: 100, seed: 4, noise: 0.5, outliers: 0.1 });
  const c = 2; const X = [], uv = [], bad = [];
  for (const o of sc.obs) if (o.c === c) { X.push(sc.pts[o.p]); uv.push([o.u, o.v]); bad.push(o.out); }
  const est = G.pnpRansac(X, uv, K0, { rand: L.rng(3) });
  const Ct = G.camCenter(sc.cams[c]), Ce = G.camCenter({ R: est.R, t: est.t });
  console.log('PnP N', X.length, 'inliers', est.count, 'bad total', bad.filter(Boolean).length, 'iters', est.iters);
  ok(L.norm(L.sub(Ct, Ce)) < 0.05 && L.rotAngle(L.mul3(L.T3(est.R), sc.cams[c].R)) * 180 / Math.PI < 0.3, 'PnP pose err pos ' + L.norm(L.sub(Ct, Ce)).toFixed(4) + ' rot ' + (L.rotAngle(L.mul3(L.T3(est.R), sc.cams[c].R)) * 180 / Math.PI).toFixed(3));
  ok(est.inl.filter((v, i) => v && bad[i]).length === 0, 'PnP rejects outliers');
}
// BA + Schur vs dense
{
  const sc = makeScene({ nCams: 5, nPts: 50, seed: 8, noise: 0.5, outliers: 0.05 });
  const pt = perturb(sc, { rotDeg: 1.5, trans: 0.12, ptSigma: 0.15 });
  for (const huber of [0, 2]) {
    const ba = new BundleAdjuster(pt.cams, K0, pt.pts, sc.obs, { huber });
    const m0 = ba.mre();
    const first = ba.step({ compareDense: true });
    ok(first.diff.rel < 1e-6, `Schur vs dense update rel diff ${first.diff.rel.toExponential(2)} (reduced ${first.reduced} vs full ${first.full})`);
    const hist = ba.run(40);
    const good = (o) => !o.out;
    console.log(`huber=${huber}: MRE ${m0.toFixed(3)} -> ${ba.mre().toFixed(3)}, inlier-only MRE ${ba.mre(good).toFixed(3)}, iters ${hist.length}`);
    ok(ba.mre() < m0 && (huber === 0 || ba.mre(good) < 1.0), 'BA reduces MRE (huber ' + huber + ')');
    const T = G.umeyama(ba.pts, sc.pts);
    const err = Math.sqrt(ba.pts.reduce((s, p, i) => s + L.norm(L.sub(G.applySim(T, p), sc.pts[i])) ** 2, 0) / ba.pts.length);
    console.log('  3D rmse after sim-align', err.toFixed(4));
  }
  // 无扰动先验：噪声为零下收敛到 0
  const sc0 = makeScene({ nCams: 4, nPts: 40, seed: 2, noise: 0, outliers: 0 });
  const p0 = perturb(sc0, { rotDeg: 1, trans: 0.1, ptSigma: 0.1 });
  const ba0 = new BundleAdjuster(p0.cams, K0, p0.pts, sc0.obs);
  ba0.run(60);
  ok(ba0.mre() < 1e-3, 'noise-free BA converges to ~0 : ' + ba0.mre().toExponential(2));
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
