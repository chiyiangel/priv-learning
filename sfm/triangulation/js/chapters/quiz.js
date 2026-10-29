import { h } from '../ui.js';
const Q = [
  { q: '只有一张图里的一个像素 u，并且相机内外参都已知，你能得到什么？', o: ['唯一的一个 3D 点', '一条经过相机中心的射线（深度未知）', '一个平面', '取决于焦距，焦距越大越确定'], a: 1, fb: '投影除以深度 Z 丢掉了深度，射线上所有点投到同一像素。需要第二个视角才能把深度“交”出来。' },
  { q: '分解本质矩阵 E 得到 4 组 (R, t)，通常用什么选出正确的一组？', o: ['选旋转角最小的那组', '选 t 范数最大的那组', '三角化匹配点，选让点同时位于两台相机前方（深度为正）的那组', '随机选一组，后面 BA 会自动修正'], a: 2, fb: '这就是 cheirality 检查。4 组候选都满足 x₂ᵀEx₁=0，只有 1 组在几何上“物理可行”。随机选会让点落到相机后方，BA 修不回来。' },
  { q: '为什么只用单目图像做 SfM 时，重建结果的绝对尺度无法确定？', o: ['(R, λt, λX) 对任意 λ>0 产生完全相同的像素，图像里没有尺度信息', '因为特征点匹配不够精确', '因为相机焦距未知', '因为 RANSAC 是随机的'], a: 0, fb: '把场景和基线同时放大 λ 倍，所有像素都不变。尺度只能靠外部信息（GPS、已知尺寸、IMU 等）确定。' },
  { q: '两个视角几乎在同一位置（基线很小）时，三角化最主要的问题是？', o: ['点会出现在相机后方', '无法计算 SVD', '两条射线夹角小，沿视线方向的深度极不确定（σ_Z ∝ Z²/(f·b)）', '重投影误差会变成无穷大'], a: 2, fb: '小基线 → 小三角化角度 → 射线近似平行，噪声沿视线方向被放大。所以 COLMAP 默认丢弃三角化角度小于 1.5° 的点。' },
  { q: 'BA 的法方程里使用 Schur 补，主要好处是？', o: ['让问题变成凸问题，保证全局最优', '点块是 3×3 块对角、很便宜，消去所有 3D 点后只需解相机数×6 维的小系统，再回代点', '不再需要初始值', '可以不需要鲁棒核'], a: 1, fb: 'Schur 补利用“点与点互不耦合”的稀疏结构。它不改变解（与稠密解等价），只是更快、更省内存；BA 仍然是非凸的，依然需要好的初值。' },
];
export default function init(root) {
  const box = h('div', { class: 'quiz' });
  let score = 0, done = 0;
  const res = h('div', { class: 'note', style: { marginTop: '8px' } });
  Q.forEach((it, qi) => {
    const fb = h('div', { class: 'fb' });
    const opts = it.o.map((t, i) => h('button', { class: 'opt', type: 'button', onClick: () => {
      opts.forEach((b, j) => { b.disabled = true; if (j === it.a) b.classList.add('ok'); else if (j === i) b.classList.add('no'); });
      fb.textContent = (i === it.a ? '✅ 正确。' : '❌ 不对。') + it.fb;
      done++; if (i === it.a) score++;
      if (done === Q.length) res.textContent = `完成：${score} / ${Q.length}。` + (score === Q.length ? '全对，可以进入下一课了。' : '建议回看出错题对应的章节。');
    } }, String.fromCharCode(65 + i) + '. ' + t));
    box.append(h('div', { class: 'q' }, h('h4', {}, `${qi + 1}. ${it.q}`), ...opts, fb));
  });
  box.append(res); root.append(box);
}
