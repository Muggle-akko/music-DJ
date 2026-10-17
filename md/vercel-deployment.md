# Vercel 个人电台部署

目标：只部署自己使用的一套实例，使用 Vercel 地址，在 Mac 上让 Agent 创作，手机/iPad独立收听。没有公共注册、多租户或官方网易云 CLI 接入。

## 已实现的部署产物

- `Dockerfile.vercel`：官方 Node 24 镜像，安装主应用与仓库内的网易云 API，运行 `scripts/vercel-start.mjs`。
- `vercel.json`：Container Runtime 入口的非敏感环境设置，端口 8080。
- 网易云适配器只绑定容器内 `127.0.0.1:33001`，通过同一容器的 Awudio 后端调用，不向公网开放原始 API。
- 一个托管 PostgreSQL 保存电台、设备队列、账号连接、登录会话、Agent 检索凭据/租约/回执、偏好日志及解说音频。保留原来的 JSON 数据结构，存入 `awudio_objects`，在数据库事务内更新；不把 `/tmp` 当永久数据盘。
- 第一版不强制开通 R2；解说音频也可直接存为数据库二进制记录，后续容量需求明确后再抽出对象存储。网易云歌曲仍按当前账号权限实时解析播放，不批量上传到数据库或 R2。

## Vercel 设置

