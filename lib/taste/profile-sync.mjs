import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson, readJson, serial } from "../storage.mjs";
import { accountKey } from "../ncm.mjs";

export function mapSong(song) {
  const artists = song.ar || song.artists || [];
  const album = song.al || song.album || {};
  return {
    id: String(song.id || ""),
    provider: "netease",
    title: String(song.name || song.title || ""),
    artist: artists.map((a) => a.name).join(" / ") || song.artist || "",
    artists: artists.map((a) => a.name),
    artistIds: artists.map((a) => String(a.id || "")).filter(Boolean),
    album: String(album.name || song.album || ""),
    albumId: String(album.id || ""),
    cover: String(album.picUrl || song.cover || "").replace(/^http:/, "https:"),
    durationMs: Number(song.dt || song.duration || song.durationMs || 0),
    publishTime: Number(song.publishTime || 0) || null,
    aliases: [...(song.alia || []), ...(song.alias || [])].map(String),
    fee: song.fee ?? null,
    styleTags: [],
    features: {
      genre: [],
      vocal: { value: "unknown", confidence: 0 },
      language: { value: null, confidence: 0 },
      energy: { value: null, confidence: 0 },
    },
  };
}
export function extractWikiFeatures(data) {
  const genre = [];
  let language = { value: null, confidence: 0 };
  let explicitInstrumental = false;
  for (const block of data?.data?.blocks || [])
    for (const creative of block.creatives || []) {
      if (creative.uiElement?.mainTitle?.title === "语种") {
        const values = (creative.resources || [])
          .map((r) => r.uiElement?.mainTitle?.title)
          .filter(Boolean);
        if (values.some((value) => /^(纯音乐|器乐|instrumental)$/i.test(value)))
          explicitInstrumental = true;
        const verified = values.find((value) =>
          /^(国语|华语|英语|日语|韩语|粤语|中文|英文|普通话)$/.test(value)
        );
        if (verified)
          language = {
            value:
              { 中文: "华语", 英文: "英语", 普通话: "国语" }[verified] ||
              verified,
            confidence: 0.9,
          };
      }
      if (!["曲风", "推荐标签"].includes(creative.uiElement?.mainTitle?.title))
        continue;
      for (const resource of creative.resources || []) {
        const value = resource.uiElement?.mainTitle?.title;
        if (value)
          genre.push({
            value: String(value).slice(0, 80),
            source: "song_wiki",
            confidence: 0.8,
          });
      }
    }
  const instrumental =
    explicitInstrumental ||
    genre.some((g) =>
      /(?:纯音乐|instrumental|(?:^|[-/·\s])器乐)/i.test(g.value)
    );
  return {
    genre,
    vocal: {
      value: instrumental ? "instrumental" : "unknown",
      confidence: instrumental ? 0.8 : 0,
    },
    language,
    energy: { value: null, confidence: 0 },
  };
}

