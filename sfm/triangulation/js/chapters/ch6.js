import { h, widget, button, stat, legend, slider } from '../ui.js';
import { View3D, THREE, makeFrustum, placeCam, setFrustumColor, Lines, Cloud, axesGrid } from '../view3d.js';
import { makeScene } from '../lib/synth.js';
import { IncrementalDemo } from '../lib/incremental.js';
import { camCenter } from '../lib/geom.js';
import { scale, mulv3, T3 } from '../lib/linalg.js';

const TRACK_COL = { 2: '#5b6b86', 3: '#5cc8ff', 4: '#6ee7a0', 5: '#ffd166', 6: '#ff9f43' };
const hexTo = (c) => new THREE.Color(c).toArray();

export default function init(root) {
  const body = widget(root, '增量重建演示', '点“下一步”，一步步看点云如何长大');
  let seed = 7, demo, last = null, timer = null, nCams = 6;
  const btns = h('div', { class: 'btns' });
  const next = button('下一步 ▶', () => step(), 'primary');
  const auto = button('自动播放', () => toggleAuto());
  const reset = button('重置', () => resetDemo());
  const newScene = button('换一个随机场景', () => { seed += 1; resetDemo(); });
  btns.append(next, auto, reset, newScene);
  body.append(btns);
  const chips = h('div', { class: 'legend', style: { margin: '0 0 8px' } }); body.append(chips);
  const v = new View3D(body, { height: 470, pos: [9, -7, -8], target: [0, 0, 10], caption: '估计的重建结果（以图 0 为原点，初始基线 = 1）' });
  v.el.style.marginBottom = '10px';
  v.add(axesGrid(14, 6));
  const frus = []; for (let i = 0; i < 8; i++) { const f = makeFrustum(0x4a5568, 0.7); f.visible = false; v.add(f); frus.push(f); }
  const camLbls = []; for (let i = 0; i < 8; i++) { const l = v.label('', [0, 0, 0]); l.visible = false; camLbls.push(l); }
  const cloud = new Cloud(5, 0xffffff); v.add(cloud.obj);
  const ghost = new Cloud(3, 0x6b7690, { opacity: 0.35 }); v.add(ghost.obj);
  const lines = new Lines(0x6ee7a0, { opacity: 0.55 }); v.add(lines.obj);
  const cap = h('div', { class: 'caption' }); body.append(cap);
  const stats = h('div', { class: 'stats' }); body.append(stats);
  const st = { reg: stat('已注册图像'), pts: stat('三角化 3D 点'), mre: stat('MRE（轨迹内观测）'), rmse: stat('3D 点 RMSE（对真值，相似变换对齐后）'), prog: stat('进度') };
  Object.values(st).forEach((s) => stats.append(s.el));
  body.append(legend([['#5b6b86', '轨迹长度 2'], ['#5cc8ff', '3'], ['#6ee7a0', '4'], ['#ffd166', '5'], ['#ff9f43', '6'], ['#f472b6', '本步新增的点'], ['#6b7690', '尚未重建的点（真值位置）']]));
  body.append(legend([['#6ee7a0', 'PnP 内点（相机→3D 点）', true], ['#ff6b7a', 'PnP 外点（误匹配）', true]]));
  body.append(h('div', { class: 'note', style: { marginTop: '8px' } }, '场景是合成的：80 个点、6 台相机沿圆弧排列，观测带 0.5 px 噪声、20% 随机漏检、4% 的错误匹配。注册顺序固定为 2,3,4,5（COLMAP 实际按“可见已三角化点最多”选下一张）。每次点击都是真实调用 8 点法 / RANSAC / PnP / DLT / BA 的结果。'));

  function resetDemo() {
    clearInterval(timer); timer = null; auto.textContent = '自动播放';
    const sc = makeScene({ nCams, nPts: 80, seed, arcDeg: 80 });
    demo = new IncrementalDemo(sc, seed); last = null; next.disabled = false;
    const cen = [0, 0, 0]; sc.pts.forEach((p) => { for (let k = 0; k < 3; k++) cen[k] += p[k] * demo.s / sc.pts.length; });
    v.controls.target.set(...cen); v.camera.position.set(cen[0] + 4.5, cen[1] - 3.5, cen[2] - 6.5); v.controls.update();
    cap.innerHTML = '<b>初始状态</b>：已知 6 张图像的特征匹配（带噪声和误匹配），还没有任何位姿和 3D 点。点“下一步”开始：先挑图 0、图 1 做两视图初始化。';
    draw();
  }
  function step() {
    if (demo.done) return;
    last = demo.next();
    describe(last);
    draw();
    if (demo.done) { next.disabled = true; clearInterval(timer); timer = null; auto.textContent = '自动播放'; }
  }
  function toggleAuto() {
    if (timer) { clearInterval(timer); timer = null; auto.textContent = '自动播放'; return; }
    if (demo.done) resetDemo();
    auto.textContent = '■ 暂停'; step(); timer = setInterval(step, 1700);
  }
  function describe(r) {
    const m = r.metrics, f = (x, d = 2) => x.toFixed(d);
    let t = '';
    if (r.type === 'init') t = `<b>① 两视图初始化（图 0、图 1）</b>：${r.N} 个匹配做 8 点法 + RANSAC，内点 ${r.inliers}（${r.iters} 次迭代）。分解 E 得 4 个候选，前方点数 = ${r.cheirality.join(' / ')} → 选第 ${r.best + 1} 个，再在内点上最小化 Sampson 误差精化。与真值对比：旋转误差 ${f(r.rotErr)}°，平移方向误差 ${f(r.tErr)}°。图 0 取为原点，基线长度定义为 1。`;
    else if (r.type === 'tri') t = `<b>${r.cam === 1 ? '② 首次三角化' : `④ 三角化新点（图 ${r.cam} 加入后）`}</b>：对被 ≥2 张已注册图像看到、但还没有 3D 坐标的轨迹做 DLT + 重投影精化，新增 <b>${r.added.length}</b> 个点（粉色）；${r.rejected.reproj + r.rejected.angle} 个被丢弃（重投影误差 > 4 px、深度为负或三角化角度 < 1.5°）。当前 MRE = ${f(m.mre)} px。`;
    else if (r.type === 'pnp') t = r.ok ? `<b>③ 注册图 ${r.cam}（PnP + RANSAC）</b>：图 ${r.cam} 的特征里有 ${r.N} 个对应到已有 3D 点（2D–3D 对应，线段）。RANSAC 内点 ${r.inliers}（绿），剔除 ${r.outP.length} 个外点（红，其中 ${r.trueOut} 个确实是误匹配）。与真值相比位姿误差：旋转 ${f(r.rotErr)}°，位置 ${f(r.posErr, 3)}（单位基线）。`
      : `图 ${r.cam}：2D–3D 对应太少（${r.N}），PnP 失败。`;
    else t = `<b>⑤ 光束法平差（图 0 固定，Huber 核 2 px）</b>：${r.iters} 次 LM 迭代，MRE ${f(r.mre0)} → ${f(r.mre1)} px；过滤掉 ${r.removedObs} 个观测、${r.removedPts} 个点。对真值 RMSE = ${f(m.rmse, 3)}（单位基线）。`;
    cap.innerHTML = t;
  }
  function draw() {
    const d = demo, s = d.s, m = d.metrics();
    // 相机
    for (let i = 0; i < 8; i++) {
      if (i >= d.n) { frus[i].visible = false; camLbls[i].visible = false; continue; }
      frus[i].visible = true;
      let cam, color;
      if (d.est[i]) { cam = d.est[i]; color = (last && last.type === 'pnp' && last.cam === i) ? '#ffffff' : (i === 0 ? '#5cc8ff' : '#ffb454'); }
      else { // 真值（缩放到估计坐标系）幽灵
        const g = d.sc.cams[i], C = scale(camCenter(g), d.s); cam = { R: g.R, t: scale(mulv3(g.R, C), -1) }; color = '#4a5568';
      }
      placeCam(frus[i], cam); setFrustumColor(frus[i], color);
      const C = camCenter(cam); camLbls[i].visible = true; camLbls[i].pos = [C[0], C[1] - 0.45, C[2]]; camLbls[i].set(String(i)); camLbls[i].el.style.color = d.est[i] ? '#e6edf6' : '#6b7690';
    }
    // 点
    const pts = [], cols = [], gh = [];
    const fresh = new Set(last && last.type === 'tri' ? last.added : []);
    for (let p = 0; p < d.sc.nPts; p++) {
      if (d.pts.has(p)) { pts.push(d.pts.get(p)); const n = d.track.get(p).size; cols.push(fresh.has(p) ? hexTo('#f472b6') : hexTo(TRACK_COL[Math.min(6, Math.max(2, n))])); }
      else gh.push(scale(d.sc.pts[p], s));
    }
    cloud.set(pts, cols); ghost.set(gh);
    // PnP 连线
    const L = [];
    if (last && last.type === 'pnp' && last.ok) {
      const C = camCenter(d.est[last.cam]);
      for (const p of last.inlP) L.push([C, d.pts.get(p), [0.43, 0.9, 0.63]]);
      for (const p of last.outP) L.push([C, d.pts.get(p), [1, 0.42, 0.48]]);
    }
    lines.set(L);
    // 统计
    st.reg.set(`${m.nReg} / ${d.n}`); st.pts.set(String(m.nPts)); st.mre.set(Number.isFinite(m.mre) ? m.mre.toFixed(2) + ' px' : '–');
    st.rmse.set(Number.isFinite(m.rmse) ? m.rmse.toFixed(3) : '–'); st.prog.set(`${d.stage} / ${d.stages.length}`);
    chips.innerHTML = '';
    d.stages.forEach((sg, i) => {
      const nm = { init: '初始化', tri: '三角化', pnp: 'PnP', ba: 'BA' }[sg.type] + (sg.type !== 'init' && sg.cam > 1 || sg.type === 'pnp' ? ` 图${sg.cam}` : '');
      chips.append(h('span', { style: { padding: '1px 8px', borderRadius: '99px', border: '1px solid ' + (i === d.stage - 1 ? 'var(--accent)' : 'var(--line)'), background: i < d.stage ? '#12303f' : 'transparent', color: i < d.stage ? 'var(--text)' : 'var(--muted)' } }, nm));
    });
    v.invalidate();
  }
  resetDemo();
}
