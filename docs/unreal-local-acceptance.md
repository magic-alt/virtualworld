# Unreal 5 本地验收：小王子与 H-100 关节模组

本指南用于**本机 Unreal 桌面运行**。不需要启动 VirtualWorld Studio、配置模型密钥
或部署 Pixel Streaming。生成目录包含两个独立源码工程：小王子三章，以及 H-100。

**当前仓库中的自动化检查不等于真实引擎验收。** `doctor` 只检查前置条件，
`build` 调用本机 UnrealBuildTool，`smoke` 必须启动真实渲染进程并产生匹配本次
运行标识的报告；中文显示、角色操控、机构实际形变与性能仍由人工观察。

## 1. 首次准备

如果已经拿到生成的验收目录，跳到第 2 节。否则先检出包含本功能的仓库分支/PR，
在仓库根目录运行：

```powershell
npm ci
npm run unreal:prepare -- --out output/unreal-review
```

要求 Node.js 24 和 npm。`--out` 必须是不存在的新目录，旧工程、存档和历史结果
不会被覆盖。需要重导出时换为 `output/unreal-review-02` 等新目录。
生成器直接复用仓库 GLB 和 SceneSpec，不付费调用生成服务、不重建模型。

```text
unreal-review/
  Review.cmd                 Windows 菜单入口
  review.mjs                 独立 Node 入口，无需 npm install
  acceptance-kit.json        源码提交、场景入口、清单哈希
  manual-acceptance.json     人工验收表，初始均为 pending
  README-验收.md             本指南
  projects/prince/           小王子完整三章 .uproject
  projects/joint/            H-100 .uproject
  reports/                  按次创建的结果资料目录
```

### Windows 需要的组件

- 已安装的 **Unreal Engine 5.4 或更新的 5.x**。这是验收器的最低发现基线；
  构建设置跟随实际引擎默认值，不代表每个小版本已经编译认证。
- 对应版本的 Visual Studio C++ 工具链及 Windows SDK。只安装 Unreal Editor
  还不足以编译此 C++ 工程。通过 Visual Studio Installer 添加“使用 C++ 的游戏开发”
  与“使用 C++ 的桌面开发”，并检查 MSVC 与 Windows SDK 组件。
- Git：首次取得固定版本 glTFRuntime；Node.js 24：执行验收脚本。

Epic 当前版本兼容表给出的 VS 2022 最低版本为：UE 5.4 使用 17.4，UE 5.5–5.7
使用 17.8，UE 5.8 使用 17.14。具体 MSVC、SDK 与其他组件按**你安装的 UE 版本**
选择；不要仅凭“装了 VS”判断完成。
[Epic 官方 C++ 环境说明](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-visual-studio-development-environment-for-cplusplus-projects-in-unreal-engine)。

## 2. 启动验收菜单

Windows 双击 **Review.cmd**。也可以在此验收目录的 PowerShell 中运行：

```powershell
node review.mjs menu
```

先选 **1 环境检查**。脚本读取引擎的 `Engine/Build/Build.version`，从安装记录或
常见安装目录发现 UE。它会列出数据、引擎、C++ 工具链、插件及字体的实际状态。
未安装插件/字体时诊断不会自动下载安装；菜单 **2** 显式准备这些依赖。

自动选择检测到的最高有效 UE 版本，并显示其路径。要固定某个版本、使用源码编译版、
非标准安装目录或自动发现失败时，指定安装根目录：

```powershell
node review.mjs menu --engine "D:/Epic Games/UE_5.7"
```

这里的路径只是示例，请换成**包含 Engine 文件夹的安装根目录**，不是
`UnrealEditor.exe` 所在目录。`--engine` 优先于 `UE_ROOT`；环境变量可这样设置：

```powershell
$env:UE_ROOT = "D:/Epic Games/UE_5.7"
node review.mjs doctor
```

源码工程不再强制关联 UE 5.8。脚本使用发现或显式指定的实际编辑器启动；直接
双击 `.uproject` 时，Windows 可能提示选择引擎，优先使用菜单减少版本选错。
在不同引擎小版本之间验收时，建议生成新的验收目录，保留旧编译记录。

## 3. 编译并打开两个案例

菜单 **3–6** 分别打开沙漠、B612、地球和关节模组。每次先校验/准备固定依赖，
调用真实编译，再启动相应场景。首次编译插件和着色器可能较慢；窗口会持续显示输出，
退出引擎后返回菜单。编译失败时不继续启动，不把退出码改成成功。

命令行等价操作：

