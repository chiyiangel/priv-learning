import { genTwoView } from '../sfm/triangulation/js/lib/twoview.js';
import { epipolarDesignSV, ransacF, relativePoseFromF, fundamental8 } from '../sfm/triangulation/js/lib/geom.js';
import { K0 } from '../sfm/triangulation/js/lib/synth.js';
import * as L from '../sfm/triangulation/js/lib/linalg.js';
for (const planar of [false, true]) for (const noise of [0, 0.5]) {
  const d = genTwoView({ N: 80, noise, outFrac: 0, seed: 4, planar });
  const S = epipolarDesignSV(d.x1, d.x2);
  console.log('planar', planar, 'noise', noise, S.map((v) => (v / S[0]).toExponential(1)).join(' '));
}
// pure rotation / small baseline
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const dir0 = L.normalize([1, 0.1, 0.15]);
for (const b of [0, 0.01, 0.05, 0.2, 0.6, 1.5]) {
  const dts = [], drs = [];
  for (let s = 1; s <= 6; s++) {
    const d = genTwoView({ N: 80, noise: 0.5, outFrac: 0.1, seed: s, baseline: b });
    const rs = ransacF(d.x1, d.x2, { thresh: 1.5, maxIters: 400, rand: L.rng(s) });
    const pose = relativePoseFromF(rs.F, K0, K0, d.x1, d.x2, rs.inl);
    const ref = L.scale(L.mulv3(d.cam2.R, dir0), -1);
    dts.push(L.angleBetween(pose.t, ref) * 180 / Math.PI); drs.push(L.rotAngle(L.mul3(L.T3(pose.R), d.cam2.R)) * 180 / Math.PI);
  }
  console.log('b', b, 'dt median', med(dts).toFixed(1), 'dR median', med(drs).toFixed(2));
}
// planar pose error
for (const planar of [false, true]) { const dts = [], drs = [];
  for (let s = 1; s <= 8; s++) { const d = genTwoView({ N: 80, noise: 0.5, outFrac: 0.1, seed: s, planar });
    const rs = ransacF(d.x1, d.x2, { thresh: 1.5, maxIters: 400, rand: L.rng(s) });
    const pose = relativePoseFromF(rs.F, K0, K0, d.x1, d.x2, rs.inl);
    dts.push(L.angleBetween(pose.t, d.cam2.t) * 180 / Math.PI); drs.push(L.rotAngle(L.mul3(L.T3(pose.R), d.cam2.R)) * 180 / Math.PI); }
  console.log('planar', planar, 'dt', dts.map((v) => v.toFixed(1)).join(' '), '| dR', drs.map((v) => v.toFixed(1)).join(' ')); }
// outliers plain vs ransac
for (const o of [0, 0.1, 0.3, 0.5]) { const a = [], c = [];
  for (let s = 1; s <= 6; s++) { const d = genTwoView({ N: 100, noise: 0.5, outFrac: o, seed: s });
    const F = fundamental8(d.x1, d.x2); const p1 = relativePoseFromF(F, K0, K0, d.x1, d.x2);
    const rs = ransacF(d.x1, d.x2, { thresh: 1.5, maxIters: 800, rand: L.rng(s) }); const p2 = relativePoseFromF(rs.F, K0, K0, d.x1, d.x2, rs.inl);
    a.push(L.rotAngle(L.mul3(L.T3(p1.R), d.cam2.R)) * 180 / Math.PI); c.push(L.rotAngle(L.mul3(L.T3(p2.R), d.cam2.R)) * 180 / Math.PI); }
  console.log('out', o, 'plain dR median', med(a).toFixed(2), 'ransac', med(c).toFixed(2)); }
