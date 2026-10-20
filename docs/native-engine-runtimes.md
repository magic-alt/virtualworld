# Unity / Unreal 原生运行与网页接入

## 当前交付与验收边界

本次增加 Unity C#、Unreal C++ 运行时代码、完整项目生成命令，以及网页体验的
“渲染引擎”选择。Unity 继续使用固定版本 glTFast 6.14.1；Unreal 项目以 UE 5.8
为目标，并固定 glTFRuntime 提交
`0b22180d5d5d48b13457b683f4405113b6afd87b`。

**源代码与导出包不等于已经构建的游戏。** 本次执行环境没有 Unity Editor 或
Unreal Editor。原生编译、材质/动画画面、角色碰撞和独立打包验收需要在安装对应
引擎的机器上执行。不要以 TypeScript 测试通过、生成了 ZIP 或网页 iframe 加载成功
代替原生引擎验收。具体软件检查记录见 [验收记录](validation-native-engines.md)。

## 架构

SceneSpec 仍是唯一的创作数据源。原始 GLB、稳定节点 ID、米制/Y-up 坐标、弧度和
工程参数的确认状态保持原样。导出时生成 `engine-manifest.json`，为两个引擎提供
规范化模型、场景图、角色模型、剧情与机构绑定。`runtime.validation` 固定标记为
`requires-engine`，直到某个实际构建经过引擎验收；生成器不会自动声明原生验证通过。

| 运行方式 | 渲染/交互执行位置                    | 网页如何接入                                            |
| -------- | ------------------------------------ | ------------------------------------------------------- |
| 网页     | 现有 Three.js、Rapier 与浏览器运行时 | 现有体验/编辑/离线播放器                                |
| Unity    | Unity 6 原生运行时                   | 发布 Unity Web 构建，再配置其 URL                       |
| Unreal   | UE 5.8 原生运行时                    | 运行 Unreal 游戏与 Pixel Streaming 服务，再配置前端 URL |
| Godot    | 原有场景互操作适配器                 | 仍为导入/场景查看，不新增剧情运行时                     |

原生体验选择会卸载网页体验实例，释放其 GPU/物理/输入资源。切回网页会卸载原生
页面。缺失构建或场景版本不匹配时显示明确提示；显式选择的原生引擎不会暗中用
Three.js 代替。高级编辑仍使用现有编辑器；原生项目修改暂不反向写回 SceneSpec。

## 本地生成四个示例工程

在仓库根目录使用 Node.js 24：

```sh
npm ci
npm run native:export -- --target unity --scene little-prince-desert --out output/native/prince-unity
npm run native:export -- --target unity --scene demo-harmonic-joint --out output/native/joint-unity
npm run native:export -- --target unreal --scene little-prince-desert --out output/native/prince-unreal
npm run native:export -- --target unreal --scene demo-harmonic-joint --out output/native/joint-unreal
```

每条命令要求目标目录不存在，避免覆盖已有工程。小王子任一章节的导出会携带
三个章节和完整前置关系，并将所指定章节保留为入口。角色模型会单独绑定；即使
B612/地球没有可见的角色预览节点，也能交给原生运行时实例化。沙漠中的预览角色
在运行时隐藏，避免重复出现两位小王子。

所有工程包含原始资产、兼容性报告与归属说明。此命令从 `worlds/` 的已组装数据
生成项目，不需要先启动 Studio 服务，也不调用付费模型或重新生成网格。

网页高级编辑里的“导出目标”也增加 Unreal。Unity 网页下载包可按其中
`README-Unity.md` 放入现有项目的 Assets 目录；上面的 CLI 会额外准备新工程目录、
Unity Packages 文件与本地启动脚本。Unreal 下载包直接包含 `.uproject`、C++ 源码和
规范化运行资产。

## Unity 6

使用 Unity 6 的内置渲染管线，并安装目标平台 Build Support。把下列示例路径换成
本机已安装 Unity Editor 的真实路径。在生成工程目录执行：

