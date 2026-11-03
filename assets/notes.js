// 阅读增强：进度条 + 目录滚动高亮（无依赖）+ KaTeX 公式渲染
(function () {
  var bar = document.querySelector('.progress');
  function onScroll() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    if (bar) bar.style.width = (max > 0 ? Math.min(100, (h.scrollTop / max) * 100) : 0) + '%';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var links = Array.prototype.slice.call(document.querySelectorAll('.side a[href^="#"], .toc-m a[href^="#"]'));
  var targets = [];
  links.forEach(function (a) {
    var el = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
    if (el && targets.indexOf(el) < 0) targets.push(el);
  });
  function spy() {
    var cur = null, y = 120;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].getBoundingClientRect().top <= y) cur = targets[i].id; else break;
    }
    links.forEach(function (a) {
      var on = cur && a.getAttribute('href') === '#' + cur;
      a.classList.toggle('on', !!on);
      if (on && a.closest('.side')) {
        var s = a.closest('.side'), r = a.getBoundingClientRect(), sr = s.getBoundingClientRect();
        if (r.top < sr.top + 20 || r.bottom > sr.bottom - 20) s.scrollTop += r.top - sr.top - sr.height / 3;
      }
    });
  }
  if (targets.length) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(function () { spy(); ticking = false; }); }
    }, { passive: true });
    spy();
  }
  // 点击移动端目录项后收起
  document.querySelectorAll('.toc-m a').forEach(function (a) {
    a.addEventListener('click', function () { var d = a.closest('details'); if (d) d.open = false; });
  });
  // 点击菜单外关闭章节菜单
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.nbar details[open]').forEach(function (d) { if (!d.contains(e.target)) d.open = false; });
  });
})();
window.addEventListener('DOMContentLoaded', function () {
  function go() {
    if (!window.renderMathInElement) return false;
    window.renderMathInElement(document.querySelector('article') || document.body, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }],
      throwOnError: false
    });
    return true;
  }
  if (!go()) { var n = 0, t = setInterval(function () { if (go() || ++n > 60) clearInterval(t); }, 100); }
});
