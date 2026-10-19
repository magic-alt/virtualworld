# WebGL 异常处理与恢复

本次在 `main` 的 `355f380ab8389f0feb42b3c4e82668f7903c3a97` 上完善已有 WebGL 2 支持。改动集中在初始化失败、上下文丢失、暂停、资源重建和可重试的界面反馈。场景协议、模型、工程尺寸与依赖版本沿用原项目。

## 用户能看到的变化

| 情况                             | 界面与行为                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| 不支持 WebGL 2，或创建渲染器失败 | 显示持久错误面板、可展开的原始故障详情和「重试加载画面」；提示不再随普通通知消失        |
| 运行中丢失上下文                 | 显示连接中断提示；暂停绘制、物理、机构运动和依赖画面的操作，清空按键与摇杆输入          |
| 浏览器恢复连接                   | 显示资源重建提示；在当前 runtime 和 canvas 内恢复环境、阴影与点云，试渲染成功后隐藏面板 |
| 等待连接超过 15 秒               | 显示浏览器尚未恢复连接，并开放重试检查入口；场景和进度保留                              |
| 重建失败或超过 15 秒             | 持久显示失败原因；再次重试当前场景的资源重建                                            |

高级编辑器、世界体验、首页实时预览和导出播放器复用 `apps/web/shared/graphics-status.ts`。首页在图形不可用期间保留海报。编辑器初次初始化失败后仍可编辑 SceneSpec，重试读取最新内容；不会重新从服务器覆盖未保存的修改。

图形故障不会阻止保存或章节导航：世界体验为章节选择和 AI 面板的保存／撤销保留独立操作区域，窄屏下分别滚动；独立播放器将章节与进度重置放入独立导航区。画面恢复完成不改变用户原先的暂停选择，也不会越过页面隐藏时的挂起状态。

## 引擎生命周期

`packages/engine/src/graphics.ts` 管理图形可用性，公开接口从 `@virtualworld/engine` 导出：

```ts
type GraphicsState = {
  status: 'ready' | 'lost' | 'restoring' | 'failed';
  message?: string;
  detail?: string;
};

runtime.getGraphicsState();
const unsubscribe = runtime.subscribeGraphics((state) => {
  // 订阅时立即收到当前状态，之后收到状态变化。
});
await runtime.retryGraphics();
unsubscribe();
```

`RuntimeMetrics.graphics` 同时提供诊断状态。没有成功构造的 runtime 时，宿主通过 `WebGLInitializationError` 建立持久故障面板；构造过程清理已分配的 renderer、临时环境、控件、监听、观察器和 canvas。普通场景／资产网络错误保持原有错误通道。

生命周期监听安装在 Three.js 自身监听之后。收到 `webglcontextlost` 时调用 `preventDefault()`，停止 animation loop，阻止已排队的旧 frame 更新世界，同时清空键盘／摇杆、取消拖动并停止相机过渡于当前位置。用户暂停、页面可见性挂起和图形不可用是三个独立条件，不能互相覆盖。

恢复按以下顺序执行：

1. 等待当前场景加载结束，检查 runtime 与 SceneSpec 的代次仍有效。
2. 重建 PMREM 环境，释放旧环境以及失效的阴影渲染目标。
3. 保留 GLB／SplatMesh 和场景数据，重建 SparkRenderer 并等待其 GPU 更新。
4. 重置 Three 绘制状态，实际渲染一次并确认上下文有效。
5. 发布 `ready`，重置帧时间，再按用户暂停与可见性状态决定运行。

恢复过程中发生编辑或换场景，必须重新处理最新代次，不能用旧场景的完成回调发布 `ready`。15 秒重建期限包含等待在途场景加载以及处理最新代次的总时间。重复丢失、重试、超时或卸载会使旧尝试失效；旧异步结果不能释放或覆盖较新尝试的资源。

`AssetRegistry` 以恢复代次保护 Spark 的资源归属，防止 `prepareSplats()` 与恢复同时创建两个 renderer。恢复只替换图形资源，保留场景对象、相机、剧情、用户暂停、机构角度和展示意图。退出页面时清理订阅、计时器、监听和图形资源。

Spark 的普通绘制更新也由 registry 托管：使用公开 `update()`，每个 renderer 最多一个在途任务，合并后续变化并捕获异步错误。相机矩阵、点云有效可见性、世界变换、公开版本与初始化状态未改变时，不重复生成点云数据。项目现有 SPZ/PLY 使用静态点云且关闭 LoD，因此同时关闭 Spark 隐式自动更新和独立 LoD 驱动，避免在应用生命周期之外留下异步工作。

普通更新超过 15 秒同样进入持久失败状态。已废弃 renderer 的异步任务最终结束后，再清理它自己的晚到资源；新恢复等待旧更新结束，并受恢复的整体期限限制。这一适配针对项目现有静态点云，没有增加自定义时间动画生成器或动态 LoD 支持，也不将功能回归等同于大点云性能评测。

## 重试的边界

初始化失败、尚无 runtime 时，重试重新构造当前场景的运行时。运行中失败则调用原 runtime 的 `retryGraphics()`，不重载整页、不重置剧情。

浏览器的真实上下文仍处于丢失状态时，重试只能重新检查并等待连接，不能保证驱动恢复。生产代码没有调用 `WEBGL_lose_context.restoreContext()`：该扩展用于测试，对不是由扩展触发的丢失不能充当通用恢复 API。恢复事件到来后仍需要重建应用自持的 GPU 资源，不能只隐藏提示。