```powershell
node review.mjs play --scene little-prince-desert
node review.mjs play --scene little-prince-b612
node review.mjs play --scene little-prince-earth
node review.mjs play --scene demo-harmonic-joint
```

单独生成 IDE 工程或在 Editor 中检查场景：

```powershell
node projects/prince/Scripts/native.mjs generate
node review.mjs open --scene little-prince-desert
node review.mjs open --scene demo-harmonic-joint
```

Editor 打开 `/Engine/Maps/Entry`；运行时场景由 `VirtualWorldGameMode` 在 Play
时根据清单生成，**编辑状态的空 Entry 地图不代表导入失败**。点击 Play 后观察。
菜单的 `play` 直接使用游戏窗口，不需要再手工按 Play。直接进入 B612/地球用于
逐场景验收；游戏中的章节切换仍执行前置条件。存档与网页端互相独立。

### 固定插件与中文字体

首次 `setup` / `play` 会从公开上游下载：

- glTFRuntime：提交 `0b22180d5d5d48b13457b683f4405113b6afd87b`，保留 MIT 许可证。
- Noto Sans CJK SC Sans2.004：固定提交与 SHA-256，保留 SIL OFL 字体许可证。

两工程各自持有完整依赖，生成后可分别移动和交付。再次运行校验现有文件；发现
修改或错误版本时停止，不覆盖已有插件/字体。没有把大体积字体或插件二进制提交到仓库。

字体下载受网络限制时，可自行下载
[固定 OTF](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)，然后：

```powershell
node review.mjs setup --font-source "D:/Downloads/NotoSansCJKsc-Regular.otf"
```

脚本仍检查原始 SHA-256。目标目录为每个工程的 `Content/VirtualWorldFonts`，
字体、`OFL.txt` 与来源信息一起随桌面包分发。HUD 直接打开时也检查字体；缺少或
变更会显示持续错误提示。字体文件校验通过后，仍需检查中文实际显示。

## 4. 小王子验收

| 操作           | 按键 / 入口                                                 |
| -------------- | ----------------------------------------------------------- |
| 移动、跳跃     | WASD、空格；跳跃落地前不能重复起跳                          |
| 看向与缩放     | 右键拖动 / 方向键；在场景上滚轮缩放                         |
| 视角复位       | Home 或左侧 Reset view；不清除任务                          |
| 最近交互       | 靠近至 3 米以内按 E，或点击世界标记                         |
| 关闭对话       | Esc；适配器支持 1–9、0 选项，但当前三章没有配置数字对话选项 |
| 章节           | 左侧按钮，或 Tab 循环已解锁章节                             |
| 暂停与剧情重置 | P；R 清除本工程剧情进度并回到启动章节                       |

按顺序检查：沙漠中只有一位可控小王子；飞行员为 NPC；行走/动画/碰撞/边界正常；
跳跃在平面和 B612 球面均能落地。走到球体背面检查径向朝向和相机。完成三章
对话/任务，再退出重开验证存档，最后测试重置。

移动控制与跳跃使用原生运动学查询，不承诺与浏览器 Rapier 逐帧一致。运行 smoke
的程序控制移动也不能替代键盘、相机与真实画面验收。

## 5. H-100 关节模组验收

| 操作         | 按键 / 入口                                                             |
| ------------ | ----------------------------------------------------------------------- |
| 360° 观察    | 左/右键拖动旋转；中键拖动平移；滚轮缩放；方向键/Q/F 保留；Home 视角复位 |
| 启停         | 空格或 Run / Stop                                                       |
| 改变输入转速 | + / -，支持经过 0 变为反向                                              |
| 单步         | 停止后按 [ / ]，每次 -15° / +15°                                        |
| 输入角度归零 | R；与 Home 视角复位分开                                                 |
| 剖切 / 全壳  | C                                                                       |
| 爆炸展开     | X，每次增加 25%，到 100% 后复位                                         |
| 抱闸         | I 安装/移除；B 上电释放/断电锁止                                        |
| 子系统       | 左侧 Hide / Show、Isolate / Unisolate；面板内滚轮查看全部               |

本模型是 **200/202 齿的教学运动学示例**：`output/input = -0.01`。它不是用户实体
关节减速器参数认证，不模拟负载、力矩或抱闸停止距离。观察柔轮真实顶点是否
随输入连续变形，不能只看 HUD 的 WaveCos/WaveSin 数值。正负转速、制动状态、
剖切、爆炸、隐藏/隔离后都应能恢复。保持既有约 Ø100 mm 的模型尺度。

## 6. 原生 smoke、人工记录与结果回传

