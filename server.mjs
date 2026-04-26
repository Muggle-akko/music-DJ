import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";

const ROOT = resolve(".");
loadEnvFile(resolve(ROOT, ".env"));

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = resolve(ROOT, "public");
const DATA_DIR = resolve(ROOT, "data");
const STATE_FILE = resolve(DATA_DIR, "state.json");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE_URL = trimTrailingSlash(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const AI_PROVIDER = resolveAiProvider();
const NCM_API_BASE = trimTrailingSlash(process.env.NCM_API_BASE || "");
const NCM_COOKIE = process.env.NCM_COOKIE || "";
const NCM_SEARCH_PROBE_LIMIT = 12;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const DEFAULT_STATE = {
  tasteProfile: {
    liked: [],
    disliked: [],
    tags: ["focus", "late-night", "low-vocal"],
  },
  messages: [],
  plays: [],
  now: null,
  updatedAt: null,
};

const DEMO_TRACKS = [
  {
    id: "demo-focus-01",
    provider: "demo",
    title: "Focus Pulse",
    artist: "Awudio Demo",
    album: "Local MVP",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    cover: "",
    tags: ["focus", "electronic", "coding"],
  },
  {
    id: "demo-night-02",
    provider: "demo",
    title: "Night Grid",
    artist: "Awudio Demo",
    album: "Local MVP",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    cover: "",
    tags: ["chill", "night", "low-vocal"],
  },
  {
    id: "demo-energy-03",
    provider: "demo",
    title: "Clean Kick",
    artist: "Awudio Demo",
    album: "Local MVP",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    cover: "",
    tags: ["energy", "dj", "electronic"],
  },
  {
    id: "demo-sleep-04",
    provider: "demo",
    title: "Static Room",
    artist: "Awudio Demo",
    album: "Local MVP",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    cover: "",
    tags: ["sleep", "ambient", "soft"],
  },
];

const DJ_INSTRUCTIONS = [
  "You are Awudio, a precise AI music DJ for a personal web player.",
  "Return only valid JSON. No markdown, no comments.",
  "Schema:",
  '{"say":"Chinese DJ line under 36 chars","reason":"Chinese reason under 80 chars","mood":"focus|chill|energy|sleep|random","search":"short NetEase Music search keyword","queue":["keyword 1","keyword 2"],"voice":false}',
  "Pick search terms that work well on NetEase Cloud Music. Prefer artist, genre, song mood, or Chinese keywords.",
  "Respect disliked artists and repeated recent plays when they appear in the state.",
].join("\n");

await mkdir(DATA_DIR, { recursive: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Awudio MVP running at http://localhost:${PORT}`);
  console.log(`AI brain: ${describeAiBrain()}`);
  console.log(`Netease adapter: ${NCM_API_BASE || "demo mode"}`);
});

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      ok: true,
      aiProvider: AI_PROVIDER,
      aiModel: AI_PROVIDER === "deepseek" ? DEEPSEEK_MODEL : OPENAI_MODEL,
      deepseek: Boolean(DEEPSEEK_API_KEY),
      deepseekModel: DEEPSEEK_MODEL,
      openai: Boolean(OPENAI_API_KEY),
      openaiModel: OPENAI_MODEL,
      ncm: Boolean(NCM_API_BASE),
      ncmBase: NCM_API_BASE || null,
      mode: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/now") {
    const state = await readState();
    sendJson(res, 200, { ok: true, now: state.now, plays: state.plays.slice(-10).reverse() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/plan/today") {
    sendJson(res, 200, {
      ok: true,
      plan: [
        { time: "07:30", label: "WAKE", mood: "chill", search: "清晨 轻音乐" },
        { time: "10:00", label: "FOCUS", mood: "focus", search: "专注 工作 纯音乐" },
        { time: "15:30", label: "RESET", mood: "energy", search: "电子 放松" },
        { time: "22:30", label: "LOW", mood: "sleep", search: "白噪音 睡眠" },
      ],
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/music/search") {
    const query = url.searchParams.get("q") || "私人雷达";
    const tracks = await searchMusic(query, 10, { playableOnly: false });
    sendJson(res, 200, {
      ok: true,
      query,
      tracks,
      source: getTrackSource(tracks),
      playableCount: tracks.filter((track) => track.playable).length,
      blockedCount: tracks.filter((track) => !track.playable).length,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/music/lyric") {
    const id = url.searchParams.get("id") || "";
    const lyric = await getLyric(id);
    sendJson(res, 200, { ok: true, id, lyric });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/music/stream") {
    await streamNcmTrack(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody(req);
    const message = String(body.message || "").trim();

    if (!message) {
      sendJson(res, 400, { ok: false, error: "message is required" });
      return;
    }

    const state = await readState();
    const plan = await createDjPlan(message, state);
    let tracks = await searchMusic(plan.search, 6, { playableOnly: true });
    if (!tracks.length) {
      tracks = await searchMusic(plan.search, 6, { playableOnly: false });
    }
    const selected = tracks.find((track) => track.playable) || tracks[0] || null;

    state.messages.push({
      role: "user",
      text: message,
      at: new Date().toISOString(),
    });
    state.messages = state.messages.slice(-30);
    state.now = selected
      ? {
          ...selected,
          reason: plan.reason,
          say: plan.say,
          mood: plan.mood,
          startedAt: new Date().toISOString(),
        }
      : null;
    state.updatedAt = new Date().toISOString();
    await writeState(state);

    sendJson(res, 200, {
      ok: true,
      plan,
      tracks,
      source: {
        brain: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
        music: getTrackSource(tracks),
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/taste") {
    const body = await readJsonBody(req);
    const action = String(body.action || "");
    const track = body.track || {};
    const state = await readState();

    if (action === "like") {
      state.tasteProfile.liked.push(compactTrack(track));
      state.tasteProfile.liked = dedupeTracks(state.tasteProfile.liked).slice(-60);
    }

    if (action === "dislike") {
      state.tasteProfile.disliked.push(compactTrack(track));
      state.tasteProfile.disliked = dedupeTracks(state.tasteProfile.disliked).slice(-60);
    }

    if (action === "play") {
      state.plays.push({ ...compactTrack(track), at: new Date().toISOString() });
      state.plays = state.plays.slice(-120);
    }

    state.updatedAt = new Date().toISOString();
    await writeState(state);
    sendJson(res, 200, { ok: true, tasteProfile: state.tasteProfile });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

async function createDjPlan(message, state) {
  if (AI_PROVIDER === "deepseek") {
    try {
      const aiPlan = await createDeepSeekPlan(message, state);
      return normalizePlan(aiPlan, message);
    } catch (error) {
      console.warn("DeepSeek plan failed, falling back locally:", error.message);
    }
  }

  if (AI_PROVIDER === "openai") {
    try {
      const aiPlan = await createOpenAiPlan(message, state);
      return normalizePlan(aiPlan, message);
    } catch (error) {
      console.warn("OpenAI plan failed, falling back locally:", error.message);
    }
  }

  return createLocalPlan(message, state);
}

async function createDeepSeekPlan(message, state) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: DJ_INSTRUCTIONS },
        {
          role: "user",
          content: JSON.stringify({
            request: message,
            tasteProfile: state.tasteProfile,
            recentPlays: state.plays.slice(-12),
            now: new Date().toISOString(),
          }),
        },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.4,
      max_tokens: 700,
      stream: false,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `DeepSeek HTTP ${response.status}`);
  }

  const text = data?.choices?.[0]?.message?.content || "";
  return JSON.parse(extractJsonObject(text));
}

async function createOpenAiPlan(message, state) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: DJ_INSTRUCTIONS,
      input: JSON.stringify({
        request: message,
        tasteProfile: state.tasteProfile,
        recentPlays: state.plays.slice(-12),
        now: new Date().toISOString(),
      }),
      max_output_tokens: 700,
      store: false,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  }

  const text = extractResponseText(data);
  return JSON.parse(extractJsonObject(text));
}

function createLocalPlan(message, state) {
  const lower = message.toLowerCase();
  const recent = state.plays.slice(-6).map((play) => play.title).filter(Boolean).join(" / ");

  if (containsAny(lower, ["睡", "sleep", "晚安", "白噪音", "放松"])) {
    return {
      say: "降到低亮度播放",
      reason: "请求里有睡眠或放松信号，先给低刺激、低人声的队列。",
      mood: "sleep",
      search: "白噪音 睡眠 轻音乐",
      queue: ["白噪音", "轻音乐", "环境音乐"],
      voice: false,
    };
  }

  if (containsAny(lower, ["写代码", "coding", "专注", "工作", "学习", "论文", "阅读"])) {
    return {
      say: "进入专注档",
      reason: recent ? `避开最近播放的 ${recent}，找稳定节拍。` : "专注场景优先低人声和稳定节拍。",
      mood: "focus",
      search: "专注 工作 纯音乐",
      queue: ["lofi", "纯音乐", "低人声"],
      voice: false,
    };
  }

  if (containsAny(lower, ["dj", "电子", "跑步", "运动", "提神", "high", "能量"])) {
    return {
      say: "切到高能量队列",
      reason: "你要的是更强节拍，优先找电子、律动和少量人声。",
      mood: "energy",
      search: "电子 DJ 节奏",
      queue: ["电子", "DJ", "节奏"],
      voice: false,
    };
  }

  const artistMatch = message.match(/(?:想听|播放|来点|放点)?\s*([\u4e00-\u9fa5A-Za-z0-9 ]{2,18})/);
  const search = artistMatch?.[1]?.trim() || "私人雷达";

  return {
    say: "按你的口味试播",
    reason: "先用你的输入做网易云搜索，再根据喜欢和不喜欢继续收敛。",
    mood: "random",
    search,
    queue: [search, "私人雷达"],
    voice: false,
  };
}

async function searchMusic(query, limit = 6, options = {}) {
  if (NCM_API_BASE) {
    try {
      const playableOnly = Boolean(options.playableOnly);
      const searchLimit = playableOnly ? Math.max(limit * 8, 48) : Math.max(limit * 3, 24);
      const data = await ncmFetch("/search", {
        keywords: query,
        limit: searchLimit,
        type: 1,
        timestamp: Date.now(),
      });

      const songs = rankNcmSongs(query, data?.result?.songs || []);
      const probeLimit = playableOnly
        ? Math.min(songs.length, searchLimit)
        : Math.min(songs.length, Math.max(limit, NCM_SEARCH_PROBE_LIMIT));
      const tracks = await enrichNcmTracks(songs.slice(0, probeLimit));

      if (playableOnly) {
        return tracks.filter((track) => track.playable).slice(0, limit);
      }

      return tracks.slice(0, limit);
    } catch (error) {
      console.warn("Netease search failed, falling back to demo:", error.message);
    }
  }

  return selectDemoTracks(query, limit);
}

async function enrichNcmTracks(songs) {
  const mapped = songs.map(mapNcmSong);
  const checks = await Promise.allSettled(mapped.map((track) => getSongUrlDetails(track.id)));

  return mapped.map((track, index) => {
    const result = checks[index];
    const details = result.status === "fulfilled" ? result.value : null;
    const playable = Boolean(details?.url);

    return {
      ...track,
      playable,
      url: playable ? `/api/music/stream?id=${encodeURIComponent(track.id)}` : "",
      playState: playable ? "playable" : "blocked",
      blockReason: playable ? "" : details?.message || "版权或账号权限限制",
      br: details?.br || 0,
      sourceCode: details?.code || 0,
    };
  });
}

async function getSongUrlDetails(id) {
  if (!id || !NCM_API_BASE) {
    return { url: "", code: 0, message: "Netease API is not configured" };
  }

  const endpoints = [
    ["/song/url/v1", { id, level: "standard", timestamp: Date.now() }],
    ["/song/url", { id, timestamp: Date.now() }],
  ];

  let lastItem = null;
  let lastError = null;

  for (const [path, params] of endpoints) {
    try {
      const data = await ncmFetch(path, params);
      const item = data?.data?.[0] || null;
      if (item?.url) {
        return {
          url: item.url,
          code: item.code || data?.code || 200,
          br: item.br || 0,
          type: item.type || "",
          message: "",
        };
      }
      if (item) lastItem = item;
    } catch (error) {
      lastError = error;
      console.warn(`Netease URL failed at ${path}:`, error.message);
    }
  }

  return {
    url: "",
    code: lastItem?.code || 0,
    br: lastItem?.br || 0,
    type: lastItem?.type || "",
    message: getNcmBlockReason(lastItem, lastError),
  };
}

async function streamNcmTrack(req, res, url) {
  const id = url.searchParams.get("id") || "";
  const details = await getSongUrlDetails(id);

  if (!details.url) {
    sendJson(res, 404, {
      ok: false,
      error: details.message || "No playable URL returned by Netease",
      id,
      code: details.code || 0,
    });
    return;
  }

  const headers = {
    Accept: "*/*",
    "User-Agent": "Mozilla/5.0 Awudio-MVP/0.1",
  };

  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = await fetch(details.url, {
    headers,
    redirect: "follow",
  });

  if (!upstream.ok && upstream.status !== 206) {
    sendJson(res, upstream.status, {
      ok: false,
      error: `Audio upstream HTTP ${upstream.status}`,
      id,
    });
    return;
  }

  const responseHeaders = {
    "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    "Cache-Control": "no-store",
  };

  for (const header of ["content-length", "content-range"]) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders[header] = value;
  }

  res.writeHead(upstream.status, responseHeaders);

  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

async function getLyric(id) {
  if (!id || !NCM_API_BASE) return "";

  try {
    const data = await ncmFetch("/lyric", { id, timestamp: Date.now() });
    return data?.lrc?.lyric || "";
  } catch (error) {
    console.warn("Netease lyric failed:", error.message);
    return "";
  }
}

async function ncmFetch(path, params = {}) {
  const url = new URL(path, NCM_API_BASE);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "Awudio-MVP/0.1",
  };

  if (NCM_COOKIE) headers.Cookie = NCM_COOKIE;

  const response = await fetch(url, { headers });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || `NCM HTTP ${response.status}`);
  }

  return data;
}

function mapNcmSong(song) {
  const album = song.album || song.al || {};
  const artists = song.artists || song.ar || [];

  return {
    id: String(song.id),
    provider: "netease",
    title: song.name || "Untitled",
    artist: artists.map((artist) => artist.name).filter(Boolean).join(" / ") || "Unknown",
    album: album.name || "",
    cover: album.picUrl || "",
    duration: song.duration || song.dt || 0,
    fee: song.fee ?? 0,
    url: "",
    playable: false,
    playState: "unknown",
    blockReason: "",
    tags: [],
  };
}

function rankNcmSongs(query, songs) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = String(query)
    .trim()
    .split(/\s+/)
    .map(normalizeSearchText)
    .filter(Boolean);

  return [...songs]
    .map((song, index) => {
      const title = normalizeSearchText(song.name);
      const artists = normalizeSearchText((song.artists || song.ar || []).map((artist) => artist.name).join(" "));
      const album = normalizeSearchText(song.album?.name || song.al?.name || "");
      const haystack = `${title} ${artists} ${album}`;
      let score = 1000 - index;

      if (normalizedQuery && title === normalizedQuery) score += 700;
      if (normalizedQuery && artists === normalizedQuery) score += 650;
      if (normalizedQuery && title.includes(normalizedQuery)) score += 450;
      if (normalizedQuery && artists.includes(normalizedQuery)) score += 500;
      if (normalizedQuery && normalizedQuery.includes(artists) && artists) score += 260;
      if (tokens.length && tokens.every((token) => haystack.includes(token))) score += 220;

      return { song, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ song }) => song);
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function getNcmBlockReason(item, error) {
  if (error) return error.message;
  if (!item) return "网易云未返回播放信息";
  if (item.message) return item.message;
  if (item.code === 404) return "暂无版权或账号无播放权限";
  if (item.freeTrialPrivilege?.cannotListenReason) return "试听/版权限制";
  return "没有可播放链接";
}

function selectDemoTracks(query, limit) {
  const lower = query.toLowerCase();
  const scored = DEMO_TRACKS.map((track) => {
    const score = track.tags.reduce((sum, tag) => sum + (lower.includes(tag) ? 2 : 0), 0);
    return { track, score };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ track }) => ({
    ...track,
    playable: true,
    playState: "playable",
    blockReason: "",
  }));
}

async function serveStatic(res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = resolve(join(PUBLIC_DIR, cleanPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  const body = await readFile(filePath);
  const type = CONTENT_TYPES[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(body);
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Request body too large");
  }

  return raw ? JSON.parse(raw) : {};
}

async function readState() {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    await writeState(DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
}

async function writeState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function normalizePlan(plan, message) {
  const fallback = createLocalPlan(message, DEFAULT_STATE);
  const mood = ["focus", "chill", "energy", "sleep", "random"].includes(plan?.mood)
    ? plan.mood
    : fallback.mood;

  return {
    say: String(plan?.say || fallback.say).slice(0, 60),
    reason: String(plan?.reason || fallback.reason).slice(0, 120),
    mood,
    search: String(plan?.search || fallback.search).slice(0, 40),
    queue: Array.isArray(plan?.queue) ? plan.queue.slice(0, 6).map(String) : fallback.queue,
    voice: Boolean(plan?.voice),
  };
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
      if (typeof content?.output_text === "string") chunks.push(content.output_text);
    }
  }

  return chunks.join("\n");
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return JSON");
  }

  return text.slice(start, end + 1);
}

function compactTrack(track) {
  return {
    id: String(track.id || ""),
    provider: String(track.provider || ""),
    title: String(track.title || ""),
    artist: String(track.artist || ""),
  };
}

function dedupeTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    const key = `${track.provider}:${track.id}:${track.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTrackSource(tracks) {
  return tracks.some((track) => track.provider === "netease") ? "netease" : "demo";
}

function containsAny(text, words) {
  return words.some((word) => text.includes(word));
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const raw = readFileSync(filePath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) continue;

    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();

    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function resolveAiProvider() {
  const requested = (process.env.AI_PROVIDER || "").toLowerCase();

  if (requested === "deepseek" && DEEPSEEK_API_KEY) return "deepseek";
  if (requested === "openai" && OPENAI_API_KEY) return "openai";
  if (!requested && DEEPSEEK_API_KEY) return "deepseek";
  if (!requested && OPENAI_API_KEY) return "openai";

  return "local";
}

function describeAiBrain() {
  if (AI_PROVIDER === "deepseek") return `deepseek:${DEEPSEEK_MODEL}`;
  if (AI_PROVIDER === "openai") return `openai:${OPENAI_MODEL}`;
  return "local fallback";
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
