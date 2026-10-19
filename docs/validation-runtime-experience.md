# 运行时与体验优化验证

## 范围与环境

本轮相对基线 `cd13e3e74b60085c31810d165a8a59806b2184b2` 优化首页加载、静态交付、小王子三章交互和 H-100 展示。实现设计见 [runtime-experience-design.md](runtime-experience-design.md)，后续技术路线见 [architecture.md](architecture.md#技术路线与阶段边界)。

本地验证使用 Node.js 24.19.0、npm 11.9.0、锁文件固定的依赖和 Playwright Chromium 141.0.7390.37。浏览器运行于 Linux headless 环境，WebGL 后端为 ANGLE / Vulkan SwiftShader。软件 GPU 的操作完成时间不能作为用户设备帧率的证据。

小王子完整导航脚本识别到软件 GPU 后，通过可见的「播放设置」将画质切换为「流畅」，并记录 GPU 与实际画质；随后使用键盘输入或界面摇杆行走、点击热点完成任务。窄屏目标位于视野外时，通过 canvas 指针拖动转动镜头，再验证热点可见且可点击。手机布局使用 390 × 844 浏览器模拟，摇杆和镜头通过鼠标指针事件驱动，不代表真机触摸手势验收。默认画质的渲染与截图由关节矩阵及运行质量检查单独覆盖。这是浏览器测试设置，产品的默认画质没有变化。

## 已执行检查

| 检查                           | 结果与范围                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                     | 34 个测试文件、145 项测试通过；涵盖剧情可用性、真实地球场景的附近任务选择、Rapier 平面移动、机构构图与可选抱闸、静态 HTTP 验证器和预览调度等 |
| `npm run check`                | TypeScript 检查通过                                                                                                                          |
| `npm run build`                | 应用与独立播放器生产构建通过                                                                                                                 |
| `npm run format:check`         | 检查通过                                                                                                                                     |
| `npm audit`                    | 依赖审计未发现漏洞；未变更第三方版本或锁文件                                                                                                 |
| `npm run world:validate`       | H-100 与小王子三章共四个世界有效                                                                                                             |
| `npm run demos:validate`       | 七个案例 GLB 校验通过；零 errors、零 warnings                                                                                                |
| `npm run test:harmonic`        | 九组桌面、编辑器、手机与独立导出检查通过；最后选择清理补丁另有专项回归，详情见下文                                                           |
| `npm run test:runtime-quality` | 八项生产浏览器检查通过，详情见下文                                                                                                           |
| `npm run test:prince`          | 九组环境、真实导出与故事检查通过；桌面、手机模拟和独立播放器分别走完三章                                                                     |
| `npm run test:browser`         | 完整命令退出码 0；通用编辑器 26 项及世界体验 7 项全部通过，两份报告均 `ok: true`、`errors: []`                                               |

### 通用编辑器与世界体验回归

`npm run test:browser` 完整执行 `browser-check.mjs` 和 `world-experience-check.mjs`，最终退出码为 0。实际报告 `output/playwright/browser.json` 记录 26 项检查、`ok: true`、`errors: []`；`output/playwright/ai-world/report.json` 记录 7 项检查、`ok: true`、`errors: []`，均无 failure 字段。

通用编辑器回归覆盖编辑／撤销／重做／保存与重载、重复编辑的 GPU 资源释放、实际 STEP Worker 导入和同资源独立实例、Mesh 与 1,200 个真实 Gaussian Splats 混合渲染、角色物理与剧情条件、进度恢复／重置、延迟 AI 响应和导入不得跨项目生效，以及服务关闭且阻断外网后的工业／故事子目录独立导出。AI 流程使用真实本地 HTTP fixture。

世界体验回归覆盖首页单一实时预览与离屏暂停、程序化创建及刷新恢复、探索／暂停／画质／观赏保持 SceneSpec 不变、AI 提案／应用／撤销／保存和身份隔离、文字／上传参考图进入本地规划 fixture、手机布局摇杆移动及释放和禁用存储回退。此处手机操作仍属于浏览器指针模拟，不扩展为真机触控或 GPU 性能验收。

### 小王子故事与独立导出

`npm run test:prince` 使用隔离的生产服务导出包含三章的真实 ZIP。桌面、手机模拟与独立播放器分别通过键盘或界面摇杆靠近目标、必要时拖动镜头，再点击可见热点完成沙漠、B-612 和地球。三次旅程共完成 30 个任务交互，并分别重放已完成的初次相遇对话；下一章动作与最终旅程完成提示均通过检查。每章加载后检查运行时资源错误，三次旅程均无页面错误，手机完成页没有水平溢出。

应用端检查完成后，测试实际关闭原 API，并确认其不可访问，再以普通静态服务把导出 ZIP 部署在 `/prince/` 子目录。播放器完整旅程共发出 20 次同源静态资源请求，没有 API 或外部来源请求，也没有被请求拦截器阻断的资源。对应报告为 `output/playwright/prince-affordances/runner-report.json`、`report-application.json` 和 `report-player.json`。

### 关节展示与导出

`npm run test:harmonic` 的九组检查全部通过：默认模型可见几何、桌面完整控制、ZIP 下载、使用本地 HTTP fixtures 的 AI 提案/应用/撤销/保存、高级编辑共享面板、导航及运行时清理、禁用存储的手机体验，以及阻断编辑器 API/外部来源后的独立播放器。各界面均核对播放、步进、正反转速、抱闸、剖视、展开、视图、部件选择/聚焦/隔离、恢复和完整 SceneSpec 不变。导出播放器发出八次静态资源请求，无外部/API 请求、无页面错误。

此矩阵完成后，补充修复了树节点选择切入部件观察时遗留的编辑手柄；该补丁由两项单元回归、独立局部审查及最新构建的专项浏览器检查验证。

### 加载边界与即时截图

`tests/e2e/runtime-quality-check.mjs` 使用隔离数据和 3144 端口的生产服务，检查：

1. 暂停体验时，通过真实 `screenshot()` 接口得到尺寸与 canvas 一致、具有多种颜色且不透明的 PNG。
2. WebGL 的 `preserveDrawingBuffer` 实际为 `false`。
3. 继续运行后，同一截图接口仍能捕获当前画面。
4. 截图期间没有页面异常或运行时错误。
5. 高级编辑中真实点击树节点，再点击共享部件说明，旧变换手柄、树高亮和属性面板同步清除，SceneSpec 不变。
6. 首页空闲任务执行前已有可见海报，没有 canvas、体验代码或模型请求。
7. 实时预览模块请求失败时，海报和有效提示仍可见。
8. 在预览模块等待下载时进入世界，最终只保留一个活动运行时。

截图验证读取完整 PNG，再按 64 × 64 像素采样内容；本次两张捕获均为 1280 × 800、4096 个不透明采样点、412 种颜色。未把成功调用 `toDataURL` 单独当作非空截图的证明。

## 初始 JavaScript 体积

| 初始静态 JavaScript 闭包 |          基线 |          本轮 |   减少 |
| ------------------------ | ------------: | ------------: | -----: |
| 原始体积                 | 984,629 bytes | 271,283 bytes | 72.45% |
| 同参数 gzip 估计         | 268,214 bytes |  81,821 bytes | 69.49% |

从两版 `index.html` 的真实模块入口出发，使用 Rollup AST 递归跟随静态 import/export；不计动态 import、Vite 的动态依赖索引和目录中其他文件。两版入口没有额外静态 JavaScript import。gzip 使用 Node `zlib.gzipSync` 默认参数。

这些数字衡量首页初始代码，不包括 CSS、图片、模型以及随后加载的运行时。预览出现或进入世界后仍需下载 Three 运行代码；Rapier 与 Spark 保留原有的按需加载路径。此结果不代表总下载量同比减少、HTTP gzip 已启用或帧率改善。构建仍提示较大的 Rapier/Spark 动态 chunk，未将其隐藏或视为已解决。

## 模型与源文件完整性

通过 Git 基线内容与工作区逐字节比较，并记录 SHA-256，检查了 38 个受保护文件：全部 `assets/` 跟踪文件、谐波机构生成目录、小王子建模/渲染源码和锁文件等。七个 GLB 均未变化；首次审查时额外记录的 30 个文件摘要也全部一致。

小王子 B-612 仅将落日互动锚点移动至已有椅子旁，并同步 `generators/blender/prince/bundles.mjs` 中的场景声明。没有重建模型。H-100 的尺寸、齿数、材质、网格和资产清单均未修改；部件选择、聚焦、隔离和展示状态不写入 SceneSpec。

## 复现与产物

先安装依赖并构建，再执行浏览器检查：

```bash
npm ci
npm run build
npx playwright install chromium
npm run test:runtime-quality
npm run test:harmonic
npm run test:prince
npm run test:browser
```

也可通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定已有浏览器。各脚本使用独立临时数据和本地端口；`test:prince` 使用 3145/3146，`test:runtime-quality` 使用 3144。浏览器截图、JSON 报告和测试导出位于 Git 忽略的 `output/playwright/`。模型摘要记录位于本地 `output/validation/model-integrity.json`。

## 审查与边界

独立静态审查覆盖实现与设计一致性、共享控件状态、可选部件、相机聚焦、异步卸载、订阅释放及静态文件生命周期，未发现已确认的重要回归或阻塞问题。审查本身没有执行浏览器或全套测试。

静态服务的首次或文件身份变化后的强 ETag 计算仍需先读取文件摘要；流式内存与重复验证优化不代表冷请求 TTFB 已改善。

本轮没有验证实体手机 GPU、Windows Edge、长时间浸泡运行或真实付费生成服务。浏览器中的生成/AI 回归使用本地 HTTP fixtures；不代表真实供应商调用成功。后续 renderer 保留、增量 SceneCommands、大世界流式加载和异步导出队列仍属于后续路线。

本轮未执行 `npm run test:showcases` 整套脚本；其中受共享控件影响的选择器适配通过语法与格式检查，未将其列为已执行通过的浏览器套件。
