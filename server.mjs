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
const LISTENING_PROFILE_FILE = resolve(DATA_DIR, "listening-profile.json");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE_URL = trimTrailingSlash(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const AI_PROVIDER = resolveAiProvider();
const NCM_API_BASE = trimTrailingSlash(process.env.NCM_API_BASE || "");
const NCM_COOKIE = process.env.NCM_COOKIE || "";
const NCM_SEARCH_PROBE_LIMIT = 12;
const NCM_SIMILAR_SEED_LIMIT = 3;
const NCM_DAILY_RECOMMEND_LIMIT = 30;
const MAX_RECOMMENDATION_DURATION_MS = 12 * 60 * 1000;
const MAX_QUEUE = 200;
const PROFILE_RECOMMENDATION_LIKED_RATIO = 0.82;
const PROFILE_RECOMMENDATION_CANDIDATE_LIMIT = 120;
const CHAT_RECOMMENDATION_LIMIT = 3;
const PLAYLIST_RECOMMENDATION_LIMIT = 30;

const QUERY_MODIFIER_TERMS = new Set([
  "ai",
  "background",
  "beat",
  "beats",
  "bgm",
  "chill",
  "coding",
  "dj",
  "electro",
  "electronic",
  "focus",
  "instrumental",
  "lofi",
  "mix",
  "music",
  "playlist",
  "study",
  "work",
  "8bit",
  "电子",
  "电音",
  "轻",
  "轻电子",
  "专注",
  "上班",
  "学习",
  "工作",
  "写代码",
  "编程",
  "纯音乐",
  "背景",
  "背景音乐",
  "氛围",
  "氛围电子",
  "舒缓",
  "放松",
  "安静",
  "提神",
  "助眠",
  "复古",
  "芯片音乐",
  "无歌词",
].map((term) => normalizeSearchText(term)));

const LOW_SIGNAL_TITLE_TERMS = new Set([
  "电子",
  "电音",
  "轻电子",
  "纯音乐",
  "背景音乐",
  "放松",
  "舒缓",
  "music",
  "electronic",
  "instrumental",
  "study",
  "work",
].map((term) => normalizeSearchText(term)));
const MAX_LIKED_LIBRARY = 2000;

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
    likedLibrary: [],
    disliked: [],
    tags: ["focus", "late-night", "low-vocal"],
  },
  messages: [],
  plays: [],
  queue: [],
  queueCurrentIndex: -1,
  queueUpdatedAt: null,
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
  '{"say":"Chinese DJ line under 36 chars","reason":"Chinese reason under 90 chars","mood":"focus|chill|energy|sleep|random","search":"best fallback NetEase search keyword","seedQueries":[{"query":"NetEase search keyword","intent":"why this query fits","weight":1}],"queue":["keyword 1","keyword 2"],"avoid":["artist or song to avoid"],"voice":false}',
  "Analyze the user request, current mood/time, liked songs, liked library, recent plays, queue, disliked songs, and distilled listening profile.",
  "Generate 6 to 10 practical NetEase Music search queries. Prefer exact song/artist pairs when known, otherwise artist + style, playlist-friendly Chinese keywords, or mood/genre terms.",
  "Use liked artists/songs as taste anchors, but avoid repeating the most recent plays unless the user explicitly asks for them.",
  "Respect disliked artists/songs and avoid blocked or overplayed tracks.",
  "Do not invent inaccessible private data. Keep queries short enough to work well in NetEase search.",
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
      serverBuild: "awudio-server-v7",
      features: {
        queue: true,
        playlists: true,
        cloudsearch: true,
        chatStream: true,
        playlistGeneration: true,
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/now") {
    const state = await readState();
    sendJson(res, 200, { ok: true, now: state.now, plays: state.plays.slice(-10).reverse() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/queue") {
    const state = await readState();
    const queueState = normalizeQueueState(state.queue, state.queueCurrentIndex);
    sendJson(res, 200, { ok: true, ...queueState, updatedAt: state.queueUpdatedAt || null });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/queue") {
    const body = await readJsonBody(req);
    const queueState = normalizeQueueState(body.queue, body.currentIndex);
    const state = await readState();

    state.queue = queueState.queue;
    state.queueCurrentIndex = queueState.currentIndex;
    state.queueUpdatedAt = new Date().toISOString();
    state.updatedAt = state.queueUpdatedAt;
    await writeState(state);

    sendJson(res, 200, { ok: true, ...queueState, updatedAt: state.queueUpdatedAt });
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

  if (req.method === "GET" && url.pathname === "/api/music/account") {
    const account = await getNcmAccount();
    sendJson(res, 200, { ok: true, ...account });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/music/playlists") {
    const account = await getNcmAccount();
    const uid = url.searchParams.get("uid") || account.userId || "";
    const limit = clampNumber(url.searchParams.get("limit"), 30, 1, 50);
    const offset = clampNumber(url.searchParams.get("offset"), 0, 0, 5000);

    if (!uid) {
      sendJson(res, 400, { ok: false, error: "需要网易云用户 ID" });
      return;
    }

    const playlists = await getUserPlaylists(uid, limit, offset);
    sendJson(res, 200, { ok: true, uid: String(uid), playlists, limit, offset });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/music/playlist-tracks") {
    const id = url.searchParams.get("id") || "";
    const limit = clampNumber(url.searchParams.get("limit"), 30, 1, 50);
    const offset = clampNumber(url.searchParams.get("offset"), 0, 0, 5000);

    if (!id) {
      sendJson(res, 400, { ok: false, error: "需要歌单 ID" });
      return;
    }

    const tracks = await getPlaylistTracks(id, limit, offset);
    sendJson(res, 200, {
      ok: true,
      id,
      tracks,
      limit,
      offset,
      source: getTrackSource(tracks),
      playableCount: tracks.filter((track) => track.playable).length,
      blockedCount: tracks.filter((track) => !track.playable).length,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/music/stream") {
    await streamNcmTrack(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody(req);
    const message = String(body.message || "").trim();
    const conversation = normalizeConversationMessages(body.conversation);
    const mode = normalizeChatMode(body.mode);
    const limit = normalizeRecommendationLimit(body.limit, mode);
    const clientContext = normalizeClientContext(body.clientContext);

    if (!message) {
      sendJson(res, 400, { ok: false, error: "message is required" });
      return;
    }

    const payload = await createDjChatResponse(message, conversation, { mode, limit, clientContext });
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/stream") {
    const body = await readJsonBody(req);
    const message = String(body.message || "").trim();
    const conversation = normalizeConversationMessages(body.conversation);
    const mode = normalizeChatMode(body.mode);
    const limit = normalizeRecommendationLimit(body.limit, mode);
    const clientContext = normalizeClientContext(body.clientContext);

    if (!message) {
      sendJson(res, 400, { ok: false, error: "message is required" });
      return;
    }

    await streamDjChatResponse(res, message, conversation, { mode, limit, clientContext });
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

  if (req.method === "GET" && url.pathname === "/api/taste/library") {
    const state = await readState();
    const tracks = normalizeLikedLibrary(state.tasteProfile?.likedLibrary || []);

    if (tracks.length !== (state.tasteProfile?.likedLibrary || []).length) {
      state.tasteProfile.likedLibrary = tracks;
      state.updatedAt = new Date().toISOString();
      await writeState(state);
    }

    sendJson(res, 200, { ok: true, tracks, count: tracks.length });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/taste/library") {
    const body = await readJsonBody(req);
    const tracks = Array.isArray(body.tracks) ? body.tracks : [];
    const state = await readState();
    const normalized = normalizeLikedLibrary(tracks);

    state.tasteProfile.likedLibrary = dedupeTracks(normalized).slice(0, MAX_LIKED_LIBRARY);
    state.tasteProfile.liked = dedupeTracks([
      ...state.tasteProfile.liked,
      ...normalized.map(compactTrack),
    ]).slice(-120);
    state.updatedAt = new Date().toISOString();
    await writeState(state);

    sendJson(res, 200, {
      ok: true,
      likedLibraryCount: state.tasteProfile.likedLibrary.length,
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

async function streamDjChatResponse(res, message, conversation, requestOptions = {}) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const mode = normalizeChatMode(requestOptions.mode);
  const limit = normalizeRecommendationLimit(requestOptions.limit, mode);
  const assistantPrefix =
    mode === "playlist"
      ? "收到，我会按你的本地听歌偏好生成 30 首歌单。\n\n"
      : "收到，我会按这轮对话和你的本地听歌偏好来选歌。\n\n";

  try {
    writeStreamEvent(res, "status", { text: "读取本地对话和听歌偏好" });
    await streamTextDeltas(res, assistantPrefix, 18);

    const payload = await createDjChatResponse(message, conversation, {
      assistantPrefix,
      mode,
      limit,
      clientContext: requestOptions.clientContext,
      onStatus: (text) => writeStreamEvent(res, "status", { text }),
    });

    await streamTextDeltas(res, payload.assistantText.slice(assistantPrefix.length), 14);
    writeStreamEvent(res, "result", payload);
  } catch (error) {
    writeStreamEvent(res, "error", {
      error: error instanceof Error ? error.message : "Unknown chat stream error",
    });
  } finally {
    res.end();
  }
}

async function createDjChatResponse(message, conversation = [], options = {}) {
  const mode = normalizeChatMode(options.mode);
  const limit = normalizeRecommendationLimit(options.limit, mode);
  const state = await readState();
  const clientContext = normalizeClientContext(options.clientContext);
  const tasteContext = await buildTasteContext(state, conversation, clientContext);
  await options.onStatus?.("生成 DJ 推荐计划");

  const plan = await createDjPlan(message, state, tasteContext, clientContext);
  await options.onStatus?.("匹配可播放歌曲");

  let tracks = await resolveRecommendedTracks(plan, state, limit, { tasteContext, clientContext, mode });
  if (!tracks.length) {
    const recommendationContext = buildRecommendationFilterContext(state, tasteContext);
    tracks = await searchMusic(plan.search, limit, {
      playableOnly: false,
      forRecommendation: true,
      recommendationContext,
    });
  }

  const selected = tracks.find((track) => track.playable) || tracks[0] || null;
  const assistantText = `${options.assistantPrefix || ""}${buildDjReply(plan, tracks, { mode, limit })}`;
  const now = new Date().toISOString();

  state.messages.push({ role: "user", text: message, at: now });
  state.messages.push({ role: "assistant", text: assistantText, at: now });
  state.messages = normalizeConversationMessages(state.messages, 40);
  state.now = selected
    ? {
        ...selected,
        reason: plan.reason,
        say: plan.say,
        mood: plan.mood,
        startedAt: now,
      }
    : null;
  state.updatedAt = now;
  await writeState(state);

  await options.onStatus?.("完成");

  return {
    ok: true,
    mode,
    limit,
    plan,
    tracks,
    assistantText,
    tasteContext: summarizeTasteContext(tasteContext),
    source: {
      brain: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
      music: getTrackSource(tracks),
    },
  };
}

function buildDjReply(plan, tracks, options = {}) {
  const mode = normalizeChatMode(options.mode);
  const playableCount = tracks.filter((track) => track.playable && track.url).length;
  const examples = tracks
    .slice(0, mode === "playlist" ? 5 : CHAT_RECOMMENDATION_LIMIT)
    .map((track) => [track.title, track.artist].filter(Boolean).join(" - "))
    .filter(Boolean);

  const lines = [
    plan.say || "已生成推荐",
    plan.reason || "我按你的请求和本地品味数据整理了一组可播放方向。",
  ];

  if (playableCount) {
    lines.push(
      mode === "playlist"
        ? `已生成 ${playableCount} 首可播放歌曲，会替换右侧当前播放列表。`
        : `找到 ${playableCount} 首可添加到队列的歌。`,
    );
  } else {
    lines.push("这轮没有找到可直接播放的链接，结果里可能受版权、地区或账号权限限制。");
  }

  if (examples.length) {
    lines.push(`先从 ${examples.join(" / ")} 开始。`);
  }

  return lines.join("\n");
}

function summarizeTasteContext(tasteContext) {
  return {
    likedCount: tasteContext.tasteProfile?.likedLibrary?.length || 0,
    profileLikedSongCount: tasteContext.profileLikedSongCount || 0,
    recentPlayCount: tasteContext.recentPlays?.length || 0,
    distilledProfile: Boolean(tasteContext.distilledProfile?.summary),
    recentMessageCount: tasteContext.recentMessages?.length || 0,
    clientContext: tasteContext.clientContext || {},
  };
}

function writeStreamEvent(res, type, payload = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`${JSON.stringify({ type, ...payload })}\n`);
}

async function streamTextDeltas(res, text, chunkSize = 12) {
  for (let index = 0; index < text.length; index += chunkSize) {
    if (res.destroyed || res.writableEnded) return;
    writeStreamEvent(res, "delta", { text: text.slice(index, index + chunkSize) });
    await delay(14);
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function createDjPlan(message, state, tasteContext, clientContext = {}) {
  return createProfilePlan(message, state, tasteContext, clientContext);
}

async function createDeepSeekPlan(message, tasteContext) {
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
            tasteContext,
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

async function createOpenAiPlan(message, tasteContext) {
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
        tasteContext,
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

function createProfilePlan(message, state, tasteContext, clientContext = {}) {
  const scene = buildRecommendationScene(message, clientContext);
  const mood = scene.mood;
  const recent = state.plays.slice(-4).map((play) => play.title).filter(Boolean).join(" / ");
  const baseReason = [
    scene.timeSlotLabel,
    scene.isWeekend ? "weekend" : "weekday",
    clientContext.weather || "",
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    say: mood === "energy" ? "从你的收藏里提速" : mood === "sleep" ? "从你的收藏里降噪" : "按你的收藏重排",
    reason: recent
      ? `优先从喜欢歌单选歌，并避开最近的 ${recent}。${baseReason}`
      : `优先从喜欢歌单选歌，再少量加入相似新歌。${baseReason}`,
    mood,
    search: scene.keywords[0] || "liked-library",
    seedQueries: scene.keywords.map((query, index) => ({
      query,
      intent: "local-profile-scoring",
      weight: Math.max(1, scene.keywords.length - index),
    })),
    queue: scene.keywords,
    avoid: [],
    voice: false,
    scene,
  };
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

async function buildTasteContext(state, conversation = [], clientContext = {}) {
  const distilledProfile = await readListeningProfile();
  const profileLikedSongs = Array.isArray(distilledProfile?.allLikedSongs) ? distilledProfile.allLikedSongs : [];
  const likedLibrary = dedupeTracks([
    ...(state.tasteProfile?.likedLibrary || []),
    ...(state.tasteProfile?.liked || []),
    ...profileLikedSongs.map(profileSongToCompactTrack),
  ]).slice(-160);
  const recentMessages = [
    ...normalizeConversationMessages(state.messages || []),
    ...normalizeConversationMessages(conversation),
  ].slice(-12);

  return {
    tasteProfile: {
      tags: state.tasteProfile?.tags || [],
      liked: summarizeTracks(state.tasteProfile?.liked || [], 40),
      likedLibrary: summarizeTracks(likedLibrary, 60),
      disliked: summarizeTracks(state.tasteProfile?.disliked || [], 40),
    },
    recentPlays: summarizeTracks(state.plays || [], 40).reverse(),
    currentQueue: summarizeTracks(state.queue || [], 30),
    nowPlaying: state.now ? compactTrack(state.now) : null,
    recentMessages,
    distilledProfile,
    profileLikedSongCount: profileLikedSongs.length,
    clientContext,
  };
}

async function resolveRecommendedTracks(plan, state, limit = CHAT_RECOMMENDATION_LIMIT, options = {}) {
  const recommendationContext = buildRecommendationFilterContext(state, options.tasteContext);
  const profileTracks = await resolveProfileRecommendedTracks(plan, state, limit, {
    ...options,
    recommendationContext,
  });

  if (profileTracks.length >= limit) return profileTracks.slice(0, limit);

  const fallbackTracks = await resolveSearchRecommendedTracks(plan, state, limit - profileTracks.length, {
    ...options,
    recommendationContext,
  });
  const merged = dedupeRecommendedTracks([...profileTracks, ...fallbackTracks], recommendationContext);

  return merged.slice(0, limit);
}

async function resolveProfileRecommendedTracks(plan, state, limit, options = {}) {
  const profile = options.tasteContext?.distilledProfile || {};
  const profileSongs = normalizeProfileSongs(profile.allLikedSongs);
  if (!profileSongs.length) return [];

  const scene = plan.scene || buildRecommendationScene(plan.search || "", options.clientContext || {});
  const recommendationContext = options.recommendationContext || buildRecommendationFilterContext(state, options.tasteContext);
  const recentIds = new Set((state.plays || []).slice(-50).map((track) => String(track.id || "")).filter(Boolean));
  const currentQueueIds = new Set((state.queue || []).map((track) => String(track.id || "")).filter(Boolean));
  const likedIds = new Set(profileSongs.map((song) => String(song.id)).filter(Boolean));
  const similarTarget = limit >= 3 ? Math.max(1, Math.floor(limit * (1 - PROFILE_RECOMMENDATION_LIKED_RATIO))) : 0;
  const likedTarget = Math.max(1, limit - similarTarget);
  const rankedSongs = rankProfileSongs(profileSongs, {
    scene,
    plan,
    state,
    recentIds,
    currentQueueIds,
  }).slice(0, PROFILE_RECOMMENDATION_CANDIDATE_LIMIT);
  const likedTracks = await enrichProfileSongCandidates(
    rankedSongs,
    likedTarget,
    state,
    recommendationContext,
  );
  const tracks = [...likedTracks];

  if (similarTarget > 0 && likedTracks.length) {
    const similarSeeds = likedTracks
      .slice(0, Math.max(NCM_SIMILAR_SEED_LIMIT, Math.ceil(similarTarget / 2)))
      .map((track) => ({ id: track.id, title: track.title, artist: track.artist, provider: "netease" }));
    const similarTracks = await getSimilarTracks(similarSeeds, similarTarget, recommendationContext, {
      excludedIds: likedIds,
    });

    for (const track of similarTracks) {
      if (tracks.length >= limit) break;
      if (shouldRejectRecommendationTrack(track, state, recommendationContext)) continue;
      if (tracks.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (hasKnownTitleDuplicate(tracks, track, recommendationContext)) continue;
      tracks.push({ ...track, recommendSource: "similar-song" });
    }
  }

  if (tracks.length < limit) {
    const extraLiked = await enrichProfileSongCandidates(
      rankedSongs.slice(likedTarget),
      limit - tracks.length,
      state,
      recommendationContext,
      new Set(tracks.map((track) => String(track.id))),
    );
    tracks.push(...extraLiked);
  }

  return dedupeRecommendedTracks(tracks, recommendationContext).slice(0, limit);
}

function rankProfileSongs(songs, context) {
  const seed = buildDailySeed(context.scene);

  return songs
    .map((song) => ({
      song,
      score: scoreProfileSong(song, context) + seededJitter(`${seed}:${song.id}`),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ song }) => song);
}

function scoreProfileSong(song, { scene, plan, recentIds, currentQueueIds }) {
  const text = normalizeSearchText(
    `${song.title} ${song.artist} ${song.album} ${(song.styleTags || []).join(" ")}`,
  );
  const keywordMatches = scene.keywords.reduce((score, keyword) => {
    const normalized = normalizeSearchText(keyword);
    return score + (normalized && text.includes(normalized) ? 16 : 0);
  }, 0);
  const styleMatches = scene.styleHints.reduce((score, hint) => {
    const normalized = normalizeSearchText(hint);
    return score + (normalized && text.includes(normalized) ? 10 : 0);
  }, 0);
  const recentPenalty = recentIds.has(String(song.id)) ? -28 : 0;
  const queuePenalty = currentQueueIds.has(String(song.id)) ? -18 : 0;
  const playScore = Math.log1p(Number(song.allTimePlayCount || 0)) * 8 + Number(song.weeklyPlayCount || 0) * 5;
  const addedScore = scoreAddedAt(song.addedAt);
  const eraScore = scoreEra(song, scene);
  const moodScore = scoreMoodFit(song, scene);
  const requestBoost = plan.search && text.includes(normalizeSearchText(plan.search)) ? 14 : 0;

  return 50 + keywordMatches + styleMatches + playScore + addedScore + eraScore + moodScore + requestBoost + recentPenalty + queuePenalty;
}

async function enrichProfileSongCandidates(songs, limit, state, recommendationContext, excludedIds = new Set()) {
  const tracks = [];
  const candidates = songs.filter((song) => song.id && !excludedIds.has(String(song.id)));

  for (const batch of chunkArray(candidates, 12)) {
    const enriched = await Promise.allSettled(batch.map(enrichProfileSong));

    for (const result of enriched) {
      if (tracks.length >= limit) break;
      if (result.status !== "fulfilled" || !result.value) continue;
      const track = result.value;
      if (!track.playable || !isReasonableRecommendationTrack(track)) continue;
      if (shouldRejectRecommendationTrack(track, state, recommendationContext)) continue;
      if (tracks.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (hasKnownTitleDuplicate(tracks, track, recommendationContext)) continue;
      tracks.push({ ...track, recommendSource: "liked-library" });
    }

    if (tracks.length >= limit) break;
  }

  return tracks.slice(0, limit);
}

async function enrichProfileSong(song) {
  const details = await getSongUrlDetails(song.id);
  const playable = Boolean(details?.url);

  return {
    id: String(song.id || ""),
    provider: "netease",
    title: String(song.title || ""),
    artist: String(song.artist || ""),
    album: String(song.album || ""),
    cover: normalizeImageUrl(song.cover || ""),
    duration: normalizeNumber(song.durationMs || song.duration),
    fee: song.fee ?? 0,
    url: playable ? `/api/music/stream?id=${encodeURIComponent(song.id)}` : "",
    playable,
    playState: playable ? "playable" : "blocked",
    blockReason: playable ? "" : details?.message || "版权或账号权限限制",
    br: details?.br || 0,
    sourceCode: details?.code || 0,
    tags: Array.isArray(song.styleTags) ? song.styleTags.slice(0, 12) : [],
  };
}

async function resolveSearchRecommendedTracks(plan, state, limit = CHAT_RECOMMENDATION_LIMIT, options = {}) {
  const queries = getPlanQueries(plan);
  const tracks = [];
  const recommendationContext = options.recommendationContext || buildRecommendationFilterContext(state, options.tasteContext);
  const perQueryLimit = limit >= PLAYLIST_RECOMMENDATION_LIMIT ? 6 : CHAT_RECOMMENDATION_LIMIT;

  for (const query of queries) {
    if (tracks.length >= limit) break;
    const found = await searchMusic(query, perQueryLimit, {
      playableOnly: true,
      forRecommendation: true,
      recommendationContext,
    });
    for (const track of found) {
      if (tracks.length >= limit) break;
      if (shouldRejectRecommendationTrack(track, state, recommendationContext)) continue;
      tracks.push({ ...track, recommendQuery: query });
    }
  }

  const deduped = dedupeRecommendedTracks(tracks, recommendationContext);
  if (deduped.length >= limit) return deduped.slice(0, limit);

  for (const query of queries) {
    if (deduped.length >= limit) break;
    const found = await searchMusic(query, perQueryLimit, {
      playableOnly: true,
      forRecommendation: true,
      recommendationContext,
    });
    for (const track of found) {
      if (deduped.length >= limit) break;
      if (shouldRejectRecommendationTrack(track, state, recommendationContext)) continue;
      if (deduped.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (hasKnownTitleDuplicate(deduped, track, recommendationContext)) continue;
      deduped.push({ ...track, recommendQuery: query });
    }
  }

  if (deduped.length < limit) {
    const dailyTracks = await getDailyRecommendedTracks(limit - deduped.length, recommendationContext);
    for (const track of dailyTracks) {
      if (deduped.length >= limit) break;
      if (shouldRejectRecommendationTrack(track, state, recommendationContext)) continue;
      if (deduped.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (hasKnownTitleDuplicate(deduped, track, recommendationContext)) continue;
      deduped.push({ ...track, recommendQuery: "netease-daily" });
    }
  }

  return deduped.slice(0, limit);
}

function shouldRejectRecommendationTrack(track, state, recommendationContext) {
  return isDislikedCandidate(track, state) || isUnfamiliarSameTitleCollision(track, recommendationContext);
}

function buildRecommendationFilterContext(state, tasteContext = {}) {
  const context = {
    familiarArtists: new Set(),
    knownTitleArtists: new Map(),
  };

  const addArtist = (artist) => addKnownArtist(context, artist);
  const addTrack = (track) => {
    if (!track || typeof track !== "object") return;
    for (const artist of splitArtistNames(track.artist || track.artists || track.name)) {
      addArtist(artist);
    }

    const title = normalizeSearchText(track.title || track.song || "");
    if (!title || !track.artist) return;

    if (!context.knownTitleArtists.has(title)) context.knownTitleArtists.set(title, new Set());
    const artists = context.knownTitleArtists.get(title);
    for (const artist of splitArtistNames(track.artist)) {
      addArtistToSet(artists, artist);
      addArtist(artist);
    }
  };

  for (const track of [
    ...(state.tasteProfile?.likedLibrary || []),
    ...(state.tasteProfile?.liked || []),
    ...(state.plays || []),
  ]) {
    addTrack(track);
  }

  for (const track of [
    ...(tasteContext.tasteProfile?.likedLibrary || []),
    ...(tasteContext.tasteProfile?.liked || []),
    ...(tasteContext.recentPlays || []),
  ]) {
    addTrack(track);
  }

  collectListeningProfileSignals(tasteContext.distilledProfile, context);

  return context;
}

function collectListeningProfileSignals(value, context, depth = 0) {
  if (!value || depth > 5) return;

  if (Array.isArray(value)) {
    for (const item of value) collectListeningProfileSignals(item, context, depth + 1);
    return;
  }

  if (typeof value !== "object") return;

  if (value.artist) addKnownArtist(context, value.artist);
  if (value.name && (value.likedTrackCount || value.allTimePlayCount || value.playCount)) {
    addKnownArtist(context, value.name);
  }

  if (value.title && value.artist) {
    const title = normalizeSearchText(value.title);
    if (title) {
      if (!context.knownTitleArtists.has(title)) context.knownTitleArtists.set(title, new Set());
      const artists = context.knownTitleArtists.get(title);
      for (const artist of splitArtistNames(value.artist)) addArtistToSet(artists, artist);
    }
  }

  for (const item of Object.values(value)) {
    collectListeningProfileSignals(item, context, depth + 1);
  }
}

function addKnownArtist(context, artist) {
  for (const name of splitArtistNames(artist)) {
    addArtistToSet(context.familiarArtists, name);
  }
}

function addArtistToSet(set, artist) {
  const normalized = normalizeSearchText(artist);
  if (!normalized) return;
  set.add(normalized);

  const withoutBandSuffix = normalized.replace(/乐团$/, "");
  if (withoutBandSuffix && withoutBandSuffix !== normalized) set.add(withoutBandSuffix);
}

function splitArtistNames(value) {
  return String(value || "")
    .split(/\s*(?:\/|,|，|、|&|＆|\+| feat\.? | ft\.? | with )\s*/i)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function dedupeRecommendedTracks(tracks, recommendationContext) {
  const seenIdentities = new Set();
  const result = [];

  for (const track of tracks) {
    const identity = trackIdentity(track);
    if (seenIdentities.has(identity)) continue;
    if (hasKnownTitleDuplicate(result, track, recommendationContext)) continue;

    seenIdentities.add(identity);
    result.push(track);
  }

  return result;
}

function hasKnownTitleDuplicate(tracks, candidate, recommendationContext) {
  const title = normalizeSearchText(candidate?.title);
  if (!title || !findKnownArtistsForTitle(title, recommendationContext)) return false;
  return tracks.some((track) => normalizeSearchText(track.title) === title);
}

function isUnfamiliarSameTitleCollision(track, recommendationContext) {
  if (!recommendationContext) return false;

  const title = normalizeSearchText(track?.title);
  if (!title) return false;

  const expectedArtists = findKnownArtistsForTitle(title, recommendationContext);
  if (!expectedArtists) return false;

  const candidateArtists = splitArtistNames(track.artist).map(normalizeSearchText).filter(Boolean);
  if (candidateArtists.some((artist) => artistMatchesAny(artist, expectedArtists))) return false;
  if (candidateArtists.some((artist) => artistMatchesAny(artist, recommendationContext.familiarArtists))) return false;

  return true;
}

function findKnownArtistsForTitle(title, recommendationContext) {
  if (!recommendationContext?.knownTitleArtists) return null;
  if (recommendationContext.knownTitleArtists.has(title)) return recommendationContext.knownTitleArtists.get(title);

  for (const [knownTitle, artists] of recommendationContext.knownTitleArtists.entries()) {
    if (knownTitle.length < 4) continue;
    if (title.includes(knownTitle) || knownTitle.includes(title)) return artists;
  }

  return null;
}

function artistMatchesAny(artist, artistSet) {
  if (!artist || !artistSet?.size) return false;
  if (artistSet.has(artist)) return true;

  for (const knownArtist of artistSet) {
    if (knownArtist.length >= 4 && (artist.includes(knownArtist) || knownArtist.includes(artist))) return true;
  }

  return false;
}

function getPlanQueries(plan) {
  const queries = [];
  if (Array.isArray(plan.seedQueries)) {
    for (const item of plan.seedQueries) {
      const query = typeof item === "string" ? item : item?.query;
      if (query) queries.push(String(query));
    }
  }

  if (Array.isArray(plan.queue)) queries.push(...plan.queue.map(String));
  if (plan.search) queries.push(String(plan.search));

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 12);
}

function isDislikedCandidate(track, state) {
  const disliked = state.tasteProfile?.disliked || [];
  const candidate = normalizeSearchText(`${track.title} ${track.artist}`);
  return disliked.some((item) => {
    if (item.id && track.id && String(item.id) === String(track.id)) return true;
    const dislikedText = normalizeSearchText(`${item.title} ${item.artist}`);
    return dislikedText && candidate.includes(dislikedText);
  });
}

function buildRecommendationScene(message, clientContext = {}) {
  const text = normalizeSearchText(message);
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6 || /周末|weekend/i.test(clientContext.weekend || "");
  const weather = String(clientContext.weather || "");
  const weatherText = normalizeSearchText(weather);
  const keywords = new Set();
  const styleHints = new Set();
  let mood = "random";

  if (containsAny(text, ["睡", "晚安", "助眠", "sleep", "relax", "放松"])) mood = "sleep";
  else if (containsAny(text, ["工作", "学习", "专注", "写代码", "coding", "focus", "阅读"])) mood = "focus";
  else if (containsAny(text, ["提神", "跑步", "运动", "蹦迪", "dj", "energy", "high"])) mood = "energy";
  else if (containsAny(text, ["开车", "通勤", "路上", "drive"])) mood = "chill";

  if (mood === "random") {
    if (hour < 6 || hour >= 23) mood = "sleep";
    else if (!isWeekend && hour >= 9 && hour <= 18) mood = "focus";
    else if (isWeekend && hour >= 12 && hour <= 21) mood = "energy";
    else mood = "chill";
  }

  if (mood === "focus") addMany(keywords, ["focus", "lofi", "instrumental", "jazz", "ambient"]);
  if (mood === "sleep") addMany(keywords, ["sleep", "ambient", "piano", "jazz", "acoustic"]);
  if (mood === "energy") addMany(keywords, ["disco", "electronic", "dance", "funk", "city pop"]);
  if (mood === "chill") addMany(keywords, ["chill", "city pop", "jazz", "r&b", "drive"]);

  if (containsAny(text, ["8bit", "像素", "chiptune"])) addMany(keywords, ["8-bit", "chiptune"]);
  if (containsAny(text, ["复古", "disco", "citypop", "citypop"])) addMany(keywords, ["retro", "disco", "city pop"]);
  if (containsAny(text, ["爵士", "jazz"])) addMany(keywords, ["jazz"]);
  if (containsAny(text, ["国漫", "acg", "动画", "二次元", "日语"])) addMany(keywords, ["ACG", "anime", "日语"]);

  if (containsAny(weatherText, ["雨", "雪", "阴", "云", "cloud", "rain"])) {
    addMany(keywords, ["chill", "jazz", "ambient"]);
    addMany(styleHints, ["soft", "instrumental"]);
  }
  if (containsAny(weatherText, ["晴", "sun", "clear"])) {
    addMany(keywords, ["city pop", "funk", "disco"]);
  }

  if (!isWeekend && hour >= 9 && hour <= 18) addMany(styleHints, ["instrumental", "ambient", "lofi"]);
  if (isWeekend) addMany(styleHints, ["retro", "dance", "ACG"]);

  for (const token of extractRequestKeywords(message)) keywords.add(token);

  return {
    mood,
    keywords: [...keywords].slice(0, 16),
    styleHints: [...styleHints].slice(0, 12),
    hour,
    isWeekend,
    weather,
    timeSlot: getTimeSlot(hour),
    timeSlotLabel: getTimeSlotLabel(hour),
  };
}

function normalizeClientContext(value = {}) {
  return {
    date: String(value.date || "").slice(0, 40),
    weekend: String(value.weekend || "").slice(0, 40),
    weather: String(value.weather || "").slice(0, 80),
    timezoneOffset: Number.isFinite(Number(value.timezoneOffset)) ? Number(value.timezoneOffset) : null,
  };
}

function normalizeProfileSongs(songs) {
  return Array.isArray(songs)
    ? songs
        .map((song) => ({
          id: String(song?.id || ""),
          title: String(song?.title || ""),
          artist: String(song?.artist || ""),
          album: String(song?.album || ""),
          cover: String(song?.cover || ""),
          durationMs: normalizeNumber(song?.durationMs || song?.duration),
          fee: song?.fee ?? 0,
          styleTags: Array.isArray(song?.styleTags) ? song.styleTags.map(String).filter(Boolean) : [],
          primaryStyle: String(song?.primaryStyle || ""),
          publishYear: normalizeNumber(song?.publishYear),
          addedAt: normalizeNumber(song?.addedAt),
          allTimePlayCount: normalizeNumber(song?.allTimePlayCount),
          weeklyPlayCount: normalizeNumber(song?.weeklyPlayCount),
          allTimeScore: normalizeNumber(song?.allTimeScore),
          weeklyScore: normalizeNumber(song?.weeklyScore),
          rankInLikedPlaylist: normalizeNumber(song?.rankInLikedPlaylist),
        }))
        .filter((song) => song.id && song.title)
    : [];
}

function profileSongToCompactTrack(song) {
  return {
    id: String(song?.id || ""),
    provider: "netease",
    title: String(song?.title || ""),
    artist: String(song?.artist || ""),
    album: String(song?.album || ""),
    cover: String(song?.cover || ""),
    duration: normalizeNumber(song?.durationMs || song?.duration),
    tags: Array.isArray(song?.styleTags) ? song.styleTags.slice(0, 12).map(String) : [],
  };
}

function scoreAddedAt(timestamp) {
  if (!timestamp) return 0;
  const ageDays = (Date.now() - timestamp) / 86400000;
  if (ageDays <= 14) return 12;
  if (ageDays <= 90) return 7;
  if (ageDays <= 365) return 3;
  return 0;
}

function scoreEra(song, scene) {
  const year = Number(song.publishYear || 0);
  if (!year) return 0;
  if (scene.isWeekend && year >= 1980 && year < 2010) return 5;
  if (scene.mood === "focus" && year >= 2010) return 2;
  return 0;
}

function scoreMoodFit(song, scene) {
  const text = normalizeSearchText(`${song.title} ${song.artist} ${song.album} ${(song.styleTags || []).join(" ")}`);
  let score = 0;

  if (scene.mood === "focus") {
    if (containsAny(text, ["instrumental", "ambient", "lofi", "jazz", "纯音乐", "钢琴"])) score += 14;
    if (containsAny(text, ["dj", "dance", "disco", "rock"])) score -= 4;
  }
  if (scene.mood === "sleep") {
    if (containsAny(text, ["ambient", "piano", "jazz", "acoustic", "治愈", "浪漫"])) score += 14;
    if (containsAny(text, ["dj", "dance", "disco", "metal", "rock"])) score -= 12;
  }
  if (scene.mood === "energy") {
    if (containsAny(text, ["electronic", "dance", "disco", "funk", "groove", "citypop", "citypop"])) score += 14;
  }
  if (scene.mood === "chill") {
    if (containsAny(text, ["chill", "jazz", "citypop", "rnb", "r&b", "ambient", "drive"])) score += 10;
  }

  return score;
}

function extractRequestKeywords(message) {
  return String(message || "")
    .split(/[\s,，。.!?！？、/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 24)
    .slice(0, 8);
}

function buildDailySeed(scene) {
  return `${new Date().toISOString().slice(0, 10)}:${scene.timeSlot}:${scene.weather}:${scene.mood}`;
}

function seededJitter(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff * 8;
}

function getTimeSlot(hour) {
  if (hour < 6) return "late-night";
  if (hour < 11) return "morning";
  if (hour < 14) return "noon";
  if (hour < 18) return "afternoon";
  if (hour < 23) return "evening";
  return "late-night";
}

function getTimeSlotLabel(hour) {
  const slot = getTimeSlot(hour);
  return {
    "late-night": "late night",
    morning: "morning",
    noon: "noon",
    afternoon: "afternoon",
    evening: "evening",
  }[slot];
}

function addMany(target, values) {
  for (const value of values) target.add(value);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function summarizeTracks(tracks, limit) {
  return (Array.isArray(tracks) ? tracks : []).slice(-limit).map(compactTrack);
}

async function searchMusic(query, limit = 6, options = {}) {
  if (NCM_API_BASE) {
    try {
      if (options.forRecommendation) {
        return await searchRecommendationMusic(query, limit, options);
      }

      const playableOnly = Boolean(options.playableOnly);
      const searchLimit = playableOnly ? Math.max(limit * 8, 48) : Math.max(limit * 3, 24);
      const data = await searchNcmSongs(query, searchLimit);
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
      if (options.forRecommendation) return [];
    }
  }

  return selectDemoTracks(query, limit);
}

async function searchNcmSongs(query, limit) {
  const params = {
    keywords: query,
    limit,
    type: 1,
    timestamp: Date.now(),
  };

  try {
    return await ncmFetch("/cloudsearch", params);
  } catch (error) {
    console.warn("Netease cloudsearch failed, falling back to /search:", error.message);
    return ncmFetch("/search", params);
  }
}

async function searchRecommendationMusic(query, limit = 6, options = {}) {
  const profile = analyzeRecommendationQuery(query);
  const recommendationContext = options.recommendationContext || null;
  const searchLimit = Math.max(limit * 10, 60);
  const data = await searchNcmSongs(query, searchLimit);
  const suggestedSongs = await getNcmSuggestedSongs(query);
  const multimatchSongs = await getNcmMultimatchSongs(query);
  const songs = dedupeSongs([...(data?.result?.songs || []), ...suggestedSongs, ...multimatchSongs]);
  const ranked = rankNcmSongs(query, songs, profile);
  const relevant = filterRecommendationSongs(ranked, profile);
  const probeLimit = Math.min(relevant.length, Math.max(limit * 8, NCM_SEARCH_PROBE_LIMIT));
  const enriched = await enrichNcmTracks(relevant.slice(0, probeLimit));
  const blockedSeeds = enriched.filter((track) => !track.playable).slice(0, NCM_SIMILAR_SEED_LIMIT);
  const tracks = enriched
    .filter((track) => track.playable && isReasonableRecommendationTrack(track))
    .filter((track) => !isUnfamiliarSameTitleCollision(track, recommendationContext))
    .slice(0, limit);

  if (tracks.length < limit && blockedSeeds.length) {
    const similar = await getSimilarTracks(blockedSeeds, limit - tracks.length, recommendationContext);
    for (const track of similar) {
      if (tracks.length >= limit) break;
      if (tracks.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (isUnfamiliarSameTitleCollision(track, recommendationContext)) continue;
      if (hasKnownTitleDuplicate(tracks, track, recommendationContext)) continue;
      tracks.push({ ...track, recommendQuery: `${query} / simi` });
    }
  }

  if (tracks.length < limit && !profile.hasAnchors && !options.playableOnly) {
    const fallback = enriched
      .filter((track) => isReasonableRecommendationTrack(track))
      .filter((track) => !isUnfamiliarSameTitleCollision(track, recommendationContext))
      .slice(0, limit - tracks.length);
    tracks.push(...fallback);
  }

  return tracks.slice(0, limit);
}

async function getNcmSuggestedSongs(query) {
  try {
    const data = await ncmFetch("/search/suggest", {
      keywords: query,
      timestamp: Date.now(),
    });
    return data?.result?.songs || [];
  } catch (error) {
    console.warn("Netease search suggest failed:", error.message);
    return [];
  }
}

async function getNcmMultimatchSongs(query) {
  try {
    const data = await ncmFetch("/search/multimatch", {
      keywords: query,
      timestamp: Date.now(),
    });
    return data?.result?.songs || [];
  } catch (error) {
    console.warn("Netease search multimatch failed:", error.message);
    return [];
  }
}

async function getSimilarTracks(seedTracks, limit, recommendationContext = null, options = {}) {
  const tracks = [];
  const excludedIds = options.excludedIds || new Set();

  for (const seed of seedTracks) {
    if (tracks.length >= limit) break;
    try {
      const data = await ncmFetch("/simi/song", {
        id: seed.id,
        timestamp: Date.now(),
      });
      const songs = data?.songs || [];
      const enriched = await enrichNcmTracks(songs.slice(0, Math.max(limit * 4, NCM_SEARCH_PROBE_LIMIT)));

      for (const track of enriched) {
        if (tracks.length >= limit) break;
        if (!track.playable || !isReasonableRecommendationTrack(track)) continue;
        if (excludedIds.has(String(track.id))) continue;
        if (isUnfamiliarSameTitleCollision(track, recommendationContext)) continue;
        if (trackIdentity(track) === trackIdentity(seed)) continue;
        if (tracks.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
        if (hasKnownTitleDuplicate(tracks, track, recommendationContext)) continue;
        tracks.push(track);
      }
    } catch (error) {
      console.warn("Netease similar songs failed:", error.message);
    }
  }

  return tracks.slice(0, limit);
}

async function getDailyRecommendedTracks(limit, recommendationContext = null) {
  if (!NCM_API_BASE || limit <= 0) return [];

  try {
    const data = await ncmFetch("/recommend/songs", { timestamp: Date.now() });
    const songs = data?.data?.dailySongs || data?.recommend || [];
    const enriched = await enrichNcmTracks(songs.slice(0, NCM_DAILY_RECOMMEND_LIMIT));
    return enriched
      .filter((track) => track.playable && isReasonableRecommendationTrack(track))
      .filter((track) => !isUnfamiliarSameTitleCollision(track, recommendationContext))
      .slice(0, limit);
  } catch (error) {
    console.warn("Netease daily recommend failed:", error.message);
    return [];
  }
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

async function getNcmAccount() {
  if (!NCM_API_BASE) {
    return { enabled: false, loggedIn: false };
  }

  try {
    const status = await ncmFetch("/login/status", { timestamp: Date.now() });
    const data = status?.data || status || {};
    const profile = data.profile || status?.profile || null;
    const account = data.account || status?.account || null;

    if (!profile && !account) {
      return {
        enabled: true,
        loggedIn: false,
        code: data.code || status?.code || 0,
      };
    }

    return {
      enabled: true,
      loggedIn: true,
      userId: profile?.userId || account?.id || null,
      nickname: profile?.nickname || "",
      avatarUrl: profile?.avatarUrl || "",
      vipType: profile?.vipType || account?.vipType || 0,
    };
  } catch (error) {
    return {
      enabled: true,
      loggedIn: false,
      error: error.message,
    };
  }
}

async function getUserPlaylists(uid, limit, offset) {
  if (!NCM_API_BASE) return [];

  const data = await ncmFetch("/user/playlist", {
    uid,
    limit,
    offset,
    timestamp: Date.now(),
  });

  return (data?.playlist || []).map(mapNcmPlaylist);
}

async function getPlaylistTracks(id, limit, offset) {
  if (!NCM_API_BASE) return selectDemoTracks("playlist", Math.min(limit, DEMO_TRACKS.length));

  const data = await ncmFetch("/playlist/track/all", {
    id,
    limit,
    offset,
    timestamp: Date.now(),
  });

  return enrichNcmTracks(data?.songs || []);
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
  const cover = normalizeImageUrl(album.picUrl || album.coverImgUrl || album.blurPicUrl || "");

  return {
    id: String(song.id),
    provider: "netease",
    title: song.name || "Untitled",
    artist: artists.map((artist) => artist.name).filter(Boolean).join(" / ") || "Unknown",
    album: album.name || "",
    cover,
    duration: song.duration || song.dt || 0,
    fee: song.fee ?? 0,
    url: "",
    playable: false,
    playState: "unknown",
    blockReason: "",
    tags: [],
  };
}

function mapNcmPlaylist(playlist) {
  return {
    id: String(playlist.id || ""),
    name: String(playlist.name || "未命名歌单"),
    cover: normalizeImageUrl(playlist.coverImgUrl || ""),
    trackCount: playlist.trackCount || 0,
    playCount: playlist.playCount || 0,
    creator: playlist.creator?.nickname || "",
    subscribed: Boolean(playlist.subscribed),
    userId: playlist.userId || playlist.creator?.userId || null,
  };
}

function rankNcmSongs(query, songs, profile = analyzeRecommendationQuery(query)) {
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
      if (profile.anchorTokens.length && profile.anchorTokens.every((token) => haystack.includes(token))) score += 900;
      if (profile.anchorTokens.length && profile.anchorTokens.every((token) => artists.includes(token))) score += 700;
      if (isLowSignalTitle(title) && profile.hasAnchors && !profile.anchorTokens.some((token) => artists.includes(token))) {
        score -= 1200;
      }

      return { song, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ song }) => song);
}

function filterRecommendationSongs(songs, profile) {
  return songs.filter((song) => {
    const title = normalizeSearchText(song.name);
    const artists = normalizeSearchText((song.artists || song.ar || []).map((artist) => artist.name).join(" "));
    const album = normalizeSearchText(song.album?.name || song.al?.name || "");
    const haystack = `${title} ${artists} ${album}`;

    if (profile.hasAnchors && !profile.anchorTokens.every((token) => haystack.includes(token))) return false;
    if (profile.hasAnchors && isLowSignalTitle(title) && !profile.anchorTokens.some((token) => artists.includes(token))) {
      return false;
    }

    return true;
  });
}

function analyzeRecommendationQuery(query) {
  const tokens = String(query || "")
    .trim()
    .split(/\s+/)
    .map(normalizeSearchText)
    .filter(Boolean);
  const anchorTokens = tokens.filter((token) => !isQueryModifierToken(token));

  return {
    tokens,
    anchorTokens,
    hasAnchors: anchorTokens.length > 0,
  };
}

function isQueryModifierToken(token) {
  if (QUERY_MODIFIER_TERMS.has(token)) return true;
  return [...QUERY_MODIFIER_TERMS].some((term) => term && (token.includes(term) || term.includes(token)));
}

function isLowSignalTitle(title) {
  return LOW_SIGNAL_TITLE_TERMS.has(title);
}

function isReasonableRecommendationTrack(track) {
  return track.duration <= MAX_RECOMMENDATION_DURATION_MS;
}

function dedupeSongs(songs) {
  const seen = new Set();
  const result = [];

  for (const song of songs) {
    const key = String(song?.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(song);
  }

  return result;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeImageUrl(value) {
  const url = String(value || "");
  if (!url) return "";
  return url.replace(/^http:\/\//i, "https://");
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
    return mergeState(JSON.parse(raw));
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
  const seedQueries = normalizeSeedQueries(plan?.seedQueries, plan?.queue, plan?.search || fallback.search);
  const queue = seedQueries.length
    ? seedQueries.map((item) => item.query)
    : Array.isArray(plan?.queue)
      ? plan.queue.slice(0, 8).map(String)
      : fallback.queue;

  return {
    say: String(plan?.say || fallback.say).slice(0, 60),
    reason: String(plan?.reason || fallback.reason).slice(0, 120),
    mood,
    search: String(plan?.search || queue[0] || fallback.search).slice(0, 60),
    seedQueries,
    queue,
    avoid: Array.isArray(plan?.avoid) ? plan.avoid.slice(0, 12).map(String) : [],
    voice: Boolean(plan?.voice),
  };
}

function normalizeSeedQueries(seedQueries, queue, search) {
  const result = [];
  const add = (query, intent = "", weight = 1) => {
    const normalized = String(query || "").trim().slice(0, 80);
    if (!normalized || result.some((item) => item.query === normalized)) return;
    result.push({
      query: normalized,
      intent: String(intent || "").slice(0, 80),
      weight: Number.isFinite(Number(weight)) ? Number(weight) : 1,
    });
  };

  if (Array.isArray(seedQueries)) {
    for (const item of seedQueries) {
      if (typeof item === "string") add(item);
      else add(item?.query, item?.intent, item?.weight);
    }
  }

  if (Array.isArray(queue)) {
    for (const item of queue) add(item);
  }

  add(search);
  return result.slice(0, 10);
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
    album: String(track.album || ""),
    cover: String(track.cover || ""),
    duration: normalizeNumber(track.duration),
  };
}

function normalizeConversationMessages(messages, limit = 16) {
  return Array.isArray(messages)
    ? messages
        .map((message) => {
          const role = message?.role === "assistant" ? "assistant" : "user";
          const text = String(message?.text || "").trim().slice(0, 1600);
          if (!text) return null;

          return {
            role,
            text,
            at: message?.at ? String(message.at).slice(0, 40) : "",
          };
        })
        .filter(Boolean)
        .slice(-limit)
    : [];
}

function normalizeChatMode(value) {
  return value === "playlist" ? "playlist" : "chat";
}

function normalizeRecommendationLimit(value, mode) {
  const requested = Number(value);
  const fallback = mode === "playlist" ? PLAYLIST_RECOMMENDATION_LIMIT : CHAT_RECOMMENDATION_LIMIT;
  const max = mode === "playlist" ? PLAYLIST_RECOMMENDATION_LIMIT : CHAT_RECOMMENDATION_LIMIT;

  if (!Number.isFinite(requested) || requested <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(requested)));
}

function mergeState(raw) {
  return {
    ...DEFAULT_STATE,
    ...raw,
    tasteProfile: {
      ...DEFAULT_STATE.tasteProfile,
      ...(raw?.tasteProfile || {}),
    },
  };
}

async function readListeningProfile() {
  try {
    const raw = await readFile(LISTENING_PROFILE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    const profile = createEmptyListeningProfile();
    await writeFile(LISTENING_PROFILE_FILE, JSON.stringify(profile, null, 2), "utf8");
    return profile;
  }
}

function createEmptyListeningProfile() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    summary: "",
    styleTags: [],
    preferredArtists: [],
    preferredSongs: [],
    preferredAlbums: [],
    avoidTags: [],
    notes: [
      "把常听歌单发给 Codex 后，可蒸馏到这个文件；服务器会把它作为 AI 推荐的长期品味参考。",
    ],
    sourcePlaylists: [],
  };
}

function dedupeTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    const key = trackIdentity(track);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trackIdentity(track) {
  return `${track?.provider || "unknown"}:${track?.id || track?.title || ""}:${track?.artist || ""}`;
}

function normalizeQueueState(rawQueue, rawCurrentIndex) {
  const queue = Array.isArray(rawQueue)
    ? dedupeTracks(rawQueue.map(normalizeQueueTrack).filter(Boolean)).slice(0, MAX_QUEUE)
    : [];

  let currentIndex = Number.isInteger(rawCurrentIndex) ? rawCurrentIndex : -1;

  if (!queue.length) {
    currentIndex = -1;
  } else if (currentIndex < 0 || currentIndex >= queue.length) {
    currentIndex = queue.findIndex((track) => track.playable && track.url);
  }

  return { queue, currentIndex };
}

function normalizeLikedLibrary(tracks) {
  return Array.isArray(tracks)
    ? dedupeTracks(tracks.map(normalizeQueueTrack).filter(Boolean)).slice(0, MAX_LIKED_LIBRARY)
    : [];
}

function normalizeQueueTrack(track) {
  if (!track || typeof track !== "object") return null;

  const id = String(track.id || "").slice(0, 120);
  const title = String(track.title || "").slice(0, 160);
  const url = String(track.url || "").slice(0, 500);

  if (!id && !title) return null;

  return {
    id,
    provider: String(track.provider || "unknown").slice(0, 40),
    title,
    artist: String(track.artist || "").slice(0, 160),
    album: String(track.album || "").slice(0, 160),
    url,
    cover: String(track.cover || "").slice(0, 500),
    duration: normalizeNumber(track.duration),
    playable: Boolean(track.playable && url),
    playState: String(track.playState || "").slice(0, 40),
    blockReason: String(track.blockReason || "").slice(0, 160),
    br: normalizeNumber(track.br),
    sourceCode: normalizeNumber(track.sourceCode),
    tags: Array.isArray(track.tags) ? track.tags.slice(0, 12).map((tag) => String(tag).slice(0, 40)) : [],
  };
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
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
