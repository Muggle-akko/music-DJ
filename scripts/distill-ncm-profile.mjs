import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_FILE = resolve(ROOT, ".env");
const PROFILE_FILE = resolve(ROOT, "data", "listening-profile.json");
const LIKED_PLAYLIST_LIMIT = 500;
const STYLE_FETCH_CONCURRENCY = 6;

const env = await readEnv(ENV_FILE);
const baseUrl = trimTrailingSlash(env.NCM_API_BASE || "");
const cookie = env.NCM_COOKIE || "";
const existingProfile = await readJsonIfExists(PROFILE_FILE);

if (!baseUrl) {
  throw new Error("NCM_API_BASE is not configured in .env");
}

const account = await getAccount();
const playlists = await getAllUserPlaylists(account.userId);
const likedPlaylist = findLikedPlaylist(playlists, account.userId);

if (!likedPlaylist) {
  throw new Error("No liked playlist found. Expected specialType=5 or a name containing '喜欢的音乐'.");
}

const [detail, likedTracks, allRecord, weekRecord] = await Promise.all([
  getPlaylistDetail(likedPlaylist.id),
  getAllPlaylistTracks(likedPlaylist.id, likedPlaylist.trackCount),
  getUserRecord(account.userId, 0),
  getUserRecord(account.userId, 1),
]);
const styleCache = buildStyleCache(existingProfile);
const trackStyles = await getTrackStyleTags(likedTracks, styleCache);

const profile = buildProfile({
  account,
  playlists,
  likedPlaylist,
  detail,
  likedTracks,
  allRecord,
  weekRecord,
  trackStyles,
});

