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

声音管线 / Fish Audio
如果歌曲对象带有 hostIntro，前端会在对应时间点以 1.2 倍速读出讲解词，并把音乐音量渐低到约 16%，讲完后渐回。没有配置 Fish Audio 时，会使用浏览器内置 SpeechSynthesis 兜底。

Fish Audio 配置：
env

编辑



TTS_PROVIDER=fish
FISH_AUDIO_API_KEY=你的 Fish Audio API key
FISH_AUDIO_REFERENCE_ID=你的声音模型 reference_id
FISH_AUDIO_MODEL=s2-pro
FISH_AUDIO_LATENCY=normal
FISH_AUDIO_SPEED=1

API
POST /api/tts - 合成或读取缓存后的主播讲解音频。
GET /api/tts/audio/:file - 读取缓存的讲解音频。


推荐系统 V2（本地试用）

内置推荐统一使用 V2，V1 已移除。点击“同步偏好”取得收藏元数据。V2 使用真实网易云候选与有限工具调用选曲；实际播放和明确反馈分别记录。

实施说明与测试命令见 [推荐 V2 实施记录](md/recommendation-v2-implementation.md)，规格见 [Agent PRD](md/recommendation-agent-prd.md)。

外部 Agent 模式

在网页选择“外部 Agent”，通过本地 STDIO MCP 让 Codex 查询真实曲库、自行选歌、提交计划并控制网页播放。聊天在 Agent 中进行，外部选歌工具不调用内置模型。现已完成 Codex 连接和真实曲库歌单推荐；电台制作的验证边界见 [电台制作说明](md/radio-studio.md)。接入方式见 [接入说明](md/external-agent-setup.md)、[外部 Agent 模式 PRD](md/external-agent-mode-prd.md)及 [音乐 Skill](skills/awudio/SKILL.md)。
## 电台制作

推荐歌单和播放队列均提供“制作电台”，支持 API 或外部 Agent 生成解说、手动编辑、保存到历史电台及回听。详见 [电台制作说明](md/radio-studio.md)。