```sh
node Scripts/prepare-font.mjs
node Scripts/native.mjs import --editor "C:/Program Files/Unity/Hub/Editor/YOUR_VERSION/Editor/Unity.exe"
node Scripts/native.mjs validate --editor "C:/Program Files/Unity/Hub/Editor/YOUR_VERSION/Editor/Unity.exe"
node Scripts/native.mjs build --editor "C:/Program Files/Unity/Hub/Editor/YOUR_VERSION/Editor/Unity.exe" --target StandaloneWindows64
node Scripts/native.mjs build --editor "C:/Program Files/Unity/Hub/Editor/YOUR_VERSION/Editor/Unity.exe" --target WebGL
```

首次导入由 Unity Package Manager 恢复 glTFast 6.14.1。导入器生成独立的场景、预制体
和目录资产；重复导入使用新的输出目录。Editor 菜单为
`Tools > VirtualWorld > Import manifest`。选择
`Assets/VirtualWorldExport/engine-manifest.json`，再打开生成的 `.unity` 场景并运行。

字体准备脚本获取固定版本的 Noto Sans CJK SC、校验 SHA-256 并保留字体许可证。
它绑定到每次重新导入和构建生成的场景，供中文剧情与机构标签使用。也可使用
`--font Assets/Fonts/YourFont.ttf` 指定有合法使用权限的字体；原生验证会检查文字覆盖。
Unity Web 无法依赖操作系统中文字体，因此不能跳过这一步。

本地 helper 通过真实 Editor 调用 `ImportBatch`、`ValidateBatch`、`BuildBatch`。
缺失 Editor、构建模块、导入模型或所需动画/形变绑定会失败，不会输出虚假的成功
报告。Unity 验证结果与 `unity-*.log` 必须结合查看；导入结构验证仍不等于人工
画面和游戏行为验收。构建输出已存在时需要指定新的 `--out` 路径。

Unity 模型由 glTFast 做 X 轴反射；SceneSpec 包装节点匹配此转换，不能额外再加
负缩放。柔轮的命名形变需保留负权重，且 Unity 的 BlendShape 权重使用对应的
百分比单位。机构展示应使用与 100 mm 模型相称的相机近裁剪面。

## Unreal Engine 5.8

安装 UE 5.8 与其要求的 C++ 工具链。在生成工程目录执行：

```sh
node Scripts/prepare-plugin.mjs
node Scripts/native.mjs check --engine "C:/Program Files/Epic Games/UE_5.8"
node Scripts/native.mjs build --engine "C:/Program Files/Epic Games/UE_5.8"
node Scripts/native.mjs run --engine "C:/Program Files/Epic Games/UE_5.8" --scene little-prince-desert
node Scripts/native.mjs smoke --engine "C:/Program Files/Epic Games/UE_5.8"
node Scripts/native.mjs package --engine "C:/Program Files/Epic Games/UE_5.8"
```

`check` 同样需要 `--engine` 或环境变量 `UE_ROOT`；若只检查导出数据、不检查引擎，
使用 `node Scripts/native.mjs check --data-only`。数据检查通过只证明清单和模型
完整，不代表 C++ 编译或引擎运行通过。

插件准备脚本下载并校验固定的 glTFRuntime 提交，保留 MIT 许可证，不使用浮动
`master`。该插件负责完整 GLB 层级、纹理、骨骼与形变资源。柔轮是“有 morph、无
skin”的网格，必须以能保留形变目标的原生组件导入。UE 包装节点采用插件同一
坐标基与厘米比例；不能再自行套用另一套轴向转换。

原生检查通过实际 UnrealEditor 执行并检查新运行标识的报告；旧报告不能满足新
一次验收。详见导出工程中的 `README-Unreal.md`。`smoke` 证明其检查的运行条件，
完整画面、操控与性能仍需下方验收矩阵。

## 将当前网页体验切换为游戏引擎

先发布真实的 Unity Web 构建，或运行对应世界的 Unreal Pixel Streaming 会话。
在 Studio 服务的 `.env` 中配置 `VW_ENGINE_RUNTIMES`。例如：

