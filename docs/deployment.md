# 私有团队工作区部署

本示例部署一个服务实例、一个持久工作区。通过 Caddy 的独立账号登录后，所有成员共享项目、资产、生成记录和额度；修订冲突会拒绝覆盖。没有租户隔离、可合并的协同编辑或实时多人游戏。给公众浏览时，发布独立导出的世界，不开放 Studio API。

## 容器与入口

`Dockerfile` 使用 Node.js 24，按锁文件执行 `npm ci` 和 `npm run build`；保留 workspace TypeScript 源码、`tsx`、`public`、内置资产和两份构建产物。运行命令为 `node --import tsx apps/web/server/index.ts`，Node 直接接收 SIGTERM。镜像未安装 Blender；需要固定 Blender 批处理时，另行构建包含受控 Blender 版本的镜像并验证。

`deploy/compose.yaml` 中，Studio 使用非 root 的 `node` 用户，代码文件系统只读，只有 `/data` 持久卷和有大小限制的 `/tmp` 可写。Caddy 使用 UID/GID 1000，监听内部 8080/8443，再映射到公开 80/443；两个容器均移除 Linux capabilities。后端没有宿主端口映射，只有 Caddy 对外。Caddy 的高位内部端口不改变客户端使用的标准端口，见[官方端口选项](https://caddyserver.com/docs/caddyfile/options#http-port)。

## 首次配置与启动

需要 Docker Engine、Compose v2，以及指向服务器的域名 DNS。开放服务器 TCP 80/443；启用 HTTP/3 时同时开放 UDP 443。以下命令从仓库根目录开始；它们是待运营者执行的步骤，本次未实际部署。

```sh
cd deploy
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
docker run --rm -it caddy:2.11.7-alpine caddy hash-password
```

编辑 `.env`：将随机输出填入 `VW_GATEWAY_SECRET`，将密码散列填入 `VW_AUTH_HASH`，设置自己的账号和 `VW_PUBLIC_ORIGIN=https://实际域名`。来源必须是精确 HTTPS origin，无路径、用户名、查询或末尾 `/`；本 Compose 使用公开标准 443 端口。网关秘密须为 32–256 个 URL-safe 随机字符，与登录密码独立，浏览器永远不配置该秘密。密码在 Caddy 交互提示中输入，不写入配置或 shell 命令行；`.env` 中只保留散列：

```dotenv
VW_AUTH_HASH='$2a$14$这里替换为实际生成的完整散列'
```

单引号可保留 bcrypt 的 `$`；[Compose 官方变量规则](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/#env-file-syntax)说明 `.env` 单引号值按字面读取。不要把含真实秘密的 `docker compose config`、适配后的 Caddy JSON 或调试环境输出发给别人。LLM/Tripo 密钥只进入后端，示例不会把密钥编进前端。

```sh
docker compose config --quiet
docker compose build
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d
docker compose ps
```

访问域名，应先收到浏览器账号密码提示，再进入 Studio。`basic_auth` 没有路径例外，静态文件、API、资产和经代理的 `/healthz` 全部受保护；Caddy 的 HTTP 重定向与证书挑战不暴露应用内容。[Caddy 官方文档](https://caddyserver.com/docs/caddyfile/directives/basic_auth)要求使用密码散列并通过 HTTPS 传输认证。

Caddy 在上游请求中覆盖 `X-Virtualworld-Gateway`，移除 `Authorization` 和常见身份头，并保留公开 Host。应用核对网关秘密、Host 和精确 Origin；不会把转发用户名当作授权。该处理依据 [reverse_proxy 的 header_up 规则](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)。容器内部健康检查只访问无需认证的最小 `GET /healthz`。

## 增减团队账号与修改配置

初始账号从 `.env` 读取。添加成员时，为其单独运行 `caddy hash-password`，在挂载的 `deploy/Caddyfile` 的同一个 `basic_auth` 块增加 `用户名 bcrypt散列`；可删除某行撤销该账号。使用简单无空白的账号名，避免重复初始账号。散列直接写在 Caddyfile，不经过 Compose 插值。生产修改后的账号配置也应受控保存，不要提交真实账号散列；该文件已从镜像构建上下文排除，仍由 Compose 只读挂载。不要保存明文密码。

修改账号块后运行 `docker compose restart caddy`。Caddy 管理 API 在示例中关闭，不能通过 `caddy reload` 修改。修改 `.env` 后用 `docker compose up -d --force-recreate` 重建容器，使新环境生效；修改镜像代码时先 `docker compose build`。网关秘密轮换需要让代理与后端同时使用相同的新值。

## 数据、容量与恢复

| 路径/配置                   | 用途                                                     |
| --------------------------- | -------------------------------------------------------- |
| `/data/projects`            | 保存的 SceneSpec 修订                                    |
| `/data/asset-library`       | 上传原件、运行文件与 manifests                           |
| `/data/workspace/worlds`    | 新生成的世界文档                                         |
| `/data/workspace/assets`    | 生成资产的 source / optimized / manifests 与付费任务账本 |
| `/data/generations`         | HTTP 生成作业记录                                        |
| `/data/references`          | 生成请求的保留参考图                                     |
| `/data/.service-lease`      | 单实例占用信息；不是可随意清理的缓存                     |
| Caddy `/data`、`/config` 卷 | 证书、私钥与配置状态                                     |

持久工作区卷默认名 `virtualworld-workspace`。代码与仓库内置资产只读，替换容器不会替换该卷。不要为同一数据目录运行第二个 Studio 副本；`replicas: 2` 不提供安全扩容。首次挂载的空卷从镜像继承 UID/GID 1000 的目录权限；恢复到既有卷或改用绑定目录时，运营者需事先核对相同权限。

默认上限为排队或执行中的生成作业 8、交互 AI 2、导出 1；可用 `VW_MAX_PENDING_GENERATIONS`、`VW_MAX_AGENT_REQUESTS`、`VW_MAX_EXPORTS` 调整。`VW_MAX_EXPORT_MIB=256` 限制未压缩导出内容。它不是进程内存上限：输入、压缩工作、压缩结果和最终 Buffer 可能同时存在，应按实际负载预留内存。队列满时返回 429，不创建新的付费工作。

备份前先停止入口和 Studio，并确认完全退出；不要复制正在修改的 JSON/账本。示例：

```sh
docker compose stop
mkdir -p backups
docker run --rm \
  -v virtualworld-workspace:/data:ro \
  -v "$PWD/backups:/backup" \
  node:24-bookworm-slim \
  tar -czf /backup/workspace.tar.gz -C /data .
```

使用自定义 `VW_VOLUME_NAME` 时替换卷名。另行安全备份 Caddy 卷、`.env` 和账号配置；这些内容包含秘密或密码散列，限制读取权限。备份存放在仓库之外的受控位置。恢复前停止全部实例，将归档还原到目标卷并核对 UID/GID 1000、文件数量、重要资产哈希和任务账本；先恢复同一版本镜像，再验证项目与世界可以读取。

异常退出可能留下 `.service-lease/owner.json`。先记录其中 hostname、PID 和时间，检查容器与宿主进程，确认所有指向该卷的服务都已停止，核对近期日志与付费账本并保留备份；只有确认没有仍存活的所有者后，才由运营者手动清理该租约目录。容器里的 PID 在其他容器或宿主上不能直接按同一编号判断。服务不会自动抢占模糊或陈旧租约。

重启后检查中断的生成作业。不要自动批量 resume、删除任务账本或在结果未知时重发付费创建请求；应先向供应商核实 task ID，再按应用的显式恢复流程继续原任务。项目保存与资产完整性检查通过后再恢复入口。

本地运行仍默认绑定回环，保留原有 `data/`、仓库 `worlds/` 和资产读取方式，无需迁移即可继续使用 `npm run dev`。若迁移已有本地数据到托管卷，停止本地服务后分别迁移项目、上传资产和生成内容，核对它们在表中的目标路径；不要直接将代码目录作为可写容器卷。

## 已执行的验证边界

已用官方 Caddy v2.11.7 Linux 二进制执行 `caddy validate`，结果为 `Valid configuration`；下载归档与同版本官方 SHA-512 校验表一致。以临时测试账号/秘密适配配置后，程序断言认证覆盖全部应用路径且先于代理、HTTPS 监听内部 8443、网关头被覆盖、Authorization 被移除、管理 API 关闭。Compose 文件通过 PyYAML 解析及服务/端口/只读文件系统/持久路径断言。

另外完成了真实本地 TLS 代理联调：临时配置使用高位回环端口、`tls internal` 和 `skip_install_trust`；HTTPS 客户端显式信任临时 CA，证书校验保持开启。22 次 HTTPS 与 1 次直接后端 HTTP 请求通过 31 项断言，覆盖无/错账号的 401、登录访问、GLB 上传与读取、错误 Origin 的 403、伪造网关头覆盖、上游身份头移除和后端绕过拒绝。生产 Caddyfile 未修改，测试进程与临时证书均已清理，没有安装系统信任或申请公网证书。

本环境未安装 Docker Engine/Compose，未执行 `docker compose config`、镜像构建或容器启动，也未使用真实域名申请公开信任的 TLS 证书、绑定公网端口或进行外部部署。本地联调不代表容器权限、DNS/ACME、持久卷恢复或线上容量测试通过。完整执行记录见[验证记录](validation-platform-foundation.md)。
