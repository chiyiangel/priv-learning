title: Hilti-Trimble-Oxford 2026：数据集与评测流程
sub: 一套公开的 Insta360 双鱼眼加 IMU 数据集，真值来自 LiDAR-惯性 SLAM。怎么下载、怎么提交、怎么打分，以及拿它评估 SfM 时要注意什么。
kw: Insta360 One RS|LiDAR 真值|TUM 格式|评分公式|CC BY-NC-SA 3.0
meta: 依据：挑战赛官方仓库文档（docs/）与调研。评测服务器规则以官网为准；本章没有实际提交过任何结果。
tldr:
**它是公开数据集**，由 Hilti、Trimble 与牛津大学 Dynamic Robot Systems 组为 2026 年 SLAM 挑战赛采集，场景是正在施工的室内工地。设备与 Spirula 的目标场景几乎一样：Insta360 One RS 1-Inch 360 版，原始双鱼眼加 1000 Hz IMU。

**流程不涉及“训练”**：用你自己的方法对每段数据估计相机轨迹，提交 TUM 格式文件；服务器用 LiDAR 生成的参考轨迹比对，按位置误差打分。原始激光点云不公开，也不参与评测。

**三个坑**：比对时**不调整尺度**，所以必须输出米制轨迹；轨迹必须覆盖至少 99% 的真值位姿，否则该段 0 分；场景难度很高（暗光、弱纹理、剧烈运动），分数低不一定说明位姿差。
---

## 1　这是什么

