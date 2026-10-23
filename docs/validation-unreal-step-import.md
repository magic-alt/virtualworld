# UE5 STP 单模组导入验证记录

基于 `main` 的 `b1c695d`，功能分支 `feat/unreal-single-module-stp-import`。

## 实现

Windows UE5 关节 HUD 增加本地 STEP/STP 单选、取消、恢复默认 H-100。转换器随导出工程
分发，复用固定 OCCT、CAD 材质转换、SceneCommands 和 GLB 加载；运行时需要 PATH 中的
Node.js 24+。每个装配作为一个当前模组，普通 STEP 静态显示，不推断机构参数。

转换生成独立源文件、模型、SceneSpec 与校验记录。新模型在隐藏 Actor 内通过现有原生
加载流程，实际几何可用后才替换当前模型。失败保留当前 Actor；取消和切换场景终止
转换进程并失效旧代次；替换时释放旧场景资源。桌面导出包含转换依赖、WASM 和许可。

## 自动化进展

- 本地 Node.js 24.22.1 下，4 项新增转换测试通过：真实 10 mm STEP、多零件装配、空/损坏
  文件与目录覆盖保护，以及脱离仓库的中文空格路径运行。许可回归先失败，补齐实际
  打包的 property-graph / ktx-parse 许可后通过。
- TypeScript 检查与 Studio/独立播放器生产构建通过；大 chunk 提示仍存在。
- 浏览器完整检查通过，含独立导出停止服务与外网阻断、CAD 导入与过期响应保护。
  第一次运行与构建同时启动，构建期间首页暂未生成导致 404；构建结束后重跑通过。
- Node 24 完整单元测试已执行：412 通过、5 失败。5 个失败均为创建符号链接的 EPERM，
  涉及 `export-targets` 1 项、`export` 3 项、`unreal-local-runner` 1 项；沙箱外重跑仍是
  同样权限问题。没有修改这些断言或把失败计为通过。
- `npm audit` 实际联网结果：2 个 moderate，涉及既有 vitest 4.1.11 / @vitest/mocker；
  建议修复版本 4.1.12 超出现有固定版本，本次没有擅自升级测试框架。

## 原生检查

使用本机 UE 5.8.4、MSVC 14.44、Windows SDK 10.0.26100.0，已完成真实 C++ 编译。
首次编译发现 Win32 父窗口句柄丢弃 const 的类型错误，修正后编译通过；一次增量检查
因同步文件保留旧时间戳而未重跑 UHT，刷新生成目录时间戳后重新生成并编译通过。

真实 D3D12 / RTX 5060 渲染进程（1280×720、RenderOffscreen、未使用 NullRHI）中，
`VirtualWorld.Import.CancelAndSceneIdentity` 与 `VirtualWorld.Import.NativeReplacement`
两项均为 Success，其中替换测试带既有灯光 mobility 及预期空几何拒绝警告。检查覆盖
真实 Node 子进程转换到 UE 加载、10 mm → 1 cm 原生尺寸、装配多个实际网格仍为一个
GUI 模组、失败保持同一 Actor、候选资源释放、静态控件、场景导航与恢复默认。
导航回归在修复前实际失败，修复后通过。

H-100 原有真实渲染 smoke 通过，run ID 为 `99f93670-031f-4f1c-80fe-501136db0c96`，
匹配本次 manifest SHA-256 `79d58ed08657863c440ea6c140af59ce6c6cba140be6e8321bac99303ec7f14e`。
未声称视觉完全一致或人工键鼠验收。最终关联 Unreal/转换 Node 测试 20 项通过，
`npm run format:check` 与 `git diff --check` 通过。

独立审查发现并修正了静态导入后场景导航被拦截、两个间接依赖许可缺失的问题。

## 验收边界

文件选择器的实际鼠标操作、完整独立桌面打包、其他 UE 小版本、用户自带复杂 STEP
及长时间资源/性能测试尚未验收。转换不证明模型制造参数或真实机构运动正确。

本机日志、夹具和生成工程位于忽略的 `output/`，不提交 Node、插件、WASM 或生成二进制。
