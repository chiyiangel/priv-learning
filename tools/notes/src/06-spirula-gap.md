title: Spirula 代码对照：位姿精度该做什么、可加哪些功能
sub: 把调研里的方法逐项对照到 spirula-studio 的代码（已有 / 部分 / 缺失），给出提升位姿精度的排序方案与值得加入的功能，最后是 2–4 周路线图。
kw: 能力地图|评测基线|鱼眼模型|卷帘快门|时间同步|路线图
meta: 分析对象：harry7557558/spirula-studio 提交 3137944（2026-11-01，clean up stub training configs）。只做了静态阅读和 grep，没有编译、没有运行，也没有在真实数据上做任何实验。
tldr:
**调研里推荐的很多东西 Spirula 已经有了**：原始双鱼眼 rig、单位球面几何、IMU / GPS 先验进 BA、手眼标定与时钟偏移、度量尺度、ALIKED + LightGlue。所以建议集中在剩下的缺口，而不是“把 IMU 用起来”。

**提升位姿精度，按优先级**：① 先搭评测基线；② 增强鱼眼模型并用 Insta360 出厂标定做初值；③ BA 加逐观测权重与更合适的鲁棒核；④ 卷帘快门与镜头间曝光时差（先做零成本诊断）；⑤ 时钟速率 / 分段偏移与陀螺 bias；⑥ 对弱段做稠密匹配精修。

**值得加的功能**：SfM 质量报告、陀螺辅助选帧、标定与验证模式、训练内位姿 / rig 细化、LiDAR 辅助精修、位姿不确定度导出。每一步都以基线指标为准——指标没提升的改动默认关闭。
---

## 1　分析范围