先创建本项目专用的 Vercel 项目，并连接一个本项目专用的托管 PostgreSQL。新服务的套餐、账单和授权须由实例所有者确认；不要把其他项目的数据库直接复用到本项目。普通静态部署不够，需要账号可用的 [Container Runtime](https://vercel.com/docs/functions/runtimes/container)（当前 Beta）。

在 Production 环境中设置：

| 变量 | 值 |
|---|---|
| `AWUDIO_DATABASE_URL` | PostgreSQL 连接串；也可使用集成提供的 `DATABASE_URL` |
| `AWUDIO_PASSWORD` | 至少 12 字符的私人访问密码，建议随机生成 |
| `AWUDIO_PUBLIC_URL` | 固定生产地址，如 `https://你的项目.vercel.app` |
| `AI_PROVIDER` | 没有 API Key 时用 `local`，外部 Agent 写稿不依赖此 Key |
| `TTS_PROVIDER` | 没有配音服务时用 `none`，保存文字解说 |

如果启用了 Vercel 系统环境变量，可省略 `AWUDIO_PUBLIC_URL`，启动脚本会读取 `VERCEL_PROJECT_PRODUCTION_URL`。不从请求头猜测公开域名，也不默认信任任意来源。

不必设置 `NCM_API_BASE`，默认使用镜像内的私有适配器。也不要把本机 `http://localhost:33001` 填到 Vercel。`NCM_COOKIE` 可省略，上线后在连接设置里登录。

可选模型和语音变量沿用 `.env.example`。所有 Key 均放在 Vercel 的服务端环境变量，不放在前端变量、Git 或页面里。

通过正常 Vercel 登录连接本项目后执行：

```sh
npx vercel link
npx vercel --prod
node scripts/check-cloud-deployment.mjs https://你的项目.vercel.app
```

CLI 登录与项目连接由 Vercel 自己处理，不需要手动读取 `auth.json`。部署前检查项目是否指向本仓库以及 Container Runtime 是否启用；不要把命令指向其他已上线项目。`.vercelignore` 和 `.dockerignore` 均排除本地 `.env`、Cookie、数据和备份目录。

预览部署默认拒绝启动，避免 Preview 误连生产账号和数据库。确有需要时，建立隔离数据库和密码，并显式设置 `AWUDIO_ALLOW_PREVIEW=1` 与预览的固定访问地址；不要直接复制生产秘密。

## 上线后的使用

网页访问密码登录 → 连接设置中登录网易云 → 下载远程 Agent 连接文件 → Mac MCP 使用 `AWUDIO_BRIDGE_FILE` → Agent 推荐、写稿并保存电台 → 手机打开同一生产地址收听。

Mac 可以关闭本地音乐服务。关闭 Mac 后已保存内容、搜索与网页播放器由云端处理；该 Mac 上的 Agent 本身不会自动迁移到云端。

## 导入现有电台

准备私有且忽略提交的 `.env.cloud.local`，仅包含目标数据库的 `AWUDIO_DATABASE_URL`。它是本项目数据库连接，不是 Vercel CLI 登录令牌。然后：

```sh
node --env-file .env.cloud.local scripts/import-cloud-data.mjs --source /原项目的绝对路径/data
```

脚本只导入电台状态、偏好、反馈和解说音频，跳过 Cookie、Agent 连接文件和浏览器会话。先检查全部目标路径不存在，再在一个事务内导入；目标已有资料就拒绝整批覆盖。源文件保持不变。导入后在网页登录原来的网易云账号，即可按账号找到电台。不要把已有生产数据与另一份目录盲目合并。

## 事务与运行边界

个人版将元数据请求串行化为一个数据库事务，更新账号状态、设备队列和 Agent 状态后提交，再返回成功响应。实例重启或请求切到另一个实例，不依赖进程内的 Map 作为唯一事实来源。

播放音频与 TTS 请求走独立通路；音乐不等待元数据事务。实时更新使用每 5 秒短轮询，不依赖某一个实例持有的 SSE 连接。排队元数据请求最多等约 8 秒，超时/断开的控制请求不在之后补执行。API 长时间生成解说或同步偏好时，其他元数据操作可能提示繁忙，当前实现优先保证个人数据一致性，并非公共多用户高并发方案。API 聊天的流式片段在事务提交后统一返回，不承诺逐字实时流式展示。

PostgreSQL 远程连接要求正常 TLS 证书校验；本机测试地址可使用无 TLS。事务锁用 PostgreSQL transaction advisory lock，可配合事务连接池；应用不设置跨事务 session advisory lock。

已验证 Container Runtime 账号可用性、正式域名 Host/Origin、私人登录、PostgreSQL 和远程 Agent。仍需验证模型调用、网易云账号登录后的完整播放资格、长曲 Range 和流量/时长限制。iPhone/iPad 的首次播放手势、后台换曲、锁屏控制、解说衔接需要真机验收。数据库备份请使用托管平台的私有备份/导出能力；Docker 主机的数据卷备份脚本不适用于此数据库模式。

## 当前验证结果

115 项回归通过，包含真实本机 PostgreSQL 的两个独立 Node 实例、跨实例登录/检索凭据/推荐/设备队列、反馈去重、共享电台、二进制解说缓存、冷启动、迁移拒绝覆盖，以及模拟数据库提交失败后不返回成功、不覆盖旧队列。测试使用模拟音乐与账号，不代表网易云公网验收。

Vercel 专用镜像已构建；实际入口、内置适配器二维码生成、数据库、私人登录与受保护 API 已在临时容器内启动验证。

2026-10-16 已通过现有 Vercel CLI 登录创建独立 `awudio` 项目，正式地址为 https://awudio.vercel.app，当前部署为 `dpl_3Qx56iRbb18nZcujkLkcFPaoCogB`。所有者本人确认条款后，已创建并连接专用 Neon `free_v3` 免费数据库（新加坡，仅生产环境），并在获得资料迁移授权后导入 16 份电台/偏好/解说资料，共 6,393,161 字节，未导入 Cookie、Agent 凭据或浏览器会话。

公网已通过 `/healthz`、登录页、未登录私有 API 返回 401、正确访问密码登录、数据库模式、私有 API、远程 Agent 注册及 context 调用。网易云真实搜索返回 10 首结果。完整播放探测目前返回 409，因为云端尚未登录网易云；不得把这次结果描述为完整播放或手机验收通过。账号资料会在登录原来的网易云账号后载入。已补齐扫码状态的数据库持久化，避免跨实例轮询丢失二维码；本轮扫码状态与私人服务器鉴权回归 4/4 通过。

本机访问密码位于被 Git 和部署上传排除的 `.vercel/owner-password`，远程 Agent 连接文件位于 `.vercel/awudio-remote.json`。不要提交或公开这些文件。当前 Mac 的既有 MCP 仍保留本地配置，待云端网易云连接完成后再切换。上线时 AI 使用 `local`、TTS 使用 `none`，未自动上传本机模型或配音 Key。
