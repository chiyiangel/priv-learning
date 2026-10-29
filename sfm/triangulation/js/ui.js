// 轻量 UI 工具：DOM 构造、滑块、按钮、HiDPI 画布、图表、KaTeX 排版
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
export function typeset(el) {
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      throwOnError: false,
    });
  }
}
/** 滑块控件。返回 {el, value, set} */
export function slider({ label, min, max, step = 1, value, fmt = (v) => String(v), onInput }) {
  const out = h('b', {}, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  const el = h('div', { class: 'ctl' }, h('div', { class: 't' }, h('span', {}, label), out), inp);
  const api = {
    el, get value() { return parseFloat(inp.value); },
    set(v, silent = true) { inp.value = v; out.textContent = fmt(parseFloat(inp.value)); if (!silent) onInput && onInput(api.value); },
  };
  inp.addEventListener('input', () => { out.textContent = fmt(parseFloat(inp.value)); onInput && onInput(api.value); });
  return api;
}
export function checkbox({ label, value = false, onChange }) {
  const inp = h('input', { type: 'checkbox' });
  inp.checked = value;
  const el = h('label', { class: 'ctl chk' }, inp, h('span', {}, label));
  inp.addEventListener('change', () => onChange && onChange(inp.checked));
  return { el, get value() { return inp.checked; }, set(v) { inp.checked = v; } };
}
export const button = (text, onClick, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onClick }, text);
export function stat(label, cls = '') {
  const v = h('div', { class: 'v ' + cls }, '–');
  const el = h('div', { class: 'stat' }, h('div', { class: 'k' }, label), v);
  return { el, set(t, c = '') { v.textContent = t; v.className = 'v ' + c; } };
}
export function legend(items) {
  return h('div', { class: 'legend' }, items.map(([c, t, line]) => h('span', {}, h('i', { class: line ? 'ln' : '', style: { background: c } }), t)));
}
/** HiDPI 画布，宽度跟随容器，高度按 aspect。onDraw(ctx,w,h) 在尺寸变化或 redraw() 时调用 */
export class Canvas2D {
  constructor(parent, { aspect = 0.75, caption = '', onDraw } = {}) {
    this.aspect = aspect; this.onDraw = onDraw;
    this.canvas = h('canvas');
    this.el = h('div', { class: 'cv' }, this.canvas, caption ? h('div', { class: 'cap' }, caption) : null);
    parent.append(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.w = 300; this.h = 200;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.el);
    this.resize();
  }
  resize() {
    const w = Math.max(120, Math.floor(this.el.clientWidth || 300));
    const hh = Math.floor(w * this.aspect);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.w && hh === this.h && this.canvas.width === Math.round(w * dpr)) return;
    this.w = w; this.h = hh;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(hh * dpr);
    this.canvas.style.height = hh + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }
  redraw() { if (!this.onDraw) return; this.ctx.clearRect(0, 0, this.w, this.h); this.onDraw(this.ctx, this.w, this.h); }
  /** 事件坐标（CSS 像素） */
  pos(ev) { const r = this.canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
}
export function drawLine(ctx, a, b, color, w = 1, dash = null) {
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
}
export function dot(ctx, p, r, color, stroke = null) {
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}
export function text(ctx, s, x, y, color = '#93a1b8', size = 12, align = 'left') {
  ctx.fillStyle = color; ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`; ctx.textAlign = align; ctx.fillText(s, x, y);
}
/** 折线图：series=[{data:[y...],color,label}]，可选对数 y */
export function lineChart(ctx, w, hgt, series, { logY = false, xlabel = '', ylabel = '', ymin = null, ymax = null } = {}) {
  const L = 52, R = 12, T = 30, B = 30;
  const all = series.flatMap((s) => s.data).filter((v) => Number.isFinite(v) && (!logY || v > 0));
  if (!all.length) return;
  const tr = (v) => (logY ? Math.log10(Math.max(v, 1e-12)) : v);
  let lo = ymin ?? Math.min(...all.map(tr)), hi = ymax ?? Math.max(...all.map(tr));
  if (logY) { lo = Math.floor(lo); hi = Math.ceil(hi); if (hi === lo) hi = lo + 1; } else if (hi === lo) hi = lo + 1;
  const n = Math.max(...series.map((s) => s.data.length));
  const X = (i) => L + (n <= 1 ? 0 : i / (n - 1)) * (w - L - R);
  const Y = (v) => T + (1 - (tr(v) - lo) / (hi - lo)) * (hgt - T - B);
  ctx.strokeStyle = '#2a3446'; ctx.lineWidth = 1; ctx.fillStyle = '#93a1b8'; ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'right';
  const ticks = logY ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : Array.from({ length: 5 }, (_, i) => lo + (hi - lo) * i / 4);
  for (const t of ticks) {
    const y = T + (1 - (t - lo) / (hi - lo)) * (hgt - T - B);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
    ctx.fillText(logY ? '1e' + t : (Math.abs(t) < 10 ? t.toFixed(2) : t.toFixed(0)), L - 6, y + 4);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i += Math.max(1, Math.ceil(n / 10))) ctx.fillText(String(i), X(i), hgt - B + 14);
  if (xlabel) ctx.fillText(xlabel, (L + w - R) / 2, hgt - 4);
  if (ylabel) { ctx.save(); ctx.translate(11, (T + hgt - B) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(ylabel, 0, 0); ctx.restore(); }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    let started = false;
    s.data.forEach((v, i) => { if (!Number.isFinite(v) || (logY && v <= 0)) return; const x = X(i), y = Y(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); });
    ctx.stroke();
    s.data.forEach((v, i) => { if (Number.isFinite(v) && (!logY || v > 0)) dot(ctx, [X(i), Y(v)], 2.5, s.color); });
  }
  let lx = L + 8;
  for (const s of series) { if (!s.label) continue; ctx.fillStyle = s.color; ctx.textAlign = 'left'; ctx.fillRect(lx, T + 2, 10, 3); ctx.fillText(s.label, lx + 14, T + 8); lx += 20 + s.label.length * 12; }
}
export const fmt = {
  px: (v) => v.toFixed(2) + ' px', deg: (v) => v.toFixed(2) + '°', f3: (v) => v.toFixed(3), f2: (v) => v.toFixed(2),
  sci: (v) => (v === 0 ? '0' : v.toExponential(1)),
};
export function widget(root, title, hint = '') {
  const body = h('div', { class: 'wb' });
  root.append(h('div', { class: 'widget' }, h('div', { class: 'wh' }, h('span', { class: 'dot' }), h('b', {}, title), h('span', { class: 'sp' }), h('span', { class: 'hint' }, hint)), body));
  return body;
}
