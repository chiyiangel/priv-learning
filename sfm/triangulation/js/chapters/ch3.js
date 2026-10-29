import { h, slider, checkbox, widget, Canvas2D, drawLine, dot, text, button, legend } from '../ui.js';
import { View3D, THREE, makeFrustum, placeCam, Lines, sphere, axesGrid } from '../view3d.js';
import { projectCam, camCenter, essentialFromPose, fundamentalFromE, epipolarLine, epipolarResidual, toNorm } from '../lib/geom.js';
import { expSO3, mulv3, scale, add, I3 } from '../lib/linalg.js';
import { IMG, K0 } from '../lib/synth.js';

const MX = 0.22 * IMG.w, MY = 0.22 * IMG.h; // 画布外延边距（图像坐标）
const VW = IMG.w + 2 * MX, VH = IMG.h + 2 * MY;

export default function init(root) {
  const body = widget(root, '极线实验室', '在左图移动鼠标/点击；拖滑块改变 3D 点的深度');
  const S = { b: 1.5, phi: 0, psi: 12, depth: 6, x1: [520, 400], locked: false, off: 0, bundle: false };
  const cam1 = { R: I3(), t: [0, 0, 0], K: K0 };
  let cam2, F, E, C2;
  const recompute = () => {
    const ph = S.phi * Math.PI / 180;
    C2 = [S.b * Math.cos(ph), 0, S.b * Math.sin(ph)];
    const R = expSO3([0, S.psi * Math.PI / 180, 0]);
    cam2 = { R, t: scale(mulv3(R, C2), -1), K: K0 };
    E = essentialFromPose(cam2.R, cam2.t); F = fundamentalFromE(E, K0, K0); const nf = Math.hypot(...F); F = F.map((x) => x / nf);
  };

  recompute();
  const ctl = h('div', { class: 'controls' });
  const sl = {
    depth: slider({ label: '3D 点沿射线移动：深度 Z₁ (m)', min: 1.5, max: 25, step: 0.05, value: S.depth, fmt: (v) => v.toFixed(2), onInput: (v) => { S.depth = v; upd(); } }),
    b: slider({ label: '基线长度 ‖C₂−C₁‖', min: 0.3, max: 4, step: 0.05, value: S.b, fmt: (v) => v.toFixed(2), onInput: (v) => { S.b = v; upd(); } }),
    phi: slider({ label: '运动方向（0°=侧移，90°=前进）', min: 0, max: 90, step: 1, value: S.phi, fmt: (v) => v + '°', onInput: (v) => { S.phi = v; upd(); } }),
    psi: slider({ label: '相机 2 偏航 ψ', min: -30, max: 30, step: 1, value: S.psi, fmt: (v) => v + '°', onInput: (v) => { S.psi = v; upd(); } }),
    off: slider({ label: '把 x₂ 沿极线法向挪开（模拟误匹配）', min: -40, max: 40, step: 0.5, value: 0, fmt: (v) => v.toFixed(1) + ' px', onInput: (v) => { S.off = v; upd(); } }),
  };
  Object.values(sl).forEach((s) => ctl.append(s.el));
  const bundle = checkbox({ label: '显示极线束（汇聚于极点）', onChange: (v) => { S.bundle = v; upd(); } });
  ctl.append(bundle.el);
  body.append(ctl);

  const row = h('div', { class: 'row' }); body.append(row);
  const c1 = h('div', { class: 'col' }), c2 = h('div', { class: 'col' }); row.append(c1, c2);
  const tr = (w) => w / VW; // 图像坐标 → 画布
  const P = (p, k) => [(p[0] + MX) * k, (p[1] + MY) * k];
  const frameBg = (ctx, w, hh, k) => {
    ctx.fillStyle = '#0b1018'; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = '#0f151e'; ctx.fillRect(MX * k, MY * k, IMG.w * k, IMG.h * k);
    ctx.strokeStyle = '#3a4660'; ctx.lineWidth = 1; ctx.strokeRect(MX * k, MY * k, IMG.w * k, IMG.h * k);
  };
  const clipLine = (l, k, w, hh) => { // ax+by+c=0 在画布矩形内的两个端点（图像坐标）
    const [a, b, c] = l, pts = [];
    const x0 = -MX, x1 = IMG.w + MX, y0 = -MY, y1 = IMG.h + MY;
    if (Math.abs(b) > 1e-12) for (const x of [x0, x1]) { const y = -(a * x + c) / b; if (y >= y0 && y <= y1) pts.push([x, y]); }
    if (Math.abs(a) > 1e-12) for (const y of [y0, y1]) { const x = -(b * y + c) / a; if (x >= x0 && x <= x1) pts.push([x, y]); }
    return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : null;
  };
  let hover = null, x2draw = null, e2 = null;
  const cv1 = new Canvas2D(c1, { aspect: VH / VW, caption: '图像 1（移动鼠标选点，点击锁定/解锁）', onDraw: (ctx, w, hh) => {
    const k = tr(w); frameBg(ctx, w, hh, k);
    const q = P(S.x1, k);
    dot(ctx, q, 6, '#5cc8ff', '#fff'); text(ctx, 'x₁', q[0] + 9, q[1] - 7, '#5cc8ff', 13);
    if (S.locked) text(ctx, '已锁定', 8, hh - 8, '#ffd166');
  } });
  const cv2 = new Canvas2D(c2, { aspect: VH / VW, caption: '图像 2（浅色边距=画面外区域）', onDraw: (ctx, w, hh) => {
    const k = tr(w); frameBg(ctx, w, hh, k);
    if (S.bundle) for (let i = 1; i <= 6; i++) for (let j = 1; j <= 4; j++) {
      const l = epipolarLine(F, [i * IMG.w / 7, j * IMG.h / 5]); const seg = clipLine(l, k, w, hh);
      if (seg) drawLine(ctx, P(seg[0], k), P(seg[1], k), 'rgba(255,180,84,.22)', 1);
    }
    const l = epipolarLine(F, S.x1), seg = clipLine(l, k, w, hh);
    if (seg) drawLine(ctx, P(seg[0], k), P(seg[1], k), '#ffb454', 2);
    if (e2 && e2[2] > 0 && e2[0] > -MX && e2[0] < IMG.w + MX && e2[1] > -MY && e2[1] < IMG.h + MY) {
      const q = P(e2, k); dot(ctx, q, 5, '#ffd166', '#000'); text(ctx, '极点 e₂', q[0] + 8, q[1] + 14, '#ffd166');
    }
    if (x2draw) { const q = P(x2draw, k); dot(ctx, q, 6, '#6ee7a0', '#fff'); text(ctx, 'x₂', q[0] + 9, q[1] - 7, '#6ee7a0', 13); }
  } });
  c1.append(legend([['#5cc8ff', '图 1 中选取的像素 x₁']])); c2.append(legend([['#ffb454', '极线 l₂ = F·x₁', true], ['#6ee7a0', 'X 在图 2 的投影 x₂'], ['#ffd166', '极点 e₂ （C₁ 在图 2 的像）']]));
  const toImg = (cv, ev) => { const [px, py] = cv.pos(ev), k = tr(cv.w); return [px / k - MX, py / k - MY]; };
  const inImg = (p) => p[0] >= 0 && p[0] < IMG.w && p[1] >= 0 && p[1] < IMG.h;
  cv1.canvas.addEventListener('pointermove', (ev) => { if (S.locked) return; const p = toImg(cv1, ev); if (inImg(p)) { S.x1 = p; upd(); } });
  cv1.canvas.addEventListener('click', (ev) => { const p = toImg(cv1, ev); if (inImg(p)) { S.x1 = p; S.locked = !S.locked; upd(); } });
  cv1.canvas.style.cursor = 'crosshair';

  const v = new View3D(body, { height: 400, pos: [9, -8, -6], target: [0.5, 0, 6] });
  v.el.style.marginTop = '12px';
  v.add(axesGrid(12, 1.6));
  const f1 = makeFrustum(0x5cc8ff, 1.3, { filled: true }), f2 = makeFrustum(0xffb454, 1.3, { filled: true }); v.add(f1); v.add(f2); placeCam(f1, cam1);
  const ball = sphere(0.14, 0x6ee7a0); v.add(ball);
  const rays = new Lines(0xe6edf6, { opacity: 0.8 }); v.add(rays.obj);
  const base = new Lines(0x93a1b8, { dashed: true }); v.add(base.obj);
  const planeGeo = new THREE.BufferGeometry();
  const plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })); v.add(plane);
  v.label('C₁', [0, -0.35, 0], '#5cc8ff'); const l2 = v.label('C₂', [0, 0, 0], '#ffb454'); const lx = v.label('X', [0, 0, 0], '#6ee7a0');

  body.append(h('div', { class: 'note', style: { marginTop: '10px' } }, '粉色半透明三角形 = 对极平面（C₁、C₂、X）。拖动深度滑块时，X 沿图 1 的射线移动，x₂ 沿极线滑动，但永远不离开极线。'));
  const info = h('div', { class: 'readout', style: { marginTop: '10px' } }); body.append(info);

  function upd() {
    recompute();
    const n = toNorm(K0, S.x1), X = scale([n[0], n[1], 1], S.depth);
    const q = projectCam(cam2, X); x2draw = [q[0], q[1]]; e2 = projectCam(cam2, [0, 0, 0]);
    const l = epipolarLine(F, S.x1), nn = Math.hypot(l[0], l[1]);
    // 沿极线法向偏移
    let x2 = [q[0], q[1]];
    if (S.off !== 0 && nn > 0) x2 = [q[0] + S.off * l[0] / nn, q[1] + S.off * l[1] / nn];
    x2draw = x2;
    placeCam(f2, cam2);
    ball.position.set(...X); lx.pos = add(X, [0, -0.25, 0]); l2.pos = add(C2, [0, -0.35, 0]);
    const far = scale([n[0], n[1], 1], 25);
    rays.set([[[0, 0, 0], far], [C2, add(C2, scale(add(X, scale(C2, -1)), 1.4))]]);
    base.set([[[0, 0, 0], C2]]);
    planeGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ...C2, ...X], 3)); planeGeo.computeBoundingSphere();
    const res = epipolarResidual(F, S.x1, x2), dist = Math.abs(l[0] * x2[0] + l[1] * x2[1] + l[2]) / nn;
    const fm = (M) => [0, 3, 6].map((i) => M.slice(i, i + 3).map((x) => x.toExponential(2).padStart(10)).join(' ')).join('\n');
    info.textContent =
      `x₁ = (${S.x1[0].toFixed(1)}, ${S.x1[1].toFixed(1)})   x₂ = (${x2[0].toFixed(1)}, ${x2[1].toFixed(1)})   基线 t = −R·C₂ = (${cam2.t.map((a) => a.toFixed(2)).join(', ')})\n` +
      `F = K⁻ᵀ [t]× R K⁻¹  (已归一化 ‖F‖=1)\n${fm(F)}\n` +
      `极线 l₂ = F·x̃₁ = (${l.map((a) => a.toExponential(2)).join(', ')})\n` +
      `极点 e₂ = (${e2[2] > 0 ? e2[0].toFixed(0) + ', ' + e2[1].toFixed(0) : '在相机后方'})   ${Math.hypot(e2[0] - IMG.w / 2, e2[1] - IMG.h / 2) > 3000 ? '（距画面极远 ≈ 无穷远，极线几乎平行）' : ''}\n` +
      `x̃₂ᵀ F x̃₁ = ${dist < 1e-6 ? res.toExponential(1) + '  ≈ 0' : res.toExponential(2)}      x₂ 到极线距离 = ${dist.toFixed(2)} px`;
    cv1.redraw(); cv2.redraw(); v.invalidate();
  }
  upd();
}
