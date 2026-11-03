title: 全局 BA 与 GPU：Spirula、COLMAP、MegBA
sub: Spirula 的全局 BA 默认跑在 Vulkan GPU 上；COLMAP 的 GPU 支持有限且默认关闭；MegBA 适合多卡超大规模，但不适合双鱼眼加 IMU 的流程。
kw: 光束法平差|Vulkan / Slang|Schur + PCG|Ceres|MegBA
meta: 依据：spirula-studio b5430ba、COLMAP main、MegBA 7d914d5（均为上游当时的最新提交）。结论来自读源码、文档和论文，没有编译，也没有实测。
tldr:
**Spirula 的全局 BA 默认就在 GPU 上跑**：残差、雅可比、Schur 消元、线性求解和参数更新都在 Vulkan 上完成，不依赖 Ceres。

**COLMAP 并非完全不能用 GPU**，但开关默认关闭，且只把线性求解这一步交给 GPU，其余仍在 CPU 上。

**MegBA 与 Spirula 面向的对象不同**：MegBA 是为 BAL 式超大问题设计的 CUDA 多卡库；Spirula 的 BA 是 SfM 流水线的一环，为单机、任意显卡、双鱼眼加 IMU/GPS 先验的真实采集设计。
---

## 1　背景：BA 在算什么

光束法平差（BA）同时调整相机位姿 $T_i$、三维点 $X_j$ 和内参 $K$，让所有观测的重投影误差之和最小：

$$\min_{\{T_i\},\{X_j\},K}\ \sum_{(i,j)}\rho\!\left(\big\|\pi(K,\,T_iX_j)-x_{ij}\big\|^2\right)$$

其中 $\rho$ 是鲁棒核（Huber、Cauchy 等），$\pi$ 是相机投影。用 Levenberg–Marquardt（LM）求解时，每次迭代都要解一个法方程。把变量按“相机”和“点”分块后，它有很强的结构：

$$\begin{bmatrix} B & E \\ E^{\top} & C \end{bmatrix}\begin{bmatrix}\delta_c\\ \delta_p\end{bmatrix}=\begin{bmatrix}g_c\\ g_p\end{bmatrix}$$

$C$ 是按点分块的对角阵，容易求逆。消去点之后得到只含相机的 Schur 补 $S=B-EC^{-1}E^{\top}$，规模小得多。后面所有的“稠密 Cholesky”“隐式 Schur PCG”，都是在解这个 $S$。

::: note 为什么 BA 难搬到 GPU
BA 对数值精度很敏感，法方程病态。消费级显卡的 fp64 吞吐只有 fp32 的 1/32 到 1/64，而 fp32 的精度又不够收敛到亚像素。所以“能不能上 GPU”，核心问题是精度和稀疏结构，而不只是写几个 kernel。
:::

## 2　Spirula 的 GPU BA

