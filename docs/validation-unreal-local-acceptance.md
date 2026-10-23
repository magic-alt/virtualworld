# Unreal 本地验收流程：本轮验证记录

日期：2026-10-23（Asia/Shanghai）。基线：
`eced5499b0e34fa115f8a3f7125cf83d4e4e53c5`，即已合并的 PR #15。

## 结论

已实现并验证两工程验收目录、独立 Node / Windows 菜单入口、固定依赖准备、
环境诊断、失败处理和结果收集。Unreal 源码增加小王子跳跃/重力/落地、隐藏模型
碰撞同步、Home 视角复位、固定中文 HUD 字体和 F9 截图请求。

**本轮没有可用的 Unreal Editor，也无法操作用户电脑上的 UE5。** 没有执行
Unreal C++ 编译、原生 smoke、真实中文显示、键盘操作、截图保存或独立打包。
UE 5.4+ 是源码基线，不能据此宣称每个 UE5 小版本兼容。PR 应保持草稿，待本机
编译和画面/操作验收后再决定合并。

操作指南：[Unreal 5 本地验收](unreal-local-acceptance.md)。
[上一轮记录](validation-native-engines.md)保留原来的结果与当时缺口，不作为本轮结果。

## 已执行的仓库检查

环境为 Linux、Node.js 24.19.0、npm 11.9.0。浏览器为 Chromium 141.0.7390.37，
不代表用户的 Windows、独立显卡或 UE 渲染环境。

| 检查                     | 实际结果                             | 证明范围                                                                |
| ------------------------ | ------------------------------------ | ----------------------------------------------------------------------- |
| 修改前 `npm test`        | 63 个文件、384 项通过                | 当前 main 的软件基线                                                    |
| 最终 `npm test`          | **66 个文件、413 项通过**，退出 0    | 原有回归与新增 29 项脚本/导出行为检查                                   |
| `npm run check`          | 通过，退出 0                         | TypeScript 类型检查，不检查 Unreal C++                                  |
| `npm run build`          | 通过，退出 0                         | Studio 与独立网页播放器生产构建；保留已有大型 chunk 提示                |
| `npm run format:check`   | 通过，退出 0                         | 该命令覆盖的源码格式                                                    |
| `npm run demos:validate` | 通过，退出 0                         | 4 个内置场景及 7 个展示 GLB；GLB 检查为 0 errors / 0 warnings           |
| 引擎导出浏览器专项       | **11 项通过**，退出 0，0 page errors | 默认网页导出、Godot/Unity/Unreal 下载、宿主切换、章节身份及过期修订拒绝 |
| `git diff --check`       | 通过                                 | 补丁空白检查                                                            |

完整测试与生产构建第一次同时运行时，出现 1 项精确字节预算失败和 2 项导出超时，
结果为 410 通过、3 失败。当时构建会重新写入测试也读取的第三方声明，且同时进行
多个较重导出。生产构建完成后，**单独重新运行原始 `npm test` 命令**，全部 413 项
通过，耗时 35.43 秒；没有修改断言、超时阈值或 worker 配置来获得通过。这里保留
第一次失败，不把它记成成功，也不将并发因素描述为已经独立证明的全部根因。

