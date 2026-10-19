# AI 3D World Generator

本地运行的 AI 三维世界创作与探索应用。首页提供文字／参考图创建、精选旅程与个人世界库；进入世界后可第三人称探索、自由观赏，并通过 AI 提案继续创作。高级编辑、工业展示及故事体验共用 SceneSpec，可导出独立静态网页。

## 启动

需要 Node.js 24、npm。已在 Windows 验证。

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。首次启动会准备 CAD WASM 和内置资产。导出前运行 `npm run build`。也可以 `npm run build` 后执行 `npm start`，打开 http://127.0.0.1:3001 。

## 目录

```text
apps/web/                  React 编辑器、本地 server、独立 player
packages/engine/           Three.js 渲染、编辑与诊断
packages/scene-schema/     SceneSpec、命令、事务与撤销
packages/interaction/      角色物理、剧情状态、独立进度存档
packages/asset-runtime/    GLB/Splat 加载、缓存、实例与释放
generators/planner/        LLM 规划与编辑提案
generators/tripo/          Tripo v3 任务与恢复
generators/blender/        固定 Python 批处理
generators/scene-builder/  场景编译、资产优化、本地 CLI
assets/{source,optimized,manifests}/
worlds/demo-harmonic-joint/{scene,story,assets}.json
worlds/little-prince/campaign.json + chapters/*/{scene,story,assets}.json
tests/{assets,engine,e2e}/
docs/
```

包之间使用公开 workspace 入口；这些目录都有实际调用代码。完整职责与缓存/数据协议见 [架构说明](docs/architecture.md)。

## 当前技术路线

继续使用锁文件固定的 React 19、Three.js 0.180、Rapier 与 Spark，保留同一个 SceneSpec 和编辑器／播放器运行时。本轮改善首页加载边界、共享展示交互和静态交付，不替换引擎或修改模型。

首页先显示海报，在预览可见且浏览器空闲后启动实时 3D；世界体验与高级编辑分别按需加载。Rapier 的探索时加载和 Spark 的点云场景加载是已有能力，本轮继续保留。大模型文件采用流式响应与条件请求；同名更新的 GLB 必须重新验证，只有带内容散列的构建脚本／样式长期缓存。

