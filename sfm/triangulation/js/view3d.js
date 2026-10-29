// three.js 封装：按需渲染的可旋转 3D 视图 + 相机视锥、点云、线段、标签、拖拽
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { h } from './ui.js';
import { camCenter } from './lib/geom.js';

export { THREE };
const IMGW = 1280, IMGH = 960;

export class View3D {
  /** opts: height, pos:[x,y,z], target:[x,y,z], caption */
  constructor(parent, { height = 420, pos = [8, -6, -6], target = [0, 0, 5], caption = '拖动旋转 · 滚轮缩放 · 右键平移', fov = 45 } = {}) {
    (window.__views = window.__views || []).push(this); // 仅供自动化测试读取
    this.el = h('div', { class: 'v3', style: { height: height + 'px' } });
    parent.append(this.el);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.el.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 500);
    this.camera.up.set(0, -1, 0); // 世界系 y 向下（CV 约定），让场景看起来"正立"
    this.camera.position.set(...pos);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...target);
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.update();
    this.labels = [];
    this.hooks = [];
    this._dirty = true;
    this.el.append(h('div', { class: 'cap' }, caption));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.resize();
  }
  resize() {
    const w = this.el.clientWidth || 300, hh = this.el.clientHeight || 300;
    this.renderer.setSize(w, hh);
    this.camera.aspect = w / hh; this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  invalidate() {
    if (this._dirty && this._raf) return;
    this._dirty = true;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }
  render() {
    this._dirty = false;
    for (const f of this.hooks) f();
    this.renderer.render(this.scene, this.camera);
    const w = this.el.clientWidth, hh = this.el.clientHeight, v = new THREE.Vector3();
    for (const l of this.labels) {
      if (!l.visible) { l.el.style.display = 'none'; continue; }
      v.set(...l.pos).project(this.camera);
      const vis = v.z < 1 && v.z > -1;
      l.el.style.display = vis ? '' : 'none';
      l.el.style.left = ((v.x + 1) / 2 * w) + 'px'; l.el.style.top = ((1 - v.y) / 2 * hh) + 'px';
    }
  }
  add(o) { this.scene.add(o); this.invalidate(); return o; }
  label(text, pos, color = '#e6edf6') {
    const el = h('div', { class: 'lbl', style: { color } }, text);
    this.el.append(el);
    const l = { el, pos, visible: true, set(t) { el.textContent = t; } };
    this.labels.push(l); return l;
  }
  /** 聚焦：把控制器目标设在 target，相机沿当前方向拉到 dist */
  focus(target, dist) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(...target);
    this.camera.position.copy(this.controls.target.clone().add(dir.multiplyScalar(dist)));
    this.controls.update(); this.invalidate();
  }
  /** 让 mesh 可拖拽（在垂直于视线的平面内移动）。onDrag(newPos[3]) */
  draggable(mesh, onDrag, onEnd) {
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
    let dragging = false, off = new THREE.Vector3();
    const dom = this.renderer.domElement;
    const setNdc = (e) => { const r = dom.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, this.camera); };
    dom.addEventListener('pointerdown', (e) => {
      setNdc(e);
      if (ray.intersectObject(mesh, true).length) {
        dragging = true;
        const n = this.camera.getWorldDirection(new THREE.Vector3());
        plane.setFromNormalAndCoplanarPoint(n, mesh.position);
        ray.ray.intersectPlane(plane, hit); off.copy(mesh.position).sub(hit);
        this.controls.enabled = false; dom.setPointerCapture(e.pointerId); e.stopPropagation();
      }
    }, true);
    dom.addEventListener('pointermove', (e) => {
      if (!dragging) { setNdc(e); dom.style.cursor = ray.intersectObject(mesh, true).length ? 'grab' : ''; return; }
      setNdc(e);
      if (ray.ray.intersectPlane(plane, hit)) { hit.add(off); onDrag([hit.x, hit.y, hit.z]); }
    });
    const up = (e) => { if (!dragging) return; dragging = false; this.controls.enabled = true; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} onEnd && onEnd(); };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
  }
  dispose() { this.ro.disconnect(); this.renderer.dispose(); }
}

