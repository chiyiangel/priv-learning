import { h, slider, widget, Canvas2D, drawLine, dot, text, button, legend, stat } from '../ui.js';
import { projectCam, ransacF, relativePoseFromF, essentialFromPose } from '../lib/geom.js';
import { expSO3, mulv3, scale, sub, add, rng, rotAngle, mul3, T3, angleBetween, I3, norm } from '../lib/linalg.js';
import { IMG, K0 } from '../lib/synth.js';
import { genTwoView } from '../lib/twoview.js';

export default function init(root) {
  const body = widget(root, '8 点法 + RANSAC + 位姿分解', '调节参数，自动重新估计');
  const S = { N: 120, out: 30, noise: 0.7, th: 1.5, seed: 3 };
  let D = null, RES = null;
  let timer = null;
  const sched = () => { clearTimeout(timer); timer = setTimeout(run, 200); };
  const ctl = h('div', { class: 'controls' });
  const sl = {
    N: slider({ label: '匹配数 N', min: 30, max: 300, step: 10, value: S.N, onInput: (v) => { S.N = v; regen(); } }),
    out: slider({ label: '误匹配比例', min: 0, max: 70, step: 1, value: S.out, fmt: (v) => v + '%', onInput: (v) => { S.out = v; regen(); } }),
    noise: slider({ label: '像素噪声 σ', min: 0, max: 3, step: 0.1, value: S.noise, fmt: (v) => v.toFixed(1) + ' px', onInput: (v) => { S.noise = v; regen(); } }),
    th: slider({ label: 'RANSAC 内点阈值（Sampson 距离）', min: 0.5, max: 6, step: 0.1, value: S.th, fmt: (v) => v.toFixed(1) + ' px', onInput: (v) => { S.th = v; sched(); } }),
  };
  Object.values(sl).forEach((s) => ctl.append(s.el));
  body.append(ctl, h('div', { class: 'btns' }, button('重新生成数据', () => { S.seed++; regen(); }), button('重跑 RANSAC（换随机种子）', () => { run(true); }, 'primary')));

  const mcv = new Canvas2D(body, { aspect: 0.3, caption: '左：图像 1　右：图像 2　（连线 = 一个匹配）', onDraw: drawMatches });
  body.append(legend([['#6ee7a0', 'RANSAC 内点', true], ['#ff6b7a', 'RANSAC 外点', true], ['#6b7690', '尚未运行', true]]));
  const stats = h('div', { class: 'stats' });
  const st = { inl: stat('内点 / 总数'), it: stat('RANSAC 迭代'), fp: stat('混入内点的真误匹配', ''), fn: stat('被误杀的真内点'), rot: stat('旋转误差'), tdir: stat('平移方向误差'), nrm: stat('‖t‖：估计 / 真值') };
  Object.values(st).forEach((s) => stats.append(s.el));
  body.append(stats);
  body.append(h('h4', { style: { margin: '18px 0 4px' } }, '分解 E → 4 组候选 (R, t)，用 cheirality 检查选一组'));
  body.append(h('div', { class: 'note' }, '俯视图（x 向右，z 向上）：下方三角 = 相机 1（原点，朝上），橙色三角 = 候选的相机 2。点颜色：绿 = 在两个相机前方；黄 = 只在一个相机前方；红 = 在两个相机后方。'));
  const grid = h('div', { class: 'row', style: { marginTop: '8px' } }); body.append(grid);
  const cands = [0, 1, 2, 3].map((i) => {
    const col = h('div', { class: 'col', style: { flex: '1 1 200px' } }); grid.append(col);
    const info = h('div', { class: 'note', style: { marginTop: '4px', textAlign: 'center' } });
    const cv = new Canvas2D(col, { aspect: 1.05, onDraw: (ctx, w, hh) => drawTop(ctx, w, hh, i) });
    col.append(info);
    return { cv, info };
  });
  const out = h('div', { class: 'readout', style: { marginTop: '10px' } }); body.append(out);

  // 尺度模糊
  body.append(h('h4', { style: { margin: '18px 0 4px' } }, '尺度模糊：把场景和基线同时放大，图像一模一样'));
  const sSl = slider({ label: '放大倍数 s', min: 0.25, max: 5, step: 0.05, value: 2, fmt: (v) => '×' + v.toFixed(2), onInput: () => scaleDemo() });
  const sOut = h('div', { class: 'readout' });
  body.append(sSl.el, sOut);

  function regen() { D = genTwoView({ N: S.N, noise: S.noise, outFrac: S.out / 100, seed: S.seed }); RES = null; sched(); mcv.redraw(); scaleDemo(); }
  function run(newSeed = false) {
    if (!D) return;
    const t0 = performance.now();
    const rs = ransacF(D.x1, D.x2, { thresh: S.th, maxIters: 1500, rand: rng(newSeed ? (Math.random() * 1e9) | 0 : 12345) });
    if (!rs.F || rs.count < 8) { RES = { fail: true, rs }; render(); return; }
    const pose = relativePoseFromF(rs.F, K0, K0, D.x1, D.x2, rs.inl);
    RES = { rs, pose, ms: performance.now() - t0 };
    render();
  }
  function render() {
    mcv.redraw(); cands.forEach((c) => c.cv.redraw());
    if (!RES || RES.fail) { out.textContent = '内点不足，无法估计（尝试降低误匹配比例或提高阈值）'; Object.values(st).forEach((s) => s.set('–')); cands.forEach((c) => (c.info.textContent = '')); return; }
    const { rs, pose } = RES, N = D.x1.length;
    const fp = rs.inl.filter((v, i) => v && D.out[i]).length, fn = rs.inl.filter((v, i) => !v && !D.out[i]).length;
    const dR = rotAngle(mul3(T3(pose.R), D.cam2.R)) * 180 / Math.PI, dt = Math.min(angleBetween(pose.t, D.cam2.t), Math.PI - 0) * 180 / Math.PI;
    st.inl.set(`${rs.count} / ${N}`); st.it.set(String(rs.iters));
    st.fp.set(String(fp), fp ? 'warn' : 'good'); st.fn.set(String(fn));
    st.rot.set(dR.toFixed(2) + '°', dR < 1 ? 'good' : dR < 3 ? 'warn' : 'bad'); st.tdir.set(dt.toFixed(2) + '°', dt < 3 ? 'good' : dt < 8 ? 'warn' : 'bad');
    st.nrm.set(`1 / ${norm(D.C2).toFixed(2)}`);
    pose.cands.forEach((c, i) => {
      cands[i].info.innerHTML = `候选 ${i + 1}：(R${i < 2 ? '₁' : '₂'}, ${i % 2 ? '−' : '+'}t)<br>前方点 <b style="color:${i === pose.best ? 'var(--good)' : 'var(--text)'}">${c.front}/${c.total}</b>${i === pose.best ? ' ✓ 选中' : ''}`;
    });
    const Rt = pose.cands[pose.best];
    out.textContent = `被选中的候选 ${pose.best + 1}: 前方点 ${Rt.front}/${Rt.total}；其余候选的前方点数 = ${pose.cands.map((c) => c.front).join(' / ')}\n` +
      `真值平移 t_gt 的方向 = (${D.cam2.t.map((a) => (a / norm(D.cam2.t)).toFixed(3)).join(', ')})\n估计平移 t (单位长度) = (${pose.t.map((a) => a.toFixed(3)).join(', ')})  ← 只有方向可信，长度由我们设为 1\n耗时 ${RES.ms.toFixed(0)} ms`;
  }
  function drawMatches(ctx, w, hh) {
    ctx.fillStyle = '#0b1018'; ctx.fillRect(0, 0, w, hh);
    if (!D) return;
    const gap = 12, iw = (w - gap) / 2, k = iw / IMG.w, ih = IMG.h * k;
    const oy = (hh - ih) / 2;
    for (const ox of [0, iw + gap]) { ctx.fillStyle = '#0f151e'; ctx.fillRect(ox, oy, iw, ih); ctx.strokeStyle = '#2a3446'; ctx.strokeRect(ox + .5, oy + .5, iw - 1, ih - 1); }
    D.x1.forEach((p, i) => {
      const a = [p[0] * k, oy + p[1] * k], b = [iw + gap + D.x2[i][0] * k, oy + D.x2[i][1] * k];
      let c = 'rgba(147,161,184,.45)';
      if (RES && !RES.fail) c = RES.rs.inl[i] ? 'rgba(110,231,160,.75)' : 'rgba(255,107,122,.55)';
      drawLine(ctx, a, b, c, 1);
      dot(ctx, a, 1.8, c); dot(ctx, b, 1.8, c);
    });
  }
  function drawTop(ctx, w, hh, i) {
    ctx.fillStyle = '#0b1018'; ctx.fillRect(0, 0, w, hh);
    const X0 = [-9, 9], Z0 = [-14, 14];
    const sx = (x) => (x - X0[0]) / (X0[1] - X0[0]) * w, sz = (z) => hh - (z - Z0[0]) / (Z0[1] - Z0[0]) * hh;
    drawLine(ctx, [0, sz(0)], [w, sz(0)], '#1c2431'); drawLine(ctx, [sx(0), 0], [sx(0), hh], '#1c2431');
    if (!RES || RES.fail) return;
    const c = RES.pose.cands[i], good = i === RES.pose.best;
    for (const p of c.pts) {
      const col = p.z1 > 0 && p.z2 > 0 ? '#6ee7a0' : (p.z1 > 0 || p.z2 > 0) ? '#ffd166' : '#ff6b7a';
      if (p.X[0] < X0[0] || p.X[0] > X0[1] || p.X[2] < Z0[0] || p.X[2] > Z0[1]) continue;
      dot(ctx, [sx(p.X[0]), sz(p.X[2])], 2, col);
    }
    const C2 = scale(mulv3(T3(c.R), c.t), -1);
    const cam = (C, ang, color) => {
      const p = [sx(C[0]), sz(C[2])];
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-7, 6); ctx.lineTo(7, 6); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
    };
    cam([0, 0, 0], 0, '#5cc8ff');
    const f = mulv3(T3(c.R), [0, 0, 1]); // 相机 2 的朝向（世界系）
    cam(C2, Math.atan2(f[0], f[2]), '#ffb454');
    if (good) { ctx.strokeStyle = '#6ee7a0'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, hh - 2); }
  }
  function scaleDemo() {
    if (!D) return;
    const s = sSl.value, idx = [0, 1, 2].map((i) => i * Math.floor(D.X.length / 3));
    const R = D.cam2.R, C2 = D.C2;
    const lines = idx.map((i) => {
      const q0 = projectCam(D.cam2, D.X[i]);
      const cam2s = { R, t: scale(mulv3(R, scale(C2, s)), -1), K: K0 };
      const q1 = projectCam(cam2s, scale(D.X[i], s));
      const Z0 = D.X[i][2];
      return `点 ${i}: 深度 ${Z0.toFixed(2)} → ${(Z0 * s).toFixed(2)}   图2像素 (${q0[0].toFixed(3)}, ${q0[1].toFixed(3)}) → (${q1[0].toFixed(3)}, ${q1[1].toFixed(3)})   差 ${Math.hypot(q0[0] - q1[0], q0[1] - q1[1]).toExponential(1)} px`;
    });
    sOut.textContent = `基线长度 ${norm(C2).toFixed(2)} → ${(norm(C2) * s).toFixed(2)}\n` + lines.join('\n') + '\n结论：像素完全不变 ⇒ 仅凭图像无法确定尺度。SfM 把尺度定义成“初始基线 = 1”，之后再用 GPS/已知尺寸等外部信息对齐到公制。';
  }
  regen(); run();
}
