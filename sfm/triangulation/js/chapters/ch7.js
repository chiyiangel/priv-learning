import { h, slider, checkbox, widget, button, stat, legend, Canvas2D, lineChart } from '../ui.js';
import { View3D, THREE, makeFrustum, placeCam, setFrustumColor, Cloud, Lines, axesGrid } from '../view3d.js';
import { makeScene, perturb, K0 } from '../lib/synth.js';
import { BundleAdjuster } from '../lib/ba.js';
import { umeyama, applySim, camCenter } from '../lib/geom.js';
import { mul3, T3, mulv3, scale, sub, norm } from '../lib/linalg.js';

export default function init(root) {
  const body = widget(root, 'Gauss-Newton / LM 光束法平差', '扰动初始值，然后迭代，看 MRE 下降');
  const S = { rot: 2.5, trans: 0.25, pt: 0.25, huber: true, outliers: true, seed: 8 };
  let sc, ba, hist, timer = null, lastInfo = null;
  const ctl = h('div', { class: 'controls' });
  const sl = {
    rot: slider({ label: '相机旋转扰动', min: 0, max: 6, step: 0.1, value: S.rot, fmt: (v) => v.toFixed(1) + '°', onInput: (v) => { S.rot = v; reset(); } }),
    trans: slider({ label: '相机平移扰动', min: 0, max: 0.6, step: 0.01, value: S.trans, fmt: (v) => v.toFixed(2) + ' m', onInput: (v) => { S.trans = v; reset(); } }),
    pt: slider({ label: '3D 点位置扰动', min: 0, max: 0.8, step: 0.01, value: S.pt, fmt: (v) => v.toFixed(2) + ' m', onInput: (v) => { S.pt = v; reset(); } }),
  };
  Object.values(sl).forEach((s) => ctl.append(s.el));
  const cb1 = checkbox({ label: '使用 Huber 鲁棒核 (2 px)', value: S.huber, onChange: (v) => { S.huber = v; reset(); } });
  const cb2 = checkbox({ label: '数据含 5% 误匹配观测', value: S.outliers, onChange: (v) => { S.outliers = v; reset(true); } });
  const cb3 = checkbox({ label: '显示真值（灰色）', value: true, onChange: () => draw() });
  ctl.append(cb1.el, cb2.el, cb3.el);
  body.append(ctl);
  const run = button('运行至收敛', () => runAuto(), 'primary'), one = button('单步 LM 迭代', () => { stop(); iterate(); }), rs = button('重置初值', () => reset());
  body.append(h('div', { class: 'btns' }, one, run, rs));
  const row = h('div', { class: 'row' }); body.append(row);
  const c1 = h('div', { class: 'col' }), c2 = h('div', { class: 'col' }); row.append(c1, c2);
  const v = new View3D(c1, { height: 420, pos: [9, -7, -6], target: [0, 0, 5], caption: '彩色 = 当前估计（相似变换对齐到真值）；灰色 = 真值' });
  v.add(axesGrid(12, 5));
  const frs = []; for (let i = 0; i < 6; i++) { const f = makeFrustum(0xffb454, 0.8); f.visible = false; v.add(f); frs.push(f); }
  const gfr = []; for (let i = 0; i < 6; i++) { const f = makeFrustum(0x4a5568, 0.8); f.visible = false; v.add(f); gfr.push(f); }
  const gc = new Cloud(3, 0x6b7690, { opacity: 0.5 }); v.add(gc.obj);
  const ec = new Cloud(5, 0x6ee7a0); v.add(ec.obj);
  const link = new Lines(0xf472b6, { opacity: 0.55 }); v.add(link.obj);
  const chart = new Canvas2D(c2, { aspect: 0.62, caption: '平均重投影误差 MRE（像素，对数轴）vs LM 迭代次数', onDraw: (ctx, w, hh) => {
    if (!hist) return;
    lineChart(ctx, w, hh, [{ data: hist.map((x) => x.all), color: '#ffb454', label: '全部观测' }, { data: hist.map((x) => x.inl), color: '#6ee7a0', label: '仅真内点' }], { logY: true, xlabel: '迭代', ylabel: 'MRE (px)' });
  } });
  const stats = h('div', { class: 'stats' }); c2.append(stats);
  const st = { mre: stat('MRE（全部观测）'), inl: stat('MRE（仅真内点）'), lam: stat('阻尼 λ'), rmse: stat('3D 点 RMSE（对真值）'), cam: stat('相机位置 RMSE') };
  Object.values(st).forEach((s) => stats.append(s.el));
  const info = h('div', { class: 'readout', style: { marginTop: '8px' } }); c2.append(info);
  body.append(legend([['#ffb454', '全部观测的平均误差（含误匹配）'], ['#6ee7a0', '只统计真内点的平均误差'], ['#f472b6', '估计点 → 真值点（误差）', true]]));
  body.append(h('div', { class: 'note', style: { marginTop: '8px' } }, '试试：① 关掉 Huber，保留误匹配：误匹配的残差达几百像素，平方损失被它们主导，把好点也拉偏（“仅真内点”误差降不下来）；② 打开 Huber：误匹配被降权，真内点 MRE 收敛到约 0.5 px（≈ 噪声水平）；③ 把扰动调大，看 LM 是否仍能收敛（扰动太大会落入局部极小）。'));

  function reset(newScene = false) {
    stop();
    if (newScene || !sc) sc = makeScene({ nCams: 5, nPts: 60, seed: S.seed, arcDeg: 70, outliers: S.outliers ? 0.05 : 0, dropout: 0.15 });
    const p = perturb(sc, { rotDeg: S.rot, trans: S.trans, ptSigma: S.pt, seed: 21 });
    ba = new BundleAdjuster(p.cams, K0, p.pts, sc.obs, { huber: S.huber ? 2 : 0, fixed: new Set([0]) });
    hist = [snap()]; lastInfo = null; draw();
  }
  const good = (o) => !o.out;
  const snap = () => ({ all: ba.mre(), inl: ba.mre(good), lam: ba.lambda });
  function iterate() {
    lastInfo = ba.step({ compareDense: true });
    hist.push(snap()); draw();
    return lastInfo;
  }
  function stop() { clearInterval(timer); timer = null; run.textContent = '运行至收敛'; }
  function runAuto() {
    if (timer) { stop(); return; }
    run.textContent = '■ 停止'; let n = 0;
    timer = setInterval(() => { const r = iterate(); n++; if (n >= 25 || (r.accepted && r.relDecrease < 1e-7)) stop(); }, 280);
  }
  function draw() {
    const T = umeyama(ba.pts, sc.pts), showGT = cb3.value;
    const cams = ba.cams.map((c) => { const Rn = mul3(c.R, T3(T.R)), C = applySim(T, camCenter(c)); return { R: Rn, t: scale(mulv3(Rn, C), -1) }; });
    cams.forEach((c, i) => { frs[i].visible = true; placeCam(frs[i], c); setFrustumColor(frs[i], i === 0 ? 0x5cc8ff : 0xffb454); gfr[i].visible = showGT; placeCam(gfr[i], sc.cams[i]); });
    const E = ba.pts.map((p) => applySim(T, p));
    ec.set(E, E.map(() => '#6ee7a0'));
    gc.set(showGT ? sc.pts : []);
    link.set(showGT ? E.map((p, i) => [p, sc.pts[i]]) : []);
    const rmse = Math.sqrt(E.reduce((a, p, i) => a + norm(sub(p, sc.pts[i])) ** 2, 0) / E.length);
    const camE = Math.sqrt(cams.reduce((a, c, i) => a + norm(sub(camCenter(c), camCenter(sc.cams[i]))) ** 2, 0) / cams.length);
    const s = hist[hist.length - 1];
    st.mre.set(s.all.toFixed(2) + ' px'); st.inl.set(s.inl.toFixed(2) + ' px', s.inl < 0.8 ? 'good' : s.inl > 3 ? 'bad' : 'warn');
    st.lam.set(ba.lambda.toExponential(1)); st.rmse.set(rmse.toFixed(3) + ' m'); st.cam.set(camE.toFixed(3) + ' m');
    const nc = ba.nc, np = ba.pts.length;
    info.textContent = `迭代 ${ba.iter}  ·  待优化量：${nc} 台相机 × 6 + ${np} 个点 × 3 = ${6 * nc + 3 * np} 维（图 0 固定作规范）\n` +
      `Schur 消元后只需解 ${6 * nc} 维的相机系统 S（点块 V 是 3×3 块对角，逐点求逆）\n` +
      (lastInfo ? `上一步：${lastInfo.accepted ? '接受（代价下降）' : '拒绝（代价未降，λ×4）'}；Schur 解 vs 稠密 ${lastInfo.full}×${lastInfo.full} 解的最大差异 = ${lastInfo.diff.abs.toExponential(1)}（相对 ${lastInfo.diff.rel.toExponential(1)}）→ 两者等价` : '点“单步 LM 迭代”查看 Schur 解与稠密解的对比');
    chart.redraw(); v.invalidate();
  }
  reset(true);
}
