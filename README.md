# virtualworldAI

**把想象变成可以进入、探索和继续创作的 3D 世界。**

virtualworldAI 是一个基于浏览器的三维世界创作与交付项目。你可以用文字描述世界、在配置视觉模型后使用参考图，也可以直接打开内置场景；通过共享的 SceneSpec 场景协议，在沉浸式体验、高级编辑和独立导出之间衔接。项目默认在本地运行。

[快速开始](#快速开始) · [场景预览](#场景预览) · [能力介绍](#当前能力) · [工程导出](#导出与引擎互操作) · [技术架构](#技术架构)

## 场景预览

| 小王子 · 沙漠相遇 | H-100 · 谐波关节 |
| :---: | :---: |
| ![沙漠相遇：沙丘、飞机与小王子的三维场景预览](public/world-previews/desert.jpg) | ![H-100 谐波关节：包含金属壳体和输出法兰的模型预览](apps/web/src/assets/harmonic-cover.jpg) |
| 可行走的叙事场景，包含角色、互动与章节进度 | 可旋转观察的机构演示，支持剖视、爆炸和传动控制 |

> 以上为仓库中**真实内置场景的预览图**，并非整个网页界面的截图。实际运行时可以改变镜头、进入场景并操作；画面取决于视角、浏览器和显卡。更多场景细节见[小王子与机构案例](docs/blender-showcases.md)。

## 当前能力

- **描述 → 生成 → 探索 → 再编辑**：从首页输入文字创建世界，查看生成任务状态；可选择显式的本地程序化规划，或配置 LLM 进行 AI 规划与局部编辑提案。
- **沉浸式 3D 体验**：第三人称移动、场景热点与剧情任务、章节进度、画质切换、暂停和触屏控制；小王子 B-612 章节含球面行走与径向重力。
- **高级场景编辑**：场景树、属性调整、节点增删、撤销/重做、资产导入、保存与导出。SceneSpec 是持久化的统一场景数据；交互进度与机构播放状态独立保存。
- **多类型资产**：自包含 GLB、STEP/STP、SPZ、Gaussian PLY；STEP 经浏览器端 OCCT 转换，点云由 Spark 按需加载。导入兼容性和工程准确性仍需校验。
- **WebGL 2 渲染恢复**：图形初始化失败或上下文丢失时提供持续可见的错误说明、暂停和重试；无法代替浏览器或驱动恢复。

### 内置体验

| 体验 | 内容 | 入口 |
| --- | --- | --- |
| **小王子 · 三章旅程** | 沙漠相遇 → B-612 星球 → 地球玫瑰园与狐狸；互动解锁、继续与重置 | 首页「探索世界」或 `?project=little-prince-desert` |
| **H-100 谐波关节** | 自绘紧凑关节、200/202 齿传动示意、旋转观察、部件聚焦/隔离、剖视和爆炸 | 首页「探索世界」或 `?project=demo-harmonic-joint` |

H-100 的主体名义外形约为 **Ø100 × 84.3 mm**，通孔 Ø18 mm，属于参照公开资料的原创教学模型，**不是可直接制造的厂商 CAD**；其内部结构、齿廓与受力均有演示简化。参见 [H-100 结构与验证](docs/h100-joint-module.md)。

## 快速开始

要求 **Node.js 24**、npm，以及支持 **WebGL 2** 的浏览器（建议启用 GPU 加速）。

```bash
npm ci
npm run dev
```

打开 **http://127.0.0.1:5173/**，即可访问首页并进入两个内置体验；无需模型密钥。首页优先展示场景封面，实时预览在画面可见且浏览器空闲后加载。

从首页底部进入 **高级编辑**，或使用 `?edit=1&project=demo-harmonic-joint`。按需运行生产构建：

```bash
npm run build
npm start
```

构建后的服务默认地址为 **http://127.0.0.1:3001/**。Blender **不是**启动或体验内置场景的必需依赖，仅在重建固定模型配方时使用。

## 创建自己的世界

**无需密钥**：首页可使用明确标注的「程序化」模式，也可从 CLI 构建一个场景：

```bash
npm run world:generate -- --id my-first-world --description "一座被云海环绕的漂浮花园" --planner builtin
npm run world:validate -- --world worlds/my-first-world
```

`builtin` 模式不会调用大模型，也不理解参考图片；生成世界可在本地项目目录中打开和继续编辑。

**使用 AI**：将 `.env.example` 复制为 `.env`，配置服务端的 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`。可用的视觉模型支持 PNG/JPEG 参考图；选择 Tripo 资产生成时另外配置 `TRIPO_API_KEY` 等参数，并在界面明确确认可能产生的费用。生成任务保留状态与恢复信息，**付费任务创建不会自动重试**。密钥仅供服务端/CLI 读取。

具体的任务恢复与资产记录参见 [生成与资产说明](assets/manifests/README.md) 和 [架构说明](docs/architecture.md)。

## 导出与引擎互操作

高级编辑中的「导出目标」提供三个交付选项：

| 目标 | 当前交付内容 | 使用方式 |
| --- | --- | --- |
| **网页（默认）** | 自包含资源、场景数据与独立 Web 播放器 ZIP | 解压后通过 HTTP 服务打开 `index.html`；不依赖创作后端或模型 API，不能直接使用 `file://` |
| **Godot 4** | `project.godot`、`main.tscn`、原生导入脚本、规范化 GLB 和兼容性报告 | 解压并使用 Godot 打开工程，检查导入后场景 |
| **Unity 6** | GLB、元数据、编辑器导入工具与兼容性报告 | 在现有 Unity 工程安装 glTFast **6.14.1** 后按 `README-Unity.md` 导入 |

**原生引擎导出目前是资产、节点、变换和部分碰撞数据的单向适配，不是完整游戏工程移植。** 网页端剧情、角色控制、球面移动、谐波运动与点云渲染等交互不会自动变为 Unity/Godot 可执行逻辑。Godot 有指定版本的真实引擎校验记录；Unity 导入结构有自动化检查，但**尚未完成真实 Unity Editor 验收**。详见 [引擎互操作说明](docs/engine-interoperability.md)。

## 技术架构

| 层次 | 主要技术 / 职责 |
| --- | --- |
| Web 应用 | React 19、TypeScript、Vite、Fastify |
| 3D 运行时 | Three.js / WebGL 2、Rapier 物理、Spark Gaussian Splat |
| 场景协议 | SceneSpec、Zod 校验、原子 SceneCommands、撤销与版本控制 |
| 生成与资产 | LLM 规划、可选 Tripo、Blender 固定批处理、glTF Transform、Khronos Validator、OCCT WASM |
| 交付 | 独立网页播放器、Unity 6 / Godot 4 单向导出 |

```text
apps/web/                   首页、体验、高级编辑、Fastify 服务与播放器
packages/engine/            Three.js 场景、渲染与图形恢复
packages/scene-schema/      SceneSpec 与 SceneCommands
packages/interaction/       行走、机构状态、故事任务与存档
packages/asset-runtime/     GLB、CAD、点云资源加载与释放
generators/                 AI 规划、Tripo、Blender、世界构建 CLI
worlds/                     内置 H-100 与小王子三章
assets/                     原始资产、优化资源与校验清单
tests/                      单元、集成、浏览器与案例检查
docs/                       设计、部署、验证与互操作文档
```

开发细节见 [架构文档](docs/architecture.md)。本地项目与新生成资产通常保存于非版本控制的数据目录；升级或迁移前请备份对应的项目、资产及场景文件。

## 验证

```bash
npm test
npm run check
npm run build
npm run demos:validate
npm run test:browser
npm run test:showcases
npm run test:webgl
npm run format:check
```

浏览器测试需要可用的 Edge/Chrome 或 Playwright Chromium；必要时设置 `PLAYWRIGHT_EXECUTABLE_PATH`。截图和回归报告默认位于未纳入版本控制的 `output/playwright/`。这些命令是**可执行的检查入口**，不代表本次 README 调整已重新执行全部测试。

## 当前边界与文档

目前提供本地创作与**私有单工作区**部署能力，不包含公开多租户服务、实时协同编辑或多人联机。Blender MCP、AI 直接操作外部三维软件、完整 Unity/Godot 运行时迁移均**尚未实现**；真实付费模型的输出质量不能由本地测试夹具证明。

- [部署与团队访问](docs/deployment.md)
- [引擎互操作与兼容性](docs/engine-interoperability.md)
- [场景案例与模型验证](docs/blender-showcases.md)
- [WebGL 故障恢复](docs/webgl-recovery.md)
- [平台底座与资产校验](docs/platform-foundation-audit.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)
