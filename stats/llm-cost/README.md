# 为什么买同样的能力，花的钱能差这么多？（v0.1，2026-11-09）

这是一份静态研究报告页，不需要构建步骤。它要放在 `stats/llm-cost/` 下：打开 `index.html` 即可阅读。

- 公式：KaTeX，通过 jsDelivr CDN 加载。
- 样式：内联 CSS。
- 图片：使用相对路径 `figs/*.png`。

## 目录
- `index.html`：论文式报告（简体中文）。页面中的数字都由脚本从 `results.json` 填入，没有手写的数字。
- `figs/`：7 张图，fig1–fig7，分别对应 L0–L3 各层。
- `data/`：分析实际用到的样本。
  - `S0_aa_v5_cost_sample.csv`：L0/L1/L2a 主样本，47 个模型（中国 15、美国 32）。
  - `S2_aa_v432_price_sample.csv`：L2a 稳健性样本，v4.3.2，n=70。
  - `S3_*.csv`：L2b 推理档位。共 16 个模型、63 个档位，含各模型斜率、相邻档位差值和递减检验所用的数据。
  - `S4_*.csv`：L3 各榜单前 100 名的分数，以及换尺子后的单价回归。

## 数据来源（抓取时间均为北京时间）
| 来源 | 内容 | 时间 |
|---|---|---|
| Artificial Analysis 模型页（639 页） | Intelligence Index v5.0.1 分数，每题花费、每题 token、单价、开源标记 | 2026-11-09 11:53–12:09 |
| Artificial Analysis 方法论页 | v5.0.1 的权重与 token 口径 | 2026-11-09 约 14:57 |
| AA Intelligence Index v4.3.2 | 旧版分数快照 | 2026-10-24 |
| Epoch AI ECI | Epoch Capabilities Index | 2026-11-09 |
| LiveBench | overall 分数 | 2026-10-25 版 |
| LMArena 文本榜 | Arena 分数 | 2026-11-06 版 |

## 复现
```bash
cd /workspace/report26/final
python3 analysis.py     # 读取 ../models_all.csv、../counterintuitive/round2/aa_extended_fields.csv 和 work_*_cnus.csv
                        # 输出 results.json、figs/*.png、data/*.csv
python3 build_html.py   # 用 results.json 生成 index.html
```
运行依赖：Python 3.13，以及 pandas、numpy、scipy、statsmodels、matplotlib（中文字体为 Noto CJK）。

原始抓取数据与清洗脚本在 `/workspace/report26/` 下，没有放进本目录：
- `aa/pages/`
- `counterintuitive/common.py`
- `counterintuitive/round2/base.py`
- `counterintuitive/round2/extract_aa_fields.py`

## 与原方案的偏离
1. **恒等式改为三项。** 每题花费 = 输出单价 × 每题输出 token × m。原因是 AA 的花费里含有输入和缓存费用，所以加入了"输入与缓存系数" m。
2. **单样本 t 检验标注为【补充】。** 单样本 t、对数变换、方差分解和 Fisher 精确检验都不在课程范围内。
3. **单侧检验只用于三个事先设定的方向。** 这三个方向是：开源更便宜、多花 token 得分更高、边际收益递减。这些检验同时报告双侧 p。其余检验全部为双侧。
