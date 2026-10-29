import { h, button, widget } from '../ui.js';

const INC = [
  { no: '1', nm: '特征匹配', inp: '每张图的关键点 + 描述子', out: '图像对之间的 2D–2D 匹配（含大量误匹配）',
    how: '你已经掌握：SIFT/ALIKED 等 + 最近邻/学习式匹配。', colmap: 'feature_extractor → matcher（穷举/顺序/词汇树）', ch: null },
  { no: '2', nm: '几何验证', inp: '一对图像的原始匹配', out: '内点匹配 + 相对运动模型（E / F / H）',
    how: '用 RANSAC 估计 E/F/H，保留满足对极约束的匹配；内点太少的图像对被丢弃。', colmap: '同时估计 E、F、H 并据此判定配置（标定/平面/纯旋转…）', ch: 'ch4' },
  { no: '3', nm: '两视图初始化', inp: '选定的初始图像对 + 内点匹配', out: '相对位姿 (R,t)（t 无尺度）',
    how: '分解 E 得 4 个候选，cheirality 选一个；令第一台相机 = [I|0]，基线长度设为 1。', colmap: '要求足够多内点与足够大的三角化角度（默认 16°）', ch: 'ch4' },
  { no: '4', nm: '三角化', inp: '已知两台相机的位姿 + 匹配', out: '第一批 3D 点（轨迹长度 = 2）',
    how: '线性 DLT / 中点法，再最小化重投影误差；过滤角度太小、深度为负、误差大的点。', colmap: '默认 min_tri_angle 1.5°，最大重投影误差 4 px', ch: 'ch5' },
  { no: '5', nm: '注册新图像 (PnP)', inp: '新图像里匹配到已有 3D 点的 2D–3D 对应', out: '新图像的位姿 (R,t)',
    how: 'P3P/EPnP + RANSAC 求解，再用所有内点最小化重投影误差。', colmap: '选“看到最多已三角化点”的图像优先注册', ch: 'ch6' },
  { no: '6', nm: '三角化新点', inp: '新位姿 + 其他已注册图像里的匹配', out: '新的 3D 点 + 延长已有轨迹',
    how: '被 ≥2 张已注册图像看到、但还没有 3D 坐标的轨迹，现在可以三角化了。', colmap: '同样做角度/重投影/深度检查；还会合并重复轨迹', ch: 'ch6' },
  { no: '7', nm: '光束法平差', inp: '所有已注册位姿 + 3D 点 + 观测', out: '精化的位姿与点，MRE 下降',
    how: 'LM + Schur 补，鲁棒核；每注册几张图做局部 BA，模型增长一定比例后做全局 BA。', colmap: 'Ceres；局部 BA 只优化新图附近，全局 BA 周期性触发', ch: 'ch7' },
];
const GLO = [
  { no: '1', nm: '特征匹配', inp: '所有图像对', out: '2D–2D 匹配', how: '同增量式。', colmap: '—', ch: null },
  { no: '2', nm: '几何验证', inp: '原始匹配', out: '每个图像对的内点 + 相对位姿 (R_ij, t_ij)', how: '同样的 E/F + RANSAC，对每个图像对独立做。', colmap: '—', ch: 'ch4' },
  { no: '3', nm: '旋转平均', inp: '所有相对旋转 R_ij', out: '全局旋转 R_i', how: '解 R_j ≈ R_ij R_i 的一致性问题（如 L1 / 鲁棒平均）。', colmap: '—', ch: null },
  { no: '4', nm: '位置平均 / 全局定位', inp: '全局旋转 + 相对平移方向', out: '全局位置 C_i（带尺度）', how: '平移方向只含方向，需联合求解；GLOMAP 直接优化全局定位并同时三角化。', colmap: '—', ch: null },
  { no: '5', nm: '三角化', inp: '全局位姿 + 轨迹', out: '全部 3D 点', how: '与本课第 5 章相同，一次性对所有轨迹进行。', colmap: '—', ch: 'ch5' },
  { no: '6', nm: '光束法平差', inp: '全部位姿 + 点', out: '精化结果', how: '一次全局 BA（通常配合轨迹过滤）。', colmap: '—', ch: 'ch7' },
];

export default function init(root) {
  const body = widget(root, '重建流程图', '点击任一步骤');
  let mode = 'inc', sel = 0, timer = null;
  const tabs = h('div', { class: 'tabs' });
  const flow = h('div', { class: 'flow' });
  const detail = h('div', { class: 'detail' });
  const play = button('▶ 走一遍', () => {
    if (timer) { clearInterval(timer); timer = null; play.textContent = '▶ 走一遍'; return; }
    sel = 0; render(); play.textContent = '■ 停止';
    timer = setInterval(() => { sel++; if (sel >= cur().length) { sel = cur().length - 1; clearInterval(timer); timer = null; play.textContent = '▶ 走一遍'; } render(); }, 1300);
  });
  const cur = () => (mode === 'inc' ? INC : GLO);
  function render() {
    tabs.innerHTML = '';
    tabs.append(button('增量式 SfM（COLMAP）', () => { mode = 'inc'; sel = 0; render(); }, mode === 'inc' ? 'on' : ''),
      button('全局式 SfM（简述）', () => { mode = 'glo'; sel = 0; render(); }, mode === 'glo' ? 'on' : ''), play);
    flow.innerHTML = '';
    cur().forEach((n, i) => {
      flow.append(h('button', { class: 'node' + (i === sel ? ' on' : ''), type: 'button', onClick: () => { sel = i; render(); } },
        h('div', { class: 'no' }, 'STEP ' + n.no), h('div', { class: 'nm' }, n.nm)));
      if (i < cur().length - 1) flow.append(h('span', { class: 'arr' }, '→'));
    });
    flow.append(h('div', { class: 'loop' }, mode === 'inc' ? '↺ 步骤 5 → 6 → 7 对每一张新图像重复，直到没有可注册的图像' : '（没有逐张注册的循环：所有位姿一次性求出）'));
    const n = cur()[sel];
    detail.innerHTML = '';
    const box = (t, c) => h('div', { class: 'box' }, h('h4', {}, t), h('p', {}, c));
    detail.append(...[box('输入', n.inp), box('输出', n.out), box('做法', n.how), mode === 'inc' ? box('COLMAP', n.colmap) : null,
      n.ch ? h('div', { class: 'box' }, h('h4', {}, '对应章节'), h('p', {}, h('a', { href: '#' + n.ch }, '跳到第 ' + n.ch.slice(2) + ' 章 ↓'))) : null].filter(Boolean));
  }
  body.append(tabs, flow, detail);
  render();
}
