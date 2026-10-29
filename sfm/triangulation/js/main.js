// 入口：生成目录、滚动高亮、按需（接近视口时）加载每章 Demo，单章出错不影响其他章
import { typeset, h } from './ui.js';

const toc = document.getElementById('toc');
document.querySelectorAll('section.chapter').forEach((s) => {
  const t = s.querySelector('h2');
  const a = h('a', { href: '#' + s.id }, t.textContent.replace(/^(\d+)/, '$1 '));
  toc.append(a);
});
const links = [...toc.querySelectorAll('a')];
const secs = [...document.querySelectorAll('section.chapter')];
const onScroll = () => {
  let cur = secs[0];
  for (const s of secs) if (s.getBoundingClientRect().top < 140) cur = s;
  links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + cur.id));
};
addEventListener('scroll', onScroll, { passive: true }); onScroll();

function whenKatex(cb) {
  if (window.renderMathInElement) return cb();
  let n = 0; const iv = setInterval(() => { if (window.renderMathInElement || ++n > 100) { clearInterval(iv); cb(); } }, 100);
}
whenKatex(() => typeset(document.querySelector('main')));

const loaded = new Set();
async function load(el) {
  const name = el.dataset.mod;
  if (loaded.has(el)) return; loaded.add(el);
  el.append(h('div', { class: 'skeleton' }, '加载组件…'));
  try {
    const mod = await import(`./chapters/${name}.js`);
    el.innerHTML = '';
    await mod.default(el);
    typeset(el);
  } catch (e) {
    console.error('chapter', name, e);
    el.innerHTML = '';
    el.append(h('div', { class: 'err' }, `组件 ${name} 加载失败：${e.message}`));
  }
}
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '600px 0px' });
document.querySelectorAll('.mount').forEach((m) => io.observe(m));
window.__loadAll = () => Promise.all([...document.querySelectorAll('.mount')].map(load)); // 供自动化测试