await mkdir(dirname(PROFILE_FILE), { recursive: true });
await writeFile(PROFILE_FILE, `${JSON.stringify(profile, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      profileFile: PROFILE_FILE,
      account: {
        userId: account.userId,
        nickname: account.nickname,
      },
      likedPlaylist: {
        id: likedPlaylist.id,
        name: likedPlaylist.name,
        trackCount: likedPlaylist.trackCount,
      },
      fetchedTracks: likedTracks.length,
      addedTimeCount: profile.dataCoverage.addedTimeCount,
      allTimeRecordCount: profile.dataCoverage.allTimeRecordCount,
      weeklyRecordCount: profile.dataCoverage.weeklyRecordCount,
      styledTrackCount: profile.dataCoverage.styledTrackCount,
      topArtists: profile.preferredArtists.slice(0, 10).map((artist) => artist.name),
      styleTags: profile.styleTags,
    },
    null,
    2,
  ),
);

async function readEnv(file) {
  const text = await readFile(file, "utf8");
  const result = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function getAccount() {
  const data = await ncmFetch("/login/status", { timestamp: Date.now() });
  const profile = data?.data?.profile;

  if (!profile?.userId) {
    throw new Error("Netease login status is unavailable. Check NCM_COOKIE.");
  }

  return {
    userId: profile.userId,
    nickname: profile.nickname || String(profile.userId),
    vipType: profile.vipType || 0,
    vipLabel: profile.vipType === 110 ? "黑胶会员" : profile.vipType ? `VIP ${profile.vipType}` : "",
  };
}

async function getAllUserPlaylists(uid) {
  const result = [];
  const limit = 100;

  for (let offset = 0; ; offset += limit) {
    const data = await ncmFetch("/user/playlist", {
      uid,
      limit,
      offset,
      timestamp: Date.now(),
    });
    const batch = Array.isArray(data?.playlist) ? data.playlist : [];
    result.push(...batch.map(mapPlaylist));

    if (batch.length < limit) break;
  }

  return result;
}

function findLikedPlaylist(playlists, userId) {
  return (
    playlists.find((playlist) => playlist.specialType === 5 && Number(playlist.userId) === Number(userId)) ||
    playlists.find((playlist) => playlist.name.includes("喜欢的音乐")) ||
    playlists[0]
  );
}

async function getPlaylistDetail(id) {
  return ncmFetch("/playlist/detail", { id, s: 0, timestamp: Date.now() });
}

async function getAllPlaylistTracks(id, expectedCount = 0) {
  const result = [];
  const target = Math.max(Number(expectedCount) || 0, LIKED_PLAYLIST_LIMIT);

  for (let offset = 0; offset < target + LIKED_PLAYLIST_LIMIT; offset += LIKED_PLAYLIST_LIMIT) {
    const data = await ncmFetch("/playlist/track/all", {
      id,
      limit: LIKED_PLAYLIST_LIMIT,
      offset,
      timestamp: Date.now(),
    });
    const batch = Array.isArray(data?.songs) ? data.songs : [];
    result.push(...batch.map(mapSong));

    if (batch.length < LIKED_PLAYLIST_LIMIT) break;
  }

  return dedupeBy(result, (track) => String(track.id));
}

async function getUserRecord(uid, type) {
  try {
    const data = await ncmFetch("/user/record", {
      uid,
      type,
      timestamp: Date.now(),
    });
    const key = type === 0 ? "allData" : "weekData";
    return (Array.isArray(data?.[key]) ? data[key] : []).map(mapRecordItem);
  } catch (error) {
    return {
      error: error.message,
      items: [],
    };
  }
}

function buildStyleCache(profile) {
  const cache = new Map();
  const songs = Array.isArray(profile?.allLikedSongs) ? profile.allLikedSongs : [];

  for (const song of songs) {
    if (!song?.id || !Array.isArray(song.styleTags) || !song.styleTags.length) continue;
    cache.set(String(song.id), dedupeStrings(song.styleTags));
  }

  return cache;
}

async function getTrackStyleTags(tracks, cache) {
  const result = new Map(cache);
  const missing = tracks.filter((track) => track.id && !result.has(String(track.id)));

  if (missing.length) {
    console.log(`Fetching style tags for ${missing.length} songs...`);
  }

  let done = 0;
  await runLimited(missing, STYLE_FETCH_CONCURRENCY, async (track) => {
    const id = String(track.id);
    const tags = await fetchSongStyleTags(id);
    if (tags.length) result.set(id, tags);
    done += 1;
    if (done % 100 === 0 || done === missing.length) {
      console.log(`Style tags ${done}/${missing.length}`);
    }
  });

  return result;
}

async function fetchSongStyleTags(id) {
  try {
    const data = await ncmFetch("/song/wiki/summary", {
      id,
      timestamp: Date.now(),
    });
    return extractWikiStyleTags(data);
  } catch {
    return [];
  }
}

function extractWikiStyleTags(data) {
  const tags = [];

  for (const block of data?.data?.blocks || []) {
    for (const creative of block?.creatives || []) {
      const title = String(creative?.uiElement?.mainTitle?.title || "");
      if (!["曲风", "推荐标签"].includes(title)) continue;

      for (const resource of creative?.resources || []) {
        const resourceTitle = resource?.uiElement?.mainTitle?.title;
        if (resourceTitle) tags.push(String(resourceTitle));
      }
    }
  }

  return dedupeStrings(tags).slice(0, 8);
}

async function runLimited(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

async function ncmFetch(path, params = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {};
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.code === 301 || data?.code === 302) {
    throw new Error(data?.message || `NCM HTTP ${response.status}`);
  }

  return data;
}

function buildProfile({ account, playlists, likedPlaylist, detail, likedTracks, allRecord, weekRecord, trackStyles }) {
  const trackIds = Array.isArray(detail?.playlist?.trackIds) ? detail.playlist.trackIds : [];
  const addedAtById = new Map(
    trackIds.filter((item) => item?.id).map((item) => [String(item.id), normalizeTimestamp(item.at)]),
  );
  const allRecordItems = Array.isArray(allRecord) ? allRecord : [];
  const weekRecordItems = Array.isArray(weekRecord) ? weekRecord : [];
  const allRecordById = new Map(allRecordItems.map((item) => [String(item.id), item]));
  const weekRecordById = new Map(weekRecordItems.map((item) => [String(item.id), item]));
  const playlistNameSignals = inferPlaylistNameSignals(playlists);

  const enrichedTracks = likedTracks.map((track, index) => {
    const addedAt = addedAtById.get(String(track.id)) || null;
    const allPlay = allRecordById.get(String(track.id)) || null;
    const weekPlay = weekRecordById.get(String(track.id)) || null;
    const styleTags = dedupeStrings([
      ...(trackStyles.get(String(track.id)) || []),
      ...inferTrackStyleTags(track, playlistNameSignals),
    ]).slice(0, 10);

    return {
      ...track,
      provider: "netease",
      rankInLikedPlaylist: index + 1,
      addedAt,
      addedAtIso: addedAt ? new Date(addedAt).toISOString() : null,
      allTimePlayCount: allPlay?.playCount || 0,
      allTimeScore: allPlay?.score || 0,
      weeklyPlayCount: weekPlay?.playCount || 0,
      weeklyScore: weekPlay?.score || 0,
      styleTags,
      primaryStyle: styleTags[0] || "",
    };
  });

  const topArtists = rankArtists(enrichedTracks);
  const topAlbums = rankAlbums(enrichedTracks);
  const allTimeSongs = allRecordItems.slice(0, 40).map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.artist,
    album: item.album,
    playCount: item.playCount,
    score: item.score,
  }));
  const weeklySongs = weekRecordItems.slice(0, 30).map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.artist,
    album: item.album,
    playCount: item.playCount,
    score: item.score,
  }));
  const recentAdds = enrichedTracks
    .filter((track) => track.addedAt)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 40)
    .map(compactTrackForProfile);
  const yearDistribution = rankYearDistribution(enrichedTracks);
  const decadeDistribution = rankDecadeDistribution(enrichedTracks);
  const languageMix = rankLanguageMix(enrichedTracks);
  const styleTags = inferStyleTags({ playlistNameSignals, languageMix, decadeDistribution });
  const recommendationSeeds = buildRecommendationSeeds({ topArtists, allTimeSongs, styleTags });

  return {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    account,
    summary: buildSummary({
      likedPlaylist,
      enrichedTracks,
      topArtists,
      topAlbums,
      styleTags,
      decadeDistribution,
      languageMix,
    }),
    styleTags,
    preferredArtists: topArtists.slice(0, 50),
    preferredSongs: allTimeSongs.slice(0, 30),
    preferredAlbums: topAlbums.slice(0, 40),
    avoidTags: [],
    recommendationGuidelines: [
      "优先使用歌名 + 歌手名作为网易云搜索词。",
      "推荐时混合高频歌手、近 90 天新增收藏、播放记录 Top 歌曲的相邻风格。",
      "同一轮推荐避免连续给出同一歌手，除非用户明确要求。",
      "可以保留复古、8-bit、爵士、开车、氛围、ACG/国漫等场景化方向。",
    ],
    recommendationSeeds,
    dataCoverage: {
      playlistCount: playlists.length,
      likedPlaylistId: likedPlaylist.id,
      likedPlaylistName: likedPlaylist.name,
      likedPlaylistDeclaredTrackCount: likedPlaylist.trackCount,
      fetchedLikedTrackCount: enrichedTracks.length,
      addedTimeCount: enrichedTracks.filter((track) => track.addedAt).length,
      allTimeRecordCount: allRecordItems.length,
      weeklyRecordCount: weekRecordItems.length,
      allTimeRecordMatchedLikedCount: enrichedTracks.filter((track) => track.allTimePlayCount > 0).length,
      weeklyRecordMatchedLikedCount: enrichedTracks.filter((track) => track.weeklyPlayCount > 0).length,
      styledTrackCount: enrichedTracks.filter((track) => track.styleTags.length).length,
    },
    sourcePlaylists: [
      {
        id: likedPlaylist.id,
        name: likedPlaylist.name,
        trackCount: likedPlaylist.trackCount,
        playCount: likedPlaylist.playCount,
        specialType: likedPlaylist.specialType,
        createTime: normalizeTimestamp(detail?.playlist?.createTime),
        createTimeIso: timestampToIso(detail?.playlist?.createTime),
        updateTime: normalizeTimestamp(detail?.playlist?.updateTime),
        updateTimeIso: timestampToIso(detail?.playlist?.updateTime),
      },
    ],
    playlistNameSignals,
    distributions: {
      years: yearDistribution.slice(0, 30),
      decades: decadeDistribution,
      languages: languageMix,
      addedByMonth: rankAddedByMonth(enrichedTracks).slice(0, 24),
    },
    allLikedSongs: enrichedTracks.map(fullTrackForProfile),
    recentLikedSongs: recentAdds,
    playHistory: {
      allTimeTopSongs: allTimeSongs,
      weeklyTopSongs: weeklySongs,
      allTimeTopArtists: rankArtists(allRecordItems).slice(0, 30),
      weeklyTopArtists: rankArtists(weekRecordItems).slice(0, 30),
    },
    notes: [
      "添加时间来自 /playlist/detail 的 trackIds.at 字段。",
      "播放次数来自 /user/record，网易云接口通常只返回全部 Top 100 与最近一周 Top 100，因此不是完整播放历史。",
      "这个文件是 AI 推荐的长期品味参考，不保存 cookie 或 API key。",
    ],
  };
}

function mapPlaylist(playlist) {
  return {
    id: String(playlist.id || ""),
    name: String(playlist.name || "未命名歌单"),
    cover: playlist.coverImgUrl || "",
    trackCount: playlist.trackCount || 0,
    playCount: playlist.playCount || 0,
    creator: playlist.creator?.nickname || "",
    userId: playlist.userId || playlist.creator?.userId || null,
    subscribed: Boolean(playlist.subscribed),
    specialType: playlist.specialType || 0,
    privacy: playlist.privacy || 0,
  };
}

function mapSong(song) {
  const artists = Array.isArray(song.ar)
    ? song.ar.map((artist) => artist.name).filter(Boolean)
    : Array.isArray(song.artists)
      ? song.artists.map((artist) => artist.name).filter(Boolean)
      : [];
  const album = song.al || song.album || {};
  const publishTime = normalizeTimestamp(song.publishTime);

  return {
    id: String(song.id || ""),
    title: String(song.name || "未知歌曲"),
    artist: artists.join(" / ") || "未知歌手",
    artists,
    album: String(album.name || ""),
    albumId: album.id ? String(album.id) : "",
    cover: album.picUrl || album.pic || album.pic_str || "",
    durationMs: Number(song.dt || song.duration || 0),
    publishTime,
    publishYear: publishTime ? new Date(publishTime).getUTCFullYear() : null,
    popularity: Number(song.pop || 0),
    fee: song.fee ?? null,
    aliases: Array.isArray(song.alia) ? song.alia.filter(Boolean) : [],
  };
}

function mapRecordItem(item) {
  return {
    ...mapSong(item.song || {}),
    playCount: Number(item.playCount || 0),
    score: Number(item.score || 0),
  };
}

function rankArtists(tracks) {
  const stats = new Map();

  for (const track of tracks) {
    const artists = Array.isArray(track.artists) && track.artists.length ? track.artists : [track.artist].filter(Boolean);
    for (const artist of artists) {
      const key = String(artist || "").trim();
      if (!key) continue;

      const current = stats.get(key) || {
        name: key,
        likedTrackCount: 0,
        allTimePlayCount: 0,
        weeklyPlayCount: 0,
        recentAddedCount: 0,
        sampleSongs: [],
      };
      current.likedTrackCount += 1;
      current.allTimePlayCount += Number(track.allTimePlayCount || track.playCount || 0);
      current.weeklyPlayCount += Number(track.weeklyPlayCount || 0);
      if (isRecentTimestamp(track.addedAt, 90)) current.recentAddedCount += 1;
      if (current.sampleSongs.length < 4) current.sampleSongs.push(track.title);
      stats.set(key, current);
    }
  }

  return [...stats.values()].sort(comparePreferenceStats);
}

function rankAlbums(tracks) {
  const stats = new Map();

  for (const track of tracks) {
    const key = `${track.album || "未知专辑"}::${track.artist || "未知歌手"}`;
    const current = stats.get(key) || {
      name: track.album || "未知专辑",
      artist: track.artist || "未知歌手",
      likedTrackCount: 0,
      allTimePlayCount: 0,
      weeklyPlayCount: 0,
      sampleSongs: [],
    };
    current.likedTrackCount += 1;
    current.allTimePlayCount += Number(track.allTimePlayCount || track.playCount || 0);
    current.weeklyPlayCount += Number(track.weeklyPlayCount || 0);
    if (current.sampleSongs.length < 5) current.sampleSongs.push(track.title);
    stats.set(key, current);
  }

  return [...stats.values()].sort(comparePreferenceStats);
}

function rankYearDistribution(tracks) {
  const stats = new Map();
  for (const track of tracks) {
    const year = track.publishYear;
    if (!year || year < 1900) continue;
    stats.set(year, (stats.get(year) || 0) + 1);
  }
  return [...stats.entries()]
    .map(([year, count]) => ({ year: Number(year), count }))
    .sort((a, b) => b.count - a.count || b.year - a.year);
}

function rankDecadeDistribution(tracks) {
  const stats = new Map();
  for (const track of tracks) {
    const year = track.publishYear;
    if (!year || year < 1900) continue;
    const decade = `${Math.floor(year / 10) * 10}s`;
    stats.set(decade, (stats.get(decade) || 0) + 1);
  }
  return [...stats.entries()]
    .map(([decade, count]) => ({ decade, count }))
    .sort((a, b) => b.count - a.count);
}

function rankLanguageMix(tracks) {
  const stats = new Map();
  for (const track of tracks) {
    const label = detectTextFamily(`${track.title} ${track.artist}`);
    stats.set(label, (stats.get(label) || 0) + 1);
  }
  return [...stats.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function rankAddedByMonth(tracks) {
  const stats = new Map();
  for (const track of tracks) {
    if (!track.addedAt) continue;
    const month = new Date(track.addedAt).toISOString().slice(0, 7);
    stats.set(month, (stats.get(month) || 0) + 1);
  }
  return [...stats.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

function inferPlaylistNameSignals(playlists) {
  const joined = playlists.map((playlist) => playlist.name).join(" / ").toLowerCase();
  const signals = [];
  const checks = [
    ["8-bit / chiptune", /8[- ]?bit|像素|chiptune/i],
    ["复古爵士", /复古爵士|jazz/i],
    ["复古蹦迪 / disco", /复古蹦迪|disco|蹦迪/i],
    ["开车场景", /开车|驾驶/i],
    ["安静 / 放松", /安静|困了|睡|放松/i],
    ["国漫 / ACG", /国漫|bilibili|acg|二次元/i],
    ["桌游 / 氛围", /桌游|氛围|ambient/i],
    ["怀旧", /十年前|旧|复古|周年|年度/i],
  ];

  for (const [label, pattern] of checks) {
    if (pattern.test(joined)) signals.push(label);
  }

  return signals;
}

function inferStyleTags({ playlistNameSignals, languageMix, decadeDistribution }) {
  const tags = new Set(playlistNameSignals);
  const dominantLanguage = languageMix[0]?.name;
  const dominantDecade = decadeDistribution[0]?.decade;

  if (dominantLanguage) tags.add(dominantLanguage);
  if (dominantDecade) tags.add(`${dominantDecade} 曲库偏好`);

  return [...tags].slice(0, 16);
}

function buildRecommendationSeeds({ topArtists, allTimeSongs, styleTags }) {
  const artistSeeds = topArtists.slice(0, 12).map((artist) => ({
    query: artist.name,
    reason: `收藏 ${artist.likedTrackCount} 首，播放权重 ${artist.allTimePlayCount}`,
  }));
  const songSeeds = allTimeSongs.slice(0, 12).map((song) => ({
    query: `${song.title} ${song.artist}`,
    reason: `播放记录 Top，播放 ${song.playCount} 次`,
  }));
  const styleSeeds = styleTags.slice(0, 8).map((tag) => ({
    query: tag,
    reason: "来自歌单名、曲库年代或文本语言分布的风格信号",
  }));

  return [...songSeeds, ...artistSeeds, ...styleSeeds].slice(0, 32);
}

function buildSummary({ likedPlaylist, enrichedTracks, topArtists, topAlbums, styleTags, decadeDistribution, languageMix }) {
  const artistText = topArtists
    .slice(0, 8)
    .map((artist) => artist.name)
    .join("、");
  const albumText = topAlbums
    .slice(0, 5)
    .map((album) => album.name)
    .join("、");
  const decadeText = decadeDistribution
    .slice(0, 3)
    .map((item) => `${item.decade}(${item.count})`)
    .join("、");
  const languageText = languageMix
    .slice(0, 3)
    .map((item) => `${item.name}(${item.count})`)
    .join("、");
  const tagText = styleTags.slice(0, 10).join("、");

  return [
    `基于网易云「${likedPlaylist.name}」的 ${enrichedTracks.length} 首收藏，你的曲库不是单一流行取向，而是明显偏向场景化收藏。`,
    `高权重歌手包括 ${artistText || "暂无"}；高密度专辑包括 ${albumText || "暂无"}。`,
    `风格信号集中在 ${tagText || "暂无"}。年代分布以 ${decadeText || "暂无"} 为主，文本语言分布以 ${languageText || "暂无"} 为主。`,
    "推荐时应优先给出可在网易云直接搜索到的歌名/歌手组合，并在高频歌手、近期新增收藏、播放记录 Top 曲目的相邻风格之间做混合。",
  ].join("");
}

function compactTrackForProfile(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    styleTags: track.styleTags || [],
    primaryStyle: track.primaryStyle || "",
    addedAtIso: track.addedAtIso,
    publishYear: track.publishYear,
    allTimePlayCount: track.allTimePlayCount,
    weeklyPlayCount: track.weeklyPlayCount,
  };
}

function fullTrackForProfile(track) {
  return {
    id: track.id,
    provider: "netease",
    title: track.title,
    artist: track.artist,
    artists: track.artists,
    album: track.album,
    albumId: track.albumId,
    cover: track.cover,
    durationMs: track.durationMs,
    publishTime: track.publishTime,
    publishYear: track.publishYear,
    popularity: track.popularity,
    fee: track.fee,
    aliases: track.aliases,
    styleTags: track.styleTags || [],
    primaryStyle: track.primaryStyle || "",
    rankInLikedPlaylist: track.rankInLikedPlaylist,
    addedAt: track.addedAt,
    addedAtIso: track.addedAtIso,
    allTimePlayCount: track.allTimePlayCount,
    allTimeScore: track.allTimeScore,
    weeklyPlayCount: track.weeklyPlayCount,
    weeklyScore: track.weeklyScore,
  };
}

function comparePreferenceStats(a, b) {
  return (
    Number(b.allTimePlayCount || 0) - Number(a.allTimePlayCount || 0) ||
    Number(b.weeklyPlayCount || 0) - Number(a.weeklyPlayCount || 0) ||
    Number(b.likedTrackCount || 0) - Number(a.likedTrackCount || 0) ||
    Number(b.recentAddedCount || 0) - Number(a.recentAddedCount || 0) ||
    String(a.name).localeCompare(String(b.name), "zh-Hans-CN")
  );
}

function detectTextFamily(text) {
  if (/[ぁ-んァ-ン]/.test(text)) return "日语 / ACG";
  if (/[가-힣]/.test(text)) return "韩语";
  if (/[\u4e00-\u9fff]/.test(text) && /[a-z]/i.test(text)) return "中英混合";
  if (/[\u4e00-\u9fff]/.test(text)) return "华语";
  if (/[a-z]/i.test(text)) return "欧美 / 英文";
  return "其他";
}

function inferTrackStyleTags(track, playlistNameSignals = []) {
  const tags = [];
  const text = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
  const language = detectTextFamily(`${track.title} ${track.artist}`);

  if (language) tags.push(language);
  if (track.publishYear) tags.push(`${Math.floor(track.publishYear / 10) * 10}s`);
  if (/8[- ]?bit|chiptune|像素/i.test(text)) tags.push("8-bit / chiptune");
  if (/jazz|爵士|sax|萨克斯/i.test(text)) tags.push("jazz");
  if (/disco|funk|city pop|future funk|groove/i.test(text)) tags.push("retro groove");
  if (/lofi|ambient|piano|钢琴|纯音乐|instrumental/i.test(text)) tags.push("instrumental / ambient");
  if (/anime|アニメ|ボカロ|vocaloid|miku|初音|acg|国漫|bilibili/i.test(text)) tags.push("ACG");

  return dedupeStrings([...tags, ...playlistNameSignals.slice(0, 2)]).slice(0, 8);
}

function normalizeTimestamp(value) {
  const number = Number(value || 0);
  return number > 0 ? number : null;
}

function timestampToIso(value) {
  const timestamp = normalizeTimestamp(value);
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function isRecentTimestamp(timestamp, days) {
  if (!timestamp) return false;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

function dedupeBy(items, getKey) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }

  return result;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
