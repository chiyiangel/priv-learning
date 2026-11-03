title: 相关项目速读：fused-zipnerf、PR #214、MRE 导出修复
sub: 三个与 SfM / 3DGS 工作相关的具体项目：Zip-NeRF 的全 CUDA 重写版，Spirula 里“按对焦置信度降低模糊像素权重”的 PR，以及 points3D.bin 里逐点重投影误差恒为 0 的 bug 与修复。
kw: fused-zipnerf|Zip-NeRF|PR #214|MoGe-2|points3D.bin|上游 PR 规范
meta: fused-zipnerf 依据其仓库 README 与代码；PR #214 依据 PR 页面；MRE 修复依据 fork 分支与上游 master c85008c。
tldr:
**fused-zipnerf** 是 Zip-NeRF 的全 CUDA 重写，画质对齐官方、训练快约 6–7 倍，但它**不优化位姿**，对 SfM 精度和 3DGS 清晰度没有直接帮助，价值在于让 NeRF 级画质基线变便宜。

**PR #214** 不是修 bug，而是新功能：用单目深度加边缘模糊估计，算每个像素的对焦置信度，乘进遮罩，让 3DGS 训练少受失焦像素影响。构想不错，但作者没跑任何运行时测试，合并前需要实测。

**MRE 导出 bug** 的真实情形是：终端汇总的 MRE 本来就对，错的是导出的 `points3D.bin` 里每个点的 `error` 恒为 0。修复分支已在 fork 上准备好。
---

## 1　fused-zipnerf

