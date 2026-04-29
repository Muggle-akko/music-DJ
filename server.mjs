import { createServer } from "node:http";
import { copyFile, readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";

const ROOT = resolve(".");
loadEnvFile(resolve(ROOT, ".env"));

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = resolve(ROOT, "public");
const DATA_DIR = resolve(ROOT, "data");
const STATE_FILE = resolve(DATA_DIR, "state.json");
const STATE_BACKUP_FILE = resolve(DATA_DIR, "state.backup.json");
const LISTENING_PROFILE_FILE = resolve(DATA_DIR, "listening-profile.json");
const TTS_CACHE_DIR = resolve(DATA_DIR, "tts");
let stateWriteQueue = Promise.resolve();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE_URL = trimTrailingSlash(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const AI_PROVIDER = resolveAiProvider();
const NCM_API_BASE = trimTrailingSlash(process.env.NCM_API_BASE || "");
const NCM_COOKIE = process.env.NCM_COOKIE || "";
const FISH_AUDIO_API_KEY = process.env.FISH_AUDIO_API_KEY || process.env.FISH_API_KEY || "";
const FISH_AUDIO_TTS_URL = process.env.FISH_AUDIO_TTS_URL || "https://api.fish.audio/v1/tts";
const FISH_AUDIO_MODEL = process.env.FISH_AUDIO_MODEL || "s2-pro";
const FISH_AUDIO_REFERENCE_ID = process.env.FISH_AUDIO_REFERENCE_ID || process.env.FISH_AUDIO_VOICE_ID || process.env.REFERENCE_ID || "";
const FISH_AUDIO_LATENCY = process.env.FISH_AUDIO_LATENCY || "normal";
const FISH_AUDIO_SPEED = clampFloat(process.env.FISH_AUDIO_SPEED, 1, 0.75, 1.25);
const TTS_PROVIDER = resolveTtsProvider();
const NCM_SEARCH_PROBE_LIMIT = 12;
const NCM_SIMILAR_SEED_LIMIT = 3;
const NCM_DAILY_RECOMMEND_LIMIT = 30;
const MAX_RECOMMENDATION_DURATION_MS = 12 * 60 * 1000;
const MAX_QUEUE = 200;
const MAX_RADIO_HISTORY = 40;
const PROFILE_RECOMMENDATION_LIKED_RATIO = 0.72;
const PROFILE_RECOMMENDATION_CANDIDATE_LIMIT = 1500;
const RADIO_HISTORY_REPEAT_PENALTY_LIMIT = 8;
const NCM_PLAYLIST_SEARCH_LIMIT = 8;
const NCM_PLAYLIST_TRACK_PROBE_LIMIT = 24;
const CHAT_RECOMMENDATION_LIMIT = 5;
const PLAYLIST_RECOMMENDATION_LIMIT = 30;
const HOST_INTRO_COVERAGE_RATIO = 0.6;
const HOST_INTRO_MAX_COUNT = PLAYLIST_RECOMMENDATION_LIMIT;
const HOST_INTRO_MIN_PLAYLIST_SIZE = 3;

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
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".opus": "audio/ogg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const DEFAULT_STATE = {
  tasteProfile: {
    liked: [],
    likedLibrary: [],
    disliked: [],
    negativeFeedback: [],
    scenePreferences: {},
    tags: ["focus", "late-night", "low-vocal"],
  },
  messages: [],
  plays: [],
  queue: [],
  queueCurrentIndex: -1,
  queueUpdatedAt: null,
  radioHistory: [],
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
  "You are Faye, a gentle, cheerful female DJ host inside the Awudio personal web player.",
  "Return only valid JSON. No markdown, no comments.",
  "Schema:",
  '{"intent":"recommend|playlist|music_chat|library_query","say":"Chinese DJ line under 36 chars","reason":"Chinese reason under 90 chars","mood":"focus|chill|energy|sleep|random","search":"best fallback NetEase search keyword","requestedTrackQueries":["exact song title only when listener names a specific song"],"playlistSearchQuery":"optional playlist/theme search keyword","seedQueries":[{"query":"NetEase search keyword","intent":"why this query fits","weight":1}],"queue":["keyword 1","keyword 2"],"avoid":["artist or song to avoid"],"voice":false}',
  "Voice: warm, bright, concise, and lightly hosted like a radio DJ. Do not be overly cute or verbose.",
  "Persona rule: the long-term listening profile is Faye's own DJ taste, distilled from the listener's library. Public copy should say my taste, my library, or my radio instinct; do not frame recommendations as the user's taste or the user's preferences.",
  "Never start with repetitive acknowledgements such as '收到', '好的', '明白', or '我会'.",
  "Do not prefix chat text with 'Faye'. Let the UI carry the speaker identity.",
  "First classify the user intent. Only use recommend/playlist when the user explicitly asks to play, recommend, generate, add, or replace songs.",
  "If the user asks why, how, logic, reason, basis, or asks about the previous recommendation, use music_chat and answer the question. Do not recommend or return songs.",
  "Use music_chat when the user wants to discuss a song, artist, album, style, lyric feeling, or listening impression. Do not turn that into a recommendation.",
  "Use library_query when the listener asks about the liked library or playlists behind Faye's DJ taste, such as recent additions, new releases, top artists, or which songs match a condition. Do not turn that into a recommendation.",
  "For recommend/playlist, analyze current mood/time, liked songs, liked library, recent plays, queue, disliked songs, and Faye's distilled listening profile.",
  "For recommend/playlist, generate 6 to 10 practical NetEase Music search queries. Prefer exact song/artist pairs when known, otherwise artist + style, playlist-friendly Chinese keywords, or mood/genre terms.",
  "When the listener mixes exact songs with a broad theme, split only the explicitly named songs into requestedTrackQueries. Put artist/theme/constraint phrases in seedQueries or playlistSearchQuery instead.",
  "Example: '来一期贾斯汀比伯，我想听beauty and a beat和all around the world以及一些经典的比伯的歌，不要有重复歌曲' should use requestedTrackQueries ['Beauty And A Beat','All Around The World']; do not use '来一期贾斯汀比伯' or '一些经典的比伯的歌' as exact tracks.",
  "If a phrase might be a theme, artist request, constraint, or sentence fragment instead of a title, leave it out of requestedTrackQueries.",
  "Use liked artists/songs as taste anchors, but do not expose internal filtering details or name songs you avoided.",
  "Respect disliked artists/songs and avoid blocked or overplayed tracks.",
  "When the listener asks for a playlist, explain Faye's taste direction briefly; do not list many song titles in the chat text because the UI shows the playlist separately.",
  "Avoid boilerplate such as 'start with these songs' unless the user explicitly asked what to play first.",
  "Prefer natural Chinese phrasing. Keep the visible reply to 1 to 3 short Chinese lines.",
  "Do not invent inaccessible private data. Keep queries short enough to work well in NetEase search.",
].join("\n");

const ROUTER_INSTRUCTIONS = [
  "You are Faye's intent router for a personal music player.",
  "Return only valid JSON. No markdown, no comments.",
  "Schema:",
  '{"intent":"recommend|playlist|music_chat|library_query|control","confidence":0.0,"shouldSearchMusic":false,"shouldReplaceQueue":false,"shouldShowTrackCards":false,"replyMode":"chat_only|recommend_with_cards|replace_queue","mood":"focus|chill|energy|sleep|random","scene":"coding|sleep|commute|workout|chat|unknown","recommendationCount":3,"queryHints":["short NetEase search query"],"answer":"Chinese answer, 1-3 short lines","reason":"Chinese public-facing reason"}',
  "Use recommend only when the user explicitly asks to play, recommend, find songs, add songs, or wants music candidates.",
  "Use playlist when the user asks to generate, replace, or arrange a playlist.",
  "Use music_chat when the listener asks about Faye's taste, style, genre proportion, song feeling, lyrics, why/how/reasoning, or wants discussion without requesting songs.",
  "If the user asks for another songs by a singer, similar songs, or alternatives around an artist, that is recommend, not music_chat.",
  "Use library_query when the listener asks what is in the liked library or playlists behind Faye's taste.",
  "Use control for playback commands such as pause, next, previous, clear queue, or volume.",
  "For music_chat/library_query/control set shouldSearchMusic false, shouldShowTrackCards false, and replyMode chat_only.",
  "For recommend set shouldSearchMusic true, shouldShowTrackCards true, and replyMode recommend_with_cards.",
  "For playlist set shouldSearchMusic true, shouldReplaceQueue true, and replyMode replace_queue.",
  "For recommend, choose recommendationCount from 2 to 5 based on how many songs feel useful. Do not always choose 5.",
  "Persona rule for public answer/reason: if taste or preference is mentioned, attribute it to Faye's DJ taste instead of the user's taste.",
  "Keep answer and reason natural Chinese. Never expose internal route labels, English routing reasons, or implementation words such as route, intent, explicit, button, fallback.",
].join("\n");

const HOST_INTRO_INSTRUCTIONS = [
  "You are Faye, a warm, observant radio host for Awudio.",
  "Return only valid JSON. No markdown, no comments.",
  "Schema:",
  '{"items":[{"trackId":"exact track id from input","index":0,"startAtMs":0,"displayText":"Chinese radio host intro, 180-520 chars","tone":"comfort|context|energy|night|focus","reason":"short reason for choosing this song"}]}',
  "Generate host intros for at least targetCount tracks. More is acceptable when the playlist flow benefits from it.",
  "Do not simply choose the first targetCount tracks. Spread intros across the beginning, middle, and end of the playlist; use introCoverageSlots as a guide for coverage, then choose the best nearby songs.",
  "Always include the final playable track when finalPlayableIndex is present. It is the closing song and should get a farewell intro.",
  "For tracks at or after farewellStartIndex, treat the copy as the final section of the radio set: gradually close the emotional arc instead of opening new topics.",
  "For the final playable track, explicitly say goodbye to the listener in a natural Chinese radio-host way. Tie the goodbye to currentIsoTime, clientContext.date, weather, time slot, night/morning/afternoon mood, or the user's original request when available.",
  "The final goodbye should not sound like a hard stop or a customer-service signoff. Make it feel like Faye is lowering the studio lights, leaving one last thought, and letting the listener continue their day or night.",
  "Persona rule: the listening profile belongs to Faye's DJ persona. In public copy, say 我的口味, 我的歌库, 我会偏爱, 我选它, or 这套电台的审美; do not say 你的口味, 你的偏好, 你的收藏, or 你的曲库.",
  "Prefer songs that feel like good radio entry points, mood turns, familiar anchors, emotional pauses, or songs whose artist/title/album/tags give you something concrete to say.",
  "Use the listener's current request, mood, time, weather, song title, artist, album, tags, currentIsoTime, and any known music facts already present in the input.",
  "If you know a widely established fact about the artist, song, album, era, style, or background, you may mention it. If you are not sure, say it as listening context or feeling instead of inventing facts.",
  "Within the same playlist, make every intro visibly different. Before writing, assign each selected track a distinct angle such as: sonic detail, playlist transition, artist/background context, personal memory, philosophical reflection, classic film or literature association, recent public news/current cultural mood, work-life observation, city/night/weather scene, or listening technique.",
  "Do not reuse the same angle more than twice in one playlist. Avoid repeating the same opening, sentence rhythm, metaphor, emotional adjective, or advice pattern across items.",
  "For philosophical or cultural analysis, keep it conversational and tied to the song; do not become abstract filler.",
  "For classic film/literature references, use only broadly recognizable works when the association feels natural. Do not force a reference into every intro.",
  "For recent news or current events, mention only events you are confident are real or that are present in the input. If uncertain, discuss the broader current mood instead of inventing specific news details, names, dates, or numbers.",
  "The intro will appear near the beginning of the song, so startAtMs should usually be 0.",
  "Make the Chinese copy feel like a real radio host speaking to one listener: natural, paced, a little informative, emotionally aware, and not like an encyclopedia card.",
  "The intro can be longer than a subtitle. It should sound speakable in 25-90 seconds when the song deserves context.",
  "Blend three layers when possible: why this song is here, one bit of artist/song/style/background context, and what the listener can notice or feel when the music begins.",
  "If the user's request implies tiredness, stress, loneliness, or low mood, make several intros quietly comforting without becoming generic motivational copy.",
  "Avoid repeated openings such as '接下来这首', '现在让', '这首歌', '歌单走到这里', or '如果你今天'. Avoid naming sources or saying you searched.",
  "Good style sample 1: 这一段我们先不急着把情绪推高。《Song》放在这里，是因为它的鼓点和声线都有一点往前走的力量，但不会催你。Artist 的音乐常常把明亮和克制放在一起，适合在有点累的时候，把注意力慢慢从杂音里带回来。",
  "Good style sample 2: 现在让声音稍微靠近一点。《Song》这类作品最动人的地方，不一定是副歌有多大，而是它把一个很私人的瞬间唱得很开阔。如果你今天心里有些堵，就先别急着解释，跟着前奏把呼吸放长一点。",
  "Good style sample 3: 歌单走到这里，需要一个转场。《Song》有很清楚的年代感和画面感，像夜里路灯一盏盏往后退。你可以留意它的贝斯和节拍，音乐会先稳住脚步，再慢慢把情绪带亮。",
  "Good final-song sample: 最后一首我想把声音留得轻一点。《Song》不是用来把今晚推向高潮的，更像把灯慢慢调暗。现在已经接近夜里，城市的噪声会慢下来一些，我也在这里和你说声晚安。把这首听完，后面的路就交给你自己慢慢走。",
].join("\n");

await mkdir(DATA_DIR, { recursive: true });
await mkdir(TTS_CACHE_DIR, { recursive: true });

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
  console.log(`Voice pipeline: ${TTS_PROVIDER}${TTS_PROVIDER === "fish" ? `:${FISH_AUDIO_MODEL}` : ""}`);
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
      tts: {
        provider: TTS_PROVIDER,
        fishAudio: Boolean(FISH_AUDIO_API_KEY),
        fishAudioVoice: Boolean(FISH_AUDIO_REFERENCE_ID),
        model: TTS_PROVIDER === "fish" ? FISH_AUDIO_MODEL : null,
        browserFallback: false,
      },
      mode: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
      serverBuild: "awudio-server-v12",
      features: {
        queue: true,
        playlists: true,
        cloudsearch: true,
        chatStream: true,
        playlistGeneration: true,
        hostIntros: true,
        voicePipeline: true,
        voiceDucking: true,
        radioHistory: true,
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

  if (req.method === "GET" && url.pathname === "/api/radios") {
    const state = await readState();
    const radios = normalizeRadioHistory(state.radioHistory || []);
    if (radios.length !== (state.radioHistory || []).length) {
      state.radioHistory = radios;
      state.updatedAt = new Date().toISOString();
      await writeState(state);
    }

    sendJson(res, 200, { ok: true, radios, count: radios.length });
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

  if (req.method === "GET" && url.pathname === "/api/music/playlist-search") {
    const query = url.searchParams.get("q") || "私人雷达";
    const limit = clampNumber(url.searchParams.get("limit"), NCM_PLAYLIST_SEARCH_LIMIT, 1, 20);
    const playlists = await searchNcmPlaylists(query, limit);
    sendJson(res, 200, { ok: true, query, playlists, limit });
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

  if (req.method === "POST" && url.pathname === "/api/tts") {
    const body = await readJsonBody(req);
    const voiceCue = await synthesizeVoiceCue(body);
    sendJson(res, 200, voiceCue);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/tts/audio/")) {
    await serveTtsAudio(res, url.pathname);
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
    const scene = buildFeedbackScene(body.scene, body.clientContext, state.now);
    const feedbackTrack = compactFeedbackTrack(track);

    if (action === "like") {
      state.tasteProfile.liked.push(compactTrack(track));
      state.tasteProfile.liked = dedupeTracks(state.tasteProfile.liked).slice(-60);
    }

    if (action === "dislike") {
      state.tasteProfile.disliked.push(compactTrack(track));
      state.tasteProfile.disliked = dedupeTracks(state.tasteProfile.disliked).slice(-60);
    }

    if (["dislike", "skip", "remove"].includes(action)) {
      state.tasteProfile.negativeFeedback.push({
        action,
        scene,
        track: feedbackTrack,
        at: new Date().toISOString(),
      });
      state.tasteProfile.negativeFeedback = state.tasteProfile.negativeFeedback.slice(-160);
    }

    if (action === "play") {
      state.plays.push({ ...compactTrack(track), at: new Date().toISOString() });
      state.plays = state.plays.slice(-120);
    }

    updateScenePreference(state, action, feedbackTrack, scene);
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

async function synthesizeVoiceCue(body = {}) {
  const text = normalizeTtsText(body.text || body.displayText || body.say || "");
  if (!text) {
    return {
      ok: false,
      error: "text is required",
    };
  }

  const speed = clampFloat(body.speed, FISH_AUDIO_SPEED, 0.75, 1.25);
  const durationMs = clampMs(body.durationMs || body.estimatedDurationMs, estimateHostIntroDurationMs(text), 12000, 180000);
  const baseCue = {
    ok: true,
    text,
    speed,
    durationMs,
    estimatedDurationMs: durationMs,
    ducking: {
      targetRatio: 0.16,
      fadeOutMs: 750,
      fadeInMs: 1400,
    },
  };

  if (TTS_PROVIDER !== "fish") {
    return {
      ...baseCue,
      ok: false,
      provider: TTS_PROVIDER || "none",
      fallback: false,
      status: "unavailable",
      voiceCueId: "",
      audioUrl: "",
      reason: FISH_AUDIO_API_KEY ? "Fish Audio voice id is not configured" : "Fish Audio API key is not configured",
    };
  }

  try {
    const result = await synthesizeFishAudio(text, { speed });
    return {
      ...baseCue,
      ...result,
      provider: "fish",
      fallback: false,
      status: "ready",
    };
  } catch (error) {
    return {
      ...baseCue,
      ok: false,
      provider: "fish",
      fallback: false,
      status: "error",
      voiceCueId: "",
      audioUrl: "",
      error: error instanceof Error ? error.message : "Fish Audio TTS failed",
    };
  }
}

async function synthesizeFishAudio(text, options = {}) {
  const speed = clampFloat(options.speed, FISH_AUDIO_SPEED, 0.75, 1.25);
  const cachePayload = {
    provider: "fish",
    text,
    model: FISH_AUDIO_MODEL,
    referenceId: FISH_AUDIO_REFERENCE_ID,
    latency: FISH_AUDIO_LATENCY,
    speed,
    format: "mp3",
  };
  const voiceCueId = createVoiceCueId(cachePayload);
  const fileName = `${voiceCueId}.mp3`;
  const filePath = resolve(TTS_CACHE_DIR, fileName);
  const audioUrl = `/api/tts/audio/${fileName}`;

  if (existsSync(filePath)) {
    return {
      voiceCueId,
      audioUrl,
      cacheHit: true,
      model: FISH_AUDIO_MODEL,
      voiceId: FISH_AUDIO_REFERENCE_ID,
    };
  }

  if (!FISH_AUDIO_API_KEY) throw new Error("FISH_AUDIO_API_KEY is not configured");
  if (!FISH_AUDIO_REFERENCE_ID) throw new Error("FISH_AUDIO_REFERENCE_ID is not configured");

  const response = await fetch(FISH_AUDIO_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FISH_AUDIO_API_KEY}`,
      "Content-Type": "application/json",
      model: FISH_AUDIO_MODEL,
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      reference_id: FISH_AUDIO_REFERENCE_ID,
      temperature: 0.7,
      top_p: 0.7,
      format: "mp3",
      sample_rate: 44100,
      mp3_bitrate: 128,
      latency: FISH_AUDIO_LATENCY,
      chunk_length: 300,
      normalize: true,
      max_new_tokens: 1024,
      repetition_penalty: 1.2,
      min_chunk_length: 50,
      condition_on_previous_chunks: true,
      early_stop_threshold: 1,
      prosody: {
        speed,
        volume: 0,
        normalize_loudness: true,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Fish Audio HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("Fish Audio returned empty audio");
  await writeFile(filePath, bytes);

  return {
    voiceCueId,
    audioUrl,
    cacheHit: false,
    model: FISH_AUDIO_MODEL,
    voiceId: FISH_AUDIO_REFERENCE_ID,
  };
}

async function serveTtsAudio(res, pathname) {
  const rawName = decodeURIComponent(pathname.replace("/api/tts/audio/", ""));
  if (!/^[a-f0-9]{64}\.(mp3|wav|opus)$/.test(rawName)) {
    sendJson(res, 400, { ok: false, error: "Invalid audio file" });
    return;
  }

  const filePath = resolve(TTS_CACHE_DIR, rawName);
  if (!filePath.startsWith(TTS_CACHE_DIR) || !existsSync(filePath)) {
    sendJson(res, 404, { ok: false, error: "TTS audio not found" });
    return;
  }

  const body = await readFile(filePath);
  const type = CONTENT_TYPES[extname(filePath)] || "audio/mpeg";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

function normalizeTtsText(text) {
  return shortenTtsPauses(cleanHostIntroText(text)).slice(0, 1200);
}

function shortenTtsPauses(text) {
  return String(text || "")
    .replace(/[。！？!?；;]+(?=\s*\S)/gu, "，")
    .replace(/，{2,}/gu, "，")
    .replace(/[。！？!?；;，,]+$/u, "")
    .trim();
}

function createVoiceCueId(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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
  const assistantPrefix = "";

  try {
    writeStreamEvent(res, "status", { text: "读取本地对话和听歌偏好" });

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
  const route = await resolveIntentRoute(message, mode, tasteContext, clientContext);

  if (route.intent === "library_query") {
    await options.onStatus?.("查询本地歌单画像");
    return createInformationalChatResponse(message, state, tasteContext, clientContext, "library_query");
  }

  if (route.replyMode === "chat_only" || !route.shouldSearchMusic) {
    await options.onStatus?.("整理聊天回答");
    return createRoutedChatResponse(message, state, tasteContext, route);
  }

  await options.onStatus?.("生成 DJ 推荐计划");

  const routePlan = routeToRecommendationPlan(route, message, state, tasteContext, clientContext);
  let plan = routePlan;
  if (shouldUseAiRecommendationPlan(message, route, mode)) {
    await options.onStatus?.("让 AI 拆分点歌需求");
    plan = await createAiBackedRecommendationPlan(message, routePlan, state, tasteContext, clientContext);
  }
  const executionMode = route.replyMode === "replace_queue" || route.shouldReplaceQueue || plan.strictPlaylistTheme ? "playlist" : "chat";
  const executionLimit = executionMode === "playlist" ? PLAYLIST_RECOMMENDATION_LIMIT : getRouteRecommendationLimit(route, limit);
  await options.onStatus?.("匹配可播放歌曲");

  const recommendationContext = buildRecommendationFilterContext(state, tasteContext);
  let tracks = [];

  const requestedTracks = await resolveRequestedTrackCandidates(plan, state, Math.min(executionLimit, CHAT_RECOMMENDATION_LIMIT), {
    tasteContext,
    clientContext,
    mode: executionMode,
    recommendationContext,
  });
  tracks = dedupeRecommendedTracks(requestedTracks, recommendationContext).slice(0, executionLimit);

  if (executionMode === "playlist" && plan.playlistSearchQuery) {
    await options.onStatus?.("搜索网易云歌单");
    const playlistTracks = await resolvePlaylistSearchTracks(plan, state, executionLimit - tracks.length, {
      recommendationContext,
      excludedTracks: tracks,
    });
    tracks = dedupeRecommendedTracks([...tracks, ...playlistTracks], recommendationContext).slice(0, executionLimit);
  }

  if (tracks.length < executionLimit && plan.strictPlaylistTheme) {
    await options.onStatus?.("补充网易云主题歌单");
    const extraPlaylistTracks = await resolvePlaylistSearchTracks(
      {
        ...plan,
        playlistSearchQuery: plan.playlistSearchQuery || plan.search,
      },
      state,
      executionLimit - tracks.length,
      {
        recommendationContext,
        excludedTracks: tracks,
        offset: tracks.length,
      },
    );
    tracks = dedupeRecommendedTracks([...tracks, ...extraPlaylistTracks], recommendationContext).slice(0, executionLimit);
  }

  if (tracks.length < executionLimit && !plan.strictPlaylistTheme) {
    const recommendedTracks = await resolveRecommendedTracks(plan, state, executionLimit - tracks.length, {
      tasteContext,
      clientContext,
      mode: executionMode,
      recommendationContext,
      skipRequestedTracks: requestedTracks.length > 0,
    });
    tracks = dedupeRecommendedTracks([...tracks, ...recommendedTracks], recommendationContext).slice(0, executionLimit);
  }

  if (!tracks.length && !plan.strictPlaylistTheme) {
    tracks = plan.exactTrackOnly ? [] : await searchMusic(plan.search, executionLimit, {
      playableOnly: false,
      forRecommendation: true,
      recommendationContext,
    });
  }

  if (
    executionMode === "playlist" &&
    tracks.some((track) => track.playable && track.url) &&
    shouldGeneratePlaylistVoice(plan, tracks)
  ) {
    await options.onStatus?.("生成主持人串词");
    tracks = await attachHostIntrosToPlaylistTracks(tracks, {
      message,
      plan,
      tasteContext,
      clientContext,
    });

    if (tracks.some((track) => track.hostIntro?.displayText)) {
      await options.onStatus?.("缓存主持人语音");
      tracks = await attachVoiceCuesToHostIntros(tracks);
    }
  }

  const selected = tracks.find((track) => track.playable) || tracks[0] || null;
  const assistantText = `${options.assistantPrefix || ""}${buildDjReply(plan, tracks, {
    mode: executionMode,
    limit: executionLimit,
  })}`;
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
  let radioHistoryItem = null;
  if (executionMode === "playlist" && tracks.some((track) => track.playable && track.url)) {
    radioHistoryItem = createRadioHistoryItem({
      message,
      plan,
      tracks,
      assistantText,
      source: {
        brain: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
        music: getTrackSource(tracks),
        tts: TTS_PROVIDER,
      },
      createdAt: now,
    });
    state.radioHistory = normalizeRadioHistory([radioHistoryItem, ...(state.radioHistory || [])]);
  }

  state.updatedAt = now;
  await writeState(state);

  await options.onStatus?.("完成");

  return {
    ok: true,
    mode: executionMode,
    limit: executionLimit,
    route,
    plan,
    tracks,
    radioHistoryItem,
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
  const playableTracks = tracks.filter((track) => track.playable && track.url);
  const requestedStatus = getRequestedTrackStatus(plan, tracks);
  const visibleReason = getPublicPlanReason(plan);

  const lines = [];

  if (requestedStatus.exactOnly && requestedStatus.missing.length) {
    lines.push(`没有找到《${requestedStatus.missing[0]}》的可播放结果。`);
    lines.push("我没有用其他歌曲替代它。");
  } else {
    let opening = cleanVisibleDjLine(plan.say || "已整理好这轮推荐。");
    if (requestedStatus.missing.length && requestedStatus.mentionedInOpening) {
      opening = `我没找到《${requestedStatus.missing[0]}》，先不拿别的歌冒充。`;
    }
    lines.push(opening, visibleReason);
    if (requestedStatus.included.length) {
      lines.push(`已优先加入你指定的《${requestedStatus.included.join("》《")}》。`);
    }
    if (requestedStatus.missing.length && !requestedStatus.mentionedInOpening) {
      lines.push(`《${requestedStatus.missing.join("》《")}》没有匹配到可播放结果，所以这次没有替换成同名无关歌曲。`);
    }
  }

  if (playableCount) {
    if (mode === "playlist") {
      lines.push(`已生成 ${playableCount} 首可播放歌曲，并替换右侧播放列表。歌名我不在这里重复列出，你可以直接看右侧列表。`);
    } else {
      lines.push(`这次先挑 ${playableCount} 首，理由也放在这里：`);
      playableTracks.slice(0, CHAT_RECOMMENDATION_LIMIT).forEach((track, index) => {
        lines.push(`${index + 1}. 《${track.title || "未命名"}》 - ${track.artist || "未知艺人"}：${buildRecommendationReasonForTrack(track, plan, index)}`);
      });
    }
  } else {
    lines.push("这轮没有找到可直接播放的链接，结果里可能受版权、地区或账号权限限制。");
  }

  return lines.join("\n");
}

function shouldGeneratePlaylistVoice(plan = {}, tracks = []) {
  const requestedStatus = getRequestedTrackStatus(plan, tracks);
  return !requestedStatus.missing.length || requestedStatus.included.length > 0;
}

function getRequestedTrackStatus(plan = {}, tracks = []) {
  const queries = Array.isArray(plan.requestedTrackQueries) ? plan.requestedTrackQueries.filter(Boolean) : [];
  const included = [];
  const missing = [];

  for (const query of queries) {
    const matched = tracks.some((track) => isRequestedTrackMatch(track, query));
    if (matched) included.push(query);
    else missing.push(query);
  }

  const normalizedOpening = normalizeSearchText(plan.say || "");
  return {
    included,
    missing,
    exactOnly: Boolean(plan.exactTrackOnly),
    mentionedInOpening: missing.some((query) => normalizedOpening.includes(normalizeSearchText(query))),
  };
}

function getPublicPlanReason(plan = {}) {
  const reason = cleanVisibleDjLine(plan.reason || "");
  if (isInternalRouteText(reason)) {
    return "按这次请求、当前场景和我的电台口味重新筛了一组更贴近的方向。";
  }
  return rewriteTastePersonaText(reason) || "按这次请求、当前场景和我的电台口味重新筛了一组更贴近的方向。";
}

function buildRecommendationReasonForTrack(track, plan = {}, index = 0) {
  const source = String(track.recommendSource || track.recommendQuery || "");
  const tags = Array.isArray(track.tags) ? track.tags.filter(Boolean).slice(0, 2).join("、") : "";
  const mood = plan.mood || "random";

  if (/similar|simi/i.test(source)) {
    return "它更像是从我熟悉的口味旁边往外走一步，有新鲜感，但不会和前面的听感断开。";
  }

  if (/liked-library/i.test(source)) {
    return tags
      ? `它在我的歌库脉络里比较稳，${tags} 的气质适合先把这一轮听感立住。`
      : "它在我的歌库脉络里比较稳，适合当这一轮推荐的锚点。";
  }

  if (/netease-daily/i.test(source)) {
    return "这首来自今天的推荐补位，用来给歌单加一点不完全熟悉的新鲜感。";
  }

  if (mood === "focus") return "它的节奏和情绪不会太抢注意力，适合放在需要专注的时间里。";
  if (mood === "sleep") return "它的刺激感更低，适合把声音和情绪慢慢放下来。";
  if (mood === "energy") return "它能把律动往前推一点，适合给这一轮增加一些亮度。";
  return "它和这次的请求气质比较贴近，可以作为一个顺耳的入口。";
}

function createRadioHistoryItem({ message, plan, tracks, assistantText, source, createdAt }) {
  const normalizedTracks = normalizeRadioTracks(tracks);
  const introCount = normalizedTracks.filter((track) => track.hostIntro?.displayText).length;
  const voiceCount = normalizedTracks.filter((track) => track.hostIntro?.audioUrl).length;
  const id = createRadioHistoryId({ createdAt, message, tracks: normalizedTracks });

  return {
    id,
    title: buildRadioHistoryTitle(message, plan, createdAt),
    createdAt,
    updatedAt: createdAt,
    request: String(message || "").slice(0, 360),
    mood: String(plan?.mood || "random").slice(0, 32),
    say: cleanVisibleDjLine(plan?.say || "").slice(0, 120),
    reason: cleanVisibleDjLine(plan?.reason || "").slice(0, 240),
    assistantText: String(assistantText || "").slice(0, 1200),
    trackCount: normalizedTracks.length,
    introCount,
    voiceCount,
    source: normalizeRadioSource(source),
    tracks: normalizedTracks,
  };
}

function buildRadioHistoryTitle(message, plan, createdAt) {
  const text = cleanVisibleDjLine(plan?.say || message || "").replace(/^生成\s*\d*\s*首推荐歌单[:：]?/, "").trim();
  const base = text || "AI 电台歌单";
  return `${base.slice(0, 28)} / ${formatRadioCreatedAt(createdAt)}`;
}

function createRadioHistoryId(payload) {
  return createHash("sha256")
    .update(JSON.stringify({
      createdAt: payload.createdAt,
      message: payload.message,
      tracks: payload.tracks.map((track) => [track.provider, track.id, track.title, track.artist]),
    }))
    .digest("hex")
    .slice(0, 20);
}

function formatRadioCreatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}.${day} ${hours}:${minutes}`;
}

async function attachHostIntrosToPlaylistTracks(tracks, context = {}) {
  const cleanedTracks = tracks.map((track) => ({ ...track, hostIntro: null }));
  const playableTracks = cleanedTracks.filter((track) => track.playable && track.url);
  const targetCount = getHostIntroTargetCount(playableTracks.length);
  const maxIntroCount = Math.min(HOST_INTRO_MAX_COUNT, playableTracks.length);

  if (!targetCount) return cleanedTracks;

  let items = [];
  if (AI_PROVIDER !== "local") {
    try {
      items = await createAiHostIntroItems(cleanedTracks, context, targetCount);
    } catch (error) {
      console.warn("AI host intro generation failed; skipping host intros:", error.message);
    }
  }

  return applyHostIntroItems(cleanedTracks, items, maxIntroCount, context);
}

function getHostIntroTargetCount(playableCount) {
  if (playableCount < HOST_INTRO_MIN_PLAYLIST_SIZE) return 0;
  return Math.min(HOST_INTRO_MAX_COUNT, Math.max(Math.ceil(playableCount / 2), Math.ceil(playableCount * HOST_INTRO_COVERAGE_RATIO)));
}

function getHostIntroCoverageSlots(trackCount, targetCount) {
  const count = Math.max(0, Math.min(Number(targetCount) || 0, Number(trackCount) || 0));
  if (!count) return [];
  if (count === 1) return [0];

  return Array.from({ length: count }, (_, index) =>
    Math.round((index / (count - 1)) * (trackCount - 1)),
  );
}

async function createAiHostIntroItems(tracks, context, targetCount) {
  const finalPlayableIndex = getFinalPlayableTrackIndex(tracks);
  const payload = {
    request: context.message || "",
    mood: context.plan?.mood || "random",
    playlistReason: context.plan?.reason || "",
    scene: context.plan?.scene || {},
    clientContext: context.clientContext || {},
    currentIsoTime: new Date().toISOString(),
    targetCount,
    trackCount: tracks.length,
    finalPlayableIndex,
    farewellStartIndex: finalPlayableIndex >= 0 ? Math.max(0, finalPlayableIndex - 2) : -1,
    introCoverageSlots: getHostIntroCoverageSlots(tracks.length, targetCount),
    tracks: tracks.map(compactHostIntroTrack).slice(0, PLAYLIST_RECOMMENDATION_LIMIT),
  };

  if (AI_PROVIDER === "deepseek") return createDeepSeekHostIntroItems(payload);
  if (AI_PROVIDER === "openai") return createOpenAiHostIntroItems(payload);
  return [];
}

function getFinalPlayableTrackIndex(tracks = []) {
  for (let index = tracks.length - 1; index >= 0; index -= 1) {
    if (tracks[index]?.playable && tracks[index]?.url) return index;
  }
  return -1;
}

async function createDeepSeekHostIntroItems(payload) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: HOST_INTRO_INSTRUCTIONS },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.55,
      max_tokens: 6000,
      stream: false,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `DeepSeek HTTP ${response.status}`);

  const text = data?.choices?.[0]?.message?.content || "";
  return JSON.parse(extractJsonObject(text))?.items || [];
}

async function createOpenAiHostIntroItems(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: HOST_INTRO_INSTRUCTIONS,
      input: JSON.stringify(payload),
      max_output_tokens: 6000,
      store: false,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);

  return JSON.parse(extractJsonObject(extractResponseText(data)))?.items || [];
}

function compactHostIntroTrack(track, index) {
  return {
    index,
    id: String(track.id || ""),
    title: String(track.title || ""),
    artist: String(track.artist || ""),
    album: String(track.album || ""),
    durationMs: normalizeNumber(track.duration),
    tags: Array.isArray(track.tags) ? track.tags.slice(0, 8).map(String) : [],
    recommendSource: String(track.recommendSource || track.recommendQuery || ""),
    playable: Boolean(track.playable && track.url),
  };
}

function applyHostIntroItems(tracks, items, targetCount, context = {}) {
  const selected = new Set(tracks.map((track, index) => (track.hostIntro?.displayText ? index : -1)).filter((index) => index >= 0));
  const byId = new Map(tracks.map((track, index) => [String(track.id || ""), { track, index }]));
  const result = tracks.map((track) => ({ ...track }));
  const usedIntroTexts = result
    .map((track) => cleanHostIntroText(track.hostIntro?.displayText || ""))
    .filter(Boolean);

  for (const item of normalizeHostIntroItems(items)) {
    if (selected.size >= targetCount) break;

    const explicitIndex = Number.isInteger(Number(item.index)) ? Number(item.index) : -1;
    const id = String(item.trackId || item.id || "");
    const match = id && byId.has(id)
      ? byId.get(id)
      : explicitIndex >= 0 && explicitIndex < result.length
        ? { track: result[explicitIndex], index: explicitIndex }
        : null;

    if (!match?.track?.playable || !match.track.url || selected.has(match.index)) continue;

    let displayText = cleanHostIntroText(item.displayText || item.text || item.intro);
    if (!displayText) continue;
    if (isHostIntroTooSimilar(displayText, usedIntroTexts)) continue;
    if (!displayText) continue;

    selected.add(match.index);
    usedIntroTexts.push(displayText);
    result[match.index] = {
      ...result[match.index],
      hostIntro: {
        enabled: true,
        voiceCueId: createVoiceCueId({
          trackId: match.track.id || match.index,
          startAtMs: clampMs(item.startAtMs, 0, 0, 60000),
          text: displayText,
        }),
        startAtMs: clampMs(item.startAtMs, 0, 0, 60000),
        estimatedDurationMs: clampMs(
          item.estimatedDurationMs,
          estimateHostIntroDurationMs(displayText),
          12000,
          180000,
        ),
        displayText,
        audioUrl: "",
        status: "pending",
        ducking: {
          targetRatio: 0.16,
          fadeOutMs: 750,
          fadeInMs: 1400,
        },
        tone: String(item.tone || "context").slice(0, 32),
        moodIntent: String(context.plan?.mood || item.moodIntent || "random").slice(0, 32),
        source: normalizeHostIntroSource(item),
      },
    };
  }

  return result;
}

async function attachVoiceCuesToHostIntros(tracks) {
  const result = tracks.map((track) => ({ ...track }));
  const jobs = result
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.hostIntro?.enabled && track.hostIntro?.displayText);

  for (const batch of chunkArray(jobs, 2)) {
    const settled = await Promise.allSettled(
      batch.map(({ track }) =>
        synthesizeVoiceCue({
          text: track.hostIntro.displayText,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          tone: track.hostIntro.tone,
          moodIntent: track.hostIntro.moodIntent,
          estimatedDurationMs: track.hostIntro.estimatedDurationMs,
        }),
      ),
    );

    settled.forEach((item, offset) => {
      const job = batch[offset];
      if (!job || item.status !== "fulfilled" || !item.value) return;
      result[job.index] = applyVoiceCueToTrack(result[job.index], item.value);
    });
  }

  return result;
}