| 项 | 内容 |
|---|---|
| 主办 | Hilti、Trimble、牛津大学 Dynamic Robot Systems 组 |
| 任务 | 2026 年 SLAM 挑战赛（论文：[arXiv:2607.06464](https://arxiv.org/abs/2607.06464)） |
| 场景 | 施工中的室内建筑，30 条序列、7 层、跨 8 个月 |
| 状态 | 挑战赛结果已在 ICRA 公布，在线评测服务器仍可继续提交 |
| 获取 | [GitHub 仓库](https://github.com/Hilti-Research/hilti-trimble-slam-challenge-2026)（标定文件、参考拼接实现、下载脚本）、[Hugging Face](https://huggingface.co/datasets/Hilti-Research/hilti-trimble-slam-challenge-2026)、[官网](https://hilti-trimble-challenge.com/dataset-2026) |
| 许可 | CC BY-NC-SA 3.0：需署名、**禁止商用**、衍生作品须同样许可 |

## 2　数据内容

### 2.1　传感器

- **相机**：Insta360 One RS 1-Inch 360 版，两颗 1 英寸 CMOS，每颗配 Leica Summicron-A 6.52 mm f/2.2 鱼眼，视场约 200°。卷帘快门，官方说明两颗镜头的卷帘与曝光时序同步良好。
- **IMU**：内置 6 轴（三轴陀螺加三轴加速度计），1000 Hz。
- **图像是原始双鱼眼，没有拼接成全景图**；官方也明确指出拼接会带来视差误差。

### 2.2　ROS 2 bag 里有什么

| Topic | 频率 | 说明 |
|---|---|---|
| `/cam0/image_raw/compressed` | 30 Hz | 前相机，RGB，1472×1440，压缩格式 |
| `/cam1/image_raw/compressed` | 30 Hz | 后相机，同上 |
| `/imu/data_raw` | 1000 Hz | 原始 IMU |

时间戳统一加了 10000 秒（IMU 比相机略早启动，为避免负时间戳），所以图像从 t = 10000 s 开始。数据**不是 `.insv`**，要先从 bag 里拆出图片和 IMU 才能喂给 Spirula。

### 2.3　标定

官方提供两套用 Kalibr 得到的内外参：**EUCM 模型**，以及由 EUCM 内参拟合出的**针孔等距模型**（Kalibr 的针孔等距实现标不动这么大视场的鱼眼）；另有卷帘快门参数（[`rs_config.yaml`](https://github.com/Hilti-Research/hilti-trimble-slam-challenge-2026/blob/main/config/hilti_openvins/rs_config.yaml)）。可当初值，也可只做对照。

### 2.4　真值怎么来的

- 一台 **Hesai XT32 激光雷达**与 IMU 组成的建图设备，刚性固定在相机上，用 LiDAR-惯性 SLAM 生成参考轨迹，再通过 LiDAR–相机外参转换到 `cam0` 坐标系（`cam0 → map` 约定）。LiDAR 数据本身**不在 bag 里**，也没有公开。
- LiDAR 与其 IMU 用 PPS 信号硬件同步；Insta360 是独立运行的，所以用两路 IMU 的陀螺范数（与相对朝向无关）做相关搜索，再非线性精修时间偏移与**线性时钟尺度因子**，同时联合优化陀螺 bias。
- LiDAR 比相机晚启动，**每段开头约 5 秒没有真值**，不参与评测。

## 3　评测流程

两个任务可任选其一或都做：

| 任务 | 要求 |
|---|---|
| SLAM | 估计相机轨迹，**坐标系任意** |
| 定位（Localization） | 估计在楼层平面图坐标系（map）下的轨迹，平面图左下角像素为 (0, 0)；官方给出 t ≈ 10005 s 时刻的真值位姿作初始定位（`init_gt_poses.csv`），且只比较水平位置，不看 z |

### 3.1　五步走

1. **下数据**：从 Hugging Face 下载 30 段 ROS 2 bag；拆出图片与 IMU。
2. **用标定**：选用 EUCM 或针孔等距的标定文件。
3. **跑你的方法**：SfM、VIO、SLAM 都行。
4. **输出轨迹**：每段一个 TUM 格式文件，每行 `timestamp tx ty tz qx qy qz qw`，文件名为 `floor_X_YYYY-MM-DD_run_Z.txt`（$X$ 为楼层，如 1–7、EG、UG1、UG2；$Z$ 为当日第几次）；轨迹表示 `cam0` 在世界坐标系下的位姿。
5. **提交评测**：上传到[评测服务器](https://submit.hilti-challenge.com/)，返回每段得分与误差曲线（其中 6 段只给分数、不给误差曲线）。

### 3.2　哪些段计分

| 项 | 数量 |
|---|---|
| 总序列数 | 30 |
| SLAM 任务计分 | 25 段，满分 2500（5 段早期发布时已公开真值，不计分） |
| 定位任务计分 | 24 段，满分 2400（另排除 `floor_UG2_2025-12-02_run_1`，因为没有该段平面图） |

## 4　打分规则

每个位姿按位置误差打分，一段的得分是所有位姿得分的平均，每段封顶 100：

$$\text{score}=\frac{1}{N}\sum_{t=1}^{N} a\cdot e^{-c\cdot \text{error}_t},\qquad a=100,\quad c=0.4605$$

其中 $c=\ln 100/10$，所以误差 0 m 得 100 分，误差 10 m 得 1 分。最终得分是各段得分之和。

| 位置误差 | 1 m | 2 m | 5 m | 10 m |
|---|---|---|---|---|
| 单个位姿得分（按公式算出） | 约 63 | 约 40 | 约 10 | 1 |

另外有一道硬门槛：预测轨迹要匹配上**至少 99%** 的真值位姿，覆盖率计算为 $|\text{匹配的预测位姿}|/|\text{真值位姿}|\times100$；低于 99%，该段直接记 0 分。

## 5　拿来评估 Spirula 要注意什么

::: warn 三个坑
1. **尺度**：官方明确说使用 evo 时**不调整尺度**，所以输出必须是真实米制尺度。纯视觉 SfM 的尺度不定，要靠 IMU 或其他方法恢复。Spirula 有度量尺度恢复功能，可以用上。
2. **覆盖率**：SfM 一般只解抽出来的关键帧，需要把位姿插值到每个真值时间戳，或干脆全帧都解，才能达到 99%。
3. **场景难度**：室内工地，暗光、弱纹理、剧烈运动和动态初始化的片段多，与户外 3DGS 采集差别很大。分数低不一定说明位姿差，也不能直接代表你自己场景的结果。
:::

### 5.1　不提交也能测

全部 30 段的真值现在都已在 Hugging Face 公开，可以本地用 [evo](https://github.com/MichaelGrupp/evo) 算 ATE 和分数，做 A/B 对比更快；评测服务器只在需要上排行榜时才用。要注意：如果既拿这些真值做约束、又拿它做评测，结果会失真。

### 5.2　许可提醒

数据集许可是 CC BY-NC-SA 3.0，只能非商用。若要放进 Spirula 的测试集，或用于公司内部用途，要留意这一点。

### 5.3　参考：冠军方案

据 Hilti 论文：前几名都用 VIO（多用双相机加 IMU）加后续 BA；SLAM 冠军 ACDC-VSLAM（KAIST，2410.0 / 2500 分）基于 OKVIS2-X，做了球面等面积特征选择以提升鱼眼角度覆盖、线特征补纹理缺乏区域、按轨迹可靠性与深度重加权局部 BA、前后相机跨相机回环，并按候选质量在 SE(3)、Sim(3)、4DoF 校正间自适应选择；定位赛冠军以 OKVIS2-X 加在线外参标定起步，平均 RMSE 24 cm。OpenVINS、ORB-SLAM3、VINS 等也被采用；跨相机回环与操作员 / 动态物体遮罩被普遍采用。

::: note 下一步的可能
如果要真正用起来，需要两样东西：一个把 bag 转成 Spirula 输入（图片加 IMU）的脚本，一个本地评分脚本；先挑一两段简单的序列跑通。
:::
