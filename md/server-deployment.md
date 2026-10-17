# 个人服务器版

目标：同一个人用 Mac 创作，在 iPad / 手机网页收听；Mac 关机后，已保存的电台依然可以访问和播放。每位开源使用者部署自己的实例，不包含公共注册、多用户或共用账号服务。仍使用仓库内的网易云 API，未接入官方 CLI。

此文是独立 Docker 主机的部署路径。用户尚无服务器，偏好 Vercel 提供的域名：暂未进行公网部署，也没有生成真实 `.env.server` 或修改现有 Vercel 项目。Vercel 专用容器与数据库模式见 [Vercel 部署说明](vercel-deployment.md)；不能按普通静态项目原样上传就完成全部能力。

## 运行方式

- `AWUDIO_MODE=local`：默认，仅监听 `127.0.0.1`，保留本机 MCP 配置及原有队列。
- `AWUDIO_MODE=server`：要求 HTTPS 的 `AWUDIO_PUBLIC_URL` 和至少 12 字符的 `AWUDIO_PASSWORD`。浏览器用私人访问密码登录，Agent 用独立 Bearer 凭证。服务只接受配置域名的 Host / Origin，不信任客户端自行传入的代理头。
- 生产部署用一台 Linux 服务器运行 app、网易云 API、Caddy。只有 Caddy 发布 80/443，两个后端没有映射到公网的端口。HTTPS 终止于 Caddy，App 在容器内通过 HTTP 通信。
- 服务器版按浏览器设备 ID 保存队列及队列版本；电台库、推荐计划、喜好资料共享。进度保存在当前浏览器，不会自动跨设备接力或同时播放。

## 首次部署

前提：服务器已安装 Docker Engine 和 Compose 插件；有一个指向服务器的域名；80/443 可访问。安装 Node.js 22+ 仅用于生成初始配置（容器运行 Node 24）。本项目不安装 Docker 或修改防火墙。

```sh
git clone <你的仓库地址> awudio
cd awudio
node scripts/setup-server.mjs https://radio.example.com
sh scripts/server.sh up -d --build
sh scripts/server.sh ps
```

初始化脚本生成 `.env.server` 和随机访问密码，文件权限 600，不覆盖已有文件。保存显示的密码，用手机访问配置的域名，输入此密码进入。密码不是网易云登录密码。

播放器顶部「连接设置」在新标签打开，不打断已有页面的播放。在设置里：

1. 尝试网易云扫码登录，二维码由你的服务器上的网易云 API 生成。扫码受风控限制时，使用包含 `MUSIC_U` 的 Cookie 验证连接；不会承诺扫码一定成功。
2. 凭证经 `/login/status` 验证后写入数据卷中的 `netease-connection.json`，不回显原始 Cookie，也不放进浏览器存储。首次绑定直接生效，无需重启。实例已绑定账号后拒绝网页直接切到另一个账号，避免混合资料。
3. 设置手机/iPad的设备名称。重新打开播放器后可在 Agent 连接设置中识别并选择目标设备。

`AI_PROVIDER=local`、`TTS_PROVIDER=none` 为默认值，外部 Agent 可以选歌、写文字解说并保存电台。希望服务器通过 API 写稿或朗读时，在 `.env.server` 中配置供应商，随后 `sh scripts/server.sh up -d` 重建应用容器：

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你自己的Key
DEEPSEEK_MODEL=你可用的模型名
TTS_PROVIDER=fish
FISH_AUDIO_API_KEY=你自己的Key
FISH_AUDIO_REFERENCE_ID=你的音色ID
```

服务器保留模型调用、文字稿和 TTS 缓存，手机无需持有模型 Key。只有成功配置语音服务后才启用朗读，失败时音乐不应中断。未实现生成后导出整期混音音频。

## Mac Agent 连接服务器

电脑不需要运行本地 Awudio 音乐服务，但仍需运行 Agent 和轻量 MCP 桥接脚本。

1. 在服务器网页的「连接设置」下载 `awudio-remote.json`。此文件有控制凭证，用浏览器登录密码无法替代它。
2. 将文件移到电脑私有目录，执行 `chmod 600 /绝对路径/awudio-remote.json`；不要提交到 Git、分享或放进公开同步链接。
3. 在本地项目执行 `npm ci`，把下列 MCP 条目配置到 Agent 客户端。使用机器上实际的 Node 可执行路径，保留 120 秒超时：

```toml
[mcp_servers.awudio]
command = "/你的Node绝对路径/node"
args = ["/你的项目绝对路径/scripts/awudio-mcp.mjs"]
tool_timeout_sec = 120