function applyVoiceCueToTrack(track, cue) {
  if (!track?.hostIntro) return track;

  return {
    ...track,
    hostIntro: {
      ...track.hostIntro,
      voiceCueId: String(cue.voiceCueId || track.hostIntro.voiceCueId || "").slice(0, 90),
      audioUrl: String(cue.audioUrl || track.hostIntro.audioUrl || "").slice(0, 500),
      status: String(cue.status || "ready").slice(0, 32),
      provider: String(cue.provider || TTS_PROVIDER || "").slice(0, 40),
      fallback: Boolean(cue.fallback),
      cacheHit: Boolean(cue.cacheHit),
      model: String(cue.model || "").slice(0, 80),
      voiceId: String(cue.voiceId || "").slice(0, 120),
      speed: clampFloat(cue.speed || track.hostIntro.speed, FISH_AUDIO_SPEED, 0.75, 1.25),
      ducking: normalizeVoiceDucking(cue.ducking || track.hostIntro.ducking),
    },
  };
}

function normalizeHostIntroItems(items) {
  if (Array.isArray(items)) return items;
  if (Array.isArray(items?.items)) return items.items;
  return [];
}

function normalizeHostIntroSource(item = {}) {
  if (item.source) return String(item.source).slice(0, 40);
  return AI_PROVIDER === "local" ? "none" : AI_PROVIDER;
}

