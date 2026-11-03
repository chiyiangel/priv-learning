title: 数据准备：抽帧去糊、INSV 遥测与自备图片的接法
sub: 抽帧阶段怎么挑清晰帧、丢模糊帧；原始 .insv 除了画面还提供什么、在 SfM 里起什么作用；已经自己抽帧加遮罩后，如何把遥测接回去。
kw: FramePick|.insv 遥测|IMU / GPS|manifest|rig
meta: 抽帧部分依据上游 master 6ad73ef；遥测与 manifest 部分依据 91c93e9。均为读代码所得，示例命令和 manifest 没有实际运行过。
tldr:
**抽帧分两层去糊**：第一层在窗口里挑最清晰的一帧（默认开）；第二层按模糊像素阈值直接丢弃（默认关，GUI 叫“跳过模糊帧”，阈值默认 8 px）。

**`.insv` 里真正参与 SfM 的非图像数据只有三类**：IMU（陀螺仪与加速度计）、GPS 和帧时间信息。边缘遮罩、rig 初值、序列信息都不是从元数据读出的。

**即使已经自己抽帧加遮罩，仍可通过 manifest 把原始 `.insv` 挂回去**，让 IMU、GPS、双鱼眼 rig 和你自己的遮罩一起生效，但目前只有命令行入口。
---

## 1　抽帧：怎么跳过模糊帧

### 1.1　第一层：窗口内挑最清晰的一帧（默认开）

每隔 `skip` 帧输出一张，但输出的不是固定那一帧，而是最近 `keep` 帧里最清晰的那张。

- CLI 参数是 `-s/--skip`、`-k/--keep`，`keep` 默认取 `skip/2`；GUI 里叫 `sharp_window`，默认 3。
- 清晰度算法：缩到 512×512 灰度，算 3×3 拉普拉斯的方差，与旧脚本 `extract_frames.py` 用的 `cv2.Laplacian().var()` 是同一思路。
- 多轨视频（如双鱼眼）开 `--sync` 后，各轨分数相加后一起挑，保证同一时刻的帧仍能组成 rig。

::: warn 这一层的局限
它只能“挑相对好的”。如果一整段都是糊的，仍会输出一张糊的。
:::

### 1.2　第二层：超过阈值就丢（默认关）