运行菜单 **7**，或：

```powershell
node review.mjs smoke
```

它分别编译并启动两套工程的真实 Unreal 渲染进程，验证完整场景覆盖、资源绑定、
碰撞查询、程序控制移动/跳跃/落地、剧情前置关系、机构控件和带符号的形变权重。
报告必须匹配新 run ID、固定插件版本和当前导出的全部 scene IDs；不能用旧报告
或 `-NullRHI` 替代。失败会保留输出并返回非零退出码。

在实际游戏窗口按 **F9** 可请求带 HUD 的截图，文件由 Unreal 保存到该工程的
`Saved/Screenshots`；菜单只提示已请求，确认文件实际生成后再引用。结果收集会复制
已有 PNG/JPEG/WebP 截图，也可以自行添加屏幕录像。

在验收目录的 `manual-acceptance.json` 中填写测试人、UE 版本、GPU、分辨率，逐项
将 `pending` 改为 `pass` / `fail` / `blocked`，添加说明和截图路径。尚未测试的项目
保留 `pending`。这份文件独立于游戏存档，脚本不会自动把人工项目填成通过。

菜单 **8** 或命令：

```powershell
node review.mjs report
```

将在 `reports/<本次时间与唯一标识>/` 收集两个工程已有的命令记录、引擎日志、
smoke 报告、版本信息、来源记录及人工验收表。**资料收集成功只表示复制成功**，
不能把旧 smoke、失败编译或未填写的人工表当成验收通过。失败收集同样保留
`collection.json` 中的原因。把相关截图加入资料目录后再压缩回传即可。

需要单独收集某工程时：

```powershell
node projects/prince/Scripts/native.mjs evidence --out "D:/VW-results/prince-run-01"
```

证据输出要求新目录；工程本身的 `Saved/Logs`、`Saved/VirtualWorld` 与 `Saved/Screenshots`
保留原始资料。脚本不会自动上传。分享前可检查日志中的本地用户名/路径。

## 7. 独立桌面打包

游戏窗口验收通过后，再在目标工程目录执行：

```powershell
node Scripts/native.mjs package
```

打包后再次检查材质、运行时碰撞、中文与完整资源。保持 `VirtualWorldData`、
`VirtualWorldFonts` 和归属/许可证文件。桌面验收与 Unity Web / Unreal Pixel Streaming
部署是不同步骤，本指南不配置云 GPU 或网页串流。

## 故障定位

| 现象                                 | 处理                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 找不到 UE / 发现多个安装             | 用 `--engine` 指向正确根目录，再运行 doctor；不需要把真实安装改名为 UE_5.8                               |
| 找到编辑器但无法编译                 | 安装匹配 UE 的 C++ 工作负载、MSVC、Windows SDK；查看对应 build 日志的首个真实错误                        |
| 插件版本/文件被修改                  | 保留旧工程；重新生成验收目录并 setup，不覆盖现有 checkout                                                |
| 字体下载失败或已有字体损坏           | 下载失败可使用 `--font-source`；已有损坏目录不会被覆盖，保留旧工程并生成新验收目录。错误字体不能跳过校验 |
| Editor 打开后场景为空                | Entry 地图在 Play 时由运行时创建内容；查看左侧错误与引擎 Output Log                                      |
| 窗口出现但不能移动                   | 先点击游戏视口；确认未暂停，且当前是小王子场景；不要把 Editor 相机当作游戏控制器                         |
| 阴影/材质/碰撞或小版本编译不兼容     | 保留具体 UE 小版本、命令日志、smoke 与截图，在人工表中记 fail/blocked                                    |
| 场景更改后结果对不上                 | 生成新验收目录；对照 acceptance-kit.json 的源码提交和 manifest SHA，重新运行编译及验收                   |
| 路径含 shell 特殊符号导致 batch 拒绝 | 换到普通目录，如 `D:/VirtualWorld Review`；空格与中文可保留；不要绕过批处理字符校验                      |

自动化源代码与实际本机检查分别记录。当前执行环境无法访问你的 Windows 编辑器；
最后的原生编译、显示、键盘操作与打包结果以你本机生成的记录为准。

### 本机鼠标输入

关节视口支持左/右拖动旋转、中键拖动平移、滚轮缩放。左侧面板内滚轮只滚动面板，在面板内按下鼠标不会拖动模型；松开、移出窗口或失焦会结束拖动。小王子保留左键交互和右键旋转。验收启动器默认使用 1280×720 窗口。UE 构建设置跟随所选引擎的当前默认值，最低发现版本仍为 5.4。