[mcp_servers.awudio.env]
AWUDIO_BRIDGE_FILE = "/私有目录/awudio-remote.json"
```

仅设置 `AWUDIO_BRIDGE_FILE` 时才允许远程 HTTPS 地址；不接受远程明文 HTTP、URL 内的用户名密码或查询参数。不设置时，继续读取本机 `data/agent-bridge.json`，行为与之前一致。不要把远程连接文件覆盖到本机服务自动管理的文件上。

网页切到「外部 Agent」，选择目标播放设备。Agent 可以在没有在线播放器时制作、写稿、保存已有选曲的电台；实际开始播放仍需目标页面在线、回执确认，并可能需要在手机手动点一次播放。推荐计划过期后仍可从保存的历史电台回听，歌曲地址在播放时重新获取。

关闭 Mac 后，手机仍可搜索、查看歌单、操作播放器、回听电台；若配置模型 API，也可使用内置 API 能力。关闭 Mac 会停止该电脑上的 Agent 对话与创作，不会自动把它迁移到服务器；本版没有部署常驻云端 Agent。

## 数据、备份和更新

`awudio_data` 命名卷保存账号状态、电台、独立设备队列、偏好、Cookie、Agent 凭证、浏览器会话及 TTS 缓存。重建容器不删除卷。浏览器会话最长 30 天，服务重启后保留；修改访问密码并重建容器会让已有会话失效。退出当前浏览器会撤销此会话并关闭对应流。

```sh
# 日志与健康检查，不显示完整环境变量或连接文件
sh scripts/server.sh ps
sh scripts/server.sh logs --tail=100 app

# 一致备份：短暂停止 app，读取命名卷，再启动 app
sh scripts/backup-server.sh

# 备份后更新；保留 .env.server 与命名卷
git pull
sh scripts/server.sh up -d --build
```

备份包含私有凭证，保存在忽略提交的 `backups/`，应另行复制到私有存储。`.env.server` 与 Caddy 证书卷不在上述应用备份内，需独立保管。不要运行 `down -v` 删除数据卷。

恢复到已初始化的新实例时，先停止 app，再将备份送入临时容器，最后启动：

```sh
sh scripts/server.sh stop app
cat /私有路径/awudio-backup.tar.gz | sh scripts/server.sh run --rm --no-deps --entrypoint tar app xzf - -C /app/data
sh scripts/server.sh start app
```

恢复应面向空数据卷，或先备份旧卷；该命令不会清理备份中不存在的旧文件。恢复旧备份也会恢复当时的 Agent 凭证和浏览器会话；不希望旧浏览器继续访问时，更改访问密码。

现有 Mac 数据可在停止本地服务后，按相同的数据目录结构打包迁移到服务器的数据卷。先备份两端，迁移到尚未开始使用的新实例；不要把两个已经使用的实例的数据目录直接混合。服务器登录后会按网易云账号找到原有历史。原来的全局队列保留，服务器设备首次使用从空队列开始，可从历史电台载入。

## 验证边界

隔离 HTTP 回归覆盖未登录访问、跨来源/Host 拒绝、音频鉴权及 Range、Cookie 校验与账号绑定、二维码结果不泄漏 Cookie、Agent 凭证隔离、两个设备并发队列、电台共享和重启持久化。测试使用模拟网易云与音频。

公网部署前仍需用选定服务器验证真实网易云登录、播放权限、网络连通及音源刷新。iPhone / iPad 的首次播放手势、锁屏下一首、后台连续切歌及解说衔接，需要真机验收；Media Session 和 PWA 不能保证系统后台不会挂起网页。请不要把桌面预览或模拟接口测试当作真机验收。
