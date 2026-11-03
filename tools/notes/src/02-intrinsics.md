title: 内参与畸变：固定焦距、同时优化畸变、鱼眼模型怎么选
sub: Spirula 能优化畸变，但还不能单独固定焦距；主流工具都支持按参数组分别控制。附上游 Issue #172 中关于 Insta360 鱼眼模型的讨论。
kw: 固定焦距|畸变|thin-prism fisheye|Issue #172|COLMAP 对照
meta: 依据：spirula-studio 提交 91c93e9（chiyiangel fork 与上游 master 一致）。“能解决什么问题”一节是通用 SfM 知识的推断，没有在 Spirula 上实测。
tldr:
**畸变优化已实现，但只有“全开”和“全关”两档；固定焦距没有实现。** 由于 BA 内参按 `(f, 畸变, cx, cy)` 的顺序存放、可优化的只能是开头连续的一段，“固定 f、只优化畸变”目前在结构上就表达不了。

COLMAP、OpenMVG、Metashape、RealityCapture 都支持按参数组分别控制，Spirula 在这一点上是少数。

上游作者在 Issue #172 里的观点是：边跑边标定畸变在有些数据集上会让优化不稳定，有时只在最后优化畸变反而更好；重投影误差更低不等于位姿更准。
---

## 1　Spirula 现状（提交 91c93e9）

### 1.1　畸变优化：已实现，但全开或全关

