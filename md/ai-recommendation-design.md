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

推荐不再让模型生成歌名再搜索。当前主路径是本地画像算法：

1. 前端请求 `/api/chat` 或 `/api/chat/stream` 时，会带上当前日期、距周末信息、天气文本和时区偏移。
2. 后端根据用户输入、当前小时、是否周末、天气、最近播放、播放队列和长期画像生成 `scene`。
3. 后端从 `data/listening-profile.json -> allLikedSongs` 中打分选歌。
4. 约 80% 来自用户“喜欢的音乐”。
5. 约 20% 使用网易云 `/simi/song` 从高分喜欢歌曲扩展相似新歌，并排除已经在喜欢曲库里的歌曲。
6. 每首候选歌都会再走播放链接检查，只返回可播放歌曲。
7. 最后去重、避开不喜欢歌曲和最近重复播放。

DeepSeek/OpenAI 适配代码仍保留，但当前推荐选歌路径不依赖模型生成歌曲名。