| 项 | 内容 |
|---|---|
| 仓库 | [harry7557558/spirula-studio](https://github.com/harry7557558/spirula-studio)（GPL-3.0） |
| 分析的提交 | [`3137944`](https://github.com/harry7557558/spirula-studio/commit/3137944db872f718e58891736f5f17285488d641) |
| 克隆方式 | 浅克隆，仅 6 个提交，无法追溯设计变更的历史 |
| 读过的范围 | `src/sfm/`（README 全文、core / map / ba / feature / geometry / shaders）、`docs/notes` 中 SfM、IMU、rig、LiDAR、标记、RoMa 笔记、`tools/sfm`、训练引擎相关接口 |
| 没做的事 | 没编译、没运行，也没在真实数据上做实验；所有“现状”来自静态阅读加 grep |

::: unv 方法上的提醒
凡写“缺失”的项都先在 `src/` 下 grep 过，关键词写在备注里；若某项在别的分支或未合并的 PR 里则没有看到。README 与代码头注释也有不一致（例如 `Mapper.h` 头注释仍写“无局部 BA、无重三角化”，README 却记录重三角化与轨迹合并已完成），以代码与 README 较新的叙述为准，仍请抽查。
:::

## 2　能力地图：调研方法 vs Spirula 现状

状态含义：**已有**＝代码里能找到并有测试或文档；**部分**＝有基础，但与调研的做法有缺口；**缺失**＝grep 未命中。

### 2.1　已有

| 能力 | 位置 | 备注 |
|---|---|---|
| 保持原始双鱼眼为 rig（不拼成 ERP） | [[src/sfm/core/Rig.h]]、[[src/app/FrameExtract.cpp#L302|extract_synced]]、[[docs/notes/sfm-rig-constraints.md]] | `--rig`、`kind: dual-fisheye`（第二镜头绕竖轴转 180°，`refine: axial`）；`.insv` 两路轨迹同索引抽帧；gp3p 广义 PnP 联合注册（README 自述 `.insv` 上内点 +6.9%） |
| 单位球面（bearing）几何与球面 Sampson 误差 | [[src/sfm/core/Camera.h#L112|bearing()]]、[[src/sfm/geometry/Fundamental.h#L243|sampsonSqBearing]] | 几何核心在单位方向向量上，鱼眼与等距柱状都能用（决策 D31 / D45 / D49） |
| 内参自标定（主点、畸变、逐图内参） | [[src/sfm/map/Bundle.h#L45|BundleOptions]]、[[docs/notes/sfm-design.md]] | `--refine-principal-point`、`--final-principal-point`、`--final-extra-params`、`--final-per-image-intrinsics`；主点与旋转的退化已写成决策 D50–D51、D72–D73 |
| 学习式特征与匹配（ALIKED + LightGlue、LoMa） | [[src/aliked/README.md|src/aliked]]、[[src/loma/README.md|src/loma]] | `--features` / `--matcher` 选择；README 自述三种前端“尚无打分对比” |
| 已知旋转的两视图 / PnP（陀螺、重力先验） | [[src/sfm/geometry/KnownRotation.h]]、[[src/sfm/map/SensorPriors.h]]、[[src/sfm/ba/Priors.h]] | `--sensor-verify`（2 点 RANSAC）、`--sensor-map`（陀螺相对旋转、重力、加速度计尺度三元组、GPS 作为 BA 因子） |
| 度量尺度（IMU / GPS）与重力对齐 | [[src/sfm/map/ImuScale.h]]、[[src/sfm/map/MetricGauge.h]]、[[src/sfm/map/BlockScale.h]] | `--metric-gps`、`--gps-scale-band`、`--level-erp`、`gauge.txt`；`imu-gps-for-sfm.md` §5.6 记录 X5 一段 118 秒步行的加速度计尺度拟合不确定度 0.3%（拟合自述的不确定度，不是对真值的误差） |
| LiDAR 对齐 | [[src/app/LidarAlign.h]]、[[docs/notes/lidar-alignment.md]] | Sim3 加点到面 ICP（Geman-McClure 权重），事后对齐；不反向约束位姿 |
| 基于图像的模糊 / 相似帧剔除 | [[src/app/FramePick.h]] | 边缘宽度加 dHash；没有用陀螺角速度 |

### 2.2　部分具备

| 能力 | 位置 | 缺口 |
|---|---|---|
| 鱼眼 / 全景相机模型 | [[src/sfm/core/Camera.h#L308|kCamModelInfo]] | SfM 端 8 个模型：OpenCV_FISHEYE（k1–k4）、THIN_PRISM_FISHEYE、FULL_OPENCV、EQUIRECTANGULAR（不可优化）等。EUCM / Double Sphere 在 SfM 端没有；EUCM 只在数据导入侧能读（COLMAP id 16，拟合到训练端模型） |
| 厂商出厂镜头标定 | [[src/sfm/core/LensCalibration.h]]、[[src/sfm/core/Telemetry.cpp#L1302|offset_v3 仅记录]] | DJI `.OSV` 已用（k1..k5 重拟合成 k1..k4，最坏误差 1.97 / 1.22 px）；Insta360 的 `offset_v3` 只写进日志备注，没有变成内参初值 |
| 稠密匹配 RoMa v2 | [[src/roma/README.md|src/roma]]、[[src/dense/README.md|src/dense]] | 原生 Vulkan 移植，但只用于稠密点云，且相机固定（SfM 之后）；没有接回 BA 或关键点精修 |
| IMU–镜头外参与时钟偏移 | [[src/sfm/map/ImuExtrinsic.h#L327|时钟偏移搜索]]、[[src/sfm/map/SensorGauge.h#L224|帧时间]] | 手眼标定 $AX=XB$、重力对、左右手系假设已有；时间模型是 idx/fps + 0.5·读出 + **单个标量偏移**，没有速率（漂移）项，也没有分段 |
| 鲁棒核 | [[src/sfm/shaders/common/loss.slang]]、[[src/sfm/map/Mapper.h#L322|ba_loss]] | trivial / Huber / Cauchy，默认 Huber δ=2 px（乘各相机像素比例）；没有 Tukey / Geman-McClure；注释写明省略了 Triggs 修正 |
| 卷帘快门建模 | [[src/sfm/core/Telemetry.h#L71|frame_readout]]、[[src/sfm/map/SensorPriors.h#L292|只进时间戳]] | 读出时间只用来把帧时刻挪到曝光中点；BA 观测模型与渲染都是全局快门（grep rolling） |
| 回环 / 重复结构 | [[src/sfm/feature/PairSelection.h]]、[[src/sfm/core/Sequence.h]] | `--loop-closure` 把 prefilter 短名单并入配对；`--sequence` 用邻帧顺序抗重复结构；没有位姿图 / 旋转平均式的回环校验 |
| AprilTag / ArUco | [[src/data/MarkerDetector.h]]、[[docs/notes/markers.md]] | 检测加对齐尺度 / 地面（编辑器里，重投影 > 4 px 的标记被拒）；SfM 与 BA 不用它 |
| 位姿评测 | [[tools/sfm/eval_poses.py]] | 相对位姿 AUC 加 Sim3 对齐误差；没有 360 / 双鱼眼真值适配器，ETH3D / IMC 对标未做（README #17） |

### 2.3　缺失

| 能力 | 检查位置 | 备注 |
|---|---|---|
| 完整视觉–惯性 BA（速度 / bias 状态） | [[docs/notes/imu-gps-for-sfm.md#L739|§6 自述仍开放]]、[[src/sfm/core/Preintegration.h]] | 预积分类已在，但 BA 里只有仅含位姿的因子 |
| 全局 SfM（旋转平均 + 全局定位，GLOMAP 路线） | [[src/sfm/README.md|README「Not done yet」#16]]、[[src/sfm/map/Merge.h#L517|仅合并时用弦均值]] | 有增量式与 bottom-up 两种 mapper；旋转平均只在模型合并时做弦均值 |
| 局部 BA | [[src/sfm/map/Mapper.h#L17|头注释]]、README #1 | 只有全局 BA；README 自己指出主要是规模问题，不是精度问题 |
| 逐观测权重 / 协方差 | [[src/sfm/ba/Problem.h#L82|BAProblem 观测字段]]、README #3 | 观测只有 image、point、xy 三列，没有权重列 |
| 特征度量（featuremetric）关键点 / 轨迹精修 | [[src/sfm/shaders/sift/sift.slang#L197|仅 SIFT 的亚像素插值]] | grep featuremetric、guided、rematch 在 `src/sfm` 无命中；有 `completeAndRetriangulate` 与 `--merge-tracks`，但不是特征图对齐 |
| 位姿不确定度输出 | [[src/sfm/map/MetricGauge.h#L2|仅 gauge 级]] | grep covariance / uncertaint 只在 gauge 拟合里出现，没有逐帧协方差 |
| 前馈模型（VGGT / MASt3R / π³） | `src/` 全树 | grep vggt、mast3r、dust3r、pi3 均无命中 |
| 3DGS 训练内联合位姿细化 | [[src/data/tests/train_config_test.cpp#L28|use_camera_optimizer 已退役]]、[[src/engine/Engine.h#L203|viewmats 梯度为 null]] | 后端 `ProjectionBwd` kernel 接受可选 `v_viewmats`，但引擎没有接 |

## 3　Q1：提升位姿精度，最值得做的事

排序依据：来源证据强度、与 Insta360 双鱼眼数据的相关性、工作量。**收益与工作量都是推断**，只有“来源证据”里带出处的数字才是论文或仓库文档所述。

| 序 | 做什么 | 预期收益（推断） | 工作量（推断） | 风险 |
|---|---|---|---|---|
| 1 | 先搭评测与消融基线 | 不直接涨点，但决定后面每项是否可信 | 低（约 1–2 周） | 低 |
| 2 | 鱼眼模型表达力 + Insta360 出厂标定做初值 | 中 | 低–中 | 低 |
| 3 | 逐观测权重与更合适的鲁棒核 | 低–中 | 低 | 低 |
| 4 | 卷帘快门 + 镜头间曝光时差 | 待测：快速转动数据上可能最大，静止采集接近 0 | 中 | 中（与旋转 / 主点类似的退化风险） |
| 5 | 时间同步加速率项 / 分段偏移，陀螺 bias 进因子 | 中（对长 clip 的尺度与旋转先验） | 低–中 | 低 |
| 6 | 用已有的 RoMa v2 做稠密匹配精修（只对弱段） | 未知：来源只有定性结论 | 高 | 中（显存、耗时、鱼眼域差） |
| 7 | 重力对齐旋转平均：先当校验器，再决定是否做全局 mapper | 中–高（通用数据集有数字；360 未验证） | 中（校验器）/ 高（全局 mapper） | 中 |
| 8 | 完整视觉–惯性 BA（速度 / bias 状态） | 高潜力，但先看 4、5 之后的残余 | 高 | 高 |
| 9 | 训练内联合位姿细化（下游补偿，不是 SfM 本身） | 对渲染质量有机会，对“位姿真值”无保证 | 中–高 | 中（位姿与场景一起漂） |

### Q1-1　先搭评测与消融基线

**缺口**：没有一把能在 Insta360 数据上量出“位姿准不准”的固定尺子。没有它，下面任何改动都无法判断是涨点还是噪声。

**现状**

- [[tools/sfm/eval_poses.py]]：相对位姿 AUC 加 Sim3 对齐误差。README 自述：未注册的图像对按 180° 失败计，AUC 上限是（注册数 / 总数）²，所以要先看注册率；真值常把主点固定在图像中心，精修主点的模型会被误判。
- README 自列未做：ETH3D / IMC 对标（#17）、三种特征前端的打分对比（#15）。仓库里没有 360 / 双鱼眼真值适配器。
- 可复用的部件：标记检测 [[src/data/MarkerDetector.h]]、LiDAR 对齐 [[src/app/LidarAlign.h]]、LPIPS（`src/lpips`）。

**建议改法**

- 加 Hilti-Trimble-Oxford 适配器：读 LiDAR-惯性真值轨迹，输出 Sim3 对齐 ATE、分段相对位姿误差、AUC@1/3/5°，并附注册率。
- 自采数据三类真值：① 闭环起终点位姿闭合误差；② AprilTag 角点三角化后的边长比与共面残差，按离轴角分箱（复刻 OVR 的做法）；③ LiDAR 对齐后的深度重投影残差（评测时不能同时当约束）。
- 下游放大镜：同一训练配置下留出视角的 PSNR / SSIM / LPIPS，作间接指标。
- 所有改动做成默认关闭的 CLI 开关（沿用 `SfmConfig.h` 的选项表），便于 A/B。

**来源证据**

- Hilti-Trimble-Oxford 2026：Insta360 One RS + LiDAR-惯性真值（CC BY-NC-SA 3.0），见第 7 章。
- OVR（[arXiv:2610.35554](https://arxiv.org/abs/2610.35554)）：9 条带 LiDAR 的测量上，度量尺度 MAE 0.81%（手机 1.94%）；marker 尺寸用作验证；鱼眼模型在离轴 50° 以外会让标记尺寸偏差数个百分点。

**怎么验证**：本项自身就是验证手段。先在一份已知好的重建上跑通，再跑一个故意变差的设置（例如关掉 `--rig`），确认指标能分辨。

### Q1-2　鱼眼模型表达力与 Insta360 出厂标定做初值

**缺口**：大离轴角处的模型残差会变成边缘观测的系统误差，被 Huber 降权或被 rig 外参吸收。是否真的影响你的数据，要用“按离轴角分箱的残差曲线”测，而不是猜。

**现状**

- SfM 端鱼眼只有 KB 多项式（k1–k4）与 thin-prism 变体（[[src/sfm/core/Camera.h#L308]]）。
- 笔记自述：DJI 厂标有 k5，没有它多项式在 86.9° / 90.1° 处回折、短于像圆；`LensCalibration.h` 重拟合到 k4 后，最坏误差 1.97 / 1.22 px，镜头间中位残差 0.98 对 0.88 px（[[docs/notes/imu-gps-for-sfm.md#L148|§2.3]]）。
- Insta360 的 `offset_v3`（每镜头 fx、fy、cx、cy、yaw、pitch、roll、k1..k3、p1、p2）只被记录（[[src/sfm/core/Telemetry.cpp#L1302]]）。
- rig 笔记：Insta360 双镜头自由精修时，横向平移是轴向的 30–50%；限制到光轴后点数更多、误差更低（470 张步行：194103 点 / 0.914 px 对 178478 点 / 0.966 px）。作者怀疑这一项吸收了“不是刚性偏移的东西”（两颗传感器读出方向不同）。

**建议改法**

0. **零成本诊断**：在现有重建上画“重投影残差 vs 离轴角 θ”，每镜头一条曲线；若 θ>70° 有明显抬升，再往下做。
1. 候选 A：KB 多项式加 k5（与 DJI 厂标一致，改动最小）。候选 B：EUCM（数据导入侧已知 COLMAP id 16、6 参数，参数顺序以 COLMAP 4.1 文档为准——**需核实**）。`Camera.h` 头注释写明：加模型只需 `kCamModelInfo` 一行、一个 Slang 模型结构和 `Problem.h` 注册；雅可比由 `bwd_diff` 自动求导（`ba.slang:288`），不用手推。
2. 解析 Insta360 `offset_v3` 做 params 初值，沿用 `LensCalibration` 的“只在没有人为设置时才覆盖”机制。注意 `offset_v3` 的投影公式没有在读码中确认（推断：形式是 k1..k3 多项式加切向，需对照 telemetry-parser 或实拍核对）。
3. 与自标定做对照：同一份数据分别用“出厂初值 + 固定”“出厂初值 + 精修”“默认初值 + 精修”。

**来源证据**：COLMAP 4.1.0（2026-06-26）新增球面与 EUCM 相机模型；Double Sphere 论文（[arXiv:1807.08957](https://arxiv.org/abs/1807.08957)）按重投影误差与耗时比较了大视场模型；OVR 发现 50° 离轴以外的畸变模型误差。

**怎么验证**：θ 分箱残差曲线是否变平；tag 边长比对 θ 的斜率是否缩小；rig 横向 / 轴向平移比是否变化；最终 AUC / ATE（Q1-1）。

### Q1-3　逐观测权重与更合适的鲁棒核

**缺口**：现在 SIFT、ALIKED、LoMa 三种前端和不同分辨率共用一个 δ；鱼眼边缘一个像素对应的角度更大，却按像素等权。

**现状**

- [[src/sfm/shaders/common/loss.slang]]：trivial / Huber / Cauchy，注释写明省略 Triggs 修正；每个（精度，核）组合预编译一套 kernel（`Options.h:115`）。
- 默认 Huber δ=2 px × 相机像素比例（[[src/sfm/map/Bundle.h#L45]]、[[src/sfm/map/Mapper.h#L1767]]）。同一相机内所有观测等权。
- `BAProblem` 的观测只有 `obs_image / obs_point / obs_xy`（[[src/sfm/ba/Problem.h#L82]]）；README 自列 “per-observation weights” 未做。

**建议改法**

- `BAProblem` 加 `obs_weight`（float，缺省 1），在 `ba.slang` 的残差 kernel（约 205 行）与 `jac_impl`（约 265 行）里把残差乘 $w$；来源可以是前端 / 尺度 octave / 离轴角换算（`Camera.errRad` 已有像素到弧度的换算）。
- 先测再设：对每种前端统计残差的鲁棒标准差（MAD），用它定 σ，而不是拍脑袋。
- 可选：把 Geman-McClure 或 Tukey 加成 `--ba-loss` 的新值（`loss.slang` 一个 struct 加编译开关；kernel 数量会翻倍，要留意构建时间与二进制体积）。

**来源证据**：NW-RSBA（[arXiv:2209.08503](https://arxiv.org/abs/2209.08503)）摘要用视觉残差的解析协方差标准化重投影误差（摘要未给数字）；IM360 球面 BA 局部阶段 soft-L1、全局阶段不加核。

**怎么验证**：同一数据、固定其余设置的 A/B；报告注册率不变前提下的 ATE 变化，分前端分别看。

### Q1-4　卷帘快门与镜头间曝光时差

双鱼眼最有机会的“机理级”改进，也是最需要先诊断的。

**缺口**：相机转动时，图像沿读出方向被剪切。一阶算例（**推断，非来源数字**）：角速度 0.5 rad/s、读出 11.9 ms、焦距约 550 px，则帧上下沿的几何位移约为

$$0.5\times0.0119\times550\approx3.3\ \text{px}$$

这与笔记里“横向平移吸收了不是刚性偏移的东西”的观察同方向，但是否是原因没有验证。

**现状**

- 读出时间已读出：X5 `.insv` 4K 为 11.9 ms、Osmo 360 为 24.0 ms（[[docs/notes/imu-gps-for-sfm.md#L61|§2.1]]、§2.3），测试里 Avata 为 21.2 ms；只用于帧时刻 = idx/fps + 0.5·读出 + 偏移（[[src/sfm/map/SensorPriors.h#L292]]、[[src/sfm/map/SensorGauge.h#L224]]）。
- BA 观测模型是全局快门（[[src/sfm/shaders/common/camera.slang#L294|reproject / reprojectRig]]）。
- 两个镜头同索引抽帧（`extract_synced`），但两颗传感器各自真实曝光时刻的差没有建模。

**建议改法**

0. **诊断（不改 BA）**：对每个镜头，把残差的 y 分量对观测行号做回归，看斜率是否随角速度（陀螺）变化；斜率为零则卷帘不是主因，可以省掉这项。
1. 一阶卷帘模型（公式见列表后）：$s=\pm1$ 是每镜头的读出方向，$\omega$ 先取陀螺（`SensorTimeline` 已能给出 IMU 旋转，经手眼 $X$ 转到镜头系）作固定输入，不入优化，以避开与旋转 / 主点的退化。
2. 实现：`reproject<M>` 增加 $(\omega,\tau)$ 入参，$\omega$ 为每图常量缓冲；雅可比仍由 `bwd_diff` 生成。DJI 没有原始陀螺，只有 1 kHz 融合姿态，可用相邻四元数差分求 $\omega$。
3. rig 加一个标量 $\Delta t$（第二镜头相对第一镜头的曝光时差），与 $\omega$ 相乘修正第二镜头旋转；先做一维扫描再决定是否入优化。

观测所在行 `row`（图像高度 $H$）的时刻与对应旋转为：

$$\tau=\left(\frac{\text{row}}{H}-\frac12\right)\cdot\text{readout}\cdot s,\qquad R(\tau)=\exp\!\big([\omega\tau]_\times\big)\,R_0$$

**来源证据**：NW-RSBA 摘要称卷帘 BA 的归一化加协方差加权优于现有工作（未给数字）；3DGUT（[arXiv:2412.12507](https://arxiv.org/abs/2412.12507)）摘要称渲染端支持畸变相机与卷帘；COLMAP 3.10–4.2.1 的 changelog 里检索不到卷帘模型；OVR 把 IMU 用在尺度与时间上，未处理卷帘。

**怎么验证**：合成数据——照 `sfm_sensor_gauge_test` 的写法注入已知卷帘，检查能否恢复；真实数据——同一地点“慢走”和“快转”各一段，比较闭环误差与“残差—行号”斜率；有 $\Delta t$ 项时看斜率是否归零。

### Q1-5　时间同步：速率项 / 分段偏移，陀螺 bias 进因子

**缺口**：标称帧率与真实帧率有微小差别时，偏移会随时间线性增长。

**现状**

- 时钟偏移每个 capture 一个标量，由“相邻帧旋转角”匹配搜出（[[src/sfm/map/ImuExtrinsic.h#L327]]；[[src/sfm/map/SensorPriors.h#L556|拿重建旋转再估一次]]）；fps 取文件标称值（[[src/sfm/Pipeline.cpp#L267]]）。
- 陀螺相对旋转因子用固定的漂移项 `drift_deg_per_s = 0.03` 吸收 bias（[[src/sfm/map/SensorPriors.h#L43]]）；bias 只在尺度求解里估。

**建议改法**

- 偏移改成 (offset, rate) 两参数，或每 N 秒一个偏移；沿用“与手眼 $X$ 无关的相邻帧旋转角匹配”目标，做 2 维搜索。
- 每段 3 个陀螺 bias 参数进入相对旋转因子（`Priors.h`），保留 0.03°/s 作先验宽度；`gauge.txt` 里报告每段偏移与漂移量，超过阈值就警告。

**来源证据**：OVR 报告 0.1% 的帧间隔误差在 10 分钟内造成 0.6 秒偏移；联合求解的尺度偏差 +3.4%，分段求解把 MAE 从 3.43% 降到 0.85%；手眼残差 0.05–0.18° / 区间。

**怎么验证**：在 5 分钟以上的 clip 上画偏移随时间的曲线；对照 LiDAR / 卷尺的尺度误差。

### Q1-6　用已有的 RoMa v2 做稠密匹配精修（只对弱段）

**缺口**：稀疏关键点的定位噪声是 BA 精度的上限；学习式稠密匹配有机会把它压下去。

**现状**：RoMa v2 已原生移植（[[src/roma/README.md|src/roma]]），`dense/` 里“矫正后匹配”是默认并支持鱼眼 / 全景；但 dense 之后相机固定（[[src/dense/README.md|src/dense/README]]）。SfM 端没有特征度量精修，也没有引导匹配。

**建议改法**

- 作为 SfM 之后的可选阶段：对共视或序列窗口内的帧对，在矫正后的针孔切片上跑 RoMa v2，取高置信匹配，对已有 3D 轨迹做亚像素重定位（PixSfM 的关键点调整思路），或作为额外轨迹加入 BA，最后再跑一次带 Huber 的 BA。
- 先限制在“残差大 / 观测少 / 序列弱段”的帧，控制成本。

**来源证据**：Pixel-Perfect SfM（[arXiv:2108.08291](https://arxiv.org/abs/2108.08291)）、DetectorFreeSfM（[arXiv:2306.15669](https://arxiv.org/abs/2306.15669)，摘要称 IMC 2023 第一名），摘要均无数字；RoMa 在 WxBS 上 +36%（匹配指标，不是位姿）。RoMa 为 MIT 许可，仓库 `LICENSES/` 已含 `MIT-RoMaV2.txt`；DINOv3 另有许可。

**怎么验证**：同一弱段上比较精修前后的 ATE 与重投影残差分布，并记录显存峰值与耗时。

### Q1-7　重力对齐旋转平均：先当校验器

**缺口**：增量式在长回环上靠 BA 闭合，没有独立的全局一致性检查。

**现状**：增量式与 bottom-up 两种 mapper，全局 mapper 未做（README #16）；旋转平均只在合并时做弦均值（[[src/sfm/map/Merge.h#L517]]）。每帧重力方向已有（`SensorTimeline` 的 up 投票、`--sensor-map` 的重力因子）。

**建议改法**

- 中档：对已验证配对的相对旋转加每帧重力做旋转平均，输出每帧旋转残差；用于识别误配准 / 重复结构（与 D79 的序列机制互补），也可给 assemble 阶段的拼接提供旋转初值。
- 高档：GLOMAP 式全局定位加 BA，作为 `--mapper global`。

**来源证据**：重力对齐旋转平均（[arXiv:2410.12763](https://arxiv.org/abs/2410.12763)）摘要：比 SfM 基线平均高 13 个 AUC@1° 点且快 8 倍，比标准平面位姿图高 23 个（四个大规模数据集，非 360）。COLMAP 4.0 已并入 GLOMAP；二者均为 BSD，与 GPL-3.0 兼容（一般性判断，非法律意见）。

**怎么验证**：在带闭环的长序列上比较闭环闭合误差；看校验器标出的帧是否真对应人工确认的误配准。

### Q1-8　完整视觉–惯性 BA

**缺口**：无特征的帧段没有约束；尺度与重力只能事后拟合。

**现状**：笔记自述该项仍开放，并写明它是不同的求解器（每帧速度与 bias 列），应排在常量参数掩码之后（[[docs/notes/imu-gps-for-sfm.md#L739|§6]]）。预积分类已在（[[src/sfm/core/Preintegration.h]]）。

**建议改法**：给 `BAProblem` 增加每帧速度加 bias 的新参数块与预积分因子；先在合成数据与单段 clip 上做，默认关闭。

**来源证据**：Hilti-Trimble 2026 冠军方案基于 OKVIS2-X（得分 2410 / 2500，定位 RMSE 24 cm）。这是 SLAM 竞赛，不能直接换算成 SfM 精度。

**怎么验证**：在 Q1-1 的基线上，仅对“视觉弱”的子段比较。

### Q1-9　训练内联合位姿细化

下游补偿，不是 SfM 本身。

**缺口**：SfM 留下的亚像素 / 千分之几度的位姿误差，会在训练里变成模糊或浮点。

**现状**

- 配置项 `use_camera_optimizer` 已被列为“退役字段”（旧配置可加载，保存时不再写出；[[src/data/tests/train_config_test.cpp#L28]]）。最近一次提交说明是 “clean up stub training configs”，据此**推断**它可能是占位（stub）而非被弃用的实现；浅克隆只有 6 个提交，无法追溯。
- [[src/engine/Engine.h#L203]]：3DGS / mip 路径不累积 viewmats 梯度；但后端 Vulkan `ProjectionBwd` 与 `Eval3D` 反向 kernel 已支持可选的 `v_viewmats` / `output_viewmat_grad`。

**建议改法**

- 把 viewmat 梯度接到优化器；参数化为每帧 6-DoF 增量，rig 帧共享（一个帧位姿加每镜头常量外参增量）；做白化预条件；对偏离 IMU / GPS gauge 加惩罚、小学习率、预热后再开。
- 导出细化后的位姿，用 Q1-1 的独立真值检查是否真的更准。

**来源证据**：CamP（[arXiv:2308.10902](https://arxiv.org/abs/2308.10902)）摘要：Mip-NeRF 360 上相对不优化相机的 Zip-NeRF，RMSE 降低 67%，相对 SCNeRF 参数化的联合优化降低 29%。GS-SMC（[arXiv:2508.17876](https://arxiv.org/abs/2508.17876)）摘要：7-Scenes 中位平移 / 旋转误差降低 53.3% / 56.9%（重定位设定，不是整段 SfM）。

**怎么验证**：留出视角指标和独立真值上的位姿误差，两者都要看。

### 暂不建议优先做的

| 项目 | 为什么先不做 |
|---|---|
| 局部 BA | README #1 自己说它主要是规模问题，且 mapper 的 BA 大多已经很小；要先测“稠密 LM 对持久 GPU BA”再决定。不是精度项 |
| Nistér 5 点 / EPnP | README #8 列为未做；已有 E-from-F、P3P、gp3p；没有来源给出这两项的位姿增益 |
| SPRT 加速验证 | 决策 D26 已实测并否决（评分只占 RANSAC 约 4%） |
| ERP 球面 BA 整体改造 | 默认把 360 展开成透视视图（README #11）；ISPRS 2026 指出原始鱼眼在最难场景最好。数据是原始 `.insv`，不必走这条 |
| 前馈模型直接出最终位姿 | 只适合作初始化或粗检（见 F7） |

## 4　Q2：值得加入的功能

约束：Vulkan / Slang、C++ kernel、运行时不依赖 Python、GPL-3.0；模型权重不随仓库分发。

| 功能 | 为什么有意思 | 与现有代码的契合 | 工作量（推断） |
|---|---|---|---|
| F1 SfM 质量报告 | 现在只有 `gauge.txt` 的“是否定向 / 是否度量”；调位姿时最缺“哪一段最差、为什么” | 复用 Progress 快照（`model.bin` v3）与 SensorView 图表；`SS_SFM_PRIOR_DUMP` 已能打印每个先验因子 | 低–中 |
| F2 陀螺辅助选帧 | FramePick 只看图像边缘宽度与 dHash；Insta360 / GoPro 有 1 kHz 陀螺 | `PickRule` 是一条规则被两个解码器和 GUI 共用，加“角速度上限”条件即可 | 低 |
| F3 标定与验证模式 | 把“出厂标定 vs 自标定”“tag 尺寸比 vs 离轴角”变成产品功能 | `external/apriltag` 与 `MarkerDetector` 已在；BA 与相机模型已在 | 中 |
| F4 训练内位姿 / rig 细化 + 卷帘感知渲染 | 最终是 3DGS；SfM 残余误差由训练“买单” | 后端 kernel 已支持 viewmat 梯度 | 中–高 |
| F5 LiDAR 辅助位姿精修 | 仓库已能把重建对齐到扫描，但只是事后对齐，没反过来约束位姿 | `LidarAlign.h` 已有 Sim3 加点到面 ICP；深度渲染已有 | 高 |
| F6 位姿不确定度导出 | 没有逐帧协方差，就无法区分“位姿准”和“位姿只是被先验拉住” | BA 的 Schur / CG 结构里已有逐帧 6×6 预条件块 | 中 |
| F7 前馈几何模型作“救援初始化” | 笔记记录过骑行场景：重建碎成单镜头片段、GPS 拟合被拒 | 已原生移植 RoMa、MoGe、Metric3D、LoMa 等，移植流程成熟 | 高 |
| F8 已拼接 360 视频的球面直接匹配（低优先） | README #11：ERP 极区畸变下学习式匹配“未测” | mapper 已能写 EQUIRECTANGULAR（模型 17） | 高 |

### F1　SfM 质量报告：逐帧置信度、弱段定位、补拍建议

- 导出逐帧 JSON：观测数、平均重投影、三角化角分位、rig 内两镜头一致度（`calibrateRigs` 的 spread）、陀螺相对旋转残差、up 残差。
- GUI 里把弱段标红；一键“对该段提高抽帧密度并重跑”，与 FramePick 联动。
- 覆盖空洞 / 基线过短的热力图，给补拍建议。
- 依赖：无新依赖；同时是 Q1-1 的前端。

### F2　陀螺辅助选帧

- 预测模糊像素 ≈ 焦距 × 角速度 × 有效时间（**推断**，系数需用你的数据标定）。
- 与图像法取并集或交集，做成开关。
- 与 Q1-4 共用 $\omega$。

### F3　标定与验证模式（棋盘 / AprilTag）

- 绕板录一段 `.insv`，估每镜头内参与镜头间外参，写回 manifest。
- 报告 tag 边长比对 θ 的曲线与共面残差。
- 注意：AprilTag 在强畸变鱼眼上直接检测会有角点偏差，要先在矫正切片上检测（推断）；棋盘检测需自写或再引入。

### F4　训练内位姿 / rig 细化与卷帘感知渲染

- rig 共享参数化、预条件、gauge 惩罚。
- 渲染端接入每像素行时刻的位姿插值。
- 依赖：需先向维护者确认 `use_camera_optimizer` 退役的原因。

### F5　LiDAR 辅助位姿精修

- 把扫描点到面残差或渲染深度一致性作为 BA 因子（默认关）。
- 风险：评测与约束若用同一份真值就失真，需把数据切成两份；评测时用另一组独立真值。

### F6　位姿不确定度导出

- 导出每帧位姿标准差；在 F1 报告里标出低置信帧；训练时可选降权（需验证有益）。
- 近似协方差对角块可用 `cg.slang` 的 `u_cg_M`（推断，需检验是否够用）。

### F7　前馈几何模型作“救援初始化”

- 仅在 mapper 碎成多个模型时触发；输出作为合并的候选初值，仍由现有 Sim3 合并与审计把关。
- 许可需逐项核实：π³ 为 BSD-3，VGGT 为自定义许可，DUSt3R / MASt3R / VGGSfM / MASt3R-SLAM 为非商用；与 GPL-3.0 的兼容性需逐个确认。权重不随仓库分发（参照 RoMa README 的做法）。

### F8　已拼接 360 视频的球面直接匹配

- 只在确有拼接源需求时再做。来源数字来自稀疏室内全景数据集：EDM 在 Matterport3D / Stanford2D3D 的 AUC@5° 分别 +26.72 / +42.62；IM360 在 Matterport3D 某场景 69.05 对 27.70。不能直接外推到视频。

::: note 关于许可的说明
Apache-2.0、BSD、MIT 的代码一般可并入 GPL-3.0 项目；CC BY-NC 系与自定义许可需要逐个确认；模型权重的许可与代码许可分开看。以上仅为一般性说明，不是法律意见。
:::

## 5　路线图

**前 2–4 周**（每一步都以 Q1-1 的指标做门，没提升就保持默认关闭）：

1. **第 1 周**：Q1-1 评测基线（Hilti 适配器加自采闭环 / tag / LiDAR 三类真值）；同时做两个零成本诊断：Q1-2 的“残差 vs 离轴角”曲线，Q1-4 的“残差 vs 行号”回归。
2. **第 2 周**：按诊断结果做 Q1-2（先加 k5，再看要不要 EUCM；解析 `offset_v3`）与 Q1-3（先测各前端残差 MAD，再加权重列）。
3. **第 3 周**：Q1-5 时钟速率 / 分段偏移；F2 陀螺选帧。
4. **第 4 周**：F1 质量报告（直接复用 Q1-1 的指标）；若 Q1-4 的诊断为正，开始卷帘模型的合成测试。

**之后**：

- Q1-4 卷帘加镜头间时差正式并入 BA；F3 标定 / 验证模式。
- Q1-6 稠密精修（只对弱段）；Q1-7 旋转平均校验器，视结果决定是否做全局 mapper。
- Q1-9 / F4 训练内位姿细化（先和维护者确认退役原因）；F5 LiDAR 约束；F6 不确定度。
- Q1-8 完整视觉–惯性 BA；F7 前馈救援初始化（许可核实后）。

## 6　证据边界与未核实项

::: unv 请注意
- 只做了静态阅读和 grep，没有编译或运行；没有在真实数据上测过任何假设（包括“卷帘是否真是主因”）。
- “缺失”的结论局限于 `src/` 与 `docs/` 的 grep。
- README “Not done yet” 里有些条目可能已过时；`Mapper.h` 头注释与 README 存在不一致。
- Insta360 `offset_v3` 的数学模型没有确认；EUCM 的 COLMAP 参数顺序需对照文档确认。
- `use_camera_optimizer` 是否真的不起作用，最好问维护者。
- 来源数字均转述自调研已核实的论文摘要、仓库文档或笔记；没有摘要数字的项写“未给数字”。重力对齐旋转平均、CamP、GS-SMC 的数据集都不是 360，不能直接外推。
- 上面的 3.3 px 是一阶示意，不是测量，也不是任何来源的数字。
- 许可兼容性是一般性判断，需自己或法务确认。
:::
