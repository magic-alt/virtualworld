# AI world experience

The product flow is describe → generate → explore → refine. The warm white home
page uses large typography, real world imagery and a central text/image composer.
Worlds open in a full-screen experience; hierarchy, transforms and diagnostics
remain available through advanced editing. Chinese remains the primary language.

Generation reuses the existing LLM/builtin and Tripo pipeline. Builtin assets are
the default; paid assets require explicit selection. Persist requests and stages,
deduplicate by request ID, never retry paid creation automatically, and preserve
provider ledgers and warnings. Reference images are controlled uploads. Jobs are
metadata; SceneSpec remains the only serialized scene truth.

Shared runtime modes are viewing, exploring and editing. Shared player controls
include pause, quality, touch movement, chapter progress and reset. Playback state
does not mutate SceneSpec. Export remains self-contained and network independent.

Implementation order:

1. Persisted generation API and recovery tests.
2. Warm white home, world library and generation composer.
3. Shared immersive controls, runtime modes, rendering and resource lifecycle.
4. Browser flow updates, real screenshots, regression checks and review.

Acceptance: npm test, check, build, test:browser, test:showcases, format:check,
and audit. Distinguish local model fixtures from live paid provider validation.

## 验证记录（2026-10-18）

- Node.js 24.14.1；Windows / Edge 155.0.4283.62；GTX 1660 SUPER。
- `npm ci`、`npm test`（28 文件、107 项）、`npm run check`、`npm run build`、
  `npm run test:browser`、`npm run test:showcases`、`npm run format:check` 均完成并通过。
- `npm audit`：0 vulnerabilities。Spark/Rapier 的第三方大分块提示仍存在。
- 新浏览器流程覆盖程序化创建、任务刷新恢复、文字与参考图传递、AI 提案／应用／
  撤销／保存、保存期间继续编辑、后退取消离开、跨世界迟到响应隔离、摇杆移动与释放、
  画质、暂停、观赏／探索切换及禁用存储。网页首页只创建一个预览，移出视口后停止渲染。
- 原编辑流程及三个 Blender 章节回归通过；导出播放器在编辑服务停止、外部请求受阻时
  完成全部章节、继续／重置和 390px 布局检查。故事遍历使用标明的近距离测试传送，
  另有真实键盘移动／跳跃检查，不等同完整路线走图。
- 独立只读审查提出的四项重要问题已修复：并发保存清理、章节版本缓存、面板暂停及
  浏览器历史导航保护。付费恢复另通过本地 HTTP 创建计数验证，密钥／模型变化后仍为 1 次。

渲染对照使用相同 1280×720、DPR 1、固定镜头，各采样约 3 秒；基线运行时取自
`323bfb7`，两组共用未改动的资产／几何模块。四个场景改前、改后均约 75 FPS，
P95 约 13.5–13.8 ms，没有据此宣称速度提升。B-612 销毁后的纹理计数两组均为 1，
其余场景为 0，几何计数均回到 0；保留原始计数，不将其描述为所有资源全部归零。

截图与报告：`output/playwright/ai-world/`、`output/playwright/showcases/`、
`output/playwright/browser.json`。渲染对照在 `ai-world/render-comparison/`。
这些产物被 Git 忽略；首页展示图来自实际场景，保存在 `public/world-previews/`。

未执行真实 LLM／Tripo 付费接口、真实手机 GPU、Firefox／Safari 或长时间浸泡测试。
本地 HTTP 模型夹具只证明流程与接口；不证明真实供应商的生成质量、费用或可用性。
