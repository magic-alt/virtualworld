# VirtualWorld Studio

本机运行的 AI Web 3D 创作工作室。工业展示与故事世界共用 SceneSpec、编辑器、运行时和静态导出流程。

## 启动

需要 Node.js 24 和 npm；本项目已在 Windows 上运行验证。

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。首次启动自动准备 CAD WASM 和样例资源。首次使用导出功能前，另开终端运行 `npm run build`。

仅运行构建后的本机工作室：

```powershell
npm run build
npm start
```

打开 http://127.0.0.1:3001 。服务默认仅绑定本机回环地址。

## 两个完整样例

- **精密关节 · J-01**：零件选择、高亮、隔离、PBR 材质、爆炸图、关节运动、产品说明。样例是原创参数化展示模型，参数不作为制造或仿真依据。
- **星屿来信**：原创浮岛世界、Mesh 与 1,200 个真实 Gaussian Splats 混合渲染。体验模式中通过 WASD 移动、空格跳跃、E 附近互动，完成守灯人 → 星核 → 星门的任务。

拖动旋转、右键平移、滚轮缩放。选择对象后可编辑名称、变换、材质、爆炸方向、关节、说明和碰撞代理。工具栏可将当前镜头设为默认视角；点击环境设置可编辑镜头、角色出生点和任务手记。Ctrl+S 保存，Ctrl+Z 撤销，Ctrl+Shift+Z 重做，Esc 退出体验。

## 连接真实 AI

```powershell
Copy-Item .env.example .env
```

在 `.env` 填写下列服务端配置，然后重启服务：

```dotenv
LLM_BASE_URL=https://your-compatible-endpoint/v1
LLM_MODEL=your-model-name
LLM_API_KEY=your-key
```

接口需接受 `POST {LLM_BASE_URL}/chat/completions` 的 `model`、`messages`、`temperature`，返回 `choices[0].message.content`。AI 根据场景和选中对象生成结构化修改提案；预览差异后应用，支持撤销。无效输出最多修复一次，单次请求超时 90 秒，可取消。密钥不会进入浏览器构建或导出包。

无密钥时，两个样例、手动编辑、导入、验证和导出均可使用；AI 显示未配置状态。自动测试中的模型 HTTP 服务是本地受控测试夹具，不能当作真实付费供应商验收。

## 导入与交付

支持每文件最多 **100 MiB** 的 STEP/STP、自包含 GLB、SPZ 和 Gaussian PLY。

- STEP 在本机浏览器 Worker 中通过 OCCT 转换，输出统一为米，保留可用层级、名称、面颜色。转换后缓存为 GLB，原始 STEP 一并保存。
- GLB 按层级导入，保留局部变换及原材质。首版要求资源自包含，不接收外部纹理/缓冲引用或 Draco/KTX2 压缩；不编辑导入文件中的骨骼和动画轨道。
- SPZ/PLY 支持整体移动、旋转、缩放和显示控制；3DGS 不会自动产生碰撞或工程结构。
- 关节轴、枢轴与运动范围应通过对象层级和属性人工配置。AI 提出的关节始终保持“等待人工确认”。

右侧资源页可下载 10 mm STEP 测试立方体。项目源数据存于 `data/projects/`，资源按 SHA-256 保存在 `data/assets/`。`data/` 和 `.env` 不进入 Git；备份时复制整个 `data/` 目录。

「导出网页」会验证并下载 ZIP，包含 SceneSpec、播放器、资源、运行时依赖及许可证。解压后通过静态 HTTP 服务打开 `index.html`，支持子目录与 iframe 嵌入。`file://` 不适用于模块和 WASM。导出体验无需本地编辑服务、模型 API 或 CDN。CAD 解析器不进入播放器。

## 开发与验证

```powershell
npm test
npm run check
npm run build
npm run test:browser
npm run format:check
npm audit
```

浏览器检查优先使用本机 Edge 或 Chrome；其他环境先执行 `npx playwright install chromium`，也可设置 `PLAYWRIGHT_EXECUTABLE_PATH`。脚本使用隔离的临时项目目录和 3133–3136 端口，产物位于 `output/playwright/`，不会覆盖 `data/`。

测试包括真实 STEP 转换、Rapier 碰撞、场景事务、文件持久化、受控 HTTP 模型请求，以及浏览器内的编辑、保存、任务完成和独立网页导出。实际执行结果与未执行边界见 [验证报告](docs/validation.md)。

主要模块：`packages/scene` 定义场景与命令；`packages/runtime` 编译并运行场景；`apps/studio` 提供编辑和 CAD 导入；`apps/server` 处理本地文件、AI 和导出；`apps/player` 提供独立体验。

公开接口与扩展方法见 [架构说明](docs/architecture.md)。第三方来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。首版不包含多人云协作、计费或外部 3D 生成服务。