function isHostIntroTooSimilar(text, existingTexts = []) {
  const sentences = getHostIntroSentences(text);
  const fingerprint = getHostIntroFingerprint(text);

  return existingTexts.some((existing) => {
    const existingSentences = getHostIntroSentences(existing);
    if (fingerprint && fingerprint === getHostIntroFingerprint(existing)) return true;
    return sentences.some((sentence) =>
      sentence.length >= 18 && existingSentences.some((item) => item === sentence),
    );
  });
}

function getHostIntroSentences(text) {
  return cleanHostIntroText(text)
    .replace(/《[^》]+》/g, "《Song》")
    .split(/[。！？!?；;]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function getHostIntroFingerprint(text) {
  return cleanHostIntroText(text)
    .replace(/《[^》]+》/g, "《Song》")
    .replace(/\s+/g, "")
    .slice(0, 160);
}

function cleanHostIntroText(text) {
  return cleanVisibleDjLine(String(text || ""))
    .replace(/^接下来[，,。\s]*/, "")
    .replace(/^下面[，,。\s]*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function estimateHostIntroDurationMs(text) {
  const charCount = String(text || "").replace(/\s+/g, "").length;
  return Math.max(12000, Math.min(180000, Math.round((charCount / 4.2) * 1000)));
}

function clampMs(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function cleanVisibleDjLine(text) {
  return rewriteTastePersonaText(String(text || ""))
    .replace(/^Faye\s*/, "")
    .replace(/^收到[，,。\s]*/, "")
    .replace(/^好的[，,。\s]*/, "")
    .replace(/^明白[，,。\s]*/, "")
    .replace(/优先从喜欢歌单选歌，并避开最近的[^\n。]*[。]?/g, "按我的歌库和相邻风格做了筛选。")
    .replace(/避开(?:了)?最近(?:播放)?的?[^\n。]*[。]?/g, "")
    .trim();
}

function rewriteTastePersonaText(text) {
  return String(text || "")
    .replace(/你的本地听歌偏好/g, "我的电台口味")
    .replace(/你的听歌偏好/g, "我的电台口味")
    .replace(/你的音乐偏好/g, "我的音乐偏好")
    .replace(/你的偏好/g, "我的偏好")
    .replace(/你的口味/g, "我的口味")
    .replace(/你熟悉的口味/g, "我熟悉的口味")
    .replace(/你的喜欢歌单/g, "我的歌库")
    .replace(/你的收藏口味/g, "我的收藏口味")
    .replace(/你的收藏脉络/g, "我的歌库脉络")
    .replace(/你的收藏/g, "我的歌库")
    .replace(/你的曲库/g, "我的歌库")
    .replace(/本地听歌偏好/g, "我的电台口味");
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

function buildFeedbackScene(scene = {}, clientContext = {}, nowPlaying = null) {
  const hour = new Date().getHours();
  const fallbackMood = nowPlaying?.mood || "random";
  const mood = ["focus", "chill", "energy", "sleep", "random"].includes(scene?.mood)
    ? scene.mood
    : fallbackMood;
  const timeSlot = scene?.timeSlot || getTimeSlot(hour);
  const key = getScenePreferenceKey({ mood, timeSlot });

  return {
    key,
    mood,
    timeSlot,
    weather: String(scene?.weather || clientContext?.weather || "").slice(0, 80),
  };
}

function getScenePreferenceKey(scene = {}) {
  const mood = ["focus", "chill", "energy", "sleep", "random"].includes(scene?.mood) ? scene.mood : "random";
  const timeSlot = scene?.timeSlot || getTimeSlot(new Date().getHours());
  return `${mood}:${timeSlot}`;
}

function updateScenePreference(state, action, track, scene) {
  if (!track?.id && !track?.title) return;
  const key = scene?.key || getScenePreferenceKey(scene);
  const prefs = state.tasteProfile.scenePreferences || {};
  const bucket = normalizeScenePreferenceBucket(prefs[key] || createScenePreferenceBucket(scene), scene);
  bucket.scene = scene;
  bucket.updatedAt = new Date().toISOString();

  const artists = splitArtistNames(track.artist).map(normalizeSearchText).filter(Boolean);
  const tags = (track.tags || []).map(normalizeSearchText).filter(Boolean);
  const trackId = String(track.id || "");

  if (action === "like") {
    incrementMapValues(bucket.likedArtists, artists, 2);
    incrementMapValues(bucket.likedTags, tags, 2);
    if (trackId) incrementMapValues(bucket.likedTracks, [trackId], 1);
  }

  if (action === "play" || action === "complete") {
    incrementMapValues(bucket.playedArtists, artists, action === "complete" ? 2 : 1);
    incrementMapValues(bucket.playedTags, tags, action === "complete" ? 2 : 1);
  }

  if (action === "skip" || action === "dislike") {
    incrementMapValues(bucket.skippedArtists, artists, action === "dislike" ? 3 : 1);
    incrementMapValues(bucket.skippedTags, tags, action === "dislike" ? 3 : 1);
    if (trackId) incrementMapValues(bucket.skippedTracks, [trackId], action === "dislike" ? 2 : 1);
  }

  if (action === "remove") {
    incrementMapValues(bucket.removedArtists, artists, 1);
    incrementMapValues(bucket.removedTags, tags, 1);
    if (trackId) incrementMapValues(bucket.removedTracks, [trackId], 1);
  }

  prefs[key] = pruneScenePreferenceBucket(bucket);
  state.tasteProfile.scenePreferences = pruneScenePreferences(prefs);
}

function createScenePreferenceBucket(scene) {
  return {
    scene,
    likedArtists: {},
    playedArtists: {},
    skippedArtists: {},
    removedArtists: {},
    likedTags: {},
    playedTags: {},
    skippedTags: {},
    removedTags: {},
    likedTracks: {},
    skippedTracks: {},
    removedTracks: {},
    updatedAt: new Date().toISOString(),
  };
}

function normalizeScenePreferenceBucket(bucket, scene) {
  const normalized = { ...createScenePreferenceBucket(scene), ...(bucket || {}) };
  for (const key of [
    "likedArtists",
    "playedArtists",
    "skippedArtists",
    "removedArtists",
    "likedTags",
    "playedTags",
    "skippedTags",
    "removedTags",
    "likedTracks",
    "skippedTracks",
    "removedTracks",
  ]) {
    normalized[key] = normalized[key] && typeof normalized[key] === "object" ? normalized[key] : {};
  }
  return normalized;
}

function incrementMapValues(map, values, amount = 1) {
  for (const value of values) {
    if (!value) continue;
    map[value] = Math.min(24, (Number(map[value]) || 0) + amount);
  }
}

function pruneScenePreferences(prefs) {
  return Object.fromEntries(
    Object.entries(prefs)
      .sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")))
      .slice(0, 24),
  );
}

function pruneScenePreferenceBucket(bucket) {
  for (const key of [
    "likedArtists",
    "playedArtists",
    "skippedArtists",
    "removedArtists",
    "likedTags",
    "playedTags",
    "skippedTags",
    "removedTags",
    "likedTracks",
    "skippedTracks",
    "removedTracks",
  ]) {
    bucket[key] = pruneCountMap(bucket[key], 40);
  }
  return bucket;
}

function pruneCountMap(map = {}, limit = 40) {
  return Object.fromEntries(
    Object.entries(map)
      .filter(([, value]) => Number(value) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, limit),
  );
}

function summarizeNegativeFeedback(items, limit) {
  return (Array.isArray(items) ? items : []).slice(-limit).map((item) => ({
    action: item.action,
    scene: item.scene,
    track: compactTrack(item.track || {}),
    at: item.at,
  }));
}

function summarizeScenePreferences(prefs) {
  return Object.fromEntries(
    Object.entries(prefs || {}).map(([key, value]) => [
      key,
      {
        scene: value.scene,
        likedArtists: pruneCountMap(value.likedArtists, 10),
        skippedArtists: pruneCountMap(value.skippedArtists, 10),
        removedArtists: pruneCountMap(value.removedArtists, 10),
        likedTags: pruneCountMap(value.likedTags, 10),
        skippedTags: pruneCountMap(value.skippedTags, 10),
        removedTags: pruneCountMap(value.removedTags, 10),
        updatedAt: value.updatedAt,
      },
    ]),
  );
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

async function resolveIntentRoute(message, mode, tasteContext, clientContext = {}) {
  if (mode === "playlist") {
    return normalizeIntentRoute(
      {
        intent: "playlist",
        confidence: 1,
        shouldSearchMusic: true,
        shouldReplaceQueue: true,
        shouldShowTrackCards: false,
        replyMode: "replace_queue",
        mood: "random",
        scene: "unknown",
        queryHints: extractRequestKeywords(message),
        answer: "我会按这次的状态排成一整段歌单。",
        reason: "这是一次明确的歌单生成请求。",
      },
      message,
      clientContext,
    );
  }

  const hardRoute = inferHardRoute(message);
  if (hardRoute && hardRoute.intent !== "recommend") return normalizeIntentRoute(hardRoute, message, clientContext);

  return createAiIntentRoute(message, tasteContext, clientContext);
}

function inferHardRoute(message) {
  const text = normalizeSearchText(message);

  if (
    containsAny(text, [
      "下一首",
      "上一首",
      "暂停",
      "继续播放",
      "清空队列",
      "音量",
      "next",
      "previous",
      "pause",
      "resume",
      "volume",
    ])
  ) {
    return {
      intent: "control",
      confidence: 0.95,
      shouldSearchMusic: false,
      shouldReplaceQueue: false,
      shouldShowTrackCards: false,
      replyMode: "chat_only",
      mood: "random",
      scene: "unknown",
      queryHints: [],
      answer: "这个播放控制我先识别出来了，当前版本还没有把控制命令接到播放器动作。",
      reason: "Explicit playback control command.",
    };
  }

  if (
    containsAny(text, [
      "最近收藏",
      "最近新增",
      "最近加",
      "刚收藏",
      "刚加",
      "新加",
      "我的歌单",
      "我的曲库",
      "喜欢的音乐",
      "library",
    ])
  ) {
    return {
      intent: "library_query",
      confidence: 0.92,
      shouldSearchMusic: false,
      shouldReplaceQueue: false,
      shouldShowTrackCards: false,
      replyMode: "chat_only",
      mood: "random",
      scene: "unknown",
      queryHints: [],
      reason: "Explicit local library query.",
    };
  }

  if (
    /歌单|经典曲目|相关曲目|主题曲目|OST|ost|OP|ED|playlist/i.test(String(message || "")) &&
    /找|搜索|重温|想听|推荐|来点|放点|帮我/i.test(String(message || ""))
  ) {
    return {
      intent: "playlist",
      confidence: 0.92,
      shouldSearchMusic: true,
      shouldReplaceQueue: true,
      shouldShowTrackCards: false,
      replyMode: "replace_queue",
      mood: "random",
      scene: "unknown",
      queryHints: extractRequestKeywords(message),
      answer: "我会按这个主题找网易云歌单里的曲目。",
      reason: "这是一次明确的主题歌单请求。",
    };
  }

  if (
    containsAny(text, [
      "生成歌单",
      "推荐歌单",
      "排一组",
      "换一批",
      "加到队列",
      "替换队列",
      "playlist",
    ])
  ) {
    return {
      intent: "playlist",
      confidence: 0.9,
      shouldSearchMusic: true,
      shouldReplaceQueue: true,
      shouldShowTrackCards: false,
      replyMode: "replace_queue",
      mood: "random",
      scene: "unknown",
      queryHints: extractRequestKeywords(message),
      answer: "我会把它排成一段完整歌单。",
      reason: "这是一次明确的歌单生成请求。",
    };
  }

  if (
    containsAny(text, [
      "推荐",
      "来点",
      "放点",
      "播放",
      "想听",
      "帮我选",
      "推歌",
      "找几首",
      "recommend",
      "play",
    ])
  ) {
    return {
      intent: "recommend",
      confidence: 0.88,
      shouldSearchMusic: true,
      shouldReplaceQueue: false,
      shouldShowTrackCards: true,
      replyMode: "recommend_with_cards",
      mood: "random",
      scene: "unknown",
      queryHints: extractRequestKeywords(message),
      recommendationCount: extractRequestedSongCount(message) || 4,
      answer: "我挑几首更贴近你说的方向。",
      reason: "这是一次明确的听歌推荐请求。",
    };
  }

  if (
    containsAny(text, [
      "为什么推荐",
      "为啥推荐",
      "怎么推荐",
      "怎么选",
      "推荐原因",
      "推荐理由",
      "推荐逻辑",
    ])
  ) {
    return {
      intent: "music_chat",
      confidence: 0.9,
      shouldSearchMusic: false,
      shouldReplaceQueue: false,
      shouldShowTrackCards: false,
      replyMode: "chat_only",
      mood: "random",
      scene: "chat",
      queryHints: [],
      answer: "可以，我解释一下刚才的推荐依据。",
      reason: "用户在追问推荐依据。",
    };
  }

  return null;
}

async function createAiIntentRoute(message, tasteContext, clientContext = {}) {
  try {
    if (AI_PROVIDER === "deepseek") {
      return normalizeIntentRoute(await createDeepSeekIntentRoute(message, tasteContext, clientContext), message, clientContext);
    }

    if (AI_PROVIDER === "openai") {
      return normalizeIntentRoute(await createOpenAiIntentRoute(message, tasteContext, clientContext), message, clientContext);
    }
  } catch (error) {
    console.warn("AI route failed, falling back to local route:", error.message);
  }

  return normalizeIntentRoute(createLocalIntentRoute(message), message, clientContext);
}

async function createDeepSeekIntentRoute(message, tasteContext, clientContext = {}) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: ROUTER_INSTRUCTIONS },
        {
          role: "user",
          content: JSON.stringify({
            request: message,
            context: buildCompactRoutingContext(tasteContext),
            clientContext,
            now: new Date().toISOString(),
          }),
        },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 450,
      stream: false,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `DeepSeek HTTP ${response.status}`);

  const text = data?.choices?.[0]?.message?.content || "";
  return JSON.parse(extractJsonObject(text));
}

async function createOpenAiIntentRoute(message, tasteContext, clientContext = {}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: ROUTER_INSTRUCTIONS,
      input: JSON.stringify({
        request: message,
        context: buildCompactRoutingContext(tasteContext),
        clientContext,
        now: new Date().toISOString(),
      }),
      max_output_tokens: 450,
      store: false,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);

  const text = extractResponseText(data);
  return JSON.parse(extractJsonObject(text));
}

function createLocalIntentRoute(message) {
  const hardRoute = inferHardRoute(message);
  if (hardRoute) return hardRoute;

  return {
    intent: "music_chat",
    confidence: 0.45,
    shouldSearchMusic: false,
    shouldReplaceQueue: false,
    shouldShowTrackCards: false,
    replyMode: "chat_only",
    mood: "random",
    scene: "chat",
    queryHints: [],
    answer: "这句我先按聊天理解，不直接改播放列表。",
    reason: "请求不够明确，先不触发推荐或播放。",
  };
}

function buildCompactRoutingContext(tasteContext = {}) {
  const profile = tasteContext.distilledProfile || {};

  return {
    tasteSummary: {
      summary: String(profile.summary || "").slice(0, 900),
      styleTags: compactProfileList(profile.styleTags, 10),
      preferredArtists: compactProfileList(profile.preferredArtists, 24),
      preferredSongs: compactProfileList(profile.preferredSongs, 24),
      preferredAlbums: compactProfileList(profile.preferredAlbums, 12),
      recommendationGuidelines: compactProfileList(profile.recommendationGuidelines, 12),
      recommendationSeeds: compactProfileList(profile.recommendationSeeds, 24),
      recentLikedSongs: compactProfileList(profile.recentLikedSongs, 16),
      playlistNameSignals: compactProfileList(profile.playlistNameSignals, 12),
    },
    tasteProfile: {
      tags: tasteContext.tasteProfile?.tags || [],
      liked: compactProfileList(tasteContext.tasteProfile?.liked, 10),
      disliked: compactProfileList(tasteContext.tasteProfile?.disliked, 10),
      scenePreferences: tasteContext.tasteProfile?.scenePreferences || {},
    },
    nowPlaying: tasteContext.nowPlaying || null,
    recentPlays: compactProfileList(tasteContext.recentPlays, 10),
    currentQueue: compactProfileList(tasteContext.currentQueue, 10),
    recentMessages: compactProfileList(tasteContext.recentMessages, 6),
    profileLikedSongCount: tasteContext.profileLikedSongCount || 0,
  };
}

function compactProfileList(value, limit) {
  return (Array.isArray(value) ? value : [])
    .slice(0, limit)
    .map(compactProfileItem)
    .filter(Boolean);
}

function compactProfileItem(item) {
  if (item == null) return null;
  if (typeof item !== "object") return String(item).slice(0, 160);

  return {
    name: item.name || item.title || item.artist || item.album || item.tag || "",
    title: item.title || "",
    artist: item.artist || "",
    tags: Array.isArray(item.styleTags) ? item.styleTags.slice(0, 4) : Array.isArray(item.tags) ? item.tags.slice(0, 4) : [],
    count: item.count || item.playCount || item.likedTrackCount || item.allTimePlayCount || 0,
    reason: item.reason || item.intent || "",
    text: item.text || "",
    role: item.role || "",
  };
}

function normalizeIntentRoute(route, message, clientContext = {}) {
  const fallbackScene = buildRecommendationScene(message, clientContext);
  const intent = ["recommend", "playlist", "music_chat", "library_query", "control"].includes(route?.intent)
    ? route.intent
    : "music_chat";
  const mood = ["focus", "chill", "energy", "sleep", "random"].includes(route?.mood)
    ? route.mood
    : fallbackScene.mood;
  const replyMode =
    intent === "playlist" ? "replace_queue" : intent === "recommend" ? "recommend_with_cards" : "chat_only";
  const shouldSearchMusic = intent === "recommend" || intent === "playlist";
  const shouldReplaceQueue = intent === "playlist" || route?.shouldReplaceQueue === true;
  const shouldShowTrackCards = intent === "recommend" && route?.shouldShowTrackCards !== false;

  return {
    intent,
    confidence: normalizeConfidence(route?.confidence),
    shouldSearchMusic,
    shouldReplaceQueue,
    shouldShowTrackCards,
    replyMode,
    mood,
    scene: String(route?.scene || "unknown").slice(0, 40),
    queryHints: normalizeRouteQueryHints(route, message),
    answer: cleanVisibleDjLine(String(route?.answer || "").slice(0, 360)),
    reason: sanitizePublicRouteText(route?.reason, "按请求整理推荐方向。"),
    recommendationCount: normalizeRouteRecommendationCount(route?.recommendationCount),
  };
}

function sanitizePublicRouteText(value, fallback = "") {
  const text = cleanVisibleDjLine(String(value || "").slice(0, 220));
  return isInternalRouteText(text) ? fallback : text || fallback;
}

function isInternalRouteText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (!/[\u3400-\u9fff]/u.test(text)) return true;
  return /\b(route|intent|explicit|button|fallback|chat[-_ ]?only|recommendation request|playlist request)\b/i.test(text);
}

function normalizeRouteRecommendationCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(2, Math.min(CHAT_RECOMMENDATION_LIMIT, Math.floor(number)));
}

function getRouteRecommendationLimit(route, fallbackLimit) {
  const requested = normalizeRouteRecommendationCount(route?.recommendationCount);
  if (requested) return requested;
  return Math.max(1, Math.min(CHAT_RECOMMENDATION_LIMIT, Number(fallbackLimit) || CHAT_RECOMMENDATION_LIMIT));
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function normalizeRouteQueryHints(route, message) {
  const values = [];
  if (Array.isArray(route?.queryHints)) values.push(...route.queryHints);
  if (Array.isArray(route?.seedQueries)) {
    for (const item of route.seedQueries) values.push(typeof item === "string" ? item : item?.query);
  }
  if (Array.isArray(route?.queue)) values.push(...route.queue);
  if (route?.search) values.push(route.search);
  values.push(...extractRequestKeywords(message));

  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 10);
}

function routeToRecommendationPlan(route, message, state, tasteContext, clientContext = {}) {
  const fallback = createProfilePlan(message, state, tasteContext, clientContext);
  const routeQueries = route.queryHints?.length ? route.queryHints : [];
  const requestedTrackQueries = getRequestedTrackQueriesForPlan(message, route, routeQueries);
  const playlistSearchQuery = getPlaylistSearchQueryForPlan(message, routeQueries);
  const strictPlaylistTheme = isExternalNcmPlaylistRequest(message);
  const mood = route.mood || fallback.mood;
  const keywords = [...new Set([playlistSearchQuery, ...requestedTrackQueries, ...routeQueries, ...(fallback.scene?.keywords || [])].filter(Boolean))].slice(0, 16);
  const scene = {
    ...fallback.scene,
    mood,
    keywords,
  };
  const seedQueryValues = [...new Set([...requestedTrackQueries, ...(routeQueries.length ? routeQueries : keywords)])];
  const seedQueries = seedQueryValues.map((query, index) => ({
    query,
    intent: route.reason || "intent-route",
    weight: Math.max(1, keywords.length - index),
  }));

  return {
    ...fallback,
    intent: route.intent === "playlist" || strictPlaylistTheme ? "playlist" : "recommend",
    say: cleanVisibleDjLine(route.answer || fallback.say),
    reason: sanitizePublicRouteText(route.reason, fallback.reason),
    mood,
    search: requestedTrackQueries[0] || routeQueries[0] || fallback.search,
    seedQueries,
    queue: seedQueries.map((item) => item.query),
    scene,
    requestedTrackQueries,
    playlistSearchQuery,
    strictPlaylistTheme,
    exactTrackOnly: requestedTrackQueries.length > 0 && isExactTrackSearchRequest(message),
  };
}

function shouldUseAiRecommendationPlan(message, route = {}, mode = "chat") {
  if (AI_PROVIDER === "local") return false;
  if (mode === "playlist" || route.intent === "playlist" || route.replyMode === "replace_queue") return true;
  return isComplexSongListRequest(message);
}

async function createAiBackedRecommendationPlan(message, routePlan, state, tasteContext, clientContext = {}) {
  try {
    const aiPlan = await createDjPlan(message, state, tasteContext, clientContext);
    return mergeAiRecommendationPlan(routePlan, aiPlan, message);
  } catch (error) {
    console.warn("AI recommendation plan failed, using routed plan:", error.message);
    return routePlan;
  }
}

function mergeAiRecommendationPlan(routePlan, aiPlan = {}, message) {
  if (!aiPlan || typeof aiPlan !== "object") return routePlan;

  const localRequested = normalizeRequestedTrackQueries(extractRequestedTrackQueries(message));
  const aiRequested = normalizeRequestedTrackQueries(aiPlan.requestedTrackQueries);
  const requestedTrackQueries = aiRequested.length ? aiRequested : localRequested;
  const seedQueries = normalizeSeedQueries(
    [
      ...requestedTrackQueries.map((query, index) => ({
        query,
        intent: "requested-track",
        weight: 100 - index,
      })),
      ...(Array.isArray(aiPlan.seedQueries) ? aiPlan.seedQueries : []),
    ],
    aiPlan.queue,
    cleanRecommendationSearchQuery(aiPlan.search) || routePlan.search,
  ).filter((item) => isUsableRecommendationQuery(item.query));
  const fallbackSeedQueries = (Array.isArray(routePlan.seedQueries) ? routePlan.seedQueries : [])
    .filter((item) => isUsableRecommendationQuery(item?.query));
  const finalSeedQueries = seedQueries.length ? seedQueries : fallbackSeedQueries;
  const search = cleanRecommendationSearchQuery(aiPlan.search) || finalSeedQueries[0]?.query || routePlan.search;
  const playlistSearchQuery =
    cleanRecommendationSearchQuery(aiPlan.playlistSearchQuery) ||
    routePlan.playlistSearchQuery ||
    "";
  const mood = ["focus", "chill", "energy", "sleep", "random"].includes(aiPlan.mood)
    ? aiPlan.mood
    : routePlan.mood;
  const sceneKeywords = [
    ...requestedTrackQueries,
    playlistSearchQuery,
    ...finalSeedQueries.map((item) => item.query),
    ...(routePlan.scene?.keywords || []).filter(isUsableRecommendationQuery),
  ];

  return {
    ...routePlan,
    say: cleanVisibleDjLine(String(aiPlan.say || routePlan.say || "").slice(0, 60)),
    reason: sanitizePublicRouteText(aiPlan.reason, routePlan.reason),
    mood,
    search,
    seedQueries: finalSeedQueries,
    queue: finalSeedQueries.map((item) => item.query),
    avoid: Array.isArray(aiPlan.avoid) ? aiPlan.avoid.slice(0, 12).map(String) : routePlan.avoid || [],
    voice: Boolean(aiPlan.voice),
    requestedTrackQueries,
    playlistSearchQuery,
    exactTrackOnly: requestedTrackQueries.length > 0 && (routePlan.exactTrackOnly || Boolean(aiPlan.exactTrackOnly)),
    scene: {
      ...routePlan.scene,
      ...(aiPlan.scene && typeof aiPlan.scene === "object" ? aiPlan.scene : {}),
      mood,
      keywords: [...new Set(sceneKeywords.map(cleanRecommendationSearchQuery).filter(Boolean))].slice(0, 16),
    },
  };
}

function isComplexSongListRequest(message) {
  const raw = String(message || "");
  if (!raw.trim()) return false;
  if (/想听.+(?:和|以及|还有|、).+/u.test(raw)) return true;
  if (/不要.*重复|别.*重复|不重复/u.test(raw)) return true;
  return /(?:来一期|歌单|一些|几首|经典|主题)/u.test(raw) && /(?:想听|播放|推荐|来点|放点)/u.test(raw);
}

function getPlaylistSearchQueryForPlan(message, routeQueries = []) {
  const raw = String(message || "");
  const wantsExternalPlaylist = isExternalNcmPlaylistRequest(raw);
  if (!wantsExternalPlaylist) return "";

  const knownTheme = getKnownThemeQuery(raw);
  if (knownTheme) return knownTheme;

  const cleaned = raw
    .replace(/今晚|夜晚|晚上|想听|想重温|重温一下|你能|能不能|可以|帮我|找一下|找一份|找|搜索|相关|相似|里面的|高度|主题|经典曲目|曲目|歌单|音乐|歌曲|吗|呢|吧/gu, " ")
    .replace(/[，。！？,.!?、]/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (cleaned.length >= 2 && cleaned.length <= 40) return cleaned;

  return routeQueries.find((query) => String(query || "").trim().length >= 2) || "";
}

function isExternalNcmPlaylistRequest(message) {
  const raw = String(message || "");
  if (!raw.trim()) return false;
  return /找|搜索|搜|重温|相关|主题|经典|曲目|ost|op|ed|原声|合集|playlist/i.test(raw) &&
    /歌单|曲目|ost|op|ed|原声|主题|经典|重温|相关|合集|playlist/i.test(raw);
}

function getKnownThemeQuery(value) {
  const text = normalizeSearchText(value);
  if (containsAny(text, ["进击的巨人", "進撃の巨人", "attackontitan", "shingekinokyojin", "巨人ost", "巨人op", "巨人ed"])) {
    return "进击的巨人 OST OP ED";
  }

  return "";
}

function getRequestedTrackQueriesForPlan(message, route = {}, routeQueries = []) {
  const extracted = extractRequestedTrackQueries(message);
  if (extracted.length) return extracted;
  if (!shouldUseRouteQueryFallbackForRequestedTracks(message)) return [];

  const values = [];
  if (route?.search) values.push(route.search);
  values.push(...routeQueries);

  return normalizeRequestedTrackQueries(values).slice(0, 4);
}

function shouldUseRouteQueryFallbackForRequestedTracks(message) {
  const text = normalizeSearchText(message);
  return containsAny(text, ["这首歌", "这首", "这歌", "单独搜索", "指定", "加进去", "加入", "加到", "没看见", "没有看见", "在哪里", "在哪"]);
}

async function createRoutedChatResponse(message, state, tasteContext, route) {
  const assistantText = route.answer || buildInformationalChatReply(message, tasteContext, route.intent);
  const now = new Date().toISOString();

  state.messages.push({ role: "user", text: message, at: now });
  state.messages.push({ role: "assistant", text: assistantText, at: now });
  state.messages = normalizeConversationMessages(state.messages, 40);
  state.updatedAt = now;
  await writeState(state);

  return {
    ok: true,
    mode: "chat",
    limit: 0,
    route,
    plan: {
      intent: route.intent,
      say: route.answer ? route.answer.slice(0, 60) : "只聊这轮内容",
      reason: route.reason || "这轮请求不是推荐播放任务。",
      mood: route.mood || "random",
      search: "",
      seedQueries: [],
      queue: [],
      avoid: [],
      voice: false,
    },
    tracks: [],
    assistantText,
    tasteContext: summarizeTasteContext(tasteContext),
    source: {
      brain: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
      music: "library",
    },
  };
}

async function createDjPlan(message, state, tasteContext, clientContext = {}) {
  if (AI_PROVIDER === "deepseek") {
    try {
      return normalizePlan(await createDeepSeekPlan(message, tasteContext), message, clientContext);
    } catch (error) {
      console.warn("DeepSeek plan failed, falling back to local profile plan:", error.message);
    }
  }

  if (AI_PROVIDER === "openai") {
    try {
      return normalizePlan(await createOpenAiPlan(message, tasteContext), message, clientContext);
    } catch (error) {
      console.warn("OpenAI plan failed, falling back to local profile plan:", error.message);
    }
  }

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
  const baseReason = [
    scene.timeSlotLabel,
    scene.isWeekend ? "weekend" : "weekday",
    clientContext.weather || "",
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    intent: "recommend",
    say: mood === "energy" ? "这轮把节奏提亮一点" : mood === "sleep" ? "这轮把声音放轻一点" : "按我的口味排好了",
    reason: `按我的歌库、相邻风格和当前场景做了筛选。${baseReason}`,
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

async function createInformationalChatResponse(message, state, tasteContext, clientContext, intent) {
  const assistantText = buildInformationalChatReply(message, tasteContext, intent);
  const now = new Date().toISOString();

  state.messages.push({ role: "user", text: message, at: now });
  state.messages.push({ role: "assistant", text: assistantText, at: now });
  state.messages = normalizeConversationMessages(state.messages, 40);
  state.updatedAt = now;
  await writeState(state);

  return {
    ok: true,
    mode: "chat",
    limit: 0,
    plan: {
      intent,
      say: intent === "library_query" ? "查了本地曲库" : "只聊这轮内容",
      reason: "这轮请求不是推荐播放任务。",
      mood: "random",
      search: "",
      seedQueries: [],
      queue: [],
      avoid: [],
      voice: false,
    },
    tracks: [],
    assistantText,
    tasteContext: summarizeTasteContext(tasteContext),
    source: {
      brain: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
      music: "library",
    },
  };
}

async function createPlannedInformationalChatResponse(message, state, tasteContext, plan) {
  const fallbackText = buildInformationalChatReply(message, tasteContext, plan.intent);
  const assistantText = [plan.say, plan.reason]
    .map((line) => cleanVisibleDjLine(line))
    .filter(Boolean)
    .join("\n") || fallbackText;
  const now = new Date().toISOString();

  state.messages.push({ role: "user", text: message, at: now });
  state.messages.push({ role: "assistant", text: assistantText, at: now });
  state.messages = normalizeConversationMessages(state.messages, 40);
  state.updatedAt = now;
  await writeState(state);

  return {
    ok: true,
    mode: "chat",
    limit: 0,
    plan,
    tracks: [],
    assistantText,
    tasteContext: summarizeTasteContext(tasteContext),
    source: {
      brain: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
      music: "library",
    },
  };
}

function inferChatIntent(message) {
  const text = normalizeSearchText(message);
  const asksRecommendationLogic = containsAny(text, [
    "逻辑",
    "为什么推荐",
    "为啥推荐",
    "怎么推荐",
    "怎么选",
    "推荐原因",
    "推荐理由",
    "依据",
    "思路",
    "这次推荐",
    "这轮推荐",
  ]);
  const asksNew = containsAny(text, [
    "新歌",
    "新增",
    "新收藏",
    "最近收藏",
    "最近新增",
    "最近加",
    "刚收藏",
    "刚加",
    "新加",
    "近期收藏",
    "latest",
    "recent",
  ]);
  const asksLibrary = containsAny(text, [
    "歌单",
    "收藏",
    "喜欢的音乐",
    "曲库",
    "我的歌",
    "哪些",
    "哪几首",
    "有什么",
  ]);
  const asksQuestion = containsAny(text, ["哪些", "哪几首", "有什么", "查一下", "看看", "列一下"]);
  const asksTasteAnalysis = containsAny(text, [
    "你觉得",
    "如何",
    "怎么样",
    "怎么看",
    "品味",
    "口味",
    "含量",
    "占比",
    "比例",
    "分析",
    "评价",
    "风格",
    "感觉",
  ]);

  if (asksRecommendationLogic) return "music_chat";
  if (asksNew && asksLibrary) return "library_query";
  if (asksQuestion && asksLibrary) return "library_query";
  if (containsAny(text, ["哪些是新歌", "有什么新歌", "最近有什么", "最近加了什么"])) return "library_query";
  if (asksTasteAnalysis) return "music_chat";

  if (
    containsAny(text, [
      "推荐",
      "来点",
      "放点",
      "播放",
      "想听",
      "帮我选",
      "生成",
      "加到队列",
      "排一组",
      "换一批",
      "推歌",
      "找几首",
    ])
  ) {
    return "recommend";
  }

  if (
    containsAny(text, [
      "聊聊",
      "感受",
      "感觉",
      "评价",
      "怎么看",
      "分析",
      "这首",
      "这歌",
      "某首",
      "风格",
      "为什么",
      "好听",
      "歌词",
      "旋律",
    ])
  ) {
    return "music_chat";
  }

  return "recommend";
}

function buildInformationalChatReply(message, tasteContext, intent) {
  const profileSongs = getProfileSongs(tasteContext);

  if (intent === "library_query") {
    return buildLibraryQueryReply(message, profileSongs);
  }

  if (asksRecommendationLogic(message)) {
    return buildRecommendationLogicReply(tasteContext);
  }

  const song = findReferencedProfileSong(message, profileSongs, tasteContext.nowPlaying);
  if (song) return buildSongChatReply(song);

  return "可以，只聊这件事，不动播放队列。把歌名、歌手或你想聊的点说具体一点，我会按我的歌库和听感线索接着聊。";
}

function asksRecommendationLogic(message) {
  const text = normalizeSearchText(message);
  return containsAny(text, [
    "逻辑",
    "为什么推荐",
    "为啥推荐",
    "怎么推荐",
    "怎么选",
    "推荐原因",
    "推荐理由",
    "依据",
    "思路",
    "这次推荐",
    "这轮推荐",
  ]);
}

function buildRecommendationLogicReply(tasteContext) {
  const profile = tasteContext.distilledProfile || {};
  const styleTags = Array.isArray(profile.styleTags) ? profile.styleTags.slice(0, 4).map((item) => item.name || item.tag || item).filter(Boolean) : [];
  const currentMood = tasteContext.nowPlaying?.mood || "";
  const currentQueue = Array.isArray(tasteContext.currentQueue) ? tasteContext.currentQueue.length : 0;
  const signals = [
    styleTags.length ? `我的歌库里 ${styleTags.join(" / ")} 权重比较高` : "我的歌库是主要口味锚点",
    currentMood ? `当前氛围偏 ${translateMoodForReply(currentMood)}` : "",
    currentQueue ? "同时会参考右侧队列的整体方向，避免风格突然断开" : "",
  ].filter(Boolean);

  return `这次的逻辑是先看我的收藏口味，再按当前场景收窄到相邻风格。\n${signals.join("；")}。\n我不会把内部过滤掉的歌名展开，聊天里只保留听感和方向。`;
}

function translateMoodForReply(value) {
  return {
    focus: "专注",
    chill: "放松",
    energy: "高能",
    sleep: "睡眠",
    random: "随机探索",
  }[value] || value;
}

function buildLibraryQueryReply(message, songs) {
  if (!songs.length) return "我还没读到本地歌单画像，所以暂时查不到哪些是新歌。";

  const text = normalizeSearchText(message);
  const byRelease = containsAny(text, ["发行", "发布", "新发行", "今年", "2026", "2025"]);
  const ranked = [...songs]
    .filter((song) => (byRelease ? song.publishYear : song.addedAt))
    .sort((a, b) => {
      if (byRelease) return (b.publishYear || 0) - (a.publishYear || 0) || (b.addedAt || 0) - (a.addedAt || 0);
      return (b.addedAt || 0) - (a.addedAt || 0);
    })
    .slice(0, 8);

  if (!ranked.length) return "本地歌单画像里没有足够的时间信息，暂时排不出新歌列表。";

  const heading = byRelease ? "按发行年份看，我收藏里比较新的歌是：" : "按加入我的歌库的时间看，最近新增的是：";
  const lines = ranked.map((song, index) => {
    const date = byRelease ? `${song.publishYear || "未知年份"}发行` : `${formatShortDate(song.addedAt)}加入我的歌库`;
    const tags = (song.styleTags || []).slice(0, 2).join(" / ");
    return `${index + 1}. ${formatSongName(song)}（${date}${tags ? `，${tags}` : ""}）`;
  });

  return [heading, ...lines].join("\n");
}

function buildSongChatReply(song) {
  const tags = (song.styleTags || []).slice(0, 5);
  const style = song.primaryStyle || tags[0] || "风格标签不明显";
  const meta = [
    song.publishYear ? `${song.publishYear}年发行` : "",
    song.addedAt ? `${formatShortDate(song.addedAt)}加入我的歌库` : "",
    song.allTimePlayCount ? `历史播放 ${song.allTimePlayCount} 次` : "",
  ].filter(Boolean);
  const feel = describeSongFeel(tags, style);

  return [
    `《${song.title}》在我的歌库里更接近 ${style}。`,
    tags.length ? `标签是：${tags.join(" / ")}。` : "",
    feel,
    meta.length ? meta.join("，") + "。" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function describeSongFeel(tags, style) {
  const text = normalizeSearchText([style, ...tags].join(" "));

  if (containsAny(text, ["disco", "funk", "retro", "复古", "活力"])) {
    return "听感重点是明亮律动和复古舞曲感，适合聊那种轻快、带一点霓虹色的心动氛围。";
  }
  if (containsAny(text, ["jazz", "爵士"])) {
    return "听感重点是松弛的和声和摇摆感，比起强情绪推进，更像适合慢慢晃进去的氛围。";
  }
  if (containsAny(text, ["acg", "anime", "日语", "国漫"])) {
    return "听感更偏角色感和画面感，情绪通常不是只靠旋律，而是靠声线、编曲和记忆点一起成立。";
  }
  if (containsAny(text, ["ambient", "piano", "纯音乐", "治愈"])) {
    return "听感更偏留白和包裹感，适合聊空间、质感和它为什么会让人放松。";
  }

  return "从标签看，它更像一首靠整体气质留下印象的歌，可以从编曲、声线和你收藏它的时间点继续聊。";
}

function findReferencedProfileSong(message, songs, nowPlaying) {
  const query = normalizeSearchText(message);

  if (nowPlaying && containsAny(query, ["这首", "这歌", "当前", "现在放"])) {
    const current = songs.find((song) => String(song.id || "") === String(nowPlaying.id || ""));
    if (current) return current;
  }

  const scored = songs
    .map((song) => {
      const aliases = getSongAliases(song);
      const score = aliases.reduce((best, alias) => {
        if (!alias || alias.length < 2 || !query.includes(alias)) return best;
        return Math.max(best, alias.length + (alias === normalizeSearchText(song.title) ? 40 : 0));
      }, 0);
      return { song, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.song || null;
}

function getSongAliases(song) {
  const title = String(song.title || "");
  const artist = String(song.artist || "");
  const titleWithoutParen = title.replace(/\s*[\(\（［\[].*?[\)\）］\]]\s*/g, " ").trim();

  return [
    title,
    titleWithoutParen,
    ...title.split(/[-/:：|]/),
    `${title} ${artist}`,
    artist,
    ...(Array.isArray(song.artists) ? song.artists : []),
  ]
    .map(normalizeSearchText)
    .filter(Boolean);
}

function getProfileSongs(tasteContext) {
  const rawSongs = Array.isArray(tasteContext.distilledProfile?.allLikedSongs)
    ? tasteContext.distilledProfile.allLikedSongs
    : [];

  return rawSongs
    .map((song) => ({
      id: String(song?.id || ""),
      title: String(song?.title || ""),
      artist: String(song?.artist || ""),
      artists: Array.isArray(song?.artists) ? song.artists.map(String).filter(Boolean) : [],
      album: String(song?.album || ""),
      styleTags: Array.isArray(song?.styleTags) ? song.styleTags.map(String).filter(Boolean) : [],
      primaryStyle: String(song?.primaryStyle || ""),
      publishYear: normalizeNumber(song?.publishYear),
      addedAt: normalizeNumber(song?.addedAt),
      allTimePlayCount: normalizeNumber(song?.allTimePlayCount),
    }))
    .filter((song) => song.id && song.title);
}

function formatSongName(song) {
  return [song.title, song.artist].filter(Boolean).join(" - ");
}

function formatShortDate(timestamp) {
  if (!timestamp) return "未知日期";
  return new Date(timestamp).toISOString().slice(0, 10);
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
    say: "按我的口味试播",
    reason: "先用这次输入做网易云搜索，再根据我的喜欢和不喜欢继续收敛。",
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
      negativeFeedback: summarizeNegativeFeedback(state.tasteProfile?.negativeFeedback || [], 30),
      scenePreferences: summarizeScenePreferences(state.tasteProfile?.scenePreferences || {}),
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
  const requestedTracks = options.skipRequestedTracks
    ? []
    : await resolveRequestedTrackCandidates(plan, state, Math.min(limit, CHAT_RECOMMENDATION_LIMIT), {
        ...options,
        recommendationContext,
      });

  if (plan.exactTrackOnly) return requestedTracks.slice(0, limit);

  const remainingLimit = Math.max(0, limit - requestedTracks.length);
  if (!remainingLimit) return requestedTracks.slice(0, limit);

  const profileTracks = await resolveProfileRecommendedTracks(plan, state, limit, {
    ...options,
    recommendationContext,
  });

  if (profileTracks.length >= remainingLimit) {
    return dedupeRecommendedTracks([...requestedTracks, ...profileTracks], recommendationContext).slice(0, limit);
  }

  const fallbackTracks = await resolveSearchRecommendedTracks(plan, state, remainingLimit - profileTracks.length, {
    ...options,
    recommendationContext,
  });
  const merged = dedupeRecommendedTracks(weaveTrackGroups(profileTracks, fallbackTracks, limit), recommendationContext);

  return dedupeRecommendedTracks([...requestedTracks, ...merged], recommendationContext).slice(0, limit);
}

async function resolvePlaylistSearchTracks(plan, state, limit = PLAYLIST_RECOMMENDATION_LIMIT, options = {}) {
  const query = String(plan.playlistSearchQuery || plan.search || "").trim();
  if (!query || limit <= 0 || !NCM_API_BASE) return [];

  const excludedTracks = Array.isArray(options.excludedTracks) ? options.excludedTracks : [];
  const seen = new Set(excludedTracks.map(trackIdentity));
  const tracks = [];

  for (const searchQuery of buildPlaylistSearchQueries(query)) {
    if (tracks.length >= limit) break;

    const playlists = rankNcmPlaylists(searchQuery, await searchNcmPlaylists(searchQuery, NCM_PLAYLIST_SEARCH_LIMIT)).slice(0, 6);
    for (const playlist of playlists) {
      if (tracks.length >= limit) break;

      for (const offset of [0, NCM_PLAYLIST_TRACK_PROBE_LIMIT, NCM_PLAYLIST_TRACK_PROBE_LIMIT * 2]) {
        if (tracks.length >= limit) break;

        const playlistTracks = await getPlaylistTracks(playlist.id, NCM_PLAYLIST_TRACK_PROBE_LIMIT, offset);
        for (const track of playlistTracks) {
          if (tracks.length >= limit) break;
          if (!track.playable || !isReasonableRecommendationTrack(track)) continue;
          if (isDislikedCandidate(track, state)) continue;
          const identity = trackIdentity(track);
          if (seen.has(identity)) continue;
          seen.add(identity);
          tracks.push({
            ...track,
            recommendSource: "ncm-playlist-search",
            recommendQuery: searchQuery,
            sourcePlaylistId: playlist.id,
            sourcePlaylistName: playlist.name,
          });
        }
      }
    }
  }

  return dedupeTracks(tracks).slice(0, limit);
}

function buildPlaylistSearchQueries(query) {
  const values = [query];
  const text = normalizeSearchText(query);

  if (containsAny(text, ["进击的巨人", "進撃の巨人", "attackontitan", "shingekinokyojin", "巨人"])) {
    values.push(
      "进击的巨人",
      "进击的巨人 OST",
      "进击的巨人 OP ED",
      "進撃の巨人",
      "進撃の巨人 OST",
      "Attack on Titan OST",
      "Shingeki no Kyojin",
    );
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function resolveRequestedTrackCandidates(plan, state, limit, options = {}) {
  const queries = Array.isArray(plan.requestedTrackQueries) ? plan.requestedTrackQueries : [];
  if (!queries.length || limit <= 0) return [];

  const tracks = [];
  const recommendationContext = options.recommendationContext || buildRecommendationFilterContext(state, options.tasteContext);

  for (const query of queries) {
    if (tracks.length >= limit) break;
    const found = await searchMusic(query, 8, {
      playableOnly: false,
      recommendationContext,
    });
    const candidate = selectRequestedTrackCandidate(found, query, recommendationContext);
    if (!candidate) continue;
    if (tracks.some((track) => trackIdentity(track) === trackIdentity(candidate))) continue;
    tracks.push({
      ...candidate,
      recommendSource: "requested-track",
      recommendQuery: query,
      userRequested: true,
    });
  }

  return tracks.slice(0, limit);
}

function selectRequestedTrackCandidate(tracks, query, recommendationContext) {
  return (Array.isArray(tracks) ? tracks : [])
    .map((track) => ({ track, score: scoreRequestedTrackMatch(track, query, recommendationContext) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.track || null;
}

function scoreRequestedTrackMatch(track, query, recommendationContext) {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(track?.title);
  const cleanTitle = normalizeSongTitleForMatch(track?.title);
  const haystack = normalizeSearchText(`${track?.title || ""}${track?.artist || ""}${track?.album || ""}`);
  if (!normalizedQuery || !title) return 0;

  let score = 0;
  if (title === normalizedQuery) score += 1000;
  else if (cleanTitle === normalizedQuery) score += 980;
  else if (title.includes(normalizedQuery) || normalizedQuery.includes(title)) score += 620;
  else if (cleanTitle.includes(normalizedQuery) || normalizedQuery.includes(cleanTitle)) score += 600;
  else if (getTextSimilarity(cleanTitle || title, normalizedQuery) >= 0.8) score += 540;
  else if (haystack.includes(normalizedQuery)) score += 320;
  else return 0;

  if (track.playable && track.url) score += 140;
  if (track.duration && track.duration <= MAX_RECOMMENDATION_DURATION_MS) score += 30;
  if (isAlternateVersionTitle(track?.title)) score -= 90;

  const expectedArtists = findKnownArtistsForTitle(title, recommendationContext);
  if (expectedArtists) {
    const artists = splitArtistNames(track.artist).map(normalizeSearchText).filter(Boolean);
    if (artists.some((artist) => artistMatchesAny(artist, expectedArtists))) score += 180;
    else score -= 260;
  }

  return score;
}

async function resolveProfileRecommendedTracks(plan, state, limit, options = {}) {
  const profile = options.tasteContext?.distilledProfile || {};
  const profileSongs = normalizeProfileSongs(profile.allLikedSongs);
  if (!profileSongs.length) return [];

  const scene = plan.scene || buildRecommendationScene(plan.search || "", options.clientContext || {});
  const recommendationContext = options.recommendationContext || buildRecommendationFilterContext(state, options.tasteContext);
  const recentIds = new Set((state.plays || []).slice(-50).map((track) => String(track.id || "")).filter(Boolean));
  const currentQueueIds = new Set((state.queue || []).map((track) => String(track.id || "")).filter(Boolean));
  const recentRadioIds = getRecentRadioHistoryTrackIds(state);
  const likedIds = new Set(profileSongs.map((song) => String(song.id)).filter(Boolean));
  const similarTarget = limit >= 3 ? Math.max(1, Math.floor(limit * (1 - PROFILE_RECOMMENDATION_LIKED_RATIO))) : 0;
  const likedTarget = Math.max(1, limit - similarTarget);
  const rankedSongs = rankProfileSongs(profileSongs, {
    scene,
    plan,
    state,
    recentIds,
    currentQueueIds,
    recentRadioIds,
    runSalt: getRadioHistorySalt(state),
  }).slice(0, PROFILE_RECOMMENDATION_CANDIDATE_LIMIT);
  const likedTracks = await enrichProfileSongCandidates(
    rankedSongs,
    likedTarget,
    state,
    recommendationContext,
  );
  const similarTracks = [];

  if (similarTarget > 0 && likedTracks.length) {
    const similarSeeds = likedTracks
      .slice(0, Math.max(NCM_SIMILAR_SEED_LIMIT, Math.ceil(similarTarget / 2)))
      .map((track) => ({ id: track.id, title: track.title, artist: track.artist, provider: "netease" }));
    const fetchedSimilarTracks = await getSimilarTracks(similarSeeds, similarTarget, recommendationContext, {
      excludedIds: likedIds,
    });

    for (const track of fetchedSimilarTracks) {
      if (shouldRejectRecommendationTrack(track, state, recommendationContext)) continue;
      if (likedTracks.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (similarTracks.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (hasKnownTitleDuplicate([...likedTracks, ...similarTracks], track, recommendationContext)) continue;
      similarTracks.push({ ...track, recommendSource: "similar-song" });
      if (similarTracks.length >= similarTarget) break;
    }
  }

  let tracks = weaveTrackGroups(likedTracks, similarTracks, limit);

  if (tracks.length < limit) {
    const extraLiked = await enrichProfileSongCandidates(
      rankedSongs.slice(likedTarget),
      limit - tracks.length,
      state,
      recommendationContext,
      new Set(tracks.map((track) => String(track.id))),
    );
    tracks = weaveTrackGroups(tracks, extraLiked, limit);
  }

  return dedupeRecommendedTracks(tracks, recommendationContext).slice(0, limit);
}

function rankProfileSongs(songs, context) {
  const seed = buildDailySeed(context.scene);

  return songs
    .map((song) => ({
      song,
      score: scoreProfileSong(song, context) + seededJitter(`${seed}:${context.runSalt || ""}:${song.id}`),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ song }) => song);
}

function scoreProfileSong(song, { scene, plan, state, recentIds, currentQueueIds, recentRadioIds }) {
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
  const recentRadioPenalty = recentRadioIds?.has(String(song.id)) ? -72 : 0;
  const playScore = Math.log1p(Number(song.allTimePlayCount || 0)) * 8 + Number(song.weeklyPlayCount || 0) * 5;
  const addedScore = scoreAddedAt(song.addedAt);
  const eraScore = scoreEra(song, scene);
  const moodScore = scoreMoodFit(song, scene);
  const requestBoost = plan.search && text.includes(normalizeSearchText(plan.search)) ? 14 : 0;
  const preferenceScore = scoreScenePreference(song, scene, state);

  return 50 + keywordMatches + styleMatches + playScore + addedScore + eraScore + moodScore + requestBoost + preferenceScore + recentPenalty + queuePenalty + recentRadioPenalty;
}

function getRecentRadioHistoryTrackIds(state) {
  const ids = new Set();
  const radios = Array.isArray(state.radioHistory) ? state.radioHistory.slice(0, RADIO_HISTORY_REPEAT_PENALTY_LIMIT) : [];
  for (const radio of radios) {
    for (const track of radio?.tracks || []) {
      if (track?.id) ids.add(String(track.id));
    }
  }
  return ids;
}

function getRadioHistorySalt(state) {
  const radios = Array.isArray(state.radioHistory) ? state.radioHistory.slice(0, 3) : [];
  return `${radios.length}:${radios.map((radio) => radio?.id || radio?.createdAt || "").join("|")}`;
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
    const acceptedDailyTracks = [];
    for (const track of dailyTracks) {
      if (acceptedDailyTracks.length >= limit - deduped.length) break;
      if (shouldRejectRecommendationTrack(track, state, recommendationContext)) continue;
      if (deduped.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (acceptedDailyTracks.some((item) => trackIdentity(item) === trackIdentity(track))) continue;
      if (hasKnownTitleDuplicate(deduped, track, recommendationContext)) continue;
      acceptedDailyTracks.push({ ...track, recommendQuery: "netease-daily" });
    }
    return dedupeRecommendedTracks(weaveTrackGroups(deduped, acceptedDailyTracks, limit), recommendationContext).slice(0, limit);
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

function weaveTrackGroups(primaryTracks, secondaryTracks, limit = PLAYLIST_RECOMMENDATION_LIMIT) {
  const primary = Array.isArray(primaryTracks) ? primaryTracks.filter(Boolean) : [];
  const secondary = Array.isArray(secondaryTracks) ? secondaryTracks.filter(Boolean) : [];
  if (!secondary.length) return primary.slice(0, limit);
  if (!primary.length) return secondary.slice(0, limit);

  const result = [...primary];
  const total = Math.min(limit, primary.length + secondary.length);
  const slots = secondary.map((_, index) =>
    Math.max(1, Math.round(((index + 1) * total) / (secondary.length + 1))),
  );

  secondary.forEach((track, index) => {
    const insertAt = Math.max(0, Math.min(result.length, slots[index] + index));
    result.splice(insertAt, 0, track);
  });

  return result.slice(0, limit);
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

function scoreScenePreference(song, scene, state) {
  const sceneKey = getScenePreferenceKey(scene);
  const prefs = state?.tasteProfile?.scenePreferences?.[sceneKey];
  const negative = state?.tasteProfile?.negativeFeedback || [];
  if (!prefs && !negative.length) return 0;

  const artists = splitArtistNames(song.artist).map(normalizeSearchText).filter(Boolean);
  const tags = (song.styleTags || []).map(normalizeSearchText).filter(Boolean);
  const trackId = String(song.id || "");
  const title = normalizeSearchText(song.title);
  let score = 0;

  if (prefs) {
    score += getWeightedMapScore(prefs.likedArtists, artists, 6);
    score += getWeightedMapScore(prefs.playedArtists, artists, 2);
    score += getWeightedMapScore(prefs.skippedArtists, artists, -8);
    score += getWeightedMapScore(prefs.removedArtists, artists, -10);
    score += getWeightedMapScore(prefs.likedTags, tags, 4);
    score += getWeightedMapScore(prefs.playedTags, tags, 1.5);
    score += getWeightedMapScore(prefs.skippedTags, tags, -5);
    score += getWeightedMapScore(prefs.removedTags, tags, -6);
    if (trackId && prefs.likedTracks?.[trackId]) score += Math.min(16, prefs.likedTracks[trackId] * 8);
    if (trackId && prefs.skippedTracks?.[trackId]) score -= Math.min(30, prefs.skippedTracks[trackId] * 12);
    if (trackId && prefs.removedTracks?.[trackId]) score -= Math.min(36, prefs.removedTracks[trackId] * 14);
  }

  for (const item of negative.slice(-80)) {
    if (item?.scene?.key && item.scene.key !== sceneKey) continue;
    const track = item?.track || {};
    const sameId = trackId && track.id && String(track.id) === trackId;
    const sameTitle = title && normalizeSearchText(track.title) === title;
    const sameArtist = artists.some((artist) => artistMatchesAny(artist, new Set(splitArtistNames(track.artist).map(normalizeSearchText))));
    if (sameId) score -= 18;
    else if (sameTitle && sameArtist) score -= 12;
    else if (sameArtist) score -= 3;
  }

  return Math.max(-48, Math.min(36, score));
}

function getWeightedMapScore(map, values, weight) {
  if (!map || !values.length) return 0;
  return values.reduce((score, value) => score + Math.min(5, Number(map[value] || 0)) * weight, 0);
}

function extractRequestKeywords(message) {
  const raw = String(message || "");
  const values = [];
  values.push(...extractRequestedTrackQueries(raw));

  for (const match of raw.matchAll(/([\p{L}\p{N}·・]{2,30})的(?:其他)?(?:歌|歌曲|作品)/gu)) {
    const artist = cleanArtistRequestKeyword(match[1]);
    if (artist) values.push(artist, `${artist} 经典歌曲`, `${artist} 相似歌曲`);
  }

  values.push(...raw
    .split(/[,，。.!?！？、/]+/)
    .map(cleanRecommendationSearchQuery)
    .filter(Boolean));

  return [...new Set(values)].slice(0, 8);
}

function extractRequestedTrackQueries(message) {
  const raw = String(message || "");
  const values = [];
  const patterns = [
    /[《「『“"]([^《》「」『』“”"]{2,50})[》」』”"]/gu,
    /想听(?:的)?\s*([^，。！？,.!?]{2,120})/gu,
    /(?:单独)?(?:搜索|搜|找)(?:一下|出来)?\s*([^，。！？,.!?]{2,50}?)(?:这首歌|这首|这歌|$)/gu,
    /(?:把|将)?\s*([^，。！？,.!?]{2,50}?)(?:这首歌|这首|这歌)?\s*(?:也)?(?:加进|加入|加到)/gu,
  ];

  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      for (const candidate of splitRequestedTrackSegment(match[1])) {
        const title = cleanRequestedTrackQuery(candidate);
        if (title) values.push(title);
      }
    }
  }

  return normalizeRequestedTrackQueries(values).slice(0, 4);
}

function cleanRequestedTrackQuery(value) {
  let text = String(value || "")
    .replace(/(?:不要|别|不想|不用|不需要).*/u, "")
    .replace(/^(?:我想听的?|想听的?|帮我|给我|请|麻烦|单独|搜索|搜|找|把|将|另外|顺便|可以|能不能|能帮我)+/u, "")
    .replace(/(?:这首歌|这首|这歌|歌曲|在哪里|在哪|在里面|里面|也|加进去|加进来|加入|加到|出来|吗|呢|啊|吧)+$/u, "")
    .trim();

  text = text.replace(/^[的\s]+|[的\s]+$/gu, "").trim();
  const normalized = normalizeSearchText(text);
  if (normalized.length < 2 || normalized.length > 40) return "";
  if (/^(推荐|歌单|通勤歌单|歌曲|搜索|单独搜索|播放|添加|加入|可以欢快一点)$/u.test(text)) return "";
  if (!isSafeRequestedTrackQuery(text)) return "";
  if (QUERY_MODIFIER_TERMS.has(normalized)) return "";
  return text;
}

function splitRequestedTrackSegment(value) {
  const cleaned = String(value || "")
    .replace(/(?:不要|别|不想|不用|不需要).*/u, "")
    .replace(/([A-Za-z0-9\)])和(?=[A-Za-z0-9\(])/gu, "$1|TRACK_SPLIT|");
  const parts = cleaned.split(/(?:\|TRACK_SPLIT\||以及|还有|再来|、)/u);
  const result = [];

  for (const part of parts) {
    const item = part.trim();
    if (!item) continue;
    if (/^(?:一些|几首|几支|经典|更多|其他|类似|相似|同类)/u.test(item)) break;
    if (/(?:的歌|的歌曲|的作品|歌单|主题)$/u.test(item)) break;
    result.push(item);
  }

  return result.length ? result : [value];
}

function normalizeRequestedTrackQueries(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(cleanRequestedTrackQuery)
    .filter(Boolean)
    .filter(isSafeRequestedTrackQuery))];
}

function isSafeRequestedTrackQuery(value) {
  const text = String(value || "").trim();
  const normalized = normalizeSearchText(text);
  if (normalized.length < 2 || normalized.length > 40) return false;
  if (/[，。！？,.!?]/u.test(text)) return false;
  if (/(?:来一期|歌单|不要|不想|不用|不需要|重复|一些|几首|几支|主题|更多|其他|相似|类似|的歌|的歌曲|的作品|歌手|艺人)/u.test(text)) return false;
  if (/(?:以及|还有|再来)/u.test(text)) return false;
  if (!/[A-Za-z0-9]/.test(text) && /[了啦呀]$/u.test(text)) return false;
  if (/^(?:a|an|and|the|with|feat|ft)$/i.test(text)) return false;
  return !QUERY_MODIFIER_TERMS.has(normalized);
}

function cleanArtistRequestKeyword(value) {
  let text = String(value || "").trim();
  const parts = text.split(/(?:以及|还有|顺便|另外|再来|想听|播放|推荐)/u).map((item) => item.trim()).filter(Boolean);
  if (parts.length) text = parts.at(-1);
  text = text
    .replace(/^(?:一些|几首|几支|经典的?|更多|其他|类似|相似)+/u, "")
    .replace(/(?:经典|歌曲|作品|歌手)$/u, "")
    .trim();
  return cleanRecommendationSearchQuery(text);
}

function cleanRecommendationSearchQuery(value) {
  let text = String(value || "")
    .replace(/(?:不要|别|不想|不用|不需要).*/u, "")
    .replace(/^(?:我想听|想听|来一期|来点|放点|播放|推荐|帮我|给我|请|麻烦|找一下|找|搜索|一些)+/u, "")
    .replace(/(?:吧|吗|呢|啊)$/u, "")
    .trim();

  text = text.replace(/^[的\s]+|[的\s]+$/gu, "").trim();
  if (/^(?:看了|听了|刚看|刚听)/u.test(text)) return "";
  if (!/[A-Za-z0-9]/.test(text)) text = text.replace(/了$/u, "").trim();
  return isUsableRecommendationQuery(text) ? text : "";
}

function isUsableRecommendationQuery(value) {
  const text = String(value || "").trim();
  const normalized = normalizeSearchText(text);
  if (normalized.length < 2 || normalized.length > 60) return false;
  if (/(?:不要|不想|不用|不需要|重复歌曲|不要重复|别重复|不重复)/u.test(text)) return false;
  if (/(?:和.+(?:以及|还有)|(?:以及|还有).*(?:的歌|歌曲|歌单|重复))/u.test(text)) return false;
  if (/^(?:和|以及|还有|一些|几首|几支|其他|更多|类似|相似|经典|歌曲|歌)$/u.test(text)) return false;
  if (/^(?:a|an|and|the|with|feat|ft)$/i.test(text)) return false;
  return true;
}

function isExactTrackSearchRequest(message) {
  const text = normalizeSearchText(message);
  return containsAny(text, ["单独搜索", "搜出来", "搜索出来", "找出来", "在哪里", "在哪", "没看见", "没有看见"]);
}

function isRequestedTrackMatch(track, query) {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(track?.title);
  const cleanTitle = normalizeSongTitleForMatch(track?.title);
  return Boolean(
    normalizedQuery &&
      title &&
      (title === normalizedQuery ||
        cleanTitle === normalizedQuery ||
        title.includes(normalizedQuery) ||
        normalizedQuery.includes(title) ||
        cleanTitle.includes(normalizedQuery) ||
        normalizedQuery.includes(cleanTitle) ||
        getTextSimilarity(cleanTitle || title, normalizedQuery) >= 0.8),
  );
}

function normalizeSongTitleForMatch(value) {
  return normalizeSearchText(
    String(value || "")
      .replace(/\s*[\(（\[].*?[\)）\]]\s*/g, " ")
      .replace(/\s+(?:dj|remix|伴奏|instrumental|live|cover|翻唱|版)\b.*$/i, " "),
  );
}

function isAlternateVersionTitle(value) {
  return /伴奏|remix|dj|instrumental|live|cover|翻唱|版/i.test(String(value || ""));
}

function getTextSimilarity(a, b) {
  const left = Array.from(String(a || ""));
  const right = Array.from(String(b || ""));
  if (!left.length || !right.length) return 0;
  const distance = getLevenshteinDistance(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function getLevenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function extractRequestedSongCount(message) {
  const text = String(message || "");
  const digitMatch = text.match(/([2-5])\s*首/u);
  if (digitMatch) return Number(digitMatch[1]);
  if (/一两首|两首|2首/u.test(text)) return 2;
  if (/三首|3首/u.test(text)) return 3;
  if (/四首|4首/u.test(text)) return 4;
  if (/五首|5首/u.test(text)) return 5;
  if (/几首|一些|几首歌/u.test(text)) return 4;
  return 0;
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

async function searchNcmPlaylists(query, limit = NCM_PLAYLIST_SEARCH_LIMIT) {
  if (!NCM_API_BASE) return [];

  const params = {
    keywords: query,
    limit,
    type: 1000,
    timestamp: Date.now(),
  };

  try {
    const data = await ncmFetch("/cloudsearch", params);
    return (data?.result?.playlists || []).map(mapNcmPlaylist);
  } catch (error) {
    console.warn("Netease playlist cloudsearch failed, falling back to /search:", error.message);
    const data = await ncmFetch("/search", params);
    return (data?.result?.playlists || []).map(mapNcmPlaylist);
  }
}

function rankNcmPlaylists(query, playlists) {
  const tokens = getThemeTokens(query);
  return (Array.isArray(playlists) ? playlists : [])
    .map((playlist) => ({
      playlist,
      score: scoreNcmPlaylistMatch(playlist, tokens),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.playlist.playCount || 0) - Number(a.playlist.playCount || 0))
    .map((item) => item.playlist);
}

function scoreNcmPlaylistMatch(playlist, tokens) {
  const haystack = normalizeSearchText(`${playlist?.name || ""} ${playlist?.creator || ""}`);
  if (!haystack) return 0;

  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (haystack.includes(token)) score += token.length >= 4 ? 12 : 5;
  }

  if (/ost|op|ed|原声|主题|动漫|动画|合集|精选/i.test(String(playlist?.name || ""))) score += 8;
  if (Number(playlist?.trackCount || 0) >= 8) score += 3;
  if (Number(playlist?.playCount || 0) > 10000) score += 2;
  return score;
}

function getThemeTokens(query) {
  const raw = String(query || "");
  const normalized = normalizeSearchText(raw);
  const tokens = raw
    .split(/[\s,，。！？、/|]+/)
    .map(normalizeSearchText)
    .filter((token) => token.length >= 2);

  if (containsAny(normalized, ["进击的巨人", "進撃の巨人", "attackontitan", "shingekinokyojin", "巨人"])) {
    tokens.push("进击的巨人", "進撃の巨人", "attackontitan", "shingekinokyojin", "巨人");
  }

  return [...new Set(tokens.map(normalizeSearchText).filter(Boolean))];
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
  stateWriteQueue = stateWriteQueue.catch(() => {}).then(() => writeStateAtomic(state));
  return stateWriteQueue;
}

async function writeStateAtomic(state) {
  const mergedState = await mergeProtectedStateForWrite(state);
  const payload = JSON.stringify(mergedState, null, 2);
  const tmpFile = resolve(DATA_DIR, `state.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);

  if (existsSync(STATE_FILE)) {
    await copyFile(STATE_FILE, STATE_BACKUP_FILE).catch(() => {});
  }

  await writeFile(tmpFile, payload, "utf8");
  await rename(tmpFile, STATE_FILE);
}

async function mergeProtectedStateForWrite(nextState) {
  if (!existsSync(STATE_FILE)) return nextState;

  try {
    const currentState = mergeState(JSON.parse(await readFile(STATE_FILE, "utf8")));
    return {
      ...nextState,
      radioHistory: mergeRadioHistoryForWrite(nextState.radioHistory, currentState.radioHistory),
    };
  } catch {
    return nextState;
  }
}

function mergeRadioHistoryForWrite(nextItems, currentItems) {
  return normalizeRadioHistory([...(nextItems || []), ...(currentItems || [])]);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function normalizePlan(plan, message, clientContext = {}) {
  const fallback = createLocalPlan(message, DEFAULT_STATE);
  const intent = ["recommend", "playlist", "music_chat", "library_query"].includes(plan?.intent)
    ? plan.intent
    : "recommend";
  const mood = ["focus", "chill", "energy", "sleep", "random"].includes(plan?.mood)
    ? plan.mood
    : fallback.mood;
  const requestedTrackQueries = normalizeRequestedTrackQueries(plan?.requestedTrackQueries);
  const seedQueries = normalizeSeedQueries(plan?.seedQueries, plan?.queue, plan?.search || fallback.search);
  const queue = seedQueries.length
    ? seedQueries.map((item) => item.query)
    : Array.isArray(plan?.queue)
      ? plan.queue.slice(0, 8).map(String)
      : fallback.queue;
  const scene = buildRecommendationScene(message, clientContext);
  if (requestedTrackQueries.length || seedQueries.length) {
    scene.keywords = [
      ...new Set([
        ...requestedTrackQueries,
        ...seedQueries.map((item) => item.query),
        ...(scene.keywords || []),
      ].map(cleanRecommendationSearchQuery).filter(Boolean)),
    ].slice(0, 16);
  }

  return {
    intent,
    say: cleanVisibleDjLine(String(plan?.say || fallback.say).slice(0, 60)),
    reason: cleanVisibleDjLine(String(plan?.reason || fallback.reason).slice(0, 120)),
    mood,
    search: String(plan?.search || queue[0] || fallback.search).slice(0, 60),
    seedQueries,
    queue,
    avoid: Array.isArray(plan?.avoid) ? plan.avoid.slice(0, 12).map(String) : [],
    voice: Boolean(plan?.voice),
    requestedTrackQueries,
    playlistSearchQuery: cleanRecommendationSearchQuery(plan?.playlistSearchQuery),
    exactTrackOnly: Boolean(plan?.exactTrackOnly),
    scene,
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

function compactFeedbackTrack(track) {
  return {
    ...compactTrack(track),
    tags: Array.isArray(track.tags) ? track.tags.slice(0, 12).map(String).filter(Boolean) : [],
    recommendSource: String(track.recommendSource || track.recommendQuery || "").slice(0, 80),
  };
}

function normalizeConversationMessages(messages, limit = 16) {
  return Array.isArray(messages)
    ? messages
        .map((message) => {
          const role = message?.role === "assistant" ? "assistant" : "user";
          const rawText = String(message?.text || "").trim().slice(0, 1600);
          const text = role === "assistant" ? cleanAssistantHistoryText(rawText) : rawText;
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

function cleanAssistantHistoryText(text) {
  return rewriteTastePersonaText(String(text || ""))
    .replace(/^Faye[^\n]*\n/, "")
    .replace(/^收到，我会按[^\n]*\n\n?/, "")
    .replace(/优先从喜欢歌单选歌，并避开最近的[^\n。]*[。]?/g, "按我的歌库和相邻风格做了筛选。")
    .replace(/\n找到 \d+ 首可添加到队列的歌。$/g, "")
    .replace(/\n先从 .+ 开始。$/s, "")
    .trim();
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
  const merged = {
    ...DEFAULT_STATE,
    ...raw,
    tasteProfile: {
      ...DEFAULT_STATE.tasteProfile,
      ...(raw?.tasteProfile || {}),
    },
  };

  merged.radioHistory = normalizeRadioHistory(merged.radioHistory || []);
  return merged;
}

function normalizeRadioHistory(items) {
  if (!Array.isArray(items)) return [];

  const seen = new Set();
  const result = [];

  for (const rawItem of items) {
    const item = normalizeRadioHistoryItem(rawItem);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
    if (result.length >= MAX_RADIO_HISTORY) break;
  }

  return result;
}

function normalizeRadioHistoryItem(item) {
  if (!item || typeof item !== "object") return null;

  const createdAt = normalizeIsoDate(item.createdAt) || new Date().toISOString();
  const tracks = normalizeRadioTracks(item.tracks || []);
  if (!tracks.length) return null;

  const introCount = tracks.filter((track) => track.hostIntro?.displayText).length;
  const voiceCount = tracks.filter((track) => track.hostIntro?.audioUrl).length;

  return {
    id: String(item.id || createRadioHistoryId({ createdAt, message: item.request || item.title || "", tracks })).slice(0, 80),
    title: String(item.title || buildRadioHistoryTitle(item.request || "", { say: item.say || "" }, createdAt)).slice(0, 120),
    createdAt,
    updatedAt: normalizeIsoDate(item.updatedAt) || createdAt,
    request: String(item.request || "").slice(0, 360),
    mood: String(item.mood || "random").slice(0, 32),
    say: cleanVisibleDjLine(item.say || "").slice(0, 120),
    reason: cleanVisibleDjLine(item.reason || "").slice(0, 240),
    assistantText: String(item.assistantText || "").slice(0, 1200),
    trackCount: tracks.length,
    introCount,
    voiceCount,
    source: normalizeRadioSource(item.source),
    tracks,
  };
}

function normalizeRadioTracks(tracks) {
  return Array.isArray(tracks)
    ? tracks
        .map(normalizeQueueTrack)
        .filter((track) => track && track.playable && track.url)
        .slice(0, PLAYLIST_RECOMMENDATION_LIMIT)
    : [];
}

function normalizeRadioSource(source = {}) {
  return {
    brain: String(source?.brain || "").slice(0, 80),
    music: String(source?.music || "").slice(0, 80),
    tts: String(source?.tts || TTS_PROVIDER || "").slice(0, 80),
  };
}

function normalizeIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
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
    hostIntro: normalizeQueueHostIntro(track.hostIntro),
  };
}

function normalizeQueueHostIntro(value) {
  if (!value || typeof value !== "object") return null;

  const displayText = cleanHostIntroText(value.displayText || value.text || "");
  if (!displayText) return null;

  return {
    enabled: value.enabled !== false,
    voiceCueId: String(value.voiceCueId || "").slice(0, 90),
    startAtMs: clampMs(value.startAtMs, 0, 0, 60000),
    estimatedDurationMs: clampMs(
      value.estimatedDurationMs,
      estimateHostIntroDurationMs(displayText),
      12000,
      180000,
    ),
    displayText,
    audioUrl: String(value.audioUrl || "").slice(0, 500),
    status: String(value.status || "pending").slice(0, 32),
    provider: String(value.provider || "").slice(0, 40),
    fallback: Boolean(value.fallback),
    cacheHit: Boolean(value.cacheHit),
    model: String(value.model || "").slice(0, 80),
    voiceId: String(value.voiceId || "").slice(0, 120),
    speed: clampFloat(value.speed, 0, 0, 1.5),
    ducking: normalizeVoiceDucking(value.ducking),
    tone: String(value.tone || "context").slice(0, 32),
    moodIntent: String(value.moodIntent || "random").slice(0, 32),
    source: String(value.source || "").slice(0, 40),
  };
}

function normalizeVoiceDucking(value = {}) {
  const targetRatio = Number(value.targetRatio);
  const cappedTargetRatio = Number.isFinite(targetRatio)
    ? Math.min(targetRatio, 0.16)
    : 0.16;

  return {
    targetRatio: clampFloat(cappedTargetRatio, 0.16, 0.08, 0.9),
    fadeOutMs: clampMs(value.fadeOutMs, 750, 0, 5000),
    fadeInMs: clampMs(value.fadeInMs, 1400, 0, 8000),
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

function clampFloat(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
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

function resolveTtsProvider() {
  const requested = String(process.env.TTS_PROVIDER || "").toLowerCase();
  if (requested === "none" || requested === "off" || requested === "browser") return "none";
  if (requested === "fish" && FISH_AUDIO_API_KEY && FISH_AUDIO_REFERENCE_ID) return "fish";
  if (!requested && FISH_AUDIO_API_KEY && FISH_AUDIO_REFERENCE_ID) return "fish";
  return "none";
}

function describeAiBrain() {
  if (AI_PROVIDER === "deepseek") return `deepseek:${DEEPSEEK_MODEL}`;
  if (AI_PROVIDER === "openai") return `openai:${OPENAI_MODEL}`;
  return "local fallback";
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