位置在 [`src/app/FramePick.h`](https://github.com/harry7557558/spirula-studio/blob/master/src/app/FramePick.h) 的 `PickRule`。选出的帧会再判一次：

- **度量方式**：不再用拉普拉斯，而是量最锐利那批强边缘的宽度（像素），取 x、y 方向中更宽的那个——因为运动模糊只往一个方向拖。
- **扣除镜头本身**：减去镜头固有的边缘宽度（整段拍摄里第 10 百分位再乘 1.08，按平方差扣掉），剩下的才算模糊量。这样不同镜头、不同场景可以用同一个阈值。
- **阈值**：超过 `blur_reject` 像素就丢。GUI 里是“跳过模糊帧”，默认 8 px，可调 1–40；CLI 为 `spirula sam extract --blur-reject <px>`。
- **不断链**：`blur_neighbour` 默认开，最多连续丢 2 帧，保证模糊段两侧还能接上匹配。
- **可检查**：被丢的帧可用 `--skipped-dir` 另存一份，方便确认是否误杀。

### 1.3　相似帧去重（默认关）

`--similar`：64 位 dHash，差异位数不够就丢。专门处理相机静止时出一堆几乎相同的帧。

### 1.4　选项速查

| 作用 | CLI | GUI | 默认 |
|---|---|---|---|
| 抽帧间隔 | `-s, --skip` | — | 1 |
| 窗口大小 | `-k, --keep` | `sharp_window` | `skip/2`；GUI 为 3 |
| 多轨同步挑选 | `--sync` | — | — |
| 模糊阈值 | `--blur-reject <px>` | 跳过模糊帧 | 关；GUI 阈值 8 px |
| 保留邻帧 | — | `blur_neighbour` | 开（最多连丢 2 帧） |
| 相似帧去重 | `--similar <n>` | — | 关 |
| 另存被丢弃帧 | `--skipped-dir <dir>` | — | — |

::: tip 建议起步配置
抽帧时加上 `--blur-reject 8 --skipped-dir <目录>`，先看被丢的是哪些帧，再决定阈值往上还是往下调。
:::

## 2　原始 `.insv` 除了画面还给了什么

Spirula 作者建议“直接导入原始 insv/insp，不要用后期处理过的图像”。对照代码后，他列的几项并不都来自文件元数据：

| 作者列出的项目 | 代码里的实际情况 |
|---|---|
| 遮掉鱼眼边缘 | 从抽出的帧的**像素**里拟合镜头成像圆，不来自元数据；需要未拼接的鱼眼帧 |
| 带初始值的 rig 约束 | “初始值”是标称的背靠背 180° 几何（`kind: dual-fisheye`），按文件扩展名 `.insv` / `.osv` 选择；文件内的出厂镜头标定并未用于此 |
| 遥测参与优化 | **这才是真正的元数据用法**：文件尾部的陀螺仪、加速度计与 GPS |
| 利用序列信息处理重复纹理 | 序列就是帧文件名里的帧号顺序；GUI 的 “Sequential” 开关**默认关闭**。IMU 校验是另一重防护 |

### 2.1　从文件尾部读出的数据

解析代码在 [`Telemetry.cpp`](https://github.com/harry7557558/spirula-studio/blob/91c93e9019aafa71f12c9199eb39ad884c4c5fe7/src/sfm/core/Telemetry.cpp#L1098)。

| 数据 | 内容与处理 | 用途 |
|---|---|---|
| 陀螺仪（约 1 kHz） | 按文件自带量程换算成角速度；用首帧时间戳与陀螺时间偏移（字段 24、28、29）对齐到视频时间轴 | 两视图校验、图像注册、BA、最终坐标系对齐 |
| 加速度计（含重力） | 换算时按文件自带量程取每 g 1024 个计数，而不是 exiftool 假设的 1000 | 确定重力方向（“上”）、恢复度量尺度 |
| GPS | 用视频头里的创建时间对齐；X5 的 GPS 实为手机经蓝牙推送，室内常是过时数据 | BA 位置约束、度量尺度、朝向和地理坐标 |
| 卷帘快门读出时间（字段 25） | 只用于修正帧时间，见下式；**没有**卷帘快门投影模型 | 帧时间 |
| 出厂镜头标定 `offset_v3` | 每镜头的 fx、fy、cx、cy、姿态角、k1–k3，**只存成了字符串**，设计文档称“记录了但没应用” | 无 |

帧时间换算：

$$t=\frac{\text{idx}}{\text{fps}}+0.5\cdot\text{readout}+\text{time\_offset}$$

只有大疆 Avata 360 的 `.OSV` 会真正用到出厂镜头标定；曝光信息对 Insta360 不读；相机型号和序列号只写日志。

::: warn 文件一动，数据就没了
这些数据存在文件尾部的特殊结构里，ffprobe 和解封装器都看不到。文件一旦被转码、剪切或重新封装，这些信息就丢了。
:::

### 2.2　遥测在 SfM 里起什么作用

遥测相关的选项默认都开（`sensor_verify` 与 `sensor_map`，见 [`sensor-priors.md`](https://github.com/harry7557558/spirula-studio/blob/91c93e9019aafa71f12c9199eb39ad884c4c5fe7/docs/notes/sensor-priors.md)）。

**① 自动标定 IMU 与镜头的相对旋转。** 文件里没有可用的 IMU 到镜头外参，所以从重建结果反推。建图前取最多 900 对时间相邻且校验通过的图像对，用它们的相对旋转与陀螺积分旋转解手眼标定 $AX=XB$，同时搜索 IMU 时钟偏移和陀螺轴向的符号。建图中，注册到 20 帧时再拟合一次，之后每翻一倍帧数重新拟合，并加入重力约束。若标定退化为只有一根轴有效，就不使用旋转先验。

**② 两视图校验。** 对陀螺覆盖到的图像对，把旋转固定为陀螺给出的值，再用两点法 RANSAC 只估计平移，做第二次校验（[`Verification.h`](https://github.com/harry7557558/spirula-studio/blob/91c93e9019aafa71f12c9199eb39ad884c4c5fe7/src/sfm/feature/Verification.h#L640-L675)）。只有内点覆盖了自由估计内点的 70% 以上，才认为两者一致。它能剔除两类误匹配：

- 自拍杆、支架这类跟相机一起动的东西——它们满足“旋转为零、平移任意”，自由 RANSAC 可能选中它们而丢掉真实场景；
- 相机实际没转过去、却匹配上场景里重复结构的情况。

这才是 IMU 对付重复纹理的真正手段。

**③ 图像注册。** PnP 求出的位姿，如果与“已注册邻帧加陀螺积分”预测的旋转差超过 $\max(2^\circ,\,3\sigma)$，就把旋转固定后重新求解，内点不够则拒绝注册。初始图像对若与陀螺一致，直接采用陀螺的旋转。

**④ BA 里的约束项**（均用 Huber 核，按 $\sigma$ 归一化后加进 Schur 系统）：

| 约束 | 说明 |
|---|---|
| 相对旋转 | 同一镜头相邻两帧；$\sigma$ 等于标定残差加每秒 0.03° 乘时间间隔，最小 0.2° |
| 重力方向 | 每帧，与每次求解重新估计的世界“上”对齐；$\sigma$ 最小 1° |
| 加速度计尺度 | 每连续三帧一个不依赖速度的约束（Mur-Artal 与 Tardós 的形式）；至少 10 组、相对 $\sigma$ 小于 20%、重力与“上”夹角在 20° 以内才启用 |
| GPS 位置 | 每次求解做一次相似变换拟合；GPS 误差相关，所以 $\sigma$ 会放大 |

**⑤ 最终坐标系对齐**（`--sensor-gauge auto`，默认开）：用重力投票确定“上”，用加速度计和 GPS 确定尺度，用 GPS 确定朝向和位置，取代原来“按相机平均朝上方向”的猜法。文档记录：X5 的一段步行数据里，相机平均朝上方向与 IMU 测得的“上”差了 11°。结果写到 `sparse/N/gauge.txt`，给 3DGS 用的地理坐标写到 `scene_transform.json`。

### 2.3　不来自元数据、但需要原始文件的部分

- **双鱼眼 rig**：依据扩展名 `.insv` 加两条视频轨道，把两个镜头拆到 `cam0/`、`cam1/`。默认同步抽帧，保证两个镜头取自同一时刻，否则不会启用 rig 标定。初值是标称背靠背 180°，不是出厂标定（X5 实测与标称差 0.8°–1.0°）。启用后，同一时刻的两帧通过广义相机 PnP 整体注册，BA 里每个时刻共享一个 6 自由度位姿，加上各镜头相对 rig 的外参，并会去匹配另一镜头的对应帧。文档数据：X5 一段 235 帧素材，内点多了 6.9%。
- **鱼眼边缘遮罩**：导入 `.insv` 后自动勾选，从像素拟合成像圆（[`FrameMask.cpp`](https://github.com/harry7557558/spirula-studio/blob/91c93e9019aafa71f12c9199eb39ad884c4c5fe7/src/app/FrameMask.cpp#L243-L300)）。
- **Thin-prism 鱼眼模型**：按扩展名默认选用；初始焦距按 $\sqrt{w^2+h^2}/\pi$ 估算，再由两视图阶段测出，不来自文件。

### 2.4　改用后期处理过的素材会损失什么

| 素材 | 损失 |
|---|---|
| Insta360 Studio 导出的拼接全景图或视频 | 文件尾部数据丢失：IMU、GPS、BA 约束和坐标系对齐全部失效，尺度与朝向任意；变成单相机，rig、边缘遮罩和 thin-prism 模型也用不上 |
| 导出的鱼眼图片或 MP4 | 同样没有 IMU 与 GPS，两镜头的同步关系通常也恢复不了，只能手动整理目录；边缘遮罩和 thin-prism 仍可用 |
| `.insp` 照片 | 只读其中的 JPEG，按宽高比切成两个镜头；不读文件尾部，本来就没有 IMU |

::: unv 没有核实
- 文档只测过 X5 和 Antigravity A1；X6 的文件尾部格式是否一致不确定。GUI 会显示文件是否带 IMU 与 GPS，可先看一下。
- 卷帘快门目前只做了时间修正。
- 出厂标定 `offset_v3` 没被利用；若拿它做 IMU 到镜头外参的初值或内参先验，也许还有提升空间，可与作者讨论。
:::

## 3　已经自己抽帧加遮罩，怎么把遥测接回去

做法是在 manifest 里把原始 `.insv` 作为遥测来源挂上去，并让图片文件名与原视频的帧号对上。manifest 解析见 [`Manifest.cpp` L52–247](https://github.com/harry7557558/spirula-studio/blob/91c93e9019aafa71f12c9199eb39ad884c4c5fe7/src/sfm/core/Manifest.cpp#L52)，通过 `spirula sfm auto … --manifest FILE` 传入。支持 YAML 或 JSON，相对路径相对 manifest 所在目录解析，命令行参数优先于 manifest。GUI 里没有找到给图片文件夹挂 `.insv` 的入口，所以走命令行。

### 3.1　manifest 的主要键

| 键 | 含义 |
|---|---|
| `image_dir`、`mask_dir`、`mask_flipped` | 图片目录、遮罩目录、是否翻转遮罩极性 |
| `camera_mode` | `single`、`folder` 或 `image` |
| `cameras:` | 列表，每项 `{prefix, model, focal, distortion[], params[]}` |
| `captures:` | 列表，每项 `{prefix, telemetry（必填）, fps, time_offset, imu, gps}` |
| `rigs:` | 列表，每项 `{name, kind, captures[], members[]}` |

### 3.2　目录与命名：关键是这一步

```
work/
  manifest.yaml
  images/cam0/00000.jpg …   ← 视频轨道 0
  images/cam1/00000.jpg …   ← 视频轨道 1
  masks/cam0/00000.png …    ← 白色保留，黑色剔除
  masks/cam1/00000.png …
```

- **帧号就是时间**：程序取文件名末尾的数字作为帧号（`00017.jpg`、`frame_000017.jpg` 都行），按上面的帧时间公式换算成 IMU 时间。帧号从 0 开始，第 0 帧就是视频第一帧。
- **两种命名方式任选**：
  - 用**源视频帧号**命名，`fps` 填 0（表示用视频自身帧率）；
  - 用**抽帧后的连续序号**命名，`fps` 填“源帧率 / 抽帧间隔 N”。
- ffmpeg 默认从 1 开始编号，记得加 `-start_number 0`。例如：

```bash
ffmpeg -i in.insv -map 0:v:0 -vf "select='not(mod(n,N))'" -fps_mode passthrough \
       -start_number 0 -q:v 2 images/cam0/%05d.jpg
# cam1 把 -map 0:v:1 的输出写到 images/cam1/
```

- **两个镜头必须同步**：`cam0/00017.jpg` 与 `cam1/00017.jpg` 会被当成同一时刻，所以两个目录的文件名要完全一致，且确实取自同一源帧。名字对上、时间没对上时，`dual-fisheye` rig **不会拒绝**，而是把这部分误差硬吃下去。
- **遮罩**：非零像素表示保留；与图片同名即可匹配（`00017.png` 或 `00017.jpg.png`），分辨率不必一致。如果你的遮罩是把要剔除的区域涂白，加 `mask_flipped: true`。

### 3.3　manifest 示例与运行命令

```yaml
image_dir: images
mask_dir: masks
camera_mode: folder          # 每个镜头目录一套内参
cameras:
  - prefix: cam0
    model: thin-prism-fisheye
  - prefix: cam1
    model: thin-prism-fisheye
captures:
  - prefix: ""               # 空前缀，同时覆盖 cam0 与 cam1
    telemetry: /data/VID_xxx.insv   # 直接指向原始 insv 或 osv
    fps: 0                   # 0 = 用视频自身帧率；按序号命名时填 源帧率/N
    time_offset: 0           # 只有剪过片头时才需要
rigs:
  - name: x6
    kind: dual-fisheye
    members: [cam0, cam1]
```

```bash
spirula sfm auto images/ -o ws/ --manifest manifest.yaml --camera-model thin-prism-fisheye
```

命令行默认相机模型是 `opencv`，所以要显式加 `--camera-model`。陀螺校验、建图先验、坐标系对齐、匹配另一镜头对应帧、回环检测都默认开启，IMU 时钟偏移也自动估计。不写 manifest 的等价写法是：`--masks masks/ --telemetry xxx.insv --rig dual-fisheye=cam0,cam1`。

**OSV 文件**要让出厂镜头标定自动生效，需同时满足：

- 必须是 Avata 360 拍的（Osmo 360 只有遥测，没有出厂标定）；
- 目录名必须是 `cam0`（主镜头，轨道 0）和 `cam1`（从镜头，轨道 1）；
- 图片必须是原始 3840×3840，**不能缩小**；
- 相机模型必须是 thin-prism-fisheye 或 opencv-fisheye；
- 不能给 `focal`、`distortion`、`params`，否则会覆盖出厂标定。

### 3.4　怎么确认生效了：看日志

| 日志特征 | 说明 |
|---|---|
| `Telemetry from … gyro 1000 Hz, accelerometer …` | 遥测文件挂上了；若出现 `cannot read` 或 `no frame rate` 就是挂载失败 |
| 没有 `registered images matched no telemetry` | 文件名都解析成功 |
| `Rig x6: … N frames, M with every lens` | M 接近 N，说明两个镜头的帧对上了 |
| `Sensor priors: … calibrated against the gyro … agree to X deg` | IMU 与镜头外参标定成功；若是 `not calibrated`，通常是 fps 填错或帧号没对上 |
| `Masks matched: n/N images` | 遮罩匹配了多少张图 |
| OSV 的 `lens_calib_used` / `lens_calib_skipped` | 出厂标定是否生效，未生效会附原因 |
| `ws/sparse/0/gauge.txt` 里 `oriented 1`、`metric 1` | 重力方向与度量尺度都用上了 |

::: unv 没有实测
上面的 manifest 示例和命令都是读代码整理的，没有运行过。尾部格式只在 X5 和 A1 的文件上测过，X6 能否正确读出，要看日志第一条。建议先拿一小段素材试跑。
:::