export function createProfileSync({ dataDir, ncm, now = () => Date.now() }) {
  let task = null;
  let status = { state: "idle" };
  const fileFor = (key) => join(dataDir, "accounts", key, "profile.json");
  async function identity() {
    const data = await ncm("/login/status", { timestamp: now() });
    const user = data?.data?.profile || data?.profile;
    if (!user?.userId)
      throw Object.assign(new Error("网易云未登录，无法同步偏好"), {
        status: "unauthorized",
      });
    return { userId: String(user.userId), accountKey: accountKey(user.userId) };
  }
  const featuresFile = (key) =>
    join(dataDir, "accounts", key, "song-features.json");
  async function readFeatures(key) {
    const entries = await readJson(featuresFile(key), {});
    return Object.fromEntries(
      Object.entries(entries).filter(
        ([, entry]) => now() - Date.parse(entry.updatedAt) < 30 * 86400000
      )
    );
  }
  async function saveFeatures(key, updates) {
    if (!updates.length) return;
    await serial(featuresFile(key), async () => {
      const entries = await readFeatures(key);
      for (const entry of updates)
        entries[entry.id] = {
          features: entry.features,
          updatedAt: new Date(now()).toISOString(),
        };
      await atomicJson(featuresFile(key), entries);
    });
  }
  async function read(key) {
    const profile = await readJson(fileFor(key));
    if (!profile) return null;
    const features = await readFeatures(key);
    profile.allLikedSongs = profile.allLikedSongs.map((track) =>
      features[track.id]
        ? {
            ...track,
            features: features[track.id].features,
            styleTags: features[track.id].features.genre.map((g) => g.value),
          }
        : track
    );
    return profile;
  }
  async function sync() {
    const user = await identity();
    const previous = await read(user.accountKey);
    const playlists = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await ncm("/user/playlist", {
        uid: user.userId,
        limit: 100,
        offset,
      });
      if (!Array.isArray(page.playlist)) throw new Error("歌单列表结构异常");
      playlists.push(...page.playlist);
      if (page.more === false || (!page.more && page.playlist.length < 100))
        break;
    }
    const liked = playlists.find(
      (p) =>
        p.specialType === 5 &&
        String(p.userId || p.creator?.userId) === user.userId
    );
    if (!liked) throw new Error("没有找到当前账号的喜欢歌单，未改动上次画像");
    const detail = await ncm("/playlist/detail", { id: liked.id, s: 0 });
    const expected = Number(detail.playlist?.trackCount ?? liked.trackCount);
    if (!Number.isFinite(expected) || expected < 0)
      throw new Error("收藏数量结构异常");
    const added = new Map(
      (detail.playlist?.trackIds || []).map((t) => [
        String(t.id),
        Number(t.at) || null,
      ])
    );
    const found = new Map();
    const errors = [];
    for (let offset = 0; offset < expected; offset += 500) {
      try {
        const data = await ncm(
          "/playlist/track/all",
          { id: liked.id, limit: 500, offset },
          { timeoutMs: 15000 }
        );
        if (!Array.isArray(data.songs)) throw new Error("收藏分页结构异常");
        for (const raw of data.songs)
          if (raw.id) found.set(String(raw.id), mapSong(raw));
        status.fetched = found.size;
      } catch {
        errors.push(`收藏分页 ${offset} 失败`);
      }
    }
    if (expected > 0 && !found.size)
      throw new Error("收藏同步全部失败，已保留上次画像");
    const complete = found.size === expected && !errors.length;
    const oldSongs = new Map(
      (previous?.allLikedSongs || []).map((t) => [t.id, t])
    );
    const records = await Promise.allSettled(
      [0, 1].map((type) => ncm("/user/record", { uid: user.userId, type }))
    );
    const recordMaps = records.map((r, i) => {
      const rows =
        r.status === "fulfilled" ? r.value[i ? "weekData" : "allData"] : null;
      if (!Array.isArray(rows)) {
        errors.push(`${i ? "周榜" : "历史榜"}不可用`);
        return null;
      }
      return new Map(rows.map((row) => [String(row.song?.id), row]));
    });
    const songs = [...found.values()].map((song) => {
      const old = oldSongs.get(song.id);
      return {
        ...song,
        features: old?.features || song.features,
        styleTags: old?.features?.genre?.map((g) => g.value) || [],
        addedAt: added.get(song.id) ?? old?.addedAt ?? null,
        allTimePlayCount: recordMaps[0]?.get(song.id)?.playCount ?? null,
        weeklyPlayCount: recordMaps[1]?.get(song.id)?.playCount ?? null,
        membership: { inLikedLibrary: true, playlistIds: [String(liked.id)] },
        provenance: [
          {
            source: "liked_library",
            retrievedAt: new Date(now()).toISOString(),
          },
        ],
      };
    });
    if (!complete)
      for (const [id, song] of oldSongs) if (!found.has(id)) songs.push(song);
    const profile = {
      schemaVersion: 3,
      accountKey: user.accountKey,
      version: randomUUID(),
      updatedAt: new Date(now()).toISOString(),
      complete,
      allLikedSongs: songs,
      preferredArtists: [],
      styleTags: [],
      dataCoverage: {
        likedPlaylistDeclaredTrackCount: expected,
        fetchedLikedTrackCount: found.size,
        retainedTrackCount: songs.length,
        allTimeRecordCount: recordMaps[0]?.size ?? null,
        weeklyRecordCount: recordMaps[1]?.size ?? null,
        recordIsTruncated: true,
      },
      errors,
    };
    await atomicJson(fileFor(user.accountKey), profile, true);
    // V1 still reads this compatibility snapshot. Account identity is retained for isolation.
    await atomicJson(join(dataDir, "listening-profile.json"), profile, true);
    status = {
      ...status,
      state: complete ? "complete" : "partial",
      accountKey: user.accountKey,
      coverage: profile.dataCoverage,
      errors,
      finishedAt: profile.updatedAt,
    };
    return profile;
  }
  function start() {
    if (task) return { ...status };
    status = {
      state: "running",
      taskId: randomUUID(),
      startedAt: new Date(now()).toISOString(),
      fetched: 0,
    };
    task = sync()
      .catch((error) => {
        status = {
          ...status,
          state: "error",
          error: error.message,
          reasonCode: error.status || "error",
        };
      })
      .finally(() => {
        task = null;
      });
    return { ...status };
  }
  return {
    identity,
    read,
    readFeatures,
    saveFeatures,
    start,
    wait: () => task,
    status: () => ({ ...status }),
    fileFor,
  };
}
