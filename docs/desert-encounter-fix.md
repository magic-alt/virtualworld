# 沙漠相遇：角色控制与安全行走修复

## 修复与分阶段交付

原始沙漠把 `prince-pilot` 配置为探索时创建的玩家角色，画面中的小王子则是独立的待机节点。因此进入探索会出现另一个人，小王子仍留在原地。原地形仅覆盖 X/Z 各 −11 到 +11 米，平面导航没有活动边界，越过三角网格便会下落。

| 阶段 | 提交与 PR                                                                                          | 内容                                                                     |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 基线 | `e2def020dba9a96067a37069517211dffacbbaf1`                                                         | 原始 `main`，282 项测试                                                  |
| 1    | `200f9c4`，[PR #11](https://github.com/magic-alt/virtualworld/pull/11)，已合并至 `main`            | 玩家改为小王子、飞行员 NPC、预览生命周期与异步取消保护；新增 24 项测试   |
| 2    | `a3e9549`、`031fc32`，[PR #12](https://github.com/magic-alt/virtualworld/pull/12)，已合并至 `main` | 扩展地形、活动边界与异常下落恢复，再精简远处网格；新增 35 项测试         |
| 3    | `9de6c9f`、`f3e00ae`，[PR #13](https://github.com/magic-alt/virtualworld/pull/13)，base 为 `main`  | 真实浏览器验收、真实步骤进度记录、交付与迁移说明，以及既有测试的格式整理 |

修复后的行为：

- 三章都控制小王子。沙漠飞行员是飞机旁的独立 NPC，在观赏与探索中均存在；互动锚点和叙述调整为小王子视角。
- `actor.nodeId` 关联小王子的场景预览。控制器成功创建后才隐藏预览，停止时按当前隔离状态恢复。异步初始化在停止、重新进入或切换场景后失效，不能再安装旧控制器、覆盖相机过渡或停止新场景。试玩不改写 SceneSpec。
- 地形为 **220 × 220 米**，覆盖 X/Z 各 −110 到 +110 米；声明的活动区为 **200 × 200 米**，覆盖各 −100 到 +100 米，外侧另留 10 米沙地。角色中心还需留出胶囊半径和 0.02 米控制器间隙。
- 持续向外移动时保留沿边行走和跳跃。异常下落仅在整个胶囊低于实际碰撞世界的最低处后恢复到最近一次接地位置；尚未接地时以出生点为后备。最低处按变换后的网格、盒体和球体计算，合法的六米下降不会提前触发恢复。

实现依据：[场景声明](../worlds/little-prince/chapters/desert/scene.json)、[运行时](../packages/engine/src/runtime.ts)、[角色控制器](../packages/interaction/src/character.ts)。

## 资产、兼容性与编辑契约

[地形后处理](../generators/blender/prince/extend-desert.ts) 追加外围沙丘，保留原始中心的二进制缓冲、节点及网格定义；飞机和中心景物没有整体放大。接缝匹配原地形的 512 个边缘顶点及其法线、UV、切线，并复用原沙地材质。最终资产为 **3,754,492 字节、106,536 个三角形**，SHA-256 为 `d375c9d8377e2256a1e8613ae9c96903d4c4cd28343df616ad14b4afcc442477`。

外围优化保留 11–27 米的全部密集过渡圈，27 米外改为 4 米径向间距，并保留 110 米最外圈。外围三角形从 102,400 降到 38,912（减少 62%），完整资产从第一版扩展的 170,024 降到 106,536（减少 37.3%）；11–27 米共 18 圈的顶点、法线、UV、切线与第一版扩展逐字节一致。现有资产测试约束外围不超过 40,000 个三角形，防止密度回退。版本 2 从原始 22 米 GLB 生成，并拒绝在旧扩展版本上叠加；这项几何减量不等于真实硬件帧率结论。

独立检查从基线 GLB 调用纯函数 `extendDesert()`，生成结果与当前资产逐字节一致；对当前资产再次调用也不改变字节。原始缓冲和节点、网格定义均保持一致；清单大小与哈希匹配；当前沙漠 GLB 校验为 **0 错误、0 警告、4 条信息级提示**。本次执行的是 Node.js 后处理复现，未重新运行 Blender；完整 Blender 构建已接入该步骤，见[模型构建说明](../generators/blender/prince/README.md)。

`actor.nodeId` 与平面 `navigation.bounds` 均为可选字段。未绑定预览的旧角色、无边界平面及 B-612 球面保留既有行为。网页应用与独立网页播放器共用控制器；本轮没有为 Unity/Godot 增加网页式角色控制。地形与活动区都是有限区域，未实现无限或流式地形。

新的预览编辑契约由[场景校验](../packages/scene-schema/src/schema.ts)约束：

- 绑定对象必须是可见、无父子关系的完整 GLB 网格，与 `actor.assetId` 相同；不得指定 `assetNode`，也不得带碰撞或交互。
- 预览的作者位置、旋转与缩放继续保留；玩家出生点取 `scene.spawn`，体型取 `actor.height`。拖动或缩放预览不会同步修改它们。
- 隐藏、删除、重挂父节点等破坏绑定的持久编辑会被原子校验拒绝。临时隔离仍可使用。现有[命令接口](../packages/scene-schema/src/commands.ts)没有修改 `actor` 或 `navigation` 的配置命令，本轮也没有新增这类编辑控件。

## 已保存项目：备份后采用新模板

[ProjectStore](../apps/web/server/store.ts) 优先读取 `<数据根目录>/projects/little-prince-desert.json`，只有文件不存在（`ENOENT`）才回退内置世界。更新代码和 GLB 不会自动覆盖已保存场景；旧保存仍可能采用旧玩家配置并缺少活动边界。无效 JSON 也不会自动回退模板。

1. 停止服务并关闭旧编辑器页面，避免迁移后被旧会话重新保存覆盖。
2. 确认服务实际的数据根目录。[启动配置](../apps/web/server/config.ts)读取 `VW_DATA_ROOT`；未配置时，[应用](../apps/web/server/app.ts)使用相对**服务工作目录**的 `data/`。环境变量中的相对路径也相对该工作目录解析；通常从仓库根启动。使用自定义 `createApp({ dataRoot })` 的部署，应以其实际配置为准。
3. 将同名保存文件移到 `projects/` **之外**的备份目录。该目录会枚举所有 `.json` 文件，因此不要在其中留下改名后的 `.json` 备份。以下命令适用于标准启动方式，在与服务相同的工作目录、环境下运行，并读取相同的 `.env`：

```sh
node --input-type=module <<'JS'
import 'dotenv/config';
import { access, mkdir, mkdtemp, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const desertDataRoot = resolve(process.env.VW_DATA_ROOT || 'data');
const filename = 'little-prince-desert.json';
const saved = join(desertDataRoot, 'projects', filename);
const exists = await access(saved).then(() => true, (error) => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
if (exists) {
  const backups = join(desertDataRoot, 'backups');
  await mkdir(backups, { recursive: true });
  const backup = await mkdtemp(join(backups, 'desert-encounter-'));
  const destination = join(backup, filename);
  await rename(saved, destination);
  console.log('已保留原场景：', destination);
} else {
  console.log('没有同名保存覆盖文件，将读取内置模板：', saved);
}
JS
```

4. 使用原配置重启服务，完整刷新并重新打开 `?project=little-prince-desert`。返回的 `/api/projects/little-prince-desert` 应具有 `actor.assetId: "prince-character"`、`actor.nodeId: "prince"`、平面边界 `[-100, -100]` 至 `[100, 100]`，以及独立 `pilot` 节点。只需迁移这个同名场景，保留其他项目及资产。
5. 有自定义内容时，保留备份，以新版模板为起点通过编辑器和合法 SceneCommands 合并需要保留的编辑。保存文件是完整 SceneSpec，不能直接用章节目录中不含完整资源和剧情的 `scene.json` 覆盖。需回退时再次停服，先另存新的同名场景，再把备份放回原路径。

浏览器进度与服务端场景分开保存，但 [SaveSystem](../packages/interaction/src/save.ts) 的剧情指纹包含任务名称和完整互动文案。本次采用新模板会使旧沙漠进度失配，本章从初始状态开始；后续章节按[章节依赖](../packages/interaction/src/campaign.ts)重新计算解锁。其他章节进度不会被上述迁移删除，完成新沙漠后可继续验证并恢复使用；不必手动清空整个旅程的浏览器存储。

## 已执行验证

| 检查                                           | 当前结果                                                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原始 `main` 单元／集成测试                     | 282 项通过                                                                                                                                                       |
| 阶段 1 单元／集成测试                          | 306 项通过，新增 24 项                                                                                                                                           |
| `npm test -- --maxWorkers=2`                   | 最终代码及版本 2 资产共 **57 个文件、341/341 项通过**，累计新增 59 项；退出码 0，耗时 116.07 秒                                                                  |
| 单独复跑 `tests/engine/export-targets.test.ts` | **9/9 项通过**                                                                                                                                                   |
| `npm run check`                                | TypeScript 检查通过                                                                                                                                              |
| `npm run build`                                | 网页应用与独立播放器生产构建通过，仍有较大 chunk 的构建提示                                                                                                      |
| 当前沙漠 GLB 及独立重建检查                    | 上述字节、哈希、原始内容保留与 glTF 校验均通过                                                                                                                   |
| 最后一次外围网格优化后的资产专项复检           | `tests/assets/desert.test.ts` 与 `tests/assets/prince.test.ts` 共 **15/15 项通过**，包括最终 GLB 的四向连续行走；总测试数仍为 341                                |
| `npm run format:check`                         | **全仓通过**；已仅对既有 `mechanism-orbit.test.ts` 做 Prettier 格式整理                                                                                          |
| 浏览器分阶段验收                               | 应用阶段 **20 次剧情互动、25 条检查通过**；最终独立播放器 **10 次剧情互动、12 条检查通过**，checker 退出 0，所属进程与静态服务清理完成；原始中断及两次失败仍保留 |

首次全并行运行中，340 项通过，既有原生导出预算测试 `budgets derived GLBs, raw copies, scripts and metadata at the exact native archive size` 达到 30,000 ms 时限；当次没有其他断言失败。该文件按原时限单独复跑通过，限制为四个 worker 后全套通过。最终代码和版本 2 资产又以两个 worker 全量复检，341 项全部通过。没有提高[原有测试时限](../vitest.config.ts)。

新增回归覆盖角色绑定、NPC、预览与取消生命周期；平面边界校验；基于最终 GLB 真实三角碰撞、按实际角色高度构造胶囊的四向连续行走；接缝、飞机尺寸；斜向沿边移动、跳跃、不同高度和变换后碰撞体的恢复，以及合法六米下降和旧导航兼容。对应文件位于 `tests/assets/desert*.test.ts`、`tests/engine/actor-*.test.ts`、`navigation-schema.test.ts` 和 `plane-boundary.test.ts`。

复现主要检查（Node.js 24、锁文件固定的依赖）：

```sh
npm ci
npm test -- --maxWorkers=2
npx vitest run tests/engine/export-targets.test.ts
npm run check
npm run build
npm run format:check
```

需要重跑资产后处理时使用 `node generators/blender/prince/extend-desert.ts`；该命令会更新沙漠资产、清单及章节 bundle。当前资产带幂等标记，重复运行保持 GLB 字节一致；完整 Blender 重建另见模型说明。

## 真实浏览器验收

生产构建后的完整运行命令为 `npm run test:prince`；可先执行 `npx playwright install chromium`，或通过 `PLAYWRIGHT_EXECUTABLE_PATH` 使用已有浏览器。`VW_PRINCE_DEVICE_SCALE_FACTOR` 可指定设备像素比例，默认值为 1，本次应用阶段为 0.5，最终离线复验为 0.25。脚本使用隔离数据、3145/3146 端口和真实三章导出，检查桌面、手机布局模拟、独立播放器的角色数量、输入与释放、旧地形边缘穿越、四侧边界、模式切换及剧情交互。

长走检查用实际键盘或可见摇杆输入，从出生点连续走到 X≥14 米，超过旧 +11 米边缘；它不注入位移或剧情标志。四侧边界检查先进行明确标注的近边测试定位，再持续真实输入，要求连续 24 个渲染帧接地；它不代表浏览器从出生点全程步行到全部四侧。使用最终 GLB 的物理测试另行覆盖四个方向的完整连续行走。

本次执行中，原调度进程退出后，独立的应用 checker 和测试服务继续运行。续跑监督器保留原应用检查的进展，等待其真正退出后核对报告，再停止原 API、使用同一份导出 ZIP 执行独立播放器。应用阶段在 `9de6c9f` 完成桌面与移动布局共 20 次剧情互动、25 条检查，报告通过且无错误。

第一次离线阶段通过全部沙漠检查及 B-612，共完成 6 次剧情互动、11 条检查。在地球花园，按钮已被定位且可互动，脚本等待真实点击时，270 秒无进度看门狗关闭了浏览器。原因是接近目标成功、热点已在视野、按钮可见与可用等串行步骤没有写入新检查点；最后记录仍停留在“正在接近”，不能据此认定角色移动失败。失败的 `report-player.json`、`resume-report.json`、原应用及调度报告均按原字节和哈希归档保留。

`f3e00ae` 为真实完成的移动段、接近距离、热点投影、按钮可见／可用、点击及对话显示／关闭增加检查点；没有更改输入动作、距离或帧数阈值、重试次数、180／90／60 秒步骤时限，也没有扩大 270 秒无进度保护或 30 分钟独立阶段上限。已通过的应用报告保持不变；仅从该提交重跑完整独立播放器，使用原 ZIP、同一浏览器与渲染设置，重新执行全部沙漠回归及三章剧情。运行结果由单独的 `retry-report.json` 记录。

该次 DPR 0.5 重跑在更早的长走检查中失败：180 秒内记录 66 个渲染帧，角色从出生点走到 X=9.3953 米，尚未达到 X≥14 米的终点，checker 退出码为 1，尚未完成检查或剧情点。这次错误、坐标与原报告也完整保留。后续仅将独立播放器的软件渲染 DPR 调至脚本已有支持范围内的 0.25，以降低光栅工作量，仍使用同一 ZIP、同一被测提交和全部原有输入、距离、帧数及时间要求；该次独立记录为 `retry-dpr025-report.json`。应用阶段已通过的 DPR 0.5 结果不受影响。降低像素工作量的验证设置不构成产品硬件性能结论。

原 `runner-report.json` 保持 `running` 与 `ok: false`，原命令退出码无法恢复；失败的两次离线记录也保持失败。因此不能把最终的分阶段结果记作一次连续完整成功的 `npm run test:prince`。有效结果应同时核对应用阶段、独立播放器最终重跑，以及其结束后完成清理的监督报告，并保留先前失败记录。

### 最终分阶段结果

最终独立复验于 **2026-10-20 04:01:04 UTC** 完成。原始阶段报告、两个失败归档、当前资产及 ZIP 均已逐项核对，完整可复核记录见 [desert-encounter-20261020.json](validation/desert-encounter-20261020.json)。

| 阶段                           | 被测提交  | 检查记录 | 剧情互动 | 实际结果                             |
| ------------------------------ | --------- | -------- | -------- | ------------------------------------ |
| 网页应用：桌面与手机布局       | `9de6c9f` | 25       | 20       | `passed`，错误为空；该报告保持原样   |
| 独立三章包：最终 DPR 0.25 复验 | `f3e00ae` | 12       | 10       | `passed`，错误为空；checker 退出码 0 |

两份成功报告共 **37 条验收记录、30 次剧情互动**。最终离线包中的小王子使用真实输入走过 100 个渲染帧，到达 X=14.0021 米，超过原 +11 米边缘；记录到 94 次骨骼姿态采样、Walk 时间推进 4.95 秒。四侧边界均连续 24 个渲染帧接地，输入释放与重入后连续 12 帧保持稳定 Idle。人物数量、已完成对话重放、三章衔接与最终完成界面均通过相应检查。

最终独立运行保留同一份 **7,549,082 字节**的原三章 ZIP，没有重新导出；其中沙漠 GLB 的哈希与当前资产一致。请求记录共 **20 次**，均在独立静态服务来源内，外部来源、API 与被拦截请求均为 **0**。监督报告在确认 checker、浏览器与静态服务器已停止、原 API 仍不可达、两组失败归档及四份须保留的当前报告均未改变后，才写入 `passed`；监督进程随后也已退出。

本轮浏览器为 **Chromium 141.0.7390.37**，实际后端为 **ANGLE / SwiftShader**。低画质通过正常播放设置界面选择，阴影贴图为 512 × 512；实际渲染尺寸如下：

| 布局         | CSS 视口   | DPR  | Canvas 像素 |
| ------------ | ---------- | ---- | ----------- |
| 应用桌面     | 1280 × 720 | 0.5  | 640 × 360   |
| 应用手机布局 | 390 × 844  | 0.5  | 195 × 422   |
| 独立播放器   | 1280 × 720 | 0.25 | 320 × 180   |

截图位于 `output/playwright/prince-affordances/` 下的 `desktop-desert.png`、`desktop-complete.png`、`mobile-desert.png`、`mobile-complete.png`、`offline-player-desert.png` 与 `offline-player-complete.png`。JSON 记录保留原始命令中断、两次离线失败、各次源提交、实际配置、检查内容、位置与动画数据以及报告哈希，不会把后续成功覆盖成先前尝试也通过。

浏览器验收产物位于 Git 忽略的 `output/playwright/`。手机项使用 390 × 844 的移动布局、`hasTouch` 环境和可见摇杆上的浏览器指针拖动；未验证原生多点触摸。本轮没有真实硬件 GPU、Windows Edge、手机真机或长时间压力测试证据；软件渲染完成时间不能作为真实设备帧率结论。
