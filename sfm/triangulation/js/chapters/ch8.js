import { h, widget, button, Canvas2D, text, dot, drawLine } from '../ui.js';
import { genTwoView } from '../lib/twoview.js';
import { ransacF, relativePoseFromF, fundamental8, epipolarDesignSV, triAngleDeg, camCenter } from '../lib/geom.js';
import { K0 } from '../lib/synth.js';
import { rng, normalize, scale, mulv3, angleBetween, rotAngle, mul3, T3 } from '../lib/linalg.js';

const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const deg = (r) => r * 180 / Math.PI;
const tick = () => new Promise((r) => setTimeout(r, 0));
const DIR0 = normalize([1, 0.1, 0.15]);

function poseErr(d, pose, ref) {
  return { dt: deg(angleBetween(pose.t, ref ?? d.cam2.t)), dR: deg(rotAngle(mul3(T3(pose.R), d.cam2.R))) };
}
function barChart(ctx, w, hh, labels, values, { color = '#ffb454', max = null, unit = '°', sub = null } = {}) {
  const L = 14, B = 44, T = 18, n = values.length, mx = max ?? Math.max(...values, 1e-9) * 1.1, bw = (w - 2 * L) / n;
  values.forEach((v, i) => {
    const x = L + i * bw + bw * 0.15, ww = bw * 0.7, hgt = Math.min(1, v / mx) * (hh - B - T);
    ctx.fillStyle = color; ctx.fillRect(x, hh - B - hgt, ww, hgt);
    text(ctx, v.toFixed(v < 10 ? 1 : 0) + unit, x + ww / 2, hh - B - hgt - 4, '#e6edf6', 11, 'center');
    text(ctx, labels[i], x + ww / 2, hh - B + 14, '#93a1b8', 11, 'center');
    if (sub) text(ctx, sub[i], x + ww / 2, hh - B + 28, '#6b7690', 10.5, 'center');
  });
}