浏览器专项命令：

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/absolute/path/to/chrome node tests/e2e/engine-export-check.mjs
```

其中引擎宿主使用小型 HTML 传输夹具，验证 iframe 和 Three.js 生命周期，
**不是 Unity / Unreal 画面**。本轮没有重跑完整 `npm run test:browser`、所有长期
稳定性案例或真实移动 GPU 检查；上一轮的广泛浏览器失败记录仍保留。

## 依赖审计尚未通过

`npm audit --json` 退出 1，报告 **2 项中等级依赖告警**：`vitest` 与其依赖
`@vitest/mocker`。报告涉及：

- [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
- [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)

当前锁定 Vitest 4.1.11，审计报告给出的修复版本为 4.1.12。本轮保留既有锁文件，
没有混入测试工具升级；不能宣称当前依赖“零漏洞”。该审计也不覆盖 Unreal 或
glTFRuntime 的原生代码。

## 真实生成及依赖准备

执行 `npm run unreal:prepare -- --out output/unreal-acceptance-final` 成功，生成：

- `Review.cmd` / `review.mjs`、四个场景入口、`acceptance-kit.json`。
- 两个完整 Unreal 源码工程，分别为小王子三章与 H-100。
- 16 项初始 `pending` 的人工验收表与中文说明。

| 工程   | 场景数 | 规范化 GLB 数 | GLB 总字节 | `check --data-only`            |
| ------ | -----: | ------------: | ---------: | ------------------------------ |
| Prince |      3 |             6 | 18,230,960 | 通过，`nativeExecution: false` |
| H-100  |      1 |           102 |  7,696,756 | 通过，`nativeExecution: false` |

两个工程均实际执行 `node review.mjs setup --font-source DOWNLOADED_OTF`，从上游
取得固定 glTFRuntime，并使用已下载的原始 Noto 字体安装；退出 0。再次执行相同
setup 也退出 0，校验已有依赖而不替换。实际核对的固定值：

- glTFRuntime：`0b22180d5d5d48b13457b683f4405113b6afd87b`。
- Noto CJK 提交：`523d033d6cb47f4a80c58a35753646f5c3608a78`。
- 字体 SHA-256：`2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。
- OFL SHA-256：`6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`。

字体校验不证明 UE 的字形栅格化。插件 checkout 校验不证明模块可编译。
导出器出现既有 sparse accessor 大小提示，未将该提示删去或当作渲染失败。
原始/优化资产、`worlds/`、网页运行时代码、`package-lock.json` 和原有第三方
声明保持不变。Unity 和 Godot 的导出回归也已覆盖。

## 失败路径与结果资料

依赖真实准备完成后，在本轮无引擎的 Linux 环境中：

1. `node review.mjs doctor` 分别检查两工程，数据/插件/字体通过，UE 缺失明确报错，
   命令退出 1。该结果描述本轮执行环境，不描述用户的 Windows 电脑。
2. `node projects/prince/Scripts/native.mjs smoke` 因缺失真实 UE 返回 1，未启动原生
   进程，也未创建 `smoke-report.json`。
3. `node review.mjs report --out reports/final-validation` 退出 0，记录两工程的
   缺失引擎状态。每工程 33 个被收集文件均逐个核对字节数与 SHA-256；两个清单
   与 kit 记录相符，人工验收表字节不变，16 项仍为 `pending`。
4. 收集记录明确保留 `nativeExecutionVerified: false` 与
   `visualAcceptanceVerified: false`。收集成功没有变成原生验收成功。

生成时功能工作树尚未提交，因此 kit 如实记录基线提交与 `dirty: true`。结果资料
另有具体源文件、配置、脚本及 manifest 哈希。用户应检出本 PR 提交后重新生成，
将自己的本机验收绑定到对应源码提交。

新增行为测试还覆盖：显式引擎优先级、多个安装版本、实际 `Build.version`、中文/
空格路径、参数拼写错误、实际子进程失败/超时、相对路径、已存在输出、符号链接
路径逃逸、清单被修改、旧 smoke 或错误场景/引擎版本报告。测试中的引擎安装和
Windows 边界为明确标识的夹具，不作为 Windows 原生执行证据。

## 独立审查与尚待本机执行

独立审查核对了固定 glTFRuntime 的导入/动画/形变 API、Entry 地图启动、移动与
碰撞状态、HUD 字体、Home/F9 和结果约束；修复了路径逃逸、相对路径偏移、清单
哈希未强制检查、Windows `taskkill` 失败未处理等具体问题。没有遗留已确认的
范围内重大源码问题；源码审查仍不能替代 Unreal 编译。

以下项目必须在实际安装的 UE5 中执行并记录：

- Windows `Review.cmd`、引擎/Visual C++/SDK 自动发现以及实际批处理调用。
- `VirtualWorldEditor` 与固定插件编译，全部原生 Automation 测试和 smoke。
- 小王子平面/球面移动、跳跃、落地、边界、键盘、动画、三章剧情、保存/重置。
- 中文实际显示、Home 复位、F9 截图真实保存。
- H-100 全周观察、实际柔轮顶点形变、正反转、制动、剖切、爆炸与子系统可见性。
- 独立桌面包的运行时碰撞、材质、字体与许可证，以及目标 GPU 的性能记录。

网页内显示 Unreal 画面仍需另行部署 Pixel Streaming；本轮交付本机桌面验收流程。