实现依据：[Khronos 上下文丢失处理说明](https://wikis.khronos.org/webgl/HandlingContextLost)、[Khronos WEBGL_lose_context 扩展规范](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/)与项目锁定的 Three.js / Spark 源码。

## 故障回归与复现

```sh
npm test
npm run check
npm run build
npm run test:webgl
npm run test:browser
npm run format:check
npm audit
```

`test:webgl` 使用生产构建、本地 3147／3148 端口和临时项目目录；可设置 `PLAYWRIGHT_EXECUTABLE_PATH` 指向已安装的 Chromium / Chrome / Edge，或安装 Playwright Chromium。脚本会导出真实 ZIP，将其部署到静态服务的子目录，停止原 API 并阻断外网后继续验收。报告及截图位于 `output/playwright/webgl-recovery/`，属于可重新生成的本地产物。

初始化故障通过阻止真实 `canvas.getContext('webgl2')` 注入；上下文丢失与恢复使用浏览器真实 `WEBGL_lose_context` 扩展。测试不通过手工派发恢复事件或修改生产诊断状态伪造成功。画面验证读取实际渲染 PNG 的像素，而不只检查 `toDataURL()` 返回值或 splat 计数。

单元回归覆盖状态订阅、构造清理、超时／重试、迟到回调、输入冻结、暂停与可见性、场景代次及 Spark 并发资源归属。浏览器回归覆盖持久初始化错误、未保存内容的重试、真实丢失后的模拟冻结和恢复、点云可见像素、H-100 运动意图、导航／保存以及离线播放器。

### 执行记录

2026-10-19，在 Node.js 24.19.0、Linux、Chromium 141.0.7390.37 与 ANGLE/Vulkan SwiftShader 环境执行。以下均为本次修复完成后实际执行的结果。

| 检查                           | 结果                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `npm test`                     | 38 个文件、170/170 项通过；包含 25 项新增 WebGL 单元回归                                 |
| `npm run check`                | 通过                                                                                     |
| `npm run build`                | Web 应用和独立播放器均构建成功                                                           |
| `npm run test:webgl`           | 12/12 组通过；报告 `ok: true`，无未处理页面错误                                          |
| 中文界面定点复核               | 3 个场景、4 项检查通过；桌面及 390×844 窄屏中文可读，实际重试与保存均成功                |
| `npm run test:browser`         | 33/33 项通过（26 项基础检查 + 7 项世界体验检查），两份报告均无页面错误                   |
| `npm run test:runtime-quality` | 8/8 项通过，覆盖暂停／运行截图、首页加载和预览切换                                       |
| `npm run format:check`         | 通过                                                                                     |
| `npm audit`                    | 0 项已知漏洞                                                                             |
| 受保护文件 SHA-256             | 57 个文件保持原值，包含 7 个 GLB；资产、生成配方、世界模板、锁文件和第三方声明均保持原样 |

12 组真实浏览器检查包含：编辑器持续超过 6 秒的初始化错误；保留未保存编辑的重试；首页海报与错误面板；世界的绘制／角色／输入冻结及恢复；真实 15 秒连接超时后重试；用户暂停；页面可见性；窄屏故障期间保存；丢失时退出与迟到回调隔离；H-100 运动与暂停；应用内切章；离线播放器初始化、恢复及切章。

该故障套件产生 9 张实际场景 PNG。点云使用 1,200 个 splat 的小型测试场景；在应用和离线播放器中，丢失前后共四次隔离采样均检测到 572 个偏离均匀背景的像素和 528 种颜色（64×64 采样），避免用模型计数代替画面证明。章节切换使用临时数据目录中的小型三章测试场景；H-100 使用原项目模型的低画质展示。窄屏保存使用声明式提案 fixture，再通过真实 SceneCommands 和保存 API 落盘。

修复前的生产构建曾在实际初始化失败后丢失可操作的持久面板，该测试以缺少面板而失败；修复后同一路径通过。独立代码审查发现的保存／换章遮挡和 Spark 晚到资源清理问题均完成修复与复核。功能报告在 `output/playwright/webgl-recovery/report.json`，保护文件校验在 `output/validation/webgl-integrity.json`。

中文视觉复核配置现有 Noto Sans CJK 字体后单独执行，报告与三张最终页面截图在 `output/playwright/webgl-recovery-cjk/`。已实际查看编辑器、首页和窄屏保存界面，确认故障面板与操作区不重叠。最初缺少中文字库的截图不作为文字视觉验收结果。

### 适用范围

浏览器自动化使用 Linux 下的 Chromium 与软件图形后端。它验证真实 WebGL API 事件和应用功能，不代表实体显卡、Windows Edge、移动设备驱动或长期压力运行的兼容性认证。窄屏检查验证布局与实际点击，不等同于真实触屏设备验收。

页面可见性回归通过测试侧控制 `document.hidden` 并派发 `visibilitychange`；图形故障仍使用真实 WebGL 扩展。连接／资源重建的 15 秒期限提供可恢复的失败出口，慢设备或大场景可能需要再次重试。

本轮没有调用付费生成服务，也没有重新生成或修改既有模型与世界模板。此前首页加载、小王子和关节展示的验证仍记录在 [运行时与体验验证](validation-runtime-experience.md)，不将历史结果重复计算为本次执行证据。
