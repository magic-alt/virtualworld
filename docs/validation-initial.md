# 首版实际验证记录

日期：2026-10-17。验证对象：本目录 VirtualWorld Studio v0.1.0 的最终实现。

## 已执行结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 5 个测试文件，32 项测试通过 |
| `npm run check` | TypeScript 检查通过 |
| `npm run build` | 编辑器与独立播放器均构建成功 |
| `npm run test:browser` | 21 项完整浏览器场景检查通过 |
| `npm run format:check` | 源码格式检查通过 |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |

单元与集成测试包含：场景原子修改、修订冲突与并发保存、撤销重做、无效对象及故事依赖、任务完成、250 对象批量事务、路径边界、可移植 GLB 检查、项目作用域隔离、真实 STEP 立方体与多零件装配解析、实际 Rapier 地面/墙体碰撞，以及本地 HTTP 模型响应与错误修复。

真实 STEP 立方体的三个方向均测得 0.01 m，对应源文件 10 mm。多零件装配测试件来自安装的 occt-import-js 测试目录，其源数据说明指向 CAX-IF；不是用户提供的生产机械关节 CAD。

## 浏览器执行环境与性能

- Windows；Node.js 24.14.1。
- 已安装 Microsoft Edge，浏览器报告版本 155.0.4283.45，headless 模式。
- GPU：NVIDIA GeForce GTX 1660 SUPER，ANGLE / Direct3D11。
- 交互流程截图尺寸 1440×960；导出体验的性能测量尺寸 1280×720，DPR 1。
- 每个导出体验实际采样约 3 秒的 requestAnimationFrame 帧间隔，非长期稳定性测试。

| 导出体验 | 实测平均 FPS | P95 帧时间 | ZIP 大小 |
| --- | ---: | ---: | ---: |
| 工业展示，包含两次实例化的导入 CAD | 75.29 | 13.40 ms | 2,066,447 bytes |
| 星屿来信，Mesh + 1,200 个 Gaussian Splats + 角色物理 | 75.28 | 13.40 ms | 2,094,928 bytes |

连续六次对象修改后，Three.js 报告的 GPU 资源计数保持为 45 geometries、1 texture，与修改前相同。这是特定路径的资源释放回归检查，不代表无内存泄漏或长期浸泡验收。

## 浏览器检查覆盖

1. 工业编辑器加载、对象选择、名称修改、撤销、重做、保存及刷新重开。
2. 当前镜头设为默认视角并撤销；微小 CAD 自动定位；局部修改保持当前视角；切换场景恢复深度精度。
3. 爆炸图展开与无漂移复位；重复编辑释放阴影和辅助线资源。
4. 浏览器 Worker 将真实 STEP 转为 GLB；断言实际 Mesh 顶点存在，而不仅检查解析成功。
5. 同一 CAD 重复导入产生独立对象，并复用资源；资源验证和导出成功。
6. Mesh 与 1,200 个真实 Gaussian Splats 同屏显示。
7. 键盘驱动第三人称探索、物理碰撞、守灯人对话、拾取星核和星门任务结局。
8. 体验前后 SceneSpec 内容保持一致。
9. 未配置模型时明确返回预期 HTTP 503，无模拟生成结果。
10. 通过受控本地 HTTP 模型服务，在界面中预览、应用、撤销局部修改，确认无关对象内容保持一致。
11. 延迟模型响应及正在上传的 CAD 在切换项目后不能修改新项目。
12. 关闭编辑服务后，两个导出包在独立 HTTP 服务的子目录中运行，同时阻断所有外部网络请求。

## 证据与已修复问题

执行 `npm run test:browser` 会重新生成 `output/playwright/browser.json`、两个 ZIP 和截图；这些产物不进入 Git，文件包括：

- `industrial.png`、`cad-import.png`、`world-editor.png`、`world-completed.png`
- `ai-proposal.png`、`industrial-export.png`、`world-export.png`
- `industrial.zip`、`world.zip`

独立只读审查指出的五类 Important 问题均已修复并复查：STEP 序列化层级路径错位、跨项目异步结果串入、AI 假冒人工确认、阴影/网格 GPU 资源释放，以及导入事务容量。截图检查另外发现的微小 CAD 近裁剪面污染已重现、修复并加入浏览器回归。

## 尚未执行及限制

- 未连接真实付费 LLM 供应商：本次未提供 API 密钥。测试中的实际 HTTP 服务是本地受控夹具；模型质量、供应商兼容性、费用和限流仍需在用户配置后验证。
- Chrome 本机未安装；Firefox、Safari、手机、WebXR、WebGPU 均未执行或不在首版运行路径内。
- 未执行客户 CAD 验收、工程公差/运动学正确性验证、实物验证、长期运行或客户付费意愿验证。
- 构建仍有第三方大分块提示：Spark 约 2.62 MB、Rapier 约 2.24 MB，已按需加载；这些库内含 WASM，未将体积提示视为构建失败。
- 首版不编辑导入 GLB 的骨骼/动画轨道；GLB 需自包含，且不使用 Draco/KTX2。工业关节为展示用途，运动参数由人工配置确认。
