Awudio AI 音乐播放器 MVP
极简风格的个人 AI 电台。第一版刻意保持小巧：
public/ 目录下的静态 PWA 前端。
server.mjs 中的零依赖 Node 服务器。
/api/chat 用于生成 AI DJ 歌单计划。
/api/music/search 在配置后会调用兼容 NeteaseCloudMusicApi 的服务。
本地演示模式可在没有 API 密钥的情况下保持播放器可用。
启动
powershell

编辑



npm run dev
打开：
text

编辑



http://localhost:4173
DeepSeek
该应用通过其兼容 OpenAI 的 Chat Completions API 支持 DeepSeek。
在 .env 文件中设置以下内容：
env

编辑



AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的新密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
默认使用 deepseek-v4-flash，因为 DJ 歌单规划需要快速的结构化 JSON，不需要复杂的推理。如果你需要更强的规划能力，稍后可以使用 deepseek-v4-pro。
不要提交 .env 文件，它已被 .gitignore 忽略。
NeteaseCloudMusicApi
网易云音乐没有为此用例提供稳定的公开播放 API。此 MVP 与兼容 NeteaseCloudMusicApi 的服务进行通信。
快速本地选项：
powershell

编辑



npx NeteaseCloudMusicApi@latest
Docker 选项：
powershell

编辑



docker run -d -p 3000:3000 --name netease_cloud_music_api binaryify/netease_cloud_music_api
然后设置：
env

编辑



NCM_API_BASE=http://127.0.0.1:3000
播放器目前使用以下端点：
/search
/song/url/v1
/song/url
/lyric
由于账号、VIP、版权或地区限制，某些歌曲可能无法返回可播放的 URL。应用不应尝试绕过这些限制。
Cookie
仅使用你自己的账号。
启动 NeteaseCloudMusicApi 后推荐的操作流程：
如果你的服务暴露了捆绑的二维码登录页面，访问 http://127.0.0.1:3000/qrlogin.html。
使用网易云音乐 App 扫描二维码。
从页面输出中复制返回的 cookie。
将其放入 .env：
env

编辑



NCM_COOKIE=你的cookie在这里
手动浏览器方法：
登录 music.163.com。
打开浏览器开发者工具。
进入“应用”或“存储”，然后是 Cookies，再进入 https://music.163.com。
复制你自己账号的 cookie 字符串并放入 NCM_COOKIE。
请保密 cookie，它实际上就是登录凭证。
API
POST /api/chat - 自然语言 DJ 请求。
GET /api/music/search?q=关键词 - 搜索音乐。
POST /api/taste - 记录喜欢、不喜欢和播放历史。
GET /api/now - 当前播放状态。
GET /api/plan/today - 占位用的每日电台计划。

