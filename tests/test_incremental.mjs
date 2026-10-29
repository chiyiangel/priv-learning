import { makeScene } from '../sfm/triangulation/js/lib/synth.js';
import { IncrementalDemo } from '../sfm/triangulation/js/lib/incremental.js';
for (const seed of [7, 3, 21]) {
  const sc = makeScene({ nCams: 6, nPts: 90, seed, arcDeg: 80 });
  const d = new IncrementalDemo(sc, seed);
  const t0 = Date.now();
  console.log('--- seed', seed, 'obs', sc.obs.length, 'outliers', sc.obs.filter((o) => o.out).length);
  while (!d.done) {
    const r = d.next(); const m = r.metrics;
    const x = r.type === 'init' ? `inl ${r.inliers}/${r.N} rotErr ${r.rotErr.toFixed(2)} tErr ${r.tErr.toFixed(2)} cheir ${r.cheirality}`
      : r.type === 'tri' ? `added ${r.added.length} rej ${JSON.stringify(r.rejected)}`
      : r.type === 'pnp' ? (r.ok ? `N ${r.N} inl ${r.inliers} trueOut ${r.trueOut} out ${r.outP.length} rotErr ${r.rotErr.toFixed(2)} posErr ${r.posErr.toFixed(3)}` : 'FAILED')
      : `mre ${r.mre0.toFixed(2)} -> ${r.mre1.toFixed(2)} removedObs ${r.removedObs} removedPts ${r.removedPts}`;
    console.log(`${r.type}${r.cam ?? ''}: ${x} | reg ${m.nReg} pts ${m.nPts} MRE ${m.mre.toFixed(3)} rmse ${m.rmse.toFixed(3)} camErr ${m.camErr.toFixed(3)}`);
  }
  console.log('ms', Date.now() - t0);
}