本轮生产构建的初始 JavaScript 静态闭包从 984,629 降至 271,283 bytes；同参数 gzip 估计从 268,214 降至 81,821 bytes。后续预览和体验运行代码按需下载，这些数字不代表整个世界的总资源或首屏耗时。测量口径和下一阶段的 renderer 保留／增量场景更新边界见 [架构说明](docs/architecture.md#技术路线与阶段边界)。

## 从描述生成世界

网页首页可直接提交描述、查看实际任务阶段，并在完成后进入世界。配置 LLM 后支持 PNG/JPEG 参考图；无密钥时明确使用不调用模型的「程序化体验」。默认使用内置资产，Tripo 需要显式选择并勾选可能收费的确认。

生成任务保存在 `data/generations/`，刷新可恢复查询；网页生成的世界发布至 `worlds/world-*/`（已忽略）。重复提交沿用请求 ID；服务重启不会自动重提付费任务，失败／中断后可沿用已有记录显式恢复，多资产恢复时填写对应 task ID 和节点 ID。密钥不进入任务响应，服务与模型标识在任务创建时固定。

播放器提供暂停、画质、全屏、旅程手记、进度重置和触屏摇杆。进入播放设置或 AI 创作面板时暂停探索；从页面底部或世界工具栏进入「高级编辑」可使用场景树、属性和导入工具。也可通过 `?edit=1&project=<id>` 直接打开高级编辑。

无密钥可先运行明确的程序化模式，验证相同流程接受不同描述：

```powershell
npm run world:generate -- --id my-forest --description "蓝色晶石与古树环绕的森林" --planner builtin
npm run world:validate -- --world worlds/my-forest
```

生成结果写入 `worlds/my-forest/` 的三份 JSON 和 `assets/manifests/` 的记录，重新打开工作室的项目菜单即可读取。`builtin` 不调用模型，也不支持参考图。相同输入会复用验证后的结果；同 ID 的不同内容不会被覆盖。

连接真实服务时复制 `.env.example` 为 `.env`，填写服务端配置：

```dotenv
LLM_BASE_URL=https://your-compatible-endpoint/v1
LLM_MODEL=your-model-name
LLM_API_KEY=your-key
TRIPO_BASE_URL=https://openapi.tripo3d.ai/v3
TRIPO_MODEL=v3.1-20260211
TRIPO_API_KEY=your-tripo-key
```

```powershell
npm run world:generate -- --id ai-garden --description "有向导、星核与归航任务的花园" --planner llm --assets tripo --reference ./reference.png
```

LLM 负责布局、剧情和资产请求；Tripo 生成模型，glTF Transform 优化，Khronos Validator 检查，再发布世界。参考图需模型接口支持图片消息。`--assets tripo` 会使用真实付费接口；默认 `--assets builtin` 仅使用程序化造型。密钥仅由服务端/CLI 读取，不进入播放器。

任务请求先写账本，创建 POST 不自动重试；超时保留 task ID。发现结果不明时，从 Tripo 控制台找回任务并追加 `--task-id task_...`，多资产时追加 `--task-node <节点ID>`。恢复说明见 [资产记录](assets/manifests/README.md)。

## 可选 Blender 与资产处理

```powershell
npm run asset:optimize -- --input ./model.glb --output ./output/model.glb
# 安装 Blender 后设置 BLENDER_BIN，再使用固定批处理：
npm run asset:optimize -- --input ./model.glb --output ./output/model.glb --blender
```

输入输出均做 GLB 校验并记录 SHA-256、工具版本与警告。Blender 可选，默认优化流程无需安装 Blender；MCP 服务尚未接入。

## Blender 案例

首页将 **小王子三章** 作为一段旅程展示，进入后继续已保存的章节；依次体验沙漠相遇、B-612 回忆、地球玫瑰园与狐狸。场景中提供可点击的互动热点、距离提示和任务状态；E／附近互动优先处理可用且未完成的任务。按章完成互动后解锁下一章，最终章显示旅程完成；章节独立保存，支持继续和重置全部旅程。B-612 使用径向重力和球面相机。金发角色、飞行员和狐狸由本地 Blender 制作，动画与纹理均包含在 GLB 中。**H-100 谐波关节** 保留为交互展示案例。

H-100 支持选件、装配/爆炸、剖视和输入转速演示；可点击可见部件或使用面板选择，查看说明、聚焦或隔离。展开和重新构图保留当前观察方向，移除可选制动器时退出其隔离状态。体验、导出播放器和高级编辑使用同一组展示控件；在高级编辑中观察有效部件时，会清除普通编辑选中和变换手柄，场景树与属性面板同步回到未选中状态。200/202 齿对应输出角速度为输入的 −1/100；底座/壳体直径 215/180 mm，总高 165 mm，通孔 20 mm。它是可验证名义几何的工程教学样件，齿形、变形和轴承滚道有简化，不是制造 CAD 或载荷/寿命证明。

已提交可直接运行的 GLB、JSON 和生成记录。重建需要 Blender 5.2.2 LTS，可指定安装路径：

```powershell
$env:BLENDER_PATH = 'E:/Software/Blender Foundation/Blender 5.2/blender.exe'
npm run demos:build
# 单独重建：npm run demos:build -- prince   或 harmonic
npm run demos:validate
```

固定 Python 配方在 `generators/blender/{prince,harmonic}/`；可编辑 `.blend` 在本地 `assets/source/showcase/`，不进入 Git。章节与工程语义见 [案例说明](docs/blender-showcases.md)。导出任一小王子章节会打包完整三章及去重资源，播放器可独立解锁、继续和重置。

## 案例目录

内置案例仅保留 H-100 谐波关节和小王子三章。

旧 J-01、星屿来信、沙漠绿洲、宁静森林已移出产品目录及接口；旧 ID 返回 404，旧保存文件不会使案例重新出现。回归所需几何仅作为 `tests/fixtures/` 中的测试数据保留，不会显示在正常项目菜单。新建项目使用空白 SceneSpec。

编辑器支持属性修改、添加节点、环境/镜头/出生点/任务设置、撤销重做、AI 局部提案和保存。Ctrl+S 保存，Ctrl+Z 撤销，Esc 退出体验。

支持每文件最多 100 MiB 的 STEP/STP、自包含 GLB、SPZ 和 Gaussian PLY。STEP 在浏览器 Worker 内通过 OCCT 转换为米制 GLB，保留可用层级/名称/颜色及原始 CAD；AI 视觉模型不能替代可信工程数据。首版不接受外部纹理/缓冲或需要 Draco/KTX2/Meshopt 解码器的 GLB，不编辑骨骼动画轨道。

项目编辑位于 `data/projects/`；原始资产、运行资产和处理记录分别位于 `assets/source/`、`assets/optimized/`、`assets/manifests/`。旧 `data/assets/` 仍可读取。备份时保留 `data/`、`assets/` 和 `worlds/`；用户资产与密钥默认不进入 Git。

「导出网页」生成包含 SceneSpec、相对资源、独立播放器和许可证的 ZIP。解压后通过 HTTP 服务打开 `index.html`，支持子目录与 iframe，无需编辑服务、模型接口或 CDN；不能直接使用 `file://`。

## 验证

```powershell
npm test
npm run check
npm run build
npm run world:validate
npm run test:browser
npm run test:showcases
npm run test:runtime-quality
npm run test:prince
npm run demos:validate
npm run format:check
npm audit
```

浏览器检查使用本机 Edge/Chrome；可设置 `PLAYWRIGHT_EXECUTABLE_PATH`，或安装 Playwright Chromium。脚本使用临时数据及各自的本地端口；运行时质量检查使用 3144，小王子应用／独立导出检查使用 3145／3146，产物在 `output/playwright/`。

`test:runtime-quality` 检查海报／懒加载边界和暂停／运行中的即时截图；`test:prince` 检查小王子应用体验与子目录独立导出。当前执行结果与未执行范围见 [运行时与体验验证](docs/validation-runtime-experience.md)、[早期验证报告](docs/validation.md)和[Blender 案例验收](docs/blender-showcases.md)。目前不包含多人协作、计费或云生成队列。第三方来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
