import { h, slider, widget, Canvas2D, drawLine, dot, text, button, legend, typeset } from '../ui.js';
import { View3D, THREE, makeFrustum, placeCam, Lines, sphere, axesGrid } from '../view3d.js';
import { lookAt, projectCam, camCenter, pixelRay } from '../lib/geom.js';
import { expSO3, mulv3, add, scale } from '../lib/linalg.js';
import { IMG } from '../lib/synth.js';

const CUBE_V = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CUBE_V.push([x * 1.4 + 1.5, y * 1.0, z * 1.4 + 7]);
const CUBE_E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

export default function init(root) {
  const body = widget(root, '针孔投影实验室', '拖动洋红色小球 / 调滑块');
  const S = { f: 900, yaw: 0, cx: 0, X: [-0.8, -0.3, 5] };
  const camOf = () => ({ R: expSO3([0, S.yaw * Math.PI / 180, 0]), t: [0, 0, 0], K: { f: S.f, cx: IMG.w / 2, cy: IMG.h / 2 } });
  const mk = () => { const c = camOf(); const C = [S.cx, 0, 0]; return { ...c, t: scale(mulv3(c.R, C), -1) }; };

  const ctl = h('div', { class: 'controls' });
  const sl = {
    f: slider({ label: '焦距 f (px)', min: 400, max: 1800, step: 10, value: S.f, onInput: (v) => { S.f = v; upd(); } }),
    yaw: slider({ label: '相机偏航 (°)', min: -40, max: 40, step: 1, value: 0, onInput: (v) => { S.yaw = v; upd(); } }),
    cx: slider({ label: '相机横移 x (m)', min: -4, max: 4, step: 0.05, value: 0, fmt: (v) => v.toFixed(2), onInput: (v) => { S.cx = v; upd(); } }),
    X: slider({ label: '点 X 坐标 x', min: -4, max: 4, step: 0.05, value: S.X[0], fmt: (v) => v.toFixed(2), onInput: (v) => { S.X[0] = v; upd(); } }),
    Y: slider({ label: '点 Y 坐标 y（向下为正）', min: -3, max: 3, step: 0.05, value: S.X[1], fmt: (v) => v.toFixed(2), onInput: (v) => { S.X[1] = v; upd(); } }),
    Z: slider({ label: '点 Z 坐标 z（深度方向）', min: -1, max: 14, step: 0.05, value: S.X[2], fmt: (v) => v.toFixed(2), onInput: (v) => { S.X[2] = v; upd(); } }),
  };
  Object.values(sl).forEach((s) => ctl.append(s.el));
  body.append(ctl);
  const row = h('div', { class: 'row' }); body.append(row);
  const left = h('div', { class: 'col' }), right = h('div', { class: 'col' });
  row.append(left, right);

  const v = new View3D(left, { height: 400, pos: [9, -7, -5], target: [1, 0, 5] });
  v.add(axesGrid(10, 1.6));
  const frus = makeFrustum(0x5cc8ff, 1.6, { filled: true }); v.add(frus);
  const ball = sphere(0.18, 0xf472b6); v.add(ball);
  const hit = sphere(0.45, 0xffffff); hit.material.visible = false; ball.add(hit);
  const rayL = new Lines(0xf472b6, { opacity: 0.9 }); v.add(rayL.obj);
  const cube = new Lines(0x6b7690); cube.set(CUBE_E.map(([a, b]) => [CUBE_V[a], CUBE_V[b]])); v.add(cube.obj);
  const camLbl = v.label('C', [0, 0, 0], '#5cc8ff'), xLbl = v.label('X', S.X, '#f472b6');
  v.ball = ball;
  v.draggable(ball, (p) => { S.X = p; sl.X.set(p[0]); sl.Y.set(p[1]); sl.Z.set(p[2]); upd(); });

  const info = h('div', { class: 'readout' });
  const cv = new Canvas2D(right, { aspect: IMG.h / IMG.w, caption: '图像平面（像素坐标，原点在左上）', onDraw: draw });
  right.append(info, legend([['#f472b6', '你拖动的点 X 的投影'], ['#6b7690', '参照立方体（8 个顶点）']]));

  function draw(ctx, w, hh) {
    const cam = mk(), k = w / IMG.w;
    ctx.fillStyle = '#0f151e'; ctx.fillRect(0, 0, w, hh);
    ctx.strokeStyle = '#2a3446'; ctx.strokeRect(0.5, 0.5, w - 1, hh - 1);
    drawLine(ctx, [w / 2 - 8, hh / 2], [w / 2 + 8, hh / 2], '#2a3446'); drawLine(ctx, [w / 2, hh / 2 - 8], [w / 2, hh / 2 + 8], '#2a3446');
    const P = CUBE_V.map((p) => projectCam(cam, p));
    for (const [a, b] of CUBE_E) if (P[a][2] > 0.05 && P[b][2] > 0.05) drawLine(ctx, [P[a][0] * k, P[a][1] * k], [P[b][0] * k, P[b][1] * k], '#6b7690', 1.2);
    const q = projectCam(cam, S.X);
    if (q[2] > 0.05) {
      const inside = q[0] >= 0 && q[0] < IMG.w && q[1] >= 0 && q[1] < IMG.h;
      dot(ctx, [q[0] * k, q[1] * k], 6, inside ? '#f472b6' : '#7a3a58', '#fff');
      text(ctx, `(${q[0].toFixed(0)}, ${q[1].toFixed(0)})`, Math.min(w - 90, q[0] * k + 10), Math.max(14, q[1] * k - 8), '#f9a8d4');
    }
  }
  function upd() {
    const cam = mk();
    placeCam(frus, cam);
    ball.position.set(...S.X);
    const C = camCenter(cam);
    camLbl.pos = add(C, [0, -0.3, 0]); xLbl.pos = S.X;
    const d = add(S.X, scale(add(S.X, scale(C, -1)), 0.35)); // 延长射线到点之后
    rayL.set([[C, d]]);
    const Xc = add(mulv3(cam.R, S.X), cam.t), q = projectCam(cam, S.X);
    const xn = Xc[2] > 0 ? [Xc[0] / Xc[2], Xc[1] / Xc[2]] : [NaN, NaN];
    info.textContent =
      `X_c = R·X + t = (${Xc.map((x) => x.toFixed(2)).join(', ')})   深度 Z_c = ${Xc[2].toFixed(2)}\n` +
      (Xc[2] > 0.05 ? `归一化坐标 x_n = (${xn[0].toFixed(3)}, ${xn[1].toFixed(3)})\n像素 u = f·x_n + c = (${q[0].toFixed(1)}, ${q[1].toFixed(1)})` +
        (q[0] < 0 || q[0] >= IMG.w || q[1] < 0 || q[1] >= IMG.h ? '   ← 在画面外' : '')
        : '点在相机后方（Z_c ≤ 0），不成像');
    cv.redraw(); v.invalidate();
  }
  const moveAlong = (k) => { const C = camCenter(mk()); S.X = add(C, scale(add(S.X, scale(C, -1)), k)); sl.X.set(S.X[0]); sl.Y.set(S.X[1]); sl.Z.set(S.X[2]); upd(); };
  body.append(h('div', { class: 'btns' }, button('沿射线推远 ×1.25', () => moveAlong(1.25)), button('沿射线拉近 ÷1.25', () => moveAlong(0.8))));
  body.append(h('div', { class: 'note' }, '试试：① 沿射线方向（相机 → 小球）把点拉远拉近，像素不变——这就是“深度丢失”；② 增大焦距 f，立方体在图中变大（视场变窄）；③ 横移/偏航相机，观察像素如何变化。'));
  upd();
}
