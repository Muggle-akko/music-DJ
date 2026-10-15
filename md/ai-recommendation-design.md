# Awudio 推荐设计

## 数据来源

- `data/state.json`
  - `tasteProfile.liked`: 用户点喜欢产生的精简记录。
  - `tasteProfile.likedLibrary`: 前端“我喜欢”列表，服务端文件持久化。
  - `tasteProfile.disliked`: 用户不喜欢或跳过的精简记录。
  - `plays`: 最近播放历史。
  - `queue`: 当前播放队列。
  - `messages`: 最近 AI 请求文本。
  - `now`: 最近一次推荐命中的歌曲。
- `data/listening-profile.json`
  - 长期听歌画像。
  - `allLikedSongs`: 网易云“喜欢的音乐”的完整曲库，每首歌保存歌名、歌手、专辑、封面、时长、添加时间、播放权重和曲风标签。
  - `preferredArtists` / `preferredSongs` / `preferredAlbums`: 蒸馏后的高权重歌手、歌曲和专辑。
  - `distributions`: 年代、语言和收藏月份分布。

`data/state.json` 和 `data/listening-profile.json` 都在 `.gitignore` 中，不应随开源仓库提交。

## 蒸馏流程

运行：

```powershell
node scripts\distill-ncm-profile.mjs
```

脚本会读取 `.env` 中的 `NCM_API_BASE` 和 `NCM_COOKIE`，然后：

1. 读取网易云登录账号。
2. 找到 `specialType=5` 或名称包含“喜欢的音乐”的歌单。
3. 通过 `/playlist/track/all` 拉完整歌曲列表。
4. 通过 `/playlist/detail` 合并每首歌的添加时间 `trackIds.at`。
5. 通过 `/user/record` 合并全部 Top 100 和最近一周 Top 100 的播放次数。
6. 通过 `/song/wiki/summary` 获取每首歌的“曲风”和“推荐标签”。
7. 写入 `data/listening-profile.json`。

如果百科曲风接口没有返回标签，脚本会用歌曲文本、年代、语言和已有歌单名信号补充保底风格。

## 推荐算法

推荐不再让模型生成歌名再搜索。当前主路径是“意图识别 + 本地画像打分 + 网易云可播放校验”：

1. 前端请求 `/api/chat` 或 `/api/chat/stream` 时，会带上当前日期、距周末信息、天气文本和时区偏移。
2. 后端先区分 `playlist`、`recommend`、`music_chat`、`library_query` 和 `control`，避免音乐聊天误触发推荐。
3. 后端根据用户输入、当前小时、是否周末、天气、最近播放、播放队列和长期画像生成 `scene`。
4. 如果请求里有连续活动，会生成 `scene.stages`。例如“写半小时代码，然后洗澡睡觉”会拆成：
   - `coding / focus / 30 分钟`
   - `shower / chill / 默认约 12 分钟`
   - `sleep / sleep / 默认约 24 分钟`
5. 普通推荐从 `data/listening-profile.json -> allLikedSongs` 中按关键词、风格、播放次数、新收藏、年代、场景偏好、负反馈和近期电台重复惩罚打分。
6. 歌单模式默认约 24 首，整体限制在 15 到 30 首；不够贴合时不硬凑。
7. 多阶段歌单会按阶段分别打分和取歌：前段覆盖第一个任务，中段换到下一个场景，最后按收尾场景降温或提能量。
8. 主要候选来自用户“喜欢的音乐”，再用网易云 `/simi/song`、每日推荐或搜索结果补充少量新鲜感。
9. 每首候选歌都会再走播放链接检查，只返回可播放歌曲。
10. 最后做去重、同歌不同版本过滤、避开不喜欢歌曲和近期重复播放。

DeepSeek/OpenAI 适配代码仍保留，主要负责意图拆解、搜索关键词和主播解说。选歌主路径不依赖模型直接编歌名。

## 主播解说逻辑

1. 歌单生成后，后端只给部分可播放歌曲生成解说词，数量按歌单长度约 38% 取样，上限 12 条。
2. 解说不只放在歌曲最前面。后端会通过 `/lyric` 拉歌词，解析 LRC 时间戳，寻找两句歌词之间大于 12 秒的空档，作为间奏或结尾解说窗口。
3. AI 收到每首歌的 `cueWindows`，需要在安全窗口内选择 `startAtMs`，避免压住主歌或副歌人声。
4. 部分歌曲会通过 `/comment/music` 拉网易云热门评论。评论只有在明确提到歌曲、歌词、编曲、声音、现场或具体听歌场景时才进入 `hotComments`。
5. AI 可以把相关热评当作听感线索，但必须转述，不报用户名，不说“我查了评论区”，也不使用和歌曲无关的打卡、求赞、日推类评论。
6. 解说词有模板过滤：会丢弃“今晚，让我们...”“就像是...”“今天的歌就到这里...”等重复结尾或固定句式。
7. 同一歌单内会做相似度过滤，避免多段解说使用同样开头、同样句式或同样隐喻。
