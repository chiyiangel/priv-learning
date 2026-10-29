// 合成两视图数据（用于第 4、8 章）
import { projectCam } from './geom.js';
import { expSO3, mulv3, scale, rng, I3 } from './linalg.js';
import { IMG, K0 } from './synth.js';

export function genTwoView({ N = 120, noise = 0.7, outFrac = 0.3, seed = 1, baseline = 1.2, planar = false, dir = [1, 0.1, 0.15] }) {
  const r = rng(seed);
  const R = expSO3([0.04, 0.22, -0.03]);
  const C2 = scale(dir, baseline);
  const cam1 = { R: I3(), t: [0, 0, 0], K: K0 };
  const cam2 = { R, t: scale(mulv3(R, C2), -1), K: K0 };
  const X = [], x1 = [], x2 = [], out = [];
  let guard = 0;
  while (X.length < N && guard++ < 20000) {
    const P = planar ? [(r() * 2 - 1) * 4, (r() * 2 - 1) * 2.5, 9 + (r() * 2 - 1) * 0.0 + 0.0] : [(r() * 2 - 1) * 4, (r() * 2 - 1) * 2.5, 6 + r() * 8];
    if (planar) { P[2] = 9 + 0.25 * P[0] + 0.1 * P[1]; }
    const a = projectCam(cam1, P), b = projectCam(cam2, P);
    if (a[0] < 0 || a[0] >= IMG.w || a[1] < 0 || a[1] >= IMG.h || b[0] < 0 || b[0] >= IMG.w || b[1] < 0 || b[1] >= IMG.h) continue;
    const o = r() < outFrac;
    X.push(P);
    x1.push([a[0] + r.gauss() * noise, a[1] + r.gauss() * noise]);
    x2.push(o ? [r() * IMG.w, r() * IMG.h] : [b[0] + r.gauss() * noise, b[1] + r.gauss() * noise]);
    out.push(o);
  }
  return { cam1, cam2, X, x1, x2, out, C2 };
}