/** 相机视锥组：局部坐标 z 向前；用 cam={R,t} 放置。size = 成像面距离 */
export function makeFrustum(color = 0x5cc8ff, size = 1, { filled = false, opacity = 0.12 } = {}) {
  const g = new THREE.Group();
  const f = 900, d = size;
  const hw = (IMGW / 2) / f * d, hh = (IMGH / 2) / f * d;
  const c = [[-hw, -hh, d], [hw, -hh, d], [hw, hh, d], [-hw, hh, d]];
  const p = [];
  for (let i = 0; i < 4; i++) { p.push(0, 0, 0, ...c[i]); p.push(...c[i], ...c[(i + 1) % 4]); }
  p.push(...c[0], 0, -hh * 1.35, d, 0, -hh * 1.35, d, ...c[1]); // 上方小三角标记"上"（y 向下，所以 −y 是上）
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
  g.add(lines); g.userData.lines = lines;
  if (filled) {
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute([...c[0], ...c[1], ...c[2], ...c[0], ...c[2], ...c[3]], 3));
    const m = new THREE.Mesh(q, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    g.add(m); g.userData.plane = m;
  }
  g.matrixAutoUpdate = false;
  return g;
}
/** 把相机 {R,t} 写入对象矩阵：世界 = Rᵀ·局部 + C */
export function placeCam(obj, cam) {
  const R = cam.R, C = camCenter(cam);
  obj.matrix.set(R[0], R[3], R[6], C[0], R[1], R[4], R[7], C[1], R[2], R[5], R[8], C[2], 0, 0, 0, 1);
  obj.matrixWorldNeedsUpdate = true;
}
export function setFrustumColor(g, color) { g.userData.lines.material.color.set(color); if (g.userData.plane) g.userData.plane.material.color.set(color); }

/** 可更新的线段集合 */
export class Lines {
  constructor(color = 0xffffff, { opacity = 1, dashed = false } = {}) {
    this.geo = new THREE.BufferGeometry();
    this.mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.15, gapSize: 0.1, transparent: opacity < 1, opacity })
      : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    this.obj = new THREE.LineSegments(this.geo, this.mat);
    this.obj.frustumCulled = false;
  }
  /** pairs: [[a,b],...] 或带颜色 [[a,b,[r,g,b]],...]（启用顶点色） */
  set(pairs) {
    const p = [], c = []; let colored = false;
    for (const q of pairs) { p.push(...q[0], ...q[1]); if (q[2]) { colored = true; c.push(...q[2], ...q[2]); } else c.push(1, 1, 1, 1, 1, 1); }
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    if (colored) { this.geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); this.mat.vertexColors = true; this.mat.needsUpdate = true; }
    this.geo.computeBoundingSphere();
    if (this.mat.isLineDashedMaterial) this.obj.computeLineDistances();
  }
}
/** 可更新的点云（屏幕像素大小） */
export class Cloud {
  constructor(size = 4, color = 0xffffff, { opacity = 1 } = {}) {
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    this.obj = new THREE.Points(this.geo, this.mat); this.obj.frustumCulled = false; this.color = new THREE.Color(color);
  }
  set(pts, colors = null) {
    const p = new Float32Array(pts.length * 3), c = new Float32Array(pts.length * 3);
    pts.forEach((q, i) => { p.set(q, i * 3); const col = colors ? (Array.isArray(colors[i]) ? colors[i] : new THREE.Color(colors[i]).toArray()) : this.color.toArray(); c.set(col, i * 3); });
    this.geo.setAttribute('position', new THREE.BufferAttribute(p, 3)); this.geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.geo.setDrawRange(0, pts.length); this.geo.computeBoundingSphere();
  }
}
export function sphere(r, color, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshBasicMaterial({ color }));
  m.position.set(...pos); return m;
}
export function axesGrid(size = 10, y = 0) {
  const g = new THREE.GridHelper(size * 2, size * 2, 0x2a3446, 0x1c2431);
  g.position.y = y; return g;
}
export const rgb = (hex) => new THREE.Color(hex).toArray();
