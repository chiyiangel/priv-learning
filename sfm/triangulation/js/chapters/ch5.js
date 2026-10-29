import { h, slider, widget, Canvas2D, drawLine, dot, text, button, legend } from '../ui.js';
import { View3D, THREE, makeFrustum, placeCam, Lines, Cloud, axesGrid } from '../view3d.js';
import { lookAt, projectCam, camCenter, pixelRay, triangulateDLT, triangulateMidpoint, triangulateRefine, rayClosest, reprojErrors, rms, triAngleDeg } from '../lib/geom.js';
import { sub, add, scale, norm, normalize, dot as vdot, rng } from '../lib/linalg.js';
import { K0, IMG } from '../lib/synth.js';

const M = 300;
const COL = { mid: '#f472b6', dlt: '#5cc8ff', gn: '#ffffff', truth: '#6ee7a0' };

export default function init(root) {
  const body = widget(root, '三角化与深度不确定性', '改变基线 / 噪声，观察 Monte Carlo 点云');
  const S = { b: 1.0, sigma: 1.0, Z: 8, seed: 11 };
  let Z = null; // 随机 z-score
  const reseed = () => { const r = rng(S.seed); Z = Array.from({ length: M + 1 }, () => [r.gauss(), r.gauss(), r.gauss(), r.gauss()]); };
  reseed();
  const ctl = h('div', { class: 'controls' });
  const sl = {
    b: slider({ label: '基线 b (m)', min: 0.02, max: 4, step: 0.01, value: S.b, fmt: (v) => v.toFixed(2), onInput: (v) => { S.b = v; upd(); } }),
    sigma: slider({ label: '像素噪声 σ（每个坐标）', min: 0, max: 3, step: 0.05, value: S.sigma, fmt: (v) => v.toFixed(2) + ' px', onInput: (v) => { S.sigma = v; upd(); } }),
    Z: slider({ label: '点的深度 Z (m)', min: 3, max: 30, step: 0.5, value: S.Z, fmt: (v) => v.toFixed(1), onInput: (v) => { S.Z = v; upd(); } }),
  };
  Object.values(sl).forEach((s) => ctl.append(s.el));
  body.append(ctl, h('div', { class: 'btns' }, button('重新抽取噪声', () => { S.seed++; reseed(); upd(); }, 'primary'), button('3D 视图聚焦到点', () => focus3d()), button('预设：小基线 + 大噪声', () => { S.b = 0.1; S.sigma = 2; S.Z = 15; sl.b.set(S.b); sl.sigma.set(S.sigma); sl.Z.set(S.Z); focused = false; upd(); }), button('预设：默认', () => { S.b = 1; S.sigma = 1; S.Z = 8; sl.b.set(S.b); sl.sigma.set(S.sigma); sl.Z.set(S.Z); focused = false; upd(); })));

  let ST = null, focused = false;
  const row = h('div', { class: 'row' }); body.append(row);
  const c1 = h('div', { class: 'col' }), c2 = h('div', { class: 'col' }); row.append(c1, c2);
  const v = new View3D(c1, { height: 400, pos: [3, -2, 4], target: [0, 0, 8], caption: '3D：本次噪声样本的两条射线 + 300 个 DLT 样本' });
  v.camera.near = 0.001; v.camera.updateProjectionMatrix();
  const f1 = makeFrustum(0x5cc8ff, 0.5), f2 = makeFrustum(0xffb454, 0.5); v.add(f1); v.add(f2);
  const rays = new Lines(0xffb454, { opacity: 0.95 }); v.add(rays.obj);
  const perp = new Lines(0xffd166); v.add(perp.obj);
  const cloud = new Cloud(2.5, 0x5cc8ff, { opacity: 0.55 }); v.add(cloud.obj);
  const marks = new Cloud(10, 0xffffff); v.add(marks.obj);
  const lt = v.label('真值 X', [0, 0, 0], '#6ee7a0');
  const cv = new Canvas2D(c2, { aspect: 1, caption: '俯视图（x–z 平面，等比例放大到点云附近）', onDraw: draw });
  c2.append(legend([[COL.truth, '真值'], [COL.mid, '中点法'], [COL.dlt, 'DLT'], [COL.gn, '最小重投影误差'], ['rgba(92,200,255,.6)', 'DLT 的 300 个噪声样本']]));
  const tbl = h('div'); body.append(tbl);
  const info = h('div', { class: 'readout', style: { marginTop: '8px' } }); body.append(info);
  body.append(h('div', { class: 'note', style: { marginTop: '8px' } }, '默认参数下三种方法几乎一样（两视图、噪声小时它们都近似最大似然）。差别在“小基线 + 大噪声”时显现：我们实测（b=0.1, Z=15, σ=2 px, 300 次平均）中点法平均 3D 误差约 5.2 m，DLT 约 8.8 m；但重投影误差中点法 1.48 px，DLT 1.15 px——重投影误差最小的解，3D 误差不一定最小。试试：把基线拉到最小（0.02）再拉大——点云从沿视线方向的长条变成接近圆形；横向误差几乎不变，深度误差反比于基线。再把深度拉到 30，深度误差按 Z² 增长。'));

  function setup() {
    const T = [0.3, 0.1, S.Z];
    const C = [[-S.b / 2, 0, 0], [S.b / 2, 0, 0]];
    const cams = C.map((c) => ({ ...lookAt(c, [0, 0, S.Z]), K: K0 }));
    return { T, C, cams, ideal: cams.map((c) => projectCam(c, T)) };
  }
  function solveAll(cams, uv) {
    const mid = triangulateMidpoint(cams, uv), dlt = triangulateDLT(cams, uv), gn = triangulateRefine(cams, uv, dlt);
    return { mid, dlt, gn };
  }
  function upd() {
    const sc = setup(); const { T, C, cams, ideal } = sc;
    const noisy = (z) => cams.map((_, i) => [ideal[i][0] + z[2 * i] * S.sigma, ideal[i][1] + z[2 * i + 1] * S.sigma]);
    // 当前样本 = Z[M]
    const cur = noisy(Z[M]);
    const sol = solveAll(cams, cur);
    // Monte Carlo
    const dir = normalize(sub(T, scale(add(C[0], C[1]), 0.5)));
    const res = { mid: [], dlt: [], gn: [] };
    for (let k = 0; k < M; k++) { const s = solveAll(cams, noisy(Z[k])); for (const key of Object.keys(res)) res[key].push(sub(s[key], T)); }
    const stat = (E) => {
      const n = E.length; const dep = E.map((e) => vdot(e, dir));
      const mean = dep.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(dep.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
      let lat2 = 0; E.forEach((e, i) => { const p = sub(e, scale(dir, dep[i])); lat2 += vdot(p, p); });
      // 横向：减去均值
      const mp = E.reduce((a, e, i) => add(a, sub(e, scale(dir, dep[i]))), [0, 0, 0]).map((x) => x / n);
      let l2 = 0; E.forEach((e, i) => { const p = sub(sub(e, scale(dir, dep[i])), mp); l2 += vdot(p, p); });
      return { sd, bias: mean, lat: Math.sqrt(l2 / n / 2) };
    };
    const stats = { mid: stat(res.mid), dlt: stat(res.dlt), gn: stat(res.gn) };
    const rp = (X) => rms(reprojErrors(cams, cur, X));
    const ang = triAngleDeg(C[0], C[1], T);
    const theo = S.Z * S.Z / (K0.f * S.b) * Math.SQRT2 * S.sigma;
    ST = { sc, cur, sol, res, stats, dir, ang, theo };
    // 表格
    const f = (x, d = 4) => (x >= 1 ? x.toFixed(2) : x.toFixed(d));
    const names = { mid: ['中点法', COL.mid], dlt: ['线性 DLT', COL.dlt], gn: ['最小化重投影误差', COL.gn] };
    tbl.innerHTML = '';
    tbl.append(h('table', { class: 't' }, h('tr', {}, ...['方法', '本次样本重投影误差 RMS', '本次 3D 误差', 'MC 深度 σ', 'MC 深度偏差', 'MC 横向 σ'].map((t) => h('th', {}, t))),
      ...['mid', 'dlt', 'gn'].map((k) => h('tr', {}, h('td', { style: { color: names[k][1] } }, names[k][0]),
        h('td', {}, rp(sol[k]).toFixed(3) + ' px'), h('td', {}, f(norm(sub(sol[k], T)), 4) + ' m'), h('td', {}, f(stats[k].sd) + ' m'), h('td', {}, (stats[k].bias >= 0 ? '+' : '') + stats[k].bias.toFixed(4) + ' m'), h('td', {}, f(stats[k].lat) + ' m')))));
    info.textContent = `三角化角度 θ = ${ang.toFixed(2)}°（COLMAP 默认丢弃 θ < 1.5° 的点${ang < 1.5 ? '——此时这个点会被丢弃' : ''}）\n` +
      `理论深度 σ ≈ √2·σ·Z²/(f·b) = ${theo.toFixed(4)} m（平行双目近似） ｜ MC(DLT) 实测 = ${stats.dlt.sd.toFixed(4)} m ｜ 深度 σ / 横向 σ ≈ ${(stats.dlt.sd / Math.max(stats.dlt.lat, 1e-12)).toFixed(1)} 倍` + (theo > 0.1 * S.Z ? '\n注意：深度不确定性已达到深度本身的量级，线性近似失效，噪声样本呈重尾分布，MC 的 σ 会被少数极端样本主导。' : '');
    // 3D
    placeCam(f1, cams[0]); placeCam(f2, cams[1]);
    const rr = cams.map((c, i) => pixelRay(c, cur[i]));
    const L = S.Z * 1.6;
    rays.set(rr.map((r) => [r.o, add(r.o, scale(r.d, L))]));
    const cl = rayClosest(rr[0].o, rr[0].d, rr[1].o, rr[1].d);
    perp.set([[cl.p1, cl.p2]]);
    cloud.set(res.dlt.map((e) => add(T, e)));
    marks.set([T, sol.mid, sol.dlt, sol.gn], [COL.truth, COL.mid, COL.dlt, COL.gn]);
    lt.pos = add(T, [0, -0.0, 0]);
    ST.cl = cl; ST.rr = rr;
    if (!focused) { focused = true; focus3d(); }
    cv.redraw(); v.invalidate();
  }
  function focus3d() {
    if (!ST) return;
    const ext = Math.max(ST.stats.dlt.sd * 6, ST.stats.dlt.lat * 10, 0.004);
    v.focus(ST.sc.T, Math.min(ext * 2, ST.sc.T[2]));
  }
  function draw(ctx, w, hh) {
    ctx.fillStyle = '#0b1018'; ctx.fillRect(0, 0, w, hh);
    if (!ST) return;
    const { sc, res, stats, sol, rr } = ST, T = sc.T;
    const H = Math.max(stats.dlt.sd * 3.4, stats.dlt.lat * 4, 1e-4); // 半窗口（米）
    const k = (w / 2) / H;
    const P = (X) => [w / 2 + (X[0] - T[0]) * k, hh / 2 - (X[2] - T[2]) * k];
    // 网格与比例尺
    const nice = (x) => { const e = Math.pow(10, Math.floor(Math.log10(x))); const m = x / e; return (m < 2 ? 1 : m < 5 ? 2 : 5) * e; };
    const g = nice(H / 3);
    ctx.strokeStyle = '#1c2431'; ctx.lineWidth = 1;
    for (let x = Math.ceil((T[0] - H) / g) * g; x < T[0] + H; x += g) drawLine(ctx, P([x, 0, T[2] - H]), P([x, 0, T[2] + H]), '#161e2b');
    for (let z = Math.ceil((T[2] - H) / g) * g; z < T[2] + H; z += g) drawLine(ctx, P([T[0] - H, 0, z]), P([T[0] + H, 0, z]), '#161e2b');
    drawLine(ctx, [12, hh - 14], [12 + g * k, hh - 14], '#93a1b8', 2); text(ctx, g >= 1 ? g + ' m' : g.toPrecision(1) + ' m', 14, hh - 20, '#93a1b8', 11);
    // 射线（俯视投影）：真值射线（虚线）与本次噪声射线
    const seg = (p0, d, color, wd, dash) => { // 只画窗口附近的一段，避免超大坐标
      const n = Math.hypot(d[0], d[2]) || 1, u = [d[0] / n, 0, d[2] / n];
      drawLine(ctx, P(add(p0, scale(u, -3 * H))), P(add(p0, scale(u, 3 * H))), color, wd, dash);
    };
    sc.C.forEach((C, i) => {
      seg(T, sub(T, C), 'rgba(147,161,184,.5)', 1, [4, 4]);
      const r = rr[i], s0 = vdot(sub(T, r.o), r.d);
      seg(add(r.o, scale(r.d, s0)), r.d, i ? 'rgba(255,180,84,.95)' : 'rgba(92,200,255,.95)', 1.4);
    });
    // 点云 + 2σ 椭圆（DLT）
    const pts = res.dlt.map((e) => [e[0], e[2]]);
    for (const p of pts) dot(ctx, P([T[0] + p[0], 0, T[2] + p[1]]), 1.8, 'rgba(92,200,255,.5)');
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, mz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let sxx = 0, szz = 0, sxz = 0; pts.forEach((p) => { sxx += (p[0] - mx) ** 2; szz += (p[1] - mz) ** 2; sxz += (p[0] - mx) * (p[1] - mz); });
    sxx /= pts.length; szz /= pts.length; sxz /= pts.length;
    const tr = sxx + szz, dt = sxx * szz - sxz * sxz, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - dt)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - dt));
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    ctx.save(); ctx.translate(...P([T[0] + mx, 0, T[2] + mz])); ctx.rotate(-ang); ctx.beginPath();
    ctx.ellipse(0, 0, 2 * Math.sqrt(Math.max(l1, 1e-24)) * k, 2 * Math.sqrt(Math.max(l2, 1e-24)) * k, 0, 0, 2 * Math.PI);
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    text(ctx, '2σ 椭圆', w - 64, 16, '#ffd166', 11);
    dot(ctx, P(sol.mid), 4, COL.mid, '#000'); dot(ctx, P(sol.dlt), 4, COL.dlt, '#000'); dot(ctx, P(sol.gn), 4, COL.gn, '#000'); dot(ctx, P(T), 5, COL.truth, '#000');
    text(ctx, '↓ 相机在下方（z 小）', w - 8, hh - 10, '#93a1b8', 11, 'right');
  }
  upd();
}