```dotenv
VW_ENGINE_RUNTIMES=[{"engine":"unity","sceneId":"little-prince-desert","revision":0,"url":"http://127.0.0.1:8080/?sceneId=little-prince-desert","default":true},{"engine":"unreal","sceneId":"demo-harmonic-joint","revision":0,"url":"http://127.0.0.1:8081/"}]
```

`revision` 必须使用该次导出的场景修订号；生成工程的
`engine-runtime-config.example.json` 已给出各场景值。修改为实际 URL 后使用，重启
Studio。每个场景只能指定一个默认引擎；两种原生入口可以同时配置。配置项不会
自动安装、构建、启动或托管引擎。

Unity Web 的 `?sceneId=` 从工程目录选择入口。Unreal 的 URL 对应已启动的流媒体
会话，原生游戏启动时用 `-VirtualWorldScene=<id>` 选择世界；给 Pixel Streaming
网页添加查询参数本身不能让服务端切换场景。不同世界或独立玩家需要明确的服务
会话安排。引擎画面由本地/服务端 GPU 渲染，网页接收画面和发送输入。

浏览器 iframe 被部署端的 `frame-ancestors`/`X-Frame-Options` 阻止时，可使用“独立
打开”检查部署。Unity Web 服务器还需按构建设置正确提供 WASM 与压缩文件；Unreal
需按官方 Pixel Streaming 文档配置前端、信令及网络连通性。

网页只确认入口配置和场景版本，不把 iframe 的 load 事件当作原生引擎启动成功。
运行状态与错误需要在引擎页面和引擎日志中确认。

原生体验的剧情存档与网页端存档各自保存，不做隐式跨引擎同步。切换引擎前应保存
编辑器里的场景修改；修改后需要重新导出/构建对应版本。

## 必须执行的原生验收

| 案例 | 验收内容                                                                            |
| ---- | ----------------------------------------------------------------------------------- |
| 沙漠 | 一位可控小王子；飞行员动画；行走/碰撞；边界不掉落；完成两步交互；Unity 跳跃另行验收 |
| B612 | 球面前后两侧行走；角色与相机的径向朝向；遮挡/交互距离；四步剧情                     |
| 地球 | 玩家动画、狐狸 Idle、玫瑰/狐狸交互与最终完成                                        |
| 章节 | 前置条件、当前章节入口、保存/重启/重置、错误存档处理                                |
| 关节 | 200/202 齿数对应 -0.01 比例；正反转；正负形变权重；断电制动/重新启动                |
| 展示 | 全角度旋转；切面/全壳；爆炸图；子系统隐藏/隔离；小尺度裁剪                          |
| 交付 | 独立构建脱离 Studio 运行；完整资源/许可证；真实 GPU 画面与性能记录                  |

资产尺寸、渲染与碰撞映射可验证，物理效果不承诺与 Rapier 逐帧一致。Gaussian Splat、
通用关节编辑、所选单网格的原始动画重定向、动态形变碰撞和材质的逐像素一致性不在
本次通用适配承诺内。请以每个包的 `compatibility.json` 和引擎 README 为准。

**Unreal 当前角色控制器只实现贴地行走，尚未实现小王子的跳跃及腾空重力。**
对应的 `CHARACTER_JUMP_UNMAPPED` 会出现在含角色场景的兼容性报告中；不能把
Unreal 的角色功能表述为已与网页完整等价。Unity 包含跳跃源码，但仍需实机验收。
Unreal 还需检查目标打包环境的中文字体覆盖，并在必要时添加有许可的 CJK 字体。

## 官方与上游依据

- [Unity Web](https://docs.unity3d.com/6000.0/Documentation/Manual/webgl.html)
- [Unity glTFast 6.14.1 Editor Import](https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@6.14/manual/ImportEditor.html)
- [Epic Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-in-unreal-engine)
- [glTFRuntime 固定源码](https://github.com/rdeioris/glTFRuntime/tree/0b22180d5d5d48b13457b683f4405113b6afd87b)
- [Noto Sans CJK 字体固定源码](https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78)
