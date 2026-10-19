# 技术底座优化验证记录

日期：2026-10-19。基线：`e610e685999ea4766657e50f4d5fedd37bbce9a7`；分支：`feat/platform-foundation-20261019`。验证在隔离检出的该分支进行，使用锁文件安装依赖，没有更新第三方版本、模型或世界模板。Node.js `v24.19.0`、npm `11.9.0`、Chromium `141.0.7390.37`。

交付：[PR #7](https://github.com/magic-alt/virtualworld/pull/7)，目标分支 `main`。远端代码文件树已与本地执行验证的文件树核对一致。PR 保持待审查状态，未合并或部署。

## 最终结果

| 检查                           | 已执行结果                             | 解释                                                                                      |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| 基线 `npm test`                | 38 个文件 / 170 项通过                 | 修改前执行，供对照。                                                                      |
| 最终 `npm test`                | **48 个文件 / 247 项全部通过**         | 包括资产、场景、任务、并发、真实 HTTP 与持久目录；新增 77 项测试。                        |
| `npm run check`                | 通过                                   | 最终源代码与测试的 TypeScript 检查。                                                      |
| `npm run build`                | 编辑器与独立播放器均通过               | 使用固定依赖；保留 Rapier/Spark 大 chunk 提示，未掩盖为零警告构建。                       |
| `npm run format:check`         | 通过                                   | 额外检查新增部署与文档的格式。                                                            |
| `npm run test:browser`         | **26 项基础流程 + 7 项世界体验通过**   | 真实浏览器，模型服务使用本地 HTTP fixture；错误列表均为空。                               |
| `npm run test:webgl`           | **12 组通过，`ok:true`，无浏览器错误** | 最终构建上重跑，覆盖真正的 context loss/restore 与独立章节 ZIP。                          |
| `npm run test:runtime-quality` | **8 项通过**                           | 暂停/运行截图、共享选择、加载边界和单个活动 runtime 等。                                  |
| `npm run demos:validate`       | **7 份独立 GLB，结构错误 0、警告 0**   | 四个场景引用这些模型；未重建 Blender 或修改几何。                                         |
| `npm audit --json`             | **已知漏洞 0**                         | 本次查询结果；不等于没有所有安全风险或未来漏洞。                                          |
| 模型与受保护文件差异           | 7 份已跟踪 GLB 与基线逐字节一致        | `package.json`、`package-lock.json`、世界模板与模型资源无内容差异；保留原许可证内容。     |
| Caddy 配置                     | 官方 v2.11.7 二进制校验通过            | 下载归档与官方 SHA-512 表一致；`caddy validate` 返回 `Valid configuration`。              |
| Compose 文件                   | YAML 解析与部署契约检查通过            | 后端不发布端口、只读/非 root、持久目录与入口配置；未声称 `docker compose config` 已执行。 |
| 真实本地 TLS 网关              | **31 项断言通过**                      | 22 次 HTTPS + 1 次直接后端 HTTP；临时 CA、真实证书校验、合成账号与密钥。                  |

## 回归覆盖的实际行为

### 导入、资产与格式

[导入保真回归](../tests/assets/import-fidelity.test.ts)加载真实带骨骼/动画的已提交 GLB，验证完整根节点与独立骨骼实例；另覆盖镜像、非 Mesh 资源、静态 CAD 层级和显隐、动画元数据传递、错误发布前无文件、警告保留及 STEP source-only。

必需扩展并不只依赖 Validator 的 errors 计数：未知必需扩展拒绝，未知可选扩展保留信息。实际 `KHR_materials_unlit` 三角模型通过 Loader 后产生对应材质。可选 Draco 在固定 Loader 无解码器时仍会失败，现于共享边界拒绝；可选 BasisU/Meshopt 声明的普通核心几何控制样例继续通过。这些控制不等于验证所有复杂压缩回退模型或设备解码组合。

浏览器基础流程实际上传 STEP，由 Worker 转成可见 GLB；重复导入具有独立实例，修改、撤销、保存与重载维持 ID/相机，资源校验和独立导出成功。网格与 1,200 个实际 Gaussian Splats 同时显示。独立导出在另一个端口的子目录中运行，创作服务关闭且外部网络被测试阻断。

### 单实例、队列与持久数据

[任务容量](../tests/engine/generation-capacity.test.ts)验证满队列、幂等重放、恢复和关闭后的拒绝；[服务租约](../tests/engine/service-lease.test.ts)包含独立 Node 进程竞争、所有权变更、目录替换和幂等释放。

[持久目录整合](../tests/engine/service-persistence.test.ts)通过实际 `createApp()` 证明第二个实例被拒绝时活动任务文件字节不变，关闭/重启后才执行中断恢复；初始化失败释放租约。启动后新增的托管世界与 GLB 能和内置世界一起读取、校验、导出，重启后保存覆盖仍在。上传 GET/HEAD/ETag 304 也经过接口验证。

[目录回归](../tests/engine/store-catalog.test.ts)覆盖每请求目录复用、新世界发现、保存优先及身份冲突。无关世界场景损坏不再妨碍有效的已存项目 get/save；目录列表与 campaign 操作继续拒绝不一致内容。

### HTTP 容量、访问与错误边界

[HTTP 容量回归](../tests/engine/http-capacity.test.ts)使用实际 loopback 模型服务器，保持两条请求未完成，证明第三条返回 429/Retry-After且没有到达供应商；同时健康与容量查询正常。完成后容量释放，下条请求成功。普通 JSON 超过 2 MiB 被拒绝，而合法 STEP 超过 2 MiB 可按上传通道处理，参考图超过 20 MiB 在存储前拒绝。

[访问策略回归](../tests/engine/hosted-access.test.ts)覆盖无 Origin 的未认证请求、错误秘密/Host/Origin、API/静态/资产路径保护、本地 Host、内容损坏、原始 STEP 伪装运行资产、已有 GLB 内容和磁盘大小。错误来源分开：用户输入校验是可操作的 400；已保存世界/campaign 的内部 Zod 失败为脱敏 500 与请求 ID，响应和日志不含错误字段值或路径。

本地 TLS 联调运行实际 Caddy 和 Fastify，临时修改副本使用回环高端口、内部 CA及 `skip_install_trust`；客户端显式信任该 CA，`rejectUnauthorized:true`。检查未/错登录 401、登录访问、真实 GLB 上传、错误 Origin 403、网关头覆盖、Authorization/身份头清除、直接后端访问拒绝。测试没有修改生产 Caddyfile或系统信任，进程和临时证书已经清理。

### 导出、取消与浏览器恢复

[导出回归](../tests/engine/export.test.ts)使用真实 GLB、小预算和实际异步压缩验证：读取前 stat、文件变化、符号链接越界、摘要、压缩前结构校验、STEP 拒绝、章节与许可证计数、同内容跨路径去重、精确预算/少一字节、已取消与压缩中的取消。

[真实 HTTP 导出取消](../tests/engine/export-http.test.ts)让请求在章节预检时保持等待，关闭客户端，再释放预检。确认随后没有压缩 worker 启动；预检期间的额外请求受并发 1 限制，结束后新导出成功。

WebGL 流程首轮有 11 组通过，最后 ZIP 导出失败。最小案例定位到测试以 `--input-type=module -e` 启动 Node，强制模式继承到 fflate 的 eval worker，导致 `u8 is not defined`。相同程序删除该标志即成功；Node 24 本身识别测试启动代码的 ESM 语法。四个测试启动器只移除该标志，没有削弱断言或更换生产导出实现。最终重建后 12 组全部通过，包括独立 ZIP 的初始化重试、网格/Splat 恢复和窄屏章节切换。

## 独立审查与取舍

任务交叉审查和完整分支审查已执行。已修复并复审关闭的主要问题：未知必需扩展、可选 Draco、损坏无关世界对保存项目的影响、已删除租约目录释放、相同资产跨路径的预算误拒绝、预检时断开导致导出继续、持久文档 Zod 错误泄露。最终修复复审没有剩余或新增 Critical/Important 问题；这是单实例私有共享工作区范围内的代码结论。

保留的两项非阻塞既有问题为 InstancedMesh 特有 dispose 事件与人工隐藏叶节点的显隐所有权。前者已证明事件缺失，未测泄漏速率；后者在 helper 输入复现，当前正常 GLTFLoader/CAD 入口不生成该条件。ImageBitmap、继承可见性的碰撞、增量场景更新、LOD/流式加载、上传并发/磁盘配额和多租户/联机仍按[审查报告](platform-foundation-audit.md)继续演进。

本次选择保留模块化单体、文件持久化和完整 GLB 根节点。代价分别是同一目录只能运行一个应用实例、成员共享权限边界、复杂资产暂不支持逐部件编辑。需要不同产品语义时，应先升级相应边界，而不是把此验证记录扩展解释为已经实现。

## 未执行的验收

没有 Docker Engine/Compose，因此未执行镜像构建、容器运行/初始卷权限、真实备份还原；没有公网域名、ACME证书或外部部署。未执行真实付费 LLM/Tripo、真实手机 GPU、硬件驱动矩阵、长期运行或大规模并发压测，也没有多人联机协议可以进行联机负载测试。无头浏览器/SwiftShader证明功能路径，不代表目标设备帧率或生产容量。
