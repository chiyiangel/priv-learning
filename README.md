# Learning — 交互式学习站点

把难懂的知识点做成可以动手玩的交互课。界面与讲解都是简体中文：先建立直觉，再给出公式，每个概念配一个会真实计算的小实验。

站点是纯静态的 HTML + ES Modules，没有构建、没有打包。three.js 与 KaTeX 通过 jsDelivr 的 importmap / CDN 加载，浏览器直接请求仓库里的源文件。

当前只有一课：SfM（从二维匹配到三维稀疏点云），放在 `sfm/triangulation/`。

## 目录结构

课程按 `<topic>/<lesson>/` 增长。一课一个目录，首页用卡片链过去。

```
index.html                     首页：课程卡片列表（#lessons）
vercel.json                    关闭框架检测与构建；trailingSlash + 静态资源缓存头
package.json                   本地预览与 node 算法测试（无运行时依赖）
assets/style.css               全站共享样式（深色主题、组件样式）
sfm/triangulation/             第 1 课：从二维匹配到三维稀疏点云
  index.html                   课程正文（章节 + KaTeX + <div class="mount" data-mod="chN">）
  js/main.js                   入口：目录、滚动高亮、懒加载每章组件
  js/ui.js                     DOM / 滑块 / 画布 / 折线图 / KaTeX 排版
  js/view3d.js                 three.js 封装（OrbitControls、视锥、点云、线段、拖拽）
  js/chapters/ch1..ch8.js      每章一个交互组件，导出 default function init(rootEl)
  js/chapters/quiz.js          自测题
  js/lib/                      纯算法（不依赖 DOM，可在 node 里测试）
    linalg.js                  SVD、对称特征分解、线性方程组、随机数
    geom.js                    投影 / 对极几何 / 8 点法 + RANSAC / E 分解 / 三角化 / PnP
    ba.js                      LM 光束法平差 + Schur 消元
    synth.js, twoview.js       合成场景与两视图数据
    incremental.js             增量式 SfM 教学实现（初始化 / 三角化 / PnP / BA）
tests/                         node 算法测试；Playwright 浏览器检查仅本地使用
.github/workflows/test.yml     push / PR 时跑 npm test（node 20，不含浏览器检查）
```

## 本地预览

```bash
npm run serve
# 打开 http://localhost:8000/
# 课程页 http://localhost:8000/sfm/triangulation/
```

`npm run serve` 用 Python 自带的静态服务器，监听 8000。也可以直接 `python3 -m http.server 8000`。

## 测试

需要 Node.js ≥ 20。`npm test` 依次跑三份算法脚本（不启动浏览器）：

```bash
npm test
# 等价于：
node --experimental-default-type=module tests/test_algos.mjs
node --experimental-default-type=module tests/test_incremental.mjs
node --experimental-default-type=module tests/test_lab.mjs
```

`test_algos.mjs` 有断言，失败时进程退出码为 1。后两份是数值实验日志，用来看增量式 SfM 与两视图在不同噪声、基线、外点下的表现。

浏览器检查需要本机 Playwright 和 Chrome，**不在 CI 里跑**：

```bash
python3 -m http.server 8765
python3 tests/browser_check.py    # 默认打开 http://localhost:8765/sfm/triangulation/
```

截图默认写到 `/tmp/shots`（仓库外）。若改到仓库内的 `shots/` 或 `screenshots/`，已被 `.gitignore` 忽略。GitHub Actions（`.github/workflows/test.yml`）在 push 和 pull request 上只执行 `npm test`。

## 新增一节课

1. 新建 `<topic>/<lesson>/` 目录，例如 `slam/ekf/`，放一个 `index.html`。可以复制 `sfm/triangulation/index.html` 当模板。样式用绝对路径 `/assets/style.css`。入口脚本用相对路径 `./js/main.js`（不要打成单个 `app.js`）。
2. 交互组件写成 `js/chapters/xxx.js`，`export default function init(root)`。正文里放 `<div class="mount" data-mod="xxx"></div>`，`main.js` 会按需加载。不依赖 DOM 的算法放在 `js/lib/`，方便用 node 测试。
3. 在根目录 `index.html` 的 `#lessons` 里加一张卡片：`<a class="card" href="/slam/ekf/">…</a>`。`href` 带结尾斜杠，和 `vercel.json` 的 `trailingSlash` 一致。
4. `npm run serve` 打开新卡片，确认控制台没有报错。有纯算法的话，在 `tests/` 加一份 `*.mjs`，并把命令接到 `package.json` 的 `test` 脚本里。

## 部署

站点挂在 Vercel 项目 **`learning`**（团队 **chiyiangel's projects**）上，Git 已连接到本仓库。

- 推送到 `main` 会自动部署生产环境。
- 没有构建步骤：Framework 为 Other，`vercel.json` 里 `"framework": null`、`"buildCommand": null`。输出就是仓库根目录，静态文件原样提供，不会被打包。
- 公开地址：https://learning-nine-mauve.vercel.app

本地不需要 `vercel deploy`。改完推 `main` 即可。