BA 会优化相机模型所带的全部参数。支持的模型有 simple-pinhole、pinhole、radial、opencv、full-opencv、opencv-fisheye、thin-prism-fisheye 和 equirectangular。其中 equirectangular 标为 `ba_refinable=false`，它没有焦距，BA 无需也无法调整（见 [`Camera.h` L307–317](https://github.com/chiyiangel/spirula-studio/blob/91c93e9019aafa71f12c9199eb39ad884c4c5fe7/src/sfm/core/Camera.h#L307-L317)）。

| 开关 | 默认 | 含义 |
|---|---|---|
| `--refine-extra-params` | 开 | 建图过程中优化畸变参数 |
| `--final-extra-params` | 开 | `Mapper::polish` 收尾时再跑一轮放开畸变的 BA |
| `--refine-principal-point` | 关 | 建图过程中优化主点 |
| `--final-principal-point` | 开 | 收尾时优化主点 |

`--distortion` 只用来给初始值。

### 1.2　固定焦距：没有

代码里搜不到 `refine_focal`、`fix_focal` 之类的开关。`--focal` 和 EXIF 焦距只作初始值，README 明确写了“BA 始终会优化焦距”（[README](https://github.com/harry7557558/spirula-studio/blob/91c93e9019aafa71f12c9199eb39ad884c4c5fe7/src/sfm/README.md#L320-L325)）。

::: warn 结构性限制
BA 内参按 `(f, 畸变, cx, cy)` 的顺序存放，参与优化的只能是**从开头连续的一段**（设计文档决策 D50）。这样做是为了让热点 kernel 里不必逐个参数判断是否优化。

因此“固定 f、优化畸变”不是一个连续前缀，无法表达（[`Camera.h` L327–334](https://github.com/chiyiangel/spirula-studio/blob/91c93e9019aafa71f12c9199eb39ad884c4c5fe7/src/sfm/core/Camera.h#L327-L334)）。要支持它，得调整参数排列顺序，或在 `intr_update`、CPU 端 BA 代码和 `ba.slang` 里加参数掩码。
:::

### 1.3　上游相关讨论

没有 issue 或 PR 专门提“固定焦距”。相关的有：

- [PR #119](https://github.com/harry7557558/spirula-studio/pull/119)（已合并）：manifest 可以传入完整的标定内参，但焦距仍然会被优化。
- [Issue #172](https://github.com/harry7557558/spirula-studio/issues/172#issuecomment-6095304131)：见本章第 4 节。
- [#230](https://github.com/harry7557558/spirula-studio/issues/230)：超广角镜头出现重影线。
- [#129](https://github.com/harry7557558/spirula-studio/issues/129)：作者提到畸变建模是以后要做的工作。

## 2　其他工具怎么做

| 工具 | 做法 |
|---|---|
| COLMAP | `ba_refine_focal_length`、`ba_refine_principal_point`、`ba_refine_extra_params` 三个开关相互独立。第一个设为 0、第三个保持开启，就是“固定 f、优化畸变”（[`bundle_adjustment.h`](https://github.com/colmap/colmap/blob/main/src/colmap/estimators/bundle_adjustment.h)、[FAQ](https://colmap.github.io/faq.html)） |
| OpenMVG | `--refine_intrinsic_config ADJUST_DISTORTION` 只优化畸变（[`main_SfM.cpp`](https://github.com/openMVG/openMVG/blob/master/src/software/SfM/main_SfM.cpp)） |
| Metashape | 每个传感器可单独指定固定哪些参数（f、cx、k1 等），Python 中对应 `sensor.fixed_params` |
| RealityCapture | “焦距和主点”与“镜头畸变”分成两组，每组可选 Unknown、Approximate 或 Fixed（[RealityScan 帮助](https://rshelp.capturingreality.com/en-US/appbasics/selectedinputs.htm)） |
| GLOMAP、OpenSfM | 粒度更粗：只有一个总开关，控制所有内参一起优化或一起固定 |

## 3　这两个功能能解决什么问题

::: unv 以下为推断
这一节主要依据通用 SfM 知识，没有在 Spirula 上实测。
:::

### 3.1　固定焦距

- **防止焦距漂移**：前向运动、视差小、场景接近平面或长焦镜头时，$f$ 与深度、尺度、沿光轴的平移相互耦合，BA 可能用一个错的 $f$ 换来更低的重投影误差。固定 $f$ 就去掉了这个自由度。
- **相机内参已知时**：对已标定的相机组、定焦镜头或厂商标定值，可避免少数配准不好的图像把可信的 $f$ 带偏。代码注释里就记录过，焦距搜索把某个相机的 $f$ 从 549 px 拉到 5493 px。
- **结果更一致**：多次运行之间、同型号多台相机之间的尺度和透视更一致，对 3DGS / NeRF 训练有利；BA 规模也变小，数值条件更好。

**不适合的情况**：焦距只是猜的；有变焦、对焦呼吸或自动对焦；手机视频带电子防抖或卷帘快门；视差大、图像多，$f$ 本来就能估得很准；给的焦距值的单位或分辨率对不上（这种情况很常见）。

### 3.2　固定 f 的同时优化畸变

- **解开 f 与 k1 的耦合**：普通镜头上 $f$ 与 $k_1,k_2$ 相关，视角窄、图像少、特征集中在画面中央时更明显。固定 $f$ 后，畸变参数就不会去吸收焦距误差。
- **收掉边缘残差**：广角和鱼眼镜头的误差主要在画面边缘；手上只有厂商焦距、畸变模型只是近似时，优化 $k_1,k_2,p_1,p_2$ 能收掉这部分误差而不让 $f$ 跑偏。

**风险**：特征少或分布不均时，用高阶模型（full-opencv、thin-prism）容易过拟合；卷帘快门造成的形变会被误当成畸变吸收；早期模型还很小时就放开畸变，可能把位姿误差吸收进去——这也是 Spirula 默认等到收尾才放开畸变的原因。

### 3.3　如果要给 Spirula 加

比较顺的做法是参照 COLMAP 新增一个 `--no-refine-focal` 开关，在 BA 里改用参数掩码或调整参数排列。改动会涉及 GPU 着色器 `ba.slang`，所以最好先在上游开 issue，问清作者倾向哪种做法。

## 4　Issue #172：Insta360 X6 双鱼眼，Thin Prism 还是 OpenCV Fisheye

[Issue #172](https://github.com/harry7557558/spirula-studio/issues/172) 共三条：提问者 `92401` 的问题（2026-10-10）、作者 `harry7557558` 的长回复（同日），以及一句道谢（10-12）。该 issue 已关闭。

### 4.1　提问的三点

1. 导入 X6 原始 INSV 时软件推荐 Thin Prism Fisheye 而不是 OpenCV Fisheye，为什么？两者对 SfM 位姿、稀疏重建和 3DGS 质量影响多大？参数更多的 Thin Prism 会不会过拟合或让 BA 不稳定？
2. 提问者会遮掉鱼眼外圈（边缘画质差、畸变标定误差大）。如果 SfM 和 3DGS 都排除了边缘，是否用更简单的 OpenCV Fisheye 就够？
3. 目标是直接用 X6 原始双鱼眼做 SfM 和 3DGS，有没有推荐的参数与策略？

### 4.2　作者回复要点

**关于两个模型**

- 作者没有系统比较过两个模型，也没用过 X6（只有 X5），所以是基于见过的情况和理论回答。
- 把 thin prism 设为默认，是因为社区反馈它在 Insta360 上的重投影误差比 OpenCV fisheye 低。Insta360 内部用的是 Mei 相机模型，COLMAP 格式不支持，与这两个鱼眼模型也不兼容；thin prism 系数更多，通常近似得更好。
- X6 是**卷帘快门**相机，其影响无法通过内参标定消除，所以除非拍摄时移动得很慢，否则哪种鱼眼模型都解决不了。

**关于位姿与过拟合**

- 影响取决于数据集：有些数据集上拟合得好的畸变能带来更准的位姿；有些数据集上“边优化边标定畸变”会让优化不稳定，也见过只在最后才优化畸变反而更好的情况。
- 3DGS 质量同样取决于数据集，因为它取决于位姿和内参**实际**有多准，而不是 SfM 优化的重投影误差。
- 完全可能出现重投影误差更低、位姿反而更不准，在特征稀疏或分布不均时尤其明显。**相机组约束（rig constraints）和把传感器遥测放进优化（telemetry-in-the-loop）** 就是为了约束这种情况。作者拍摄时尽量走回环，认为能减少过拟合。

**关于遮掉边缘**

- 默认设置下，被遮罩区域在 SfM 和 3DGS 训练中都会被排除，但作者认为这与选哪个鱼眼模型关系不大。
- 除非命令行里手动给了畸变系数，否则特征匹配时的几何校验不会用到畸变系数；高畸变区域的特征常被 RANSAC 剔除，与模型无关。
- 对 X5 的标定显示 $p_1,p_2$ 的绝对值可达 0.002，理论上在图像边缘造成几十个像素的误差，不过拟合往往能把这些误差平均掉。

**推荐设置**

- 直接导入原始 `insv` / `insp`，不要用后期处理过的图像。这样软件会自动识别并套用推荐设置：遮掉鱼眼边缘、带初始值的相机组约束、遥测参与优化、利用序列信息处理重复纹理等。预设从 “General” 改成 “360 camera” 有时也有帮助。
- 拍摄比参数更重要：尽量扩大覆盖和帧间重叠，形成回环；慢慢移动以减少运动模糊和卷帘伪影；多平移、少转动；时间允许时用定时拍照模式代替视频模式（快门触发时保持不动，分辨率高、运动伪影最少）。

::: note 与第 2 节、第 3 节的关系
作者自己也看到“边跑边标定畸变不稳定”，这正是 Spirula 默认只在收尾放开畸变的原因；他更依赖 rig、遥测和回环来约束，而没有讨论过固定焦距。
:::

第 3 章会逐项核对作者列出的“推荐设置”到底哪些来自 `.insv` 元数据，哪些只是流水线自己的处理。