export default function init(root) {
  const body = widget(root, '故障实验室：让 SfM 失败给你看', '每个实验都在浏览器里真的跑 8 点法 + RANSAC');
  const tabs = h('div', { class: 'tabs' }), pane = h('div');
  body.append(tabs, pane);
  const defs = [
    { id: 'rot', name: '① 纯旋转 / 小基线' },
    { id: 'plane', name: '② 平面场景' },
    { id: 'out', name: '③ 误匹配' },
    { id: 'drift', name: '④ 尺度漂移' },
  ];
  let cur = 'rot';
  const panes = {};
  function show(id) { cur = id; tabs.innerHTML = ''; defs.forEach((d) => tabs.append(button(d.name, () => show(d.id), d.id === cur ? 'on' : ''))); pane.innerHTML = ''; pane.append(panes[id]); panes[id].querySelector && panes[id].dispatchEvent(new Event('shown')); }

  // ---------- ① ----------
  {
    const p = h('div'); panes.rot = p;
    p.append(h('p', {}, '相机几乎不平移（只转动）时，两条射线几乎平行：对极几何退化，平移方向和深度都无法确定。实验：固定场景深度约 6–14 m，改变基线 b，每个 b 重复 6 次（噪声 0.5 px，10% 误匹配），统计恢复的平移方向误差。'));
    const btn = button('运行实验', async () => {
      btn.disabled = true; out.textContent = '计算中…';
      const bs = [0, 0.02, 0.1, 0.3, 0.8, 1.5], res = [];
      for (const b of bs) {
        const dts = [], drs = [], ang = [];
        for (let s = 1; s <= 6; s++) {
          const d = genTwoView({ N: 80, noise: 0.5, outFrac: 0.1, seed: s, baseline: b });
          const rs = ransacF(d.x1, d.x2, { thresh: 1.5, maxIters: 400, rand: rng(s) });
          const pose = relativePoseFromF(rs.F, K0, K0, d.x1, d.x2, rs.inl);
          const e = poseErr(d, pose, scale(mulv3(d.cam2.R, DIR0), -1));
          dts.push(e.dt); drs.push(e.dR);
          ang.push(d.X.reduce((a, X) => a + triAngleDeg([0, 0, 0], camCenter(d.cam2), X), 0) / d.X.length);
        }
        res.push({ b, dt: med(dts), dR: med(drs), ang: med(ang) });
        await tick();
      }
      cv.data = res; cv.redraw();
      out.textContent = '基线 b | 平均三角化角度 | 平移方向误差(中位) | 旋转误差(中位)\n' + res.map((r) => `${r.b.toFixed(2).padStart(5)} m | ${r.ang.toFixed(2).padStart(7)}° | ${r.dt.toFixed(1).padStart(8)}° | ${r.dR.toFixed(2).padStart(6)}°`).join('\n') +
        '\n结论：b→0 时平移方向误差趋向随机（b=0 时 t 根本不存在）；旋转估计仍然不差——纯旋转可以用单应 H 估计 R，但无法三角化。COLMAP 会检测这种情形（H 的内点占比高、三角化角度小）并把图像对标成“纯旋转”，不用于初始化，也不三角化。';
      btn.disabled = false;
    }, 'primary');
    let cv = null; cv = new Canvas2D(p, { aspect: 0.32, caption: '平移方向误差（越小越好）· 横轴：基线 b（米），下方为平均三角化角度', onDraw: (ctx, w, hh) => { if (cv && cv.data) barChart(ctx, w, hh, cv.data.map((r) => 'b=' + r.b), cv.data.map((r) => r.dt), { sub: cv.data.map((r) => 'θ≈' + r.ang.toFixed(1) + '°') }); } });
    const out = h('div', { class: 'readout' });
    p.append(h('div', { class: 'btns' }, btn), cv.el, out);
  }
  // ---------- ② ----------
  {
    const p = h('div'); panes.plane = p;
    p.append(h('p', {}, '所有点落在同一个平面上时，两视图的对应关系可以用单应 H 完全解释，8 点法的设计矩阵 A 秩亏：不是 1 个而是 3 个奇异值≈0，F 不再唯一，位姿估计变得很不稳定。下面画出 A 的 9 个奇异值（对数轴，已除以最大奇异值）。'));
    const btn = button('运行实验', async () => {
      btn.disabled = true; out.textContent = '计算中…';
      const sv = (planar, noise) => { const d = genTwoView({ N: 80, noise, outFrac: 0, seed: 4, planar }); const S = epipolarDesignSV(d.x1, d.x2); return S.map((v) => v / S[0]); };
      cvs.data = [{ title: '一般 3D 场景（噪声 0.5 px）', s: sv(false, 0.5) }, { title: '平面场景（噪声 0.5 px）', s: sv(true, 0.5) }];
      cvs.forEach((c) => c.redraw());
      const rowsErr = {};
      for (const planar of [false, true]) {
        const dts = [], drs = [];
        for (let s = 1; s <= 8; s++) {
          const d = genTwoView({ N: 80, noise: 0.5, outFrac: 0.1, seed: s, planar });
          const rs = ransacF(d.x1, d.x2, { thresh: 1.5, maxIters: 400, rand: rng(s) });
          const e = poseErr(d, relativePoseFromF(rs.F, K0, K0, d.x1, d.x2, rs.inl));
          dts.push(e.dt); drs.push(e.dR); await tick();
        }
        rowsErr[planar] = { dt: med(dts), dR: med(drs) };
      }
      out.textContent = `中位误差（8 次试验，10% 误匹配，噪声 0.5 px）\n一般场景：平移方向 ${rowsErr[false].dt.toFixed(1)}°，旋转 ${rowsErr[false].dR.toFixed(2)}°\n平面场景：平移方向 ${rowsErr[true].dt.toFixed(1)}°，旋转 ${rowsErr[true].dR.toFixed(2)}°\n` +
        '结论：平面场景下，同样的算法位姿明显变差。实际系统会同时估计 H 和 E/F 并比较内点数，发现“H 能解释几乎所有匹配”时改用 H 分解求位姿（COLMAP 中的 PLANAR 配置）。';
      btn.disabled = false;
    }, 'primary');
    const mk = (i) => new Canvas2D(p, { aspect: 0.55, onDraw: (ctx, w, hh) => {
      const D = cvs && cvs.data && cvs.data[i]; if (!D) return;
      text(ctx, D.title, 8, 16, '#e6edf6', 12);
      const L = 40, B = 24, T = 26, n = 9, bw = (w - L - 8) / n;
      const lo = -17, hi = 0;
      ctx.strokeStyle = '#1c2431'; for (let e = lo; e <= hi; e += 4) { const y = T + (1 - (e - lo) / (hi - lo)) * (hh - T - B); drawLine(ctx, [L, y], [w - 8, y], '#1c2431'); text(ctx, '1e' + e, L - 4, y + 4, '#6b7690', 10, 'right'); }
      D.s.forEach((v, k) => { const lg = Math.max(lo, Math.log10(Math.max(v, 1e-17))); const hgt = (lg - lo) / (hi - lo) * (hh - T - B); const near0 = v < 1e-2;
        ctx.fillStyle = near0 ? '#ff6b7a' : '#5cc8ff'; ctx.fillRect(L + k * bw + 4, hh - B - hgt, bw - 8, hgt); text(ctx, 'σ' + (k + 1), L + k * bw + bw / 2, hh - 8, '#93a1b8', 10.5, 'center'); });
      text(ctx, `≈0 的奇异值个数（<1e-2）：${D.s.filter((v) => v < 1e-2).length}`, w - 8, 16, '#ffd166', 11, 'right');
    } });
    let cvs = null; cvs = [mk(0), mk(1)];
    const row = h('div', { class: 'row' }); const a = h('div', { class: 'col' }), b = h('div', { class: 'col' }); row.append(a, b); a.append(cvs[0].el); b.append(cvs[1].el);
    const out = h('div', { class: 'readout' });
    p.append(h('div', { class: 'btns' }, btn), row, out);
  }
  // ---------- ③ ----------
  {
    const p = h('div'); panes.out = p;
    p.append(h('p', {}, '8 点法是最小二乘：一个离谱的误匹配就能把解拉偏。对比“对所有匹配直接 8 点法”与“RANSAC + 8 点法”在不同误匹配比例下的旋转误差（6 次试验中位数，N=100，噪声 0.5 px）。'));
    const btn = button('运行实验', async () => {
      btn.disabled = true; out.textContent = '计算中…'; const rows = [];
      for (const o of [0, 0.05, 0.1, 0.2, 0.3, 0.5]) {
        const a = [], c = [];
        for (let s = 1; s <= 6; s++) {
          const d = genTwoView({ N: 100, noise: 0.5, outFrac: o, seed: s });
          a.push(poseErr(d, relativePoseFromF(fundamental8(d.x1, d.x2), K0, K0, d.x1, d.x2)).dR);
          const rs = ransacF(d.x1, d.x2, { thresh: 1.5, maxIters: 800, rand: rng(s) });
          c.push(poseErr(d, relativePoseFromF(rs.F, K0, K0, d.x1, d.x2, rs.inl)).dR);
        }
        rows.push({ o, plain: med(a), ransac: med(c) }); await tick();
      }
      cv.rows = rows; cv.redraw();
      out.textContent = '误匹配比例 | 直接 8 点法 旋转误差 | RANSAC+8 点法 旋转误差\n' + rows.map((r) => `${(r.o * 100).toFixed(0).padStart(6)}%   | ${r.plain.toFixed(2).padStart(10)}°        | ${r.ransac.toFixed(2).padStart(10)}°`).join('\n') +
        '\n注意：没有误匹配时两者都不错（RANSAC 只用阈值内的内点，精度略有差别）；一旦出现误匹配，直接最小二乘的误差会急剧变大。';
      btn.disabled = false;
    }, 'primary');
    let cv = null; cv = new Canvas2D(p, { aspect: 0.34, caption: '旋转误差（°）：红 = 直接 8 点法；绿 = RANSAC', onDraw: (ctx, w, hh) => {
      if (!cv || !cv.rows) return; const n = cv.rows.length, mx = Math.max(...cv.rows.map((r) => r.plain), 1) * 1.1, L = 14, B = 34, T = 14, bw = (w - 2 * L) / n;
      cv.rows.forEach((r, i) => { const x = L + i * bw;
        [[r.plain, '#ff6b7a', 0], [r.ransac, '#6ee7a0', 1]].forEach(([v, c, k]) => { const hgt = Math.min(1, v / mx) * (hh - B - T); ctx.fillStyle = c; ctx.fillRect(x + bw * (0.1 + 0.4 * k), hh - B - hgt, bw * 0.38, hgt); text(ctx, v.toFixed(1), x + bw * (0.29 + 0.4 * k), hh - B - hgt - 3, '#e6edf6', 10.5, 'center'); });
        text(ctx, (r.o * 100).toFixed(0) + '%', x + bw / 2, hh - 14, '#93a1b8', 11, 'center'); });
    } });
    const out = h('div', { class: 'readout' });
    p.append(h('div', { class: 'btns' }, btn), cv.el, out);
  }
  // ---------- ④ ----------
  {
    const p = h('div'); panes.drift = p;
    p.append(h('p', {}, '单目的尺度只在初始化时被“基线 = 1”钉死。之后每张新图像靠 PnP 沿用已有点云的尺度，但每一步都有微小误差，沿长轨迹累积，就是尺度漂移（也包括位置和旋转漂移）。回到起点时，首尾对不上。'));
    p.append(h('ul', {}, h('li', {}, '缓解：回环检测 + 位姿图/全局 BA，让首尾约束拉回；'), h('li', {}, '定期全局 BA（COLMAP 在模型增长一定比例后做），而不只是局部 BA；'), h('li', {}, '外部约束：GPS、IMU、已知尺寸的物体，把无尺度模型对齐到公制；'), h('li', {}, '全局式 SfM 一次性优化，不逐帧累积，但对相对位姿误匹配更敏感。')));
    p.append(h('div', { class: 'note' }, '这个现象需要很长的序列才明显，本页不做合成演示，避免给出没有验证过的数字。你在 Spirula 里用的 IMU/GPS 先验和 gauge 拟合，正是用来约束这一类漂移与尺度的。'));
  }
  show('rot');
}