实现说明见 [`src/sfm/ba/README.md`](https://github.com/harry7557558/spirula-studio/blob/b5430ba628e707f8e87076e4fdbe0343a6440970/src/sfm/ba/README.md)。

### 2.1　整个 LM 迭代都在 GPU 上

残差、雅可比（由 Slang 的自动微分生成）、Schur 消元、线性求解和参数更新全部在 GPU 上计算。主机端只负责判断这一步接受还是拒绝。

### 2.2　两种线性求解器，按规模和显存自动选择

| 求解器 | 做法 | 适用 |
|---|---|---|
| 分块稠密 Cholesky | 自己写的分块实现，原地分解 | 相机数少的小问题 |
| 隐式 Schur PCG | 不显式构造约化矩阵，显存随观测数线性增长；整个 CG 循环都在 GPU 里跑，不与主机来回 | 相机多的大问题 |

选择 CG 的条件：稠密方案超出显存预算、维度大于 8192，或 CG 的估计代价不到稠密的一半。预条件器是块 Jacobi，外加一层粗空间修正：每 k 个连续帧共用一个 7 自由度的相似变换基。这一层默认图像按轨迹顺序排列，所以乱序数据集上效果会变弱。

### 2.3　精度档位

| 档位 | 说明 |
|---|---|
| `double`（默认） | 需要设备支持 fp64 和 fp64 原子加；不支持就退回 CPU 版本（`--real cpu`） |
| `cpu` | 同一套 LM 和求解器，结果和 GPU 版一致到 7 位有效数字 |
| `df` | 用两个 fp32 拼出约 48–49 位有效位，适合 fp64 很弱的大显卡；需手动指定 `--ba-real df`。靠 CAS 循环做原子累加，超越函数也是软件模拟，比较慢 |
| `float` | 可用但默认不选。作者实测 fp32 的法方程精度卡在 1e-7 左右，不够收尾阶段的 BA |

### 2.4　容错与显存

- **设备丢失**（例如 Windows 的 TDR 超时）：GPU 任务切成约 0.25 秒一段提交，每 5 秒存一次检查点，出错后从最近的检查点切到 CPU 接着解。
- **缓冲区超过 4 GB**：拆成最多 4 块。不拆的话访问会越过 4 GB 回绕，导致解错。
- **显存不够**：先把雅可比降成 fp32 存储（累加仍用 fp64），还不够再转到 CPU。
- **作者给的数据点**：12580 张图的数据集，在 12 GB 显卡上，5100 万观测的那几次 BA 用了 29 秒，同样规模在 CPU 上要 148 秒。

## 3　COLMAP 的 BA 为什么基本是 CPU

::: warn 更正：不是“完全不能”
COLMAP 新版本有 `use_gpu` 开关，但默认是 `false`，而且只把**线性求解**放到 GPU 上。残差、雅可比和 Schur 消元仍在 CPU 上。
:::

### 3.1　根本原因：Ceres 的通用设计

- 每个观测是一个 `CostFunction`，用模板自动微分（Jet 类型）在 CPU 上算导数。这是任意的 C++ 仿函数，没法直接搬到 GPU。自定义损失、相机模型和流形都走这条路，通用性就是靠它换来的。
- Ceres 的 GPU 支持只在线性代数这一层：2.2 版起支持 CUDA 稠密 Cholesky，2.3 版起通过 cuDSS 支持 CUDA 稀疏分解。中间还有数据来回拷贝。

### 3.2　COLMAP 当前的 GPU 限制

依据 [`bundle_adjustment.cc`](https://github.com/colmap/colmap/blob/main/src/colmap/estimators/bundle_adjustment.cc)：

| 条件 | 数值 |
|---|---|
| `use_gpu` 默认值 | `false` |
| 启用 GPU 求解器的最少图像数（`min_num_images_gpu_solver`） | 50 |
| 稠密 GPU 求解的上限 | 200 张图 |
| cuDSS 稀疏求解的上限 | 4000 张图 |
| 软件要求 | CUDA 版 COLMAP + 带 CUDA 的 Ceres 2.2 及以上（稀疏需 2.3 加 cuDSS） |

任何一个条件不满足都会退回 CPU，所以多数人用预编译版和默认参数，跑出来就是纯 CPU。

### 3.3　为什么不把 Ceres 整个搬到 GPU

- **精度**：见上文，fp64 在消费级显卡上很慢，fp32 不够。
- **结构不规则**：每个点的观测数不同，Schur 消元在 GPU 上要用大量原子操作，或者重新组织数据。
- **定位**：Ceres 是通用求解器，不像专门的 BA 实现那样可以把相机模型写死在 GPU kernel 里。

**一句话**：Spirula 为 GPU 专门重写了 BA，相机模型和损失函数是固定的几种，直接写成 GPU kernel；COLMAP 用通用的 Ceres，灵活，但最多把线性求解放到 GPU。类似 Spirula 的全 GPU 做法还有 [MegBA](https://github.com/MegviiRobot/MegBA) 和 PBA。

## 4　MegBA 与 Spirula BA 对比

对比对象：MegBA 的 main 分支（[7d914d5](https://github.com/MegviiRobot/MegBA/tree/7d914d59112f994d816cff25a7f2daeb9f90f3db)）和[论文](https://arxiv.org/abs/2112.01349)；Spirula 的 [b5430ba](https://github.com/harry7557558/spirula-studio/tree/b5430ba628e707f8e87076e4fdbe0343a6440970)。

::: note 先抓住定位差异
MegBA 是面向 BAL 式超大问题的 CUDA 多卡库，只有重投影一种因子。Spirula 的 BA 是 SfM 流水线中的一个阶段。两者服务的对象不同，很多差异不是“谁更好”，而是“谁没做”。
:::

### 4.1　逐项对比

| 维度 | MegBA | Spirula |
|---|---|---|
| 形态与 API | 库，接口类似 g2o：继承 `BaseEdge`，写 `forward()`；可用 `JetVector` 自动求导，也可手写解析导数 | 由建图器通过 [`Bundle.h`](https://github.com/harry7557558/spirula-studio/blob/b5430ba628e707f8e87076e4fdbe0343a6440970/src/sfm/map/Bundle.h) 调用，不是通用库；雅可比由 Slang 自动微分生成 |
| 变量类型 | 只有“相机顶点 + 点顶点”，假设 B、C 为块对角，不支持相机–相机边（[#37](https://github.com/MegviiRobot/MegBA/issues/37)） | 相机模型为固定注册表，共 10 种（pinhole、opencv、opencv_fisheye、thin_prism_fisheye、equirect 等）；加新相机模型只需一个 Slang 结构体加一行注册，加新约束类型则要同时改 C++ 和 shader |
| GPU 后端 | 仅 CUDA（cuSPARSE、cuBLAS、Thrust，多卡用 NCCL）；没找到可用的 CPU 求解路径 | Slang 编译到 SPIR-V，跑在 Vulkan 上：NVIDIA、AMD、Intel 都行，Apple 经 MoltenVK；不支持 fp64 时退回 CPU |
| 数值精度 | float 与 double 两版，论文默认 FP64。Final-13682 用 4 卡：FP32 4.8 s，FP64 28.7 s，MSE 几乎相同；但承认 FP32 在部分数据集上不稳定 | double / df / float / cpu 四档，默认只有“double 不行就退到 cpu”这一条路 |
| 线性求解 | LM + Schur + PCG，预条件为相机块对角（cuBLAS 批量求逆），多卡用 allreduce；没有 GPU 直接分解（[#14](https://github.com/MegviiRobot/MegBA/issues/14)） | 稠密 Cholesky 与隐式 Schur PCG 两条路径自动选；块 Jacobi 加粗层修正 |
| 显存 | 最初显式存 Hessian，8000 万观测时 H 超过 50 GB；2023 年 11 月加了隐式版本；预分配内存池 | 每个观测只存 $J_c$、$J_p$ 与残差，不显式算乘积；超 4 GB 拆块；不够时雅可比转 fp32 |
| 多卡 | 观测按边均分到各卡；论文在 8×V100 + NVLink 上测，无 NVLink 时通信可能成为瓶颈 | 单卡，文档写明不支持多卡执行 |
| 共享内参 | 不支持（[#22](https://github.com/MegviiRobot/MegBA/issues/22)、[#44](https://github.com/MegviiRobot/MegBA/issues/44) 未解决） | 支持，可任意分组，每组模型可不同 |
| 多相机 rig | 无 | 支持，可优化成员之间的外参 |
| IMU / GPS 先验 | 无，README 列为 TBD | 相对旋转、重力方向、尺度和 GPS |
| 鲁棒核 | 源码里没找到 | Huber 与 Cauchy |
| 固定部分参数 | 有 `fixed` 标志，但 #44 报告设置后崩溃 | 被优化的参数必须是前缀，做不到“固定焦距、只优化畸变”（见第 2 章） |
| 稳健性 | 没找到设备丢失处理、检查点或 CPU 回退；有 open issue 报 `misaligned address`（[#43](https://github.com/MegviiRobot/MegBA/issues/43)） | 分段提交、检查点、CPU 回退、缓冲区超限转 CPU |
| 许可与维护 | Apache-2.0。最近一次提交是 2026 年 9 月的 CUDA 13 适配，此前是 2023 年 12 月，基本只做兼容修复 | GPL-3.0，持续有新提交。GPL 有传染性，嵌入闭源系统要注意 |

### 4.2　性能数据：不能直接比较

两边的硬件、数据集和收敛条件都不同。

| 系统 | 硬件 | 结果 |
|---|---|---|
| MegBA | 8×V100，FP64 | Venice-1778 用 3.34 s（同一问题 Ceres 要 319 s）；Final-13682 用 22.1 s（Ceres 916 s）；合成 8000 万观测问题 8 卡 216 s |
| Spirula | RTX 5070 | 4194 张图 2.6 s；6946 张的双鱼眼 rig 51.2 s；22042 张 193 s；与 Ceres 2.2 的最终代价约 6 位有效数字一致 |

### 4.3　不同场景怎么选

| 场景 | 建议 |
|---|---|
| BAL 式超大问题，且有多张 NVIDIA 卡 | MegBA，论文已验证 8 卡解 8000 万观测 |
| AMD、Intel 或 Apple 显卡 | 只能选 Spirula，MegBA 只支持 CUDA |
| 消费级显卡、fp64 很弱 | 两边都要妥协：MegBA 只能退到 FP32，有不稳定风险；Spirula 可用 `df`（精度够但慢）或直接用 CPU 的 fp64 |
| X5/X6 的 `.insv`、Avata 360 的 `.osv` 双鱼眼，加 IMU、GPS，最后接 3DGS | 明显选 Spirula：双鱼眼 rig、thin-prism 模型、共享内参、传感器先验、显卡出错保护，MegBA 一项都没有 |
| 要嵌进自己的 SLAM / SfM 系统 | 看需求：MegBA 是现成库、接口像 g2o，但不支持共享内参和相机间约束且基本无人维护；Spirula 的 BA 与流程绑得很紧，难单独拆出，且是 GPL |
| 研究、需要自定义残差 | MegBA，写一个 `forward()` 即可；Spirula 要改 shader 和注册表 |
| 很小的问题 | 两边都没必要上 GPU。MegBA 维护者承认小规模上直接法比 PCG 快 10 倍以上；Spirula 小问题走稠密 Cholesky，152 张图 GPU 0.81 s、CPU 1.85 s |

::: unv 没有核实的部分
- 两边都没有编译、没有跑过，也没有在同一数据集上对比。
- “MegBA 的 CHOLMOD 求解器是否参与编译”，是看 CMake 配置推断的。
- “MegBA 没有鲁棒核、没有粗层预条件、没有设备丢失处理”，是在源码里没搜到，不是官方明确说明。
- Apple GPU 上跑 Spirula BA 的实际表现，没有找到数据。
:::