仓库：[fhahlbohm/fused-zipnerf](https://github.com/fhahlbohm/fused-zipnerf)，MIT 许可，作者来自 NeRFICG 框架那个组。

### 1.1　它是什么

[Zip-NeRF](https://arxiv.org/abs/2304.06706)（Barron 等，ICCV 2023）把 Mip-NeRF 360 的抗锯齿锥体采样与 Instant-NGP 的多分辨率哈希网格结合：两级 proposal 加一级 NeRF，每级一套哈希网格。官方实现基于 JAX。

这个项目**没改算法**，改的是实现：不用 PyTorch autograd 和 tiny-cuda-nn，全部换成手写 CUDA kernel，梯度也是手推的解析式。

### 1.2　具体提速手段

| 环节 | 做法 |
|---|---|
| 射线生成 | 所有训练图像常驻 GPU，每个 batch 的射线现场生成；所有随机数（选像素、采样抖动、多重采样图案、背景色）用迭代种子做计数器哈希算出，不存也不读 |
| 特征查询 | 六边形多重采样、场景收缩、特征降权等哈希网格查询用 NVRTC 运行时编译，网格布局直接编成常量；小的 proposal MLP 用 fp32 融合进同一 kernel，前向和反向都在里面 |
| 主 MLP | 一串 fp16 的 cuBLASLt GEMM，bias 与 ReLU 融合在 epilogue；bottleneck 后只接线性层，所以直接折进权重 |
| 损失 | 合成、重采样，以及 Charbonnier 数据损失、interlevel 损失、distortion 损失，全部在每条射线一个的融合 kernel 里连梯度一起算完 |
| 优化器 | 一次 launch 跑完所有参数的 Adam，网格正则也顺带做 |
| 推理 | 射线按 Morton 序排，一个 warp 处理相邻 32 条，哈希查询大多命中同一批 cache line |
| 训练方式 | 单卡就能一次跑 65536 条射线，直接用论文的 8 卡配置（25k 次迭代），不用官方单卡版那种 8192 条射线、200k 次迭代的配置 |

### 1.3　效果（目前只测了 Mip-NeRF 360 的 garden 场景）

| | PSNR | SSIM | 训练 | 渲染 |
|---|---|---|---|---|
| fused-zipnerf（RTX 5090） | 28.22 | 0.860 | 36 分钟，约 10 GB 显存 | 1297×840 约 300 ms |
| 论文 | 28.20 | 0.860 | — | — |
| 官方代码（4090） | 28.22 | 0.863 | 约 5 小时 | 0.1–0.2 FPS |

::: warn 注意
- 速度对比不是同一张卡（5090 对 4090），所以 6–7 倍与 10 倍里有一部分是硬件差距。
- 只测了一个场景，作者自己也说测试有限。
- 只支持 NVIDIA，必须装进 NeRFICG 框架（放在 `src/Methods/ZipNeRF`），不能单独当 PyTorch 扩展用。
- 最新提交（10/31）加了中值深度渲染。
:::

### 1.4　对位姿、重建精度、清晰度有提升吗

基本没有直接提升：算法与官方一致，画质也只是对齐官方，不是更高。

- **位姿准确度：没有提升。** 它把相机位姿当固定输入（通常来自 COLMAP 或你自己的 SfM），代码里没有优化位姿的部分；官方 `camp_zipnerf` 里可选的 CamP 位姿优化也没移植过来。SfM 位姿有多少误差，它就原样继承。
- **SfM 重建精度：没有关系。** 它属于 SfM 下游的新视角合成，不碰特征、匹配、三角化和 BA。
- **3DGS 清晰度：不会直接变好**，两者是独立的表示。

间接用法：

- **当画质对照**：Zip-NeRF 在 360 场景上一般比原版 3DGS 高约 1 dB PSNR，抗锯齿更好。以前训一次要几小时，现在半小时，可以用来判断 3DGS 的瓶颈在表示方式，还是在数据与位姿。
- **当位姿质量的放大镜**：用同一套位姿训一个 Zip-NeRF；如果它也糊，或出现重影、floater，多半是位姿或内参有问题，而不是 3DGS 的锅。
- **给 3DGS 当先验**：中值深度渲染可输出深度图，拿去做 3DGS 的深度监督或初始化，也可作为教师做蒸馏，或给稀疏视角补渲染虚拟视图——这些都要自己接，项目本身不提供。

::: tip 一句话
想提升位姿与重建精度，仍要在 SfM 与 BA 一侧下功夫（第 4–6 章），或者用带位姿联合优化的 3DGS。渲染一帧约 300 ms，也远没有 3DGS 的实时性，所以它不是 3DGS 的替代方案。
:::

## 2　Spirula PR #214：按对焦置信度降低模糊像素的权重

[PR #214](https://github.com/harry7557558/spirula-studio/pull/214)，作者 RobLinkA，2026-10-16 提交，核对时仍是 open，没有评论或 review。它**不是修 bug，而是新功能**。

### 2.1　要解决的问题

景深之外的失焦区域也会参与 3DGS 训练的光度监督，给出不可靠的梯度，可能把模糊“学”进场景里。

### 2.2　做法

1. **估计对焦置信度**：新增 `spirula focus` 命令（GUI 的数据集 / SfM 几何设置里也有对应勾选项）。先用 MoGe-2 large 估计单目深度，再从图像边缘估计模糊程度（带噪声校正），拟合一条“模糊量随深度变化”的曲线；按训练分辨率下允许的模糊像素数，算出每个像素 0–1 的置信度。
2. **乘进现有遮罩**：最终遮罩 = 原遮罩 × 对焦置信度；没有原遮罩就当作全 1。训练照常读 `masks/` 目录，不需要额外开关。
3. **备份与可重复**：原遮罩备份到 `.spirula-focus/`，按内容哈希记录——重复运行不会越乘越暗，在外面手改过的遮罩会被当成新基准，写文件中途被打断也能恢复。
4. **训练端支持连续灰度遮罩**：RGB 梯度与 densification 用的误差图都乘 `mask/255`，CUDA 与 Vulkan 都实现了；二值遮罩的行为不变，以前已有的灰度遮罩也会顺带按权重生效。
5. **预览**：在 `focus_overlay/` 生成预览图（权重越低越偏蓝，带可离线搜索的 `index.html` 图库）；`--overlay-only` 只看现有遮罩的预览，不跑深度模型也不改遮罩。

### 2.3　需要注意

- 权重只作用于 RGB 梯度与 densification 信号。日志里的 loss 统计口径没变，深度、法线监督和几何正则也没有加权。
- 关闭功能**不会**还原已写入的遮罩，要从备份恢复。
- 作者自己写明：只在 Windows 上做过 Vulkan Release 编译，**没有跑过任何运行时、推理、训练或自动化测试，CUDA 也没编译过**。改动涉及 38 个文件、约 2000 行新增代码。

::: note 评价
思路不错，但验证很不充分，合并前需要有人实际跑一遍训练做对比。对双鱼眼数据适不适用，还需要进一步看它的模糊估计算法。
:::

## 3　MRE 导出修复：points3D.bin 里逐点误差为 0

### 3.1　bug 的真实情形

起初的描述是“跑完 SfM 后没有 MRE 指标”。核对后更准确的说法是：

- 终端打印的汇总 MRE（由 `reprojStats` 计算）**本来就是对的**；
- 缺的是导出的 `points3D.bin` 里**每个点的 `error`**。上游 `Point3D::error` 默认 0，整条流水线没有任何地方计算它（[`Model.h:39`](https://github.com/harry7557558/spirula-studio/blob/c85008c12ba23d8b24ca90654a71e3297f71cb06/src/sfm/core/Model.h#L39)），而 `writeModels` 直接把它写进文件；
- 结果：用 COLMAP 的 `model_analyzer` 等工具读取导出的模型，MRE 一律显示 0。

核对时上游没有相关 issue 或 PR，作者也没回应过这个问题，所以值得提给上游。

### 3.2　修复内容

| 位置 | 改动 |
|---|---|
| `src/sfm/core/Model.h` | 新增 `Reconstruction::updatePointErrors()`：每个点的 `error` 设为其在已注册图像中的观测的平均像素误差。非有限值和相机后方的观测（宽视场相机用 bearing 判断）被跳过；没有可用观测的点记 `-1`（COLMAP 的“未知”）。`Point3D::error` 默认值由 0 改为 -1 |
| `src/sfm/Pipeline.cpp`、`Pipeline.h` | `writeModels` 改为按非 const 引用接收模型，并在 `writeBinary` 前调用 `updatePointErrors()`，覆盖 `sparse/0`、`sparse/1`… 与 `pre_weld/` |
| `src/app/cli/sfm_ba.cpp` | `ba` 子命令写出前也调用 |
| `src/sfm/tests/sfm_point_error_test.cpp`（新） | 覆盖针孔、鱼眼、等距柱状相机；相机后方的点；无观测的点；两个观测的均值；写到 `sparse/1` 的第二个模型，并通过 `Reconstruction::readBinary` 读回 |
| `src/sfm/tests/sfm_exif_gps_prior_test.cpp` | 适配新的 `writeModels` 签名 |

### 3.3　验证（Linux，lavapipe 软件 Vulkan）

- 在当时最新的上游 master 上用 `bash build_develop.bash -DSS_BACKEND=vulkan` 编译通过。
- `sfm_point_error_test`、`sfm_exif_gps_prior_test`、`sfm_sift_test`、`sfm_map_test` 与其余 `sfm_*_test` 通过；`tools/check_*.sh` 等检查脚本通过。
- 例外：`sfm_equirect_seam_test` 的 float64 变体需要 shader fp64，lavapipe 不支持（其 float 变体通过），与本改动无关。
- 用 `sfm_map_test` 的 8 张图模型经 `spirula sfm ba` 重新导出：178 个点的误差全部为正，按轨迹加权平均 0.443 px，与运行汇总一致。
- **没有**拿真实照片从头跑 `spirula sfm`（仓库里没有现成照片数据）。

### 3.4　上游 PR 规范与提交方式

上游没有 CONTRIBUTING、PR 模板、CLA 或 DCO 要求。参照作者最近合并的 PR，惯例大致是：

- 一个 PR 只做一件事；
- 标题写成 `SfM: …` 这样的“模块: 描述”；
- 正文分 Summary、What it contains、Testing 三部分；Testing 里写清楚用 Vulkan 编译过、跑过哪些测试、`tools/check_*.sh` 是否通过。

修复分支是 `fix/point-reprojection-error`：基于当时的上游 master，只多一个提交，标题 `SfM: write each point's reprojection error to points3D.bin`，已推到 fork（`chiyiangel/spirula-studio`）。由于 Cursor 的 GitHub 应用无法对非自己安装的上游仓库创建 PR，需要自己在 GitHub 上通过预填的 compare 页面点击 Create pull request。

::: unv 状态
PR 最终是否已提交、是否合并，以 GitHub 上的实际页面为准，本章不作记录。
:::
