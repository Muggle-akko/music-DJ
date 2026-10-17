import { mobileRequest } from "./public/device-policy.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createNcmClient, accountKey } from "./lib/ncm.mjs";
import { createProfileSync } from "./lib/taste/profile-sync.mjs";
import { createEventStore } from "./lib/taste/events.mjs";
import { createPlayability, classifyUrl } from "./lib/recommendation/playability.mjs";
import { createModel } from "./lib/recommendation/model.mjs";
import { createTraceStore } from "./lib/recommendation/trace.mjs";
import { recommend } from "./lib/recommendation/orchestrator.mjs";
import { atomicJson, readJson } from "./lib/storage.mjs";
import { createAgentService } from "./lib/agent/service.mjs";
import { createRadioService, radioTracks } from "./lib/radio.mjs";
import { configureDataStore, dataStoreEnabled, exists as dataExists, readFile as readDataFile,
  writeFile as writeDataFile, mkdir as makeDataDir, rename as renameDataFile, copyFile as copyDataFile } from "./lib/data-store.mjs";
import { cloudRequest } from "./lib/cloud-request.mjs";
import { createDeviceState } from "./lib/device-state.mjs";
import { createAccess } from "./lib/access.mjs";
import { buildOwnerBackup } from './lib/backup.mjs';
import { createInstanceRoutes } from "./lib/instance.mjs";
import { fetchMusicCover } from "./lib/music-cover.mjs";

const ROOT = resolve(".");
loadEnvFile(resolve(ROOT, ".env"));

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = resolve(ROOT, "public");
const DATA_DIR = process.env.AWUDIO_DATA_DIR ? resolve(process.env.AWUDIO_DATA_DIR) : resolve(ROOT, "data");
await configureDataStore({url:process.env.AWUDIO_DATABASE_URL,root:DATA_DIR});
if(process.env.AWUDIO_DEPLOYMENT==='vercel' && !dataStoreEnabled())throw new Error('Vercel deployment requires AWUDIO_DATABASE_URL');
let STATE_FILE = resolve(DATA_DIR, "state.json");
let STATE_BACKUP_FILE = resolve(DATA_DIR, "state.backup.json");
const LISTENING_PROFILE_FILE = resolve(DATA_DIR, "listening-profile.json");
const TTS_CACHE_DIR = resolve(DATA_DIR, "tts");
let stateWriteQueue = Promise.resolve();
const stateReadBases = new WeakMap();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE_URL = trimTrailingSlash(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const AI_PROVIDER = resolveAiProvider();
const NCM_API_BASE = trimTrailingSlash(process.env.NCM_API_BASE || "");
const connectionFile = resolve(DATA_DIR, 'netease-connection.json');
const savedConnection = await readJson(connectionFile, {});
let NCM_COOKIE = savedConnection.cookie || process.env.NCM_COOKIE || "";
const access = await createAccess({ dataDir:DATA_DIR, port:PORT, mode:process.env.AWUDIO_MODE || 'local',
  publicUrl:process.env.AWUDIO_PUBLIC_URL || '', password:process.env.AWUDIO_PASSWORD || '' });
const FISH_AUDIO_API_KEY = process.env.FISH_AUDIO_API_KEY || process.env.FISH_API_KEY || "";
const FISH_AUDIO_TTS_URL = process.env.FISH_AUDIO_TTS_URL || "https://api.fish.audio/v1/tts";
const FISH_AUDIO_MODEL = process.env.FISH_AUDIO_MODEL || "s2-pro";
const FISH_AUDIO_REFERENCE_ID = process.env.FISH_AUDIO_REFERENCE_ID || process.env.FISH_AUDIO_VOICE_ID || process.env.REFERENCE_ID || "";
const FISH_AUDIO_LATENCY = process.env.FISH_AUDIO_LATENCY || "normal";
const FISH_AUDIO_SPEED = clampFloat(process.env.FISH_AUDIO_SPEED, 1, 0.75, 1.25);
const TTS_PROVIDER = resolveTtsProvider();
const deviceState = createDeviceState(access.remote);
const NCM_SEARCH_PROBE_LIMIT = 12;


const MAX_RECOMMENDATION_DURATION_MS = 12 * 60 * 1000;
const MAX_QUEUE = 200;
const MAX_RADIO_HISTORY = 40;

const NCM_PLAYLIST_SEARCH_LIMIT = 8;

const CHAT_RECOMMENDATION_LIMIT = 5;
const PLAYLIST_RECOMMENDATION_LIMIT = 30;

const HOST_INTRO_MAX_START_AT_MS = MAX_RECOMMENDATION_DURATION_MS - 15000;

const RECOMMENDER_VERSION = "v2";
const ncmV2 = createNcmClient({ baseUrl: NCM_API_BASE, cookie: () => NCM_COOKIE });
const profileSync = createProfileSync({ dataDir: DATA_DIR, ncm: ncmV2 });
const listeningEvents = createEventStore({ dataDir: DATA_DIR });
const playabilityV2 = createPlayability({ ncm: ncmV2 });
const traceStore = createTraceStore(DATA_DIR);
const recommendationModel = createModel({ provider: AI_PROVIDER, deepseekKey: DEEPSEEK_API_KEY, deepseekBase: DEEPSEEK_BASE_URL, deepseekModel: DEEPSEEK_MODEL, openaiKey: OPENAI_API_KEY, openaiModel: OPENAI_MODEL });
const activeRecommendations = new Map();
let identityCache = null, identityRefresh = null, startupIdentity;
let firstSyncAttempted = false;

async function getV2Identity(required = false) {
  if (identityCache && identityCache.expiresAt > Date.now()) return identityCache;
  identityRefresh ||= (async () => {
    const identity = await profileSync.identity();
    if (savedConnection.accountKey && savedConnection.accountKey !== identity.accountKey) throw new Error('网易云账号与实例绑定不一致，请检查连接设置');
    // Recover automatically if the adapter/network was unavailable during startup.
    if (startupIdentity && !startupIdentity.authenticated) {
      await stateWriteQueue;
      await selectAccountState({ ...identity, authenticated:true });
      startupIdentity = { ...identity, authenticated:true };
    }
    return identityCache = { ...identity, authenticated:true, expiresAt:Date.now()+60000 };
  })().finally(() => { identityRefresh = null; });
  try { return await identityRefresh; }
  catch (error) {
    if (required) throw error;
    return { authenticated:false, accountKey:accountKey(createHash('sha256').update(NCM_COOKIE || 'anonymous').digest('hex')) };
  }
}

const MAX_LIKED_LIBRARY = 2000;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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

await makeDataDir(DATA_DIR, { recursive: true });
await makeDataDir(TTS_CACHE_DIR, { recursive: true });

// Select account-specific application state before accepting requests. The first
// account adopts the legacy state; later accounts start isolated without deleting it.
startupIdentity = await getV2Identity();
async function selectAccountState(identity) {
  if (!identity.authenticated) return;
  const legacyFile = resolve(DATA_DIR, 'state.json');
  const accountDir = resolve(DATA_DIR, 'accounts', identity.accountKey);
  await makeDataDir(accountDir, { recursive: true });
  const target = resolve(accountDir, 'state.json');
  if(await dataExists(target)){
    STATE_FILE=target;STATE_BACKUP_FILE=resolve(accountDir,'state.backup.json');return;
  }
  const legacy = await readJson(legacyFile);
  if (legacy && !legacy.ownerAccountKey) {
    legacy.ownerAccountKey = identity.accountKey;
    await atomicJson(legacyFile, legacy, true);
  }
  if (!await dataExists(target) && legacy?.ownerAccountKey === identity.accountKey) await atomicJson(target, legacy);
  STATE_FILE = target;
  STATE_BACKUP_FILE = resolve(accountDir, 'state.backup.json');
}
// Persisted owner data remains readable during a temporary NCM outage at boot.
await selectAccountState(startupIdentity.authenticated ? startupIdentity : savedConnection.accountKey
  ? { authenticated:true, accountKey:savedConnection.accountKey } : startupIdentity);
let connectingAccount = false;
async function connectAccount(cookie) {
  if (connectingAccount) throw new Error('登录正在进行，请稍后重试');
  connectingAccount = true;
  try {
    const check = createProfileSync({ dataDir:DATA_DIR, ncm:createNcmClient({ baseUrl:NCM_API_BASE, cookie }) });
    const identity = await check.identity();
    const owner = startupIdentity.authenticated ? startupIdentity.accountKey : savedConnection.accountKey;
    if (owner && owner !== identity.accountKey) throw new Error('此实例已绑定其他网易云账号，请使用原账号登录；切换账号需单独迁移');
    await stateWriteQueue;
    await atomicJson(connectionFile, { cookie, accountKey:identity.accountKey });
    await selectAccountState({ ...identity, authenticated:true });
    NCM_COOKIE = cookie;
    Object.assign(savedConnection, { accountKey:identity.accountKey });
    identityCache = { ...identity, authenticated:true, expiresAt:Date.now()+60000 };
    startupIdentity = identityCache;
    firstSyncAttempted = false;
  } finally { connectingAccount = false; }
}


const radioService = createRadioService({ readState, mutateState, model: recommendationModel, brain: AI_PROVIDER,
  voiceProvider: TTS_PROVIDER, ncm:ncmV2, notify: () => agentService.notify() });
const agentService = await createAgentService({ dataDir: DATA_DIR, port: PORT, readState, mutateState, normalizeQueueState, radioService,
  getIdentity: async () => {
    const identity = await getV2Identity();
    if (identity.accountKey !== startupIdentity.accountKey) throw Object.assign(new Error('账号状态已变化，请重启音乐服务重新连接'), { status: 'unauthorized' });
    return identity;
  },
  requestGuard: req => access.assertRequest(req),
  runInPlayerScope: (player, task) => deviceState.run(player?.deviceId, task),
  ncm: ncmV2, profileSync, playability: playabilityV2, listeningEvents,
  abortRecommendations: () => { for (const controller of activeRecommendations.values()) controller.abort(); activeRecommendations.clear(); },
});

const instanceRoute = createInstanceRoutes({ ncmBase:NCM_API_BASE, connectAccount, access,
  getAccount:() => getV2Identity(), getBridge:() => readJson(resolve(DATA_DIR, 'agent-bridge.json')),
  exportBackup:async()=>buildOwnerBackup({accountKey:savedConnection.accountKey || (await getV2Identity()).accountKey,
    state:JSON.parse(await readDataFile(STATE_FILE,'utf8')),readJson:path=>readJson(resolve(DATA_DIR,path))}) });
const runtimeFile=resolve(DATA_DIR,'cloud-runtime.json');
const lookupFile=resolve(DATA_DIR,'agent-lookups.json');
const handler=async (req,res)=>{
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === 'GET' && url.pathname === '/healthz') { sendJson(res, 200, {ok:true}); return; }
    if (await access.route(req, res, url, readJsonBody)) return;
    if(dataStoreEnabled() && url.pathname==='/api/player/events') {res.writeHead(204);res.end();return;}
    if (await instanceRoute(req, res, url, readJsonBody)) return;
    if (url.pathname === '/signin') { await serveStatic(res, '/signin.html'); return; }
    if (url.pathname === '/settings') { await serveStatic(res, '/settings.html'); return; }
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error('Request failed:', error.httpStatus || 500);
    if (res.headersSent) { res.destroy(); return; }
    sendJson(res, error.httpStatus || 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

const server = createServer((req,res)=>deviceState.run(req.headers['x-awudio-device'],()=>cloudRequest(req,res,async()=>{
  if(dataStoreEnabled() && (req.url.startsWith('/api/music/stream') || req.url.startsWith('/api/tts/audio/'))) {
    const saved=await readJson(connectionFile,{});NCM_COOKIE=saved.cookie || process.env.NCM_COOKIE || '';
  }
  return handler(req,res);
},{before:async()=>{
  const value=await readJson(runtimeFile,{});agentService.importRuntime(value.agent);access.importRuntime(value.access);instanceRoute.importRuntime(value.instance);
  // Catalog search evidence is needed for tool calls, never for player/Agent heartbeats.
  // Preserve references from the previous combined runtime on the first new request.
  if(value.agent?.sessions?.some(([,session])=>session.lookups?.length)){
    await atomicJson(lookupFile,{...await readJson(lookupFile,{}),...agentService.exportLookups()});
  }
  if(req.url.startsWith('/api/agent/call'))agentService.importLookups(await readJson(lookupFile,{}));
  await access.reload();
  const saved=await readJson(connectionFile,{});
  const nextCookie=saved.cookie || process.env.NCM_COOKIE || '';
  if(nextCookie!==NCM_COOKIE){NCM_COOKIE=nextCookie;identityCache=null;}
  for(const key of Object.keys(savedConnection))delete savedConnection[key];
  Object.assign(savedConnection,saved);
  if(saved.accountKey)await selectAccountState({authenticated:true,accountKey:saved.accountKey});
  else if(!NCM_COOKIE){
    startupIdentity={authenticated:false,accountKey:accountKey(createHash('sha256').update('anonymous').digest('hex'))};
    STATE_FILE=resolve(DATA_DIR,'state.json');STATE_BACKUP_FILE=resolve(DATA_DIR,'state.backup.json');
  }
},after:async()=>{
  if(req.url.startsWith('/api/agent/call'))await atomicJson(lookupFile,agentService.exportLookups());
  await atomicJson(runtimeFile,{agent:agentService.exportRuntime({includeLookups:false}),access:access.exportRuntime(),instance:instanceRoute.exportRuntime()});
},
 invalidate:()=>{identityCache=null;listeningEvents.clearCache();}})).catch(()=>{
  if(res.destroyed)return;
  if(res.headersSent){res.destroy();return;}
  sendJson(res,503,{ok:false,error:'云端服务暂时不可用，请稍后重试'});
}));

server.listen(PORT, access.remote ? (process.env.HOST || '0.0.0.0') : '127.0.0.1', () => {
  console.log(`Awudio MVP running at http://localhost:${PORT}`);
  console.log(`AI brain: ${describeAiBrain()}`);
  console.log(`Netease adapter: ${NCM_API_BASE || "demo mode"}`);
  console.log(`Voice pipeline: ${TTS_PROVIDER}${TTS_PROVIDER === "fish" ? `:${FISH_AUDIO_MODEL}` : ""}`);
});

async function routeApi(req, res, url) {
  if (req.method === 'POST' && mobileRequest(req) && ['/api/chat','/api/chat/stream','/api/radios/studio'].includes(url.pathname)) {
    sendJson(res,403,{ok:false,error:'请在电脑端通过 Agent 推荐或制作电台'});return;
  }
  if (await agentService.route(req, res, url, readJsonBody)) return;
  if (req.method === 'POST') agentService.guardBrowserMutation(req);
  if (req.method === 'GET' && url.pathname === '/api/music/cover') {
    const image = await fetchMusicCover(url.searchParams.get('url') || '');
    if (!image.body) { sendText(res, image.status, image.message); return; }
    res.writeHead(200, {
      'Content-Type': image.contentType,
      'Content-Length': image.body.length,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(image.body);
    return;
  }
  if (url.pathname === '/api/radios/studio' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!['awudio_prepare_radio','awudio_get_radio','awudio_write_radio_script','awudio_save_radio'].includes(body.tool)) throw Object.assign(new Error('未知电台操作'), {status:'invalid_input'});
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      const result = await radioService.call(body.tool, body.args, {signal:controller.signal});
      sendJson(res, 200, {ok:true,...result});
    } catch (error) {
      sendJson(res, error.status === 'conflict' ? 409 : error.status === 'not_found' ? 404 : 400,
        {ok:false,error:error.status ? error.message : '解说生成失败，请重试；原有文案和电台仍保留',status:error.status || 'unavailable'});
    }
    return;
  }
  if (['/api/chat', '/api/chat/stream'].includes(url.pathname) && await agentService.isExternal()) {
    sendJson(res, 409, { ok: false, error: '外部 Agent 模式下，请在已连接的 Agent 中聊天' });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/profile/sync") {
    await getV2Identity(true);
    profileSync.start();
    if(dataStoreEnabled())await profileSync.wait();
    sendJson(res, dataStoreEnabled()?200:202, { ok:true,...profileSync.status() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/profile/status") {
    const identity = await getV2Identity();
    const profile = await profileSync.read(identity.accountKey);
    sendJson(res, 200, { ok: true, ...profileSync.status(), authenticated: identity.authenticated, accountKey: identity.accountKey, coverage: profile?.dataCoverage || null, updatedAt: profile?.updatedAt || null, complete: Boolean(profile?.complete), stale: !profile || Date.now() - Date.parse(profile.updatedAt) > 86400000 });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/listening/events") {
    const identity = await getV2Identity(true);
    const body = await readJsonBody(req);
    await listeningEvents.migrate(identity.accountKey, await readState());
    const result = await listeningEvents.ingest(identity.accountKey, body.events);
    // Only a validated, actually started playback session updates now-playing.
    const accepted = new Set(result.accepted);
    const started = (body.events || []).filter(event => accepted.has(event.eventId) && event.type === 'play_start').at(-1);
    if (started) await mutateState(state => { state.plays = [...state.plays, { ...compactTrack(started.track || {}), at: started.occurredAt }].slice(-120); state.now = { ...normalizeQueueTrack({ ...started.track, id: started.trackId }), mood: started.context?.scene || 'random', playbackSessionId: started.playbackSessionId, startedAt: started.occurredAt }; });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }
  const explanationMatch = url.pathname.match(/^\/api\/recommendations\/([\w-]{1,100})\/explanation$/);
  if (req.method === "GET" && explanationMatch) {
    const identity = await getV2Identity();
    if (explanationMatch[1].startsWith('ext-')) {
      const explanation = await agentService.explain(explanationMatch[1], url.searchParams.get('trackId'));
      sendJson(res, explanation ? 200 : 404, { ok: Boolean(explanation), explanation: explanation || '没有找到该计划的选曲依据' });
      return;
    }
    const trace = await traceStore.read(identity.accountKey, explanationMatch[1]);
    const track = trace?.final?.find(t => t.id === url.searchParams.get('trackId'));
    sendJson(res, track ? 200 : 404, { ok: Boolean(track), explanation: track?.reasonSummary || '没有找到这首歌的历史推荐依据。' });
    return;
  }
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
      instanceMode: access.remote ? "server" : "local",
      playerEvents:!dataStoreEnabled(),
      durableStorage:dataStoreEnabled() ? "postgres":"filesystem",
      tts: {
        provider: TTS_PROVIDER,
        fishAudio: Boolean(FISH_AUDIO_API_KEY),
        fishAudioVoice: Boolean(FISH_AUDIO_REFERENCE_ID),
        model: TTS_PROVIDER === "fish" ? FISH_AUDIO_MODEL : null,
        browserFallback: false,
      },
      mode: AI_PROVIDER === "local" ? "local-fallback" : AI_PROVIDER,
      recommenderVersion: RECOMMENDER_VERSION,
      recommenderV2Available: true,
      externalAgentAvailable: true,
      serverBuild: "awudio-server-v13",
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
    sendJson(res, 200, { ok: true, ...queueState, revision: state.queueRevision || 0, updatedAt: state.queueUpdatedAt || null });
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
    const saved = await mutateState(state => {
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== (state.queueRevision || 0)) return { conflict: true, revision: state.queueRevision || 0 };
      state.queue = queueState.queue;
      state.queueCurrentIndex = queueState.currentIndex;
      state.queueUpdatedAt = new Date().toISOString();
      state.queueRevision = (state.queueRevision || 0) + 1;
      state.updatedAt = state.queueUpdatedAt;
      return { updatedAt: state.queueUpdatedAt, revision: state.queueRevision };
    });
    if (saved.conflict) {
      sendJson(res, 409, { ok: false, error: '队列已在其他页面或 Agent 中改变，请先同步', revision: saved.revision });
      return;
    }
    agentService.notify();
    sendJson(res, 200, { ok: true, ...queueState, ...saved });
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

    const { playlists, hasMore } = await getUserPlaylists(uid, limit, offset);
    sendJson(res, 200, { ok: true, uid: String(uid), playlists, hasMore, limit, offset });
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

    const payload = await createDjChatResponse(message, conversation, { mode, limit, clientContext, ...recommendationRequestOptions(body, req, res) });
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

    await streamDjChatResponse(res, message, conversation, { mode, limit, clientContext, ...recommendationRequestOptions(body, req, res) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/taste") {
    const body = await readJsonBody(req);
    const action = String(body.action || "");
    const track = body.track || {};
    const tasteProfile = await mutateState(state => {
      if (action === "like") {
        state.tasteProfile.liked = dedupeTracks([...state.tasteProfile.liked, compactTrack(track)]).slice(-120);
      } else if (action === "unlike") {
        state.tasteProfile.liked = state.tasteProfile.liked.filter(item => String(item.id) !== String(track.id));
      } else if (action === "dislike") {
        state.tasteProfile.disliked = dedupeTracks([...state.tasteProfile.disliked, compactTrack(track)]).slice(-60);
      } else if (action === "undo_dislike") {
        state.tasteProfile.disliked = state.tasteProfile.disliked.filter(item => String(item.id) !== String(track.id));
      }
      // Legacy play/remove/skip do not carry enough evidence for V2 learning.
      state.updatedAt = new Date().toISOString();
      return state.tasteProfile;
    });
    sendJson(res, 200, { ok: true, tasteProfile, legacy: true });
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
    const count = await mutateState(state => {
      state.tasteProfile.likedLibrary = dedupeTracks(normalizeLikedLibrary(tracks)).slice(0, MAX_LIKED_LIBRARY);
      state.updatedAt = new Date().toISOString();
      return state.tasteProfile.likedLibrary.length;
    });
    sendJson(res, 200, { ok: true, likedLibraryCount: count });
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

  if (await dataExists(filePath)) {
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
  await writeDataFile(filePath, bytes);

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
  if (!filePath.startsWith(TTS_CACHE_DIR) || !await dataExists(filePath)) {
    sendJson(res, 404, { ok: false, error: "TTS audio not found" });
    return;
  }

  const body = await readDataFile(filePath);
  const type = CONTENT_TYPES[extname(filePath)] || "audio/mpeg";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "private, no-store",
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
      ...requestOptions,
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
  return createV2ChatResponse(message, conversation, options);
}

function recommendationRequestOptions(body, req, res) {
  const clientId = String(body.clientId || 'local').slice(0, 160);
  const controller = new AbortController();
  activeRecommendations.get(clientId)?.abort();
  activeRecommendations.set(clientId, controller);
  res.once('close', () => { controller.abort(); if (activeRecommendations.get(clientId) === controller) activeRecommendations.delete(clientId); });
  return { algorithmVersion: 'v2',
    requestId: String(body.requestId || '').slice(0, 100), expectedQueueRevision: body.expectedQueueRevision,
    signal: controller.signal, agentRerank: process.env.RECOMMENDER_AGENT_RERANK !== 'false' };
}

async function createV2ChatResponse(message, conversation, options) {
  const state = await readState();
  const identity = await getV2Identity();
  if (identity.authenticated) await listeningEvents.migrate(identity.accountKey, state);
  const profile = await profileSync.read(identity.accountKey);
  if (!profile && identity.authenticated && !firstSyncAttempted) { firstSyncAttempted = true; profileSync.start(); if(dataStoreEnabled())await profileSync.wait(); }
  const learning = await listeningEvents.summary(identity.accountKey);
  const result = await recommend({ message, options, state, profile, learning, accountKey: identity.accountKey, ncm: ncmV2,
    model: recommendationModel, playability: playabilityV2, traceStore, featureCache: profileSync, signal: options.signal, onStatus: options.onStatus });
  if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError');
  const plan = { ...result.plan, scene: { mood: result.plan.mood, stages: result.plan.stages }, reason: '根据本次需求、真实候选与可靠偏好选曲', say: '', voice: result.plan.voiceRequested };
  let assistantText;
  let control = null;
  if (result.nonRecommendation) {
    if (plan.intent === 'explain') {
      const track = state.now;
      const trace = track?.recommendationId ? await traceStore.read(identity.accountKey, track.recommendationId) : null;
      assistantText = trace?.final?.find(t => t.id === track.id)?.reasonSummary || '这首歌没有可查询的历史推荐依据。';
    } else if (plan.intent === 'library_query') assistantText = profile ? `偏好库当前有 ${profile.allLikedSongs.length} 首收藏，${profile.complete ? '已完整同步' : '同步尚不完整'}。播放榜只是部分样本。` : '偏好库尚未同步，可以点击“同步偏好”。';
    else if (plan.intent === 'control') { control = /下一首/.test(message) ? 'next' : /上一首/.test(message) ? 'previous' : /继续/.test(message) ? 'play' : /清空/.test(message) ? 'clear' : 'pause'; assistantText = '已交给播放器处理。'; }
    else if (plan.intent === 'feedback') { control = 'not_now'; assistantText = '记住了，这首歌暂时不适合当前场景，会保留你的长期喜欢。'; }
    else {
      const taste = await buildTasteContext(state, conversation, normalizeClientContext(options.clientContext));
      const response = await createInformationalChatResponse(message, state, taste, options.clientContext || {}, 'music_chat');
      assistantText = response.assistantText;
    }
  } else assistantText = result.tracks.length ? `这次选了 ${result.tracks.length} 首符合要求、可完整播放的歌。${result.warnings.length ? `\n${result.warnings.join('；')}。` : ''}` : `这次没有找到满足要求且可完整播放的歌曲，保留现有队列。${result.warnings.join('；')}`;
  if (result.tracks.length && result.selectionSummary?.stages?.some(stage => stage.targetDurationMs)) {
    const stages = result.selectionSummary.stages.map(stage => `${stage.label.replace(/[，,]$/, '')}：约 ${Math.round(stage.actualDurationMs / 60000)} 分钟`);
    assistantText += `\n${stages.join(' → ')}。`;
  }
  if (plan.voiceRequested && result.tracks.length) {
    try {
      const cues = await radioService.generateCues({tracks:result.tracks,title:message,signal:options.signal});
      result.tracks = radioTracks({id:options.requestId || createHash('sha256').update(message).digest('hex').slice(0,20),tracks:result.tracks,cues},TTS_PROVIDER!=='none',TTS_PROVIDER);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      assistantText += '\n解说暂未生成，歌曲已保留。可以通过“制作电台”继续写解说。';
    }
  }
  let radioHistoryItem = null;
  const createdAt = new Date().toISOString();
  const currentRevision = (await readState()).queueRevision || 0;
  if (options.expectedQueueRevision !== undefined && options.expectedQueueRevision !== currentRevision && ['replace','append'].includes(plan.queueAction)) {
    plan.queueAction = 'cards';
    result.warnings.push('生成期间队列发生变化，结果作为卡片保留');
  }
  await mutateState(latest => {
    if (options.signal?.aborted) return;
    if (latest.agent?.mode === 'external') return;
    latest.messages = normalizeConversationMessages([...latest.messages, { role: 'user', text: message, at: createdAt }, { role: 'assistant', text: assistantText, at: createdAt }], 40);
    if (plan.queueAction === 'replace' && result.tracks.length) {
      radioHistoryItem = createRadioHistoryItem({ message, plan, tracks: result.tracks, assistantText, source: { brain: recommendationModel ? AI_PROVIDER : 'local-fallback', music: 'netease', tts: TTS_PROVIDER }, createdAt });
      latest.radioHistory = normalizeRadioHistory([radioHistoryItem, ...latest.radioHistory]);
    }
    latest.updatedAt = createdAt;
  });
  return { ...result, trace: undefined, ok: true, plan, control, requestId: options.requestId,
    expectedQueueRevision: options.expectedQueueRevision,
    mode: plan.queueAction === 'replace' ? 'playlist' : 'chat', limit: plan.requestedCount, radioHistoryItem, assistantText,
    source: { brain: recommendationModel ? AI_PROVIDER : 'local-fallback', music: 'netease' } };
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
    script: {mode:tracks.some(t=>t.hostIntro) ? 'api' : null,narration:tracks.some(t=>t.hostIntro?.provider && t.hostIntro.provider!=='none'),
      cues:normalizedTracks.filter(t=>t.hostIntro?.displayText).map(t=>({trackId:t.id,
        kind:['opening','intro'].includes(t.hostIntro.placement) && t.id===normalizedTracks[0]?.id ? 'opening' : ['closing','outro'].includes(t.hostIntro.placement) && t.id===normalizedTracks.at(-1)?.id ? 'closing' : 'transition',
        text:t.hostIntro.displayText,startAtMs:t.hostIntro.startAtMs,windowEndMs:t.hostIntro.windowEndMs ?? undefined,
        placement:['intro','interlude','outro'].includes(t.hostIntro.placement) ? t.hostIntro.placement : undefined,
        timingSource:['lyric_gap_heuristic','unverified'].includes(t.hostIntro.timingSource) ? t.hostIntro.timingSource : undefined}))},
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

function clampStageTargetMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(5, Math.min(180, Math.round(number)));
}

function normalizeRecommendationStage(item, index = 0) {
  if (!item || typeof item !== "object") return null;
  const mood = normalizeMoodName(item.mood, "random");
  const label = String(item.label || item.name || item.title || `stage-${index + 1}`)
    .trim()
    .slice(0, 32);
  const title = String(item.title || item.label || label)
    .trim()
    .slice(0, 32);
  const keywords = normalizeStageKeywordList([
    ...(Array.isArray(item.keywords) ? item.keywords : []),
    title,
  ]);
  const styleHints = normalizeStageKeywordList(item.styleHints || item.styles || []);
  const targetMinutes = clampStageTargetMinutes(item.targetMinutes || item.minutes || item.durationMinutes);

  if (!label && !title && !keywords.length) return null;

  return {
    index,
    label: label || title || `stage-${index + 1}`,
    title: title || label || `阶段 ${index + 1}`,
    mood,
    targetMinutes,
    explicitDuration: Boolean(item.explicitDuration),
    keywords,
    styleHints,
  };
}

function normalizeStageKeywordList(values) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source
    .map(cleanRecommendationSearchQuery)
    .filter(Boolean))]
    .slice(0, 8);
}

function normalizeMoodName(value, fallback = "random") {
  const mood = String(value || "").trim();
  return ["focus", "chill", "energy", "sleep", "random"].includes(mood) ? mood : fallback;
}

function compactRecommendationStage(stage, index = 0) {
  const normalized = normalizeRecommendationStage(stage, index);
  if (!normalized) return null;
  return {
    index: normalized.index,
    label: normalized.label,
    title: normalized.title,
    mood: normalized.mood,
    targetMinutes: normalized.targetMinutes,
  };
}

function normalizeClientContext(value = {}) {
  return {
    date: String(value.date || "").slice(0, 40),
    weekend: String(value.weekend || "").slice(0, 40),
    weather: String(value.weather || "").slice(0, 80),
    time: String(value.time || "").slice(0, 20),
    timestamp: Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : 0,
    timezoneOffset: Number.isFinite(Number(value.timezoneOffset)) ? Number(value.timezoneOffset) : null,
    timezoneName: String(value.timezoneName || "").slice(0, 80),
  };
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

function summarizeTracks(tracks, limit) {
  return (Array.isArray(tracks) ? tracks : []).slice(-limit).map(compactTrack);
}

async function searchMusic(query, limit = 6, options = {}) {
  if (NCM_API_BASE) {
    try {
      const playableOnly = Boolean(options.playableOnly);
      const searchLimit = playableOnly ? Math.max(limit * 8, 48) : Math.max(limit * 3, 24);
      const data = await searchNcmSongs(query, searchLimit);
      const songs = data?.result?.songs || [];
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
          qualification: classifyUrl(item),
          rawDurationMs: Number(item.time || 0),
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

  if (url.searchParams.get('full') === '1' && details.qualification?.state !== 'full') {
    sendJson(res, 409, { ok: false, error: '当前完整播放资格已变化，请重试或换一首', state: details.qualification?.state || 'unknown' });
    return;
  }

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

  const controller = new AbortController();
  res.once('close', () => controller.abort());
  const headerDeadline = setTimeout(() => controller.abort(), 15000);
  let upstream;
  try { upstream = await fetch(details.url, { headers, redirect:'follow', signal:controller.signal }); }
  finally { clearTimeout(headerDeadline); }

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

  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
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
  if (!NCM_API_BASE) return { playlists: [], hasMore: false };

  const data = await ncmFetch("/user/playlist", {
    uid,
    limit,
    offset,
    timestamp: Date.now(),
  });

  const playlists = (data?.playlist || []).map(mapNcmPlaylist);
  return { playlists, hasMore: typeof data?.more === "boolean" ? data.more : playlists.length === limit };
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

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  const data = await response.json();

  if (!response.ok || (data?.code && ![0, 200].includes(Number(data.code)))) {
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
    artistIds: artists.map(artist => String(artist.id || "")).filter(Boolean),
    albumId: String(album.id || ""),
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

  if (!filePath.startsWith(PUBLIC_DIR + "/")) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  const body = await readFile(filePath);
  const type = CONTENT_TYPES[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache, must-revalidate" });
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
    const raw = await readDataFile(STATE_FILE, "utf8");
    const state = mergeState(JSON.parse(raw));
    stateReadBases.set(state, structuredClone(state));
    return deviceState.view(state);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeState(DEFAULT_STATE);
    return deviceState.view(structuredClone(DEFAULT_STATE));
  }
}

async function mutateState(mutator) {
  const job = stateWriteQueue.catch(() => {}).then(async () => {
    let state;
    try { state = mergeState(JSON.parse(await readDataFile(STATE_FILE, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; state = structuredClone(DEFAULT_STATE); }
    deviceState.view(state);
    const result = await mutator(state);
    state.schemaVersion = Math.max(2, state.schemaVersion || 0);
    await writeStateAtomic(state);
    return result;
  });
  stateWriteQueue = job;
  return job;
}

async function writeState(state) {
  stateWriteQueue = stateWriteQueue.catch(() => {}).then(() => writeStateAtomic(state));
  return stateWriteQueue;
}

async function writeStateAtomic(state) {
  const packed = deviceState.pack(state);
  if (stateReadBases.has(state)) stateReadBases.set(packed, stateReadBases.get(state));
  const mergedState = await mergeProtectedStateForWrite(packed);
  const payload = JSON.stringify(mergedState, null, 2);
  const tmpFile = resolve(DATA_DIR, `state.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);

  if (await dataExists(STATE_FILE)) {
    await copyDataFile(STATE_FILE, STATE_BACKUP_FILE).catch(() => {});
  }

  if(dataStoreEnabled()){await atomicJson(STATE_FILE,mergedState);return;}
  await writeDataFile(tmpFile, payload, "utf8");
  await renameDataFile(tmpFile, STATE_FILE);
}

async function mergeProtectedStateForWrite(nextState) {
  if (!await dataExists(STATE_FILE)) return nextState;

  try {
    const currentState = mergeState(JSON.parse(await readDataFile(STATE_FILE, "utf8")));
    const base = stateReadBases.get(nextState);
    const merged = { ...currentState };
    for (const [key, value] of Object.entries(nextState)) {
      if (!base || JSON.stringify(value) !== JSON.stringify(base[key])) merged[key] = value;
    }
    if (base && nextState.deviceQueues) {
      merged.deviceQueues = { ...currentState.deviceQueues };
      for (const [id, device] of Object.entries(nextState.deviceQueues)) {
        if (JSON.stringify(device) !== JSON.stringify(base.deviceQueues?.[id])) merged.deviceQueues[id] = device;
      }
    }
    merged.radioHistory = mergeRadioHistoryForWrite(nextState.radioHistory, currentState.radioHistory);
    return merged;
  } catch {
    return nextState;
  }
}

function mergeRadioHistoryForWrite(nextItems, currentItems) {
  const byId = new Map();
  for (const item of [...(nextItems || []), ...(currentItems || [])]) {
    const previous=byId.get(item.id);
    if (!previous || (item.revision || 0) > (previous.revision || 0) ||
      (item.revision || 0) === (previous.revision || 0) && Date.parse(item.updatedAt || item.createdAt) > Date.parse(previous.updatedAt || previous.createdAt)) byId.set(item.id,item);
  }
  return normalizeRadioHistory([...byId.values()].sort((a,b)=>Date.parse(b.updatedAt || b.createdAt)-Date.parse(a.updatedAt || a.createdAt)));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control":"no-store" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
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
    revision: Number.isSafeInteger(item.revision) ? item.revision : 0,
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
    script: item.script && typeof item.script === 'object' ? {
      mode: String(item.script.mode || '').slice(0, 30), narration: Boolean(item.script.narration),
      preferences:item.script.preferences && typeof item.script.preferences==='object' ? {density:['sparse','balanced','frequent'].includes(item.script.preferences.density) ? item.script.preferences.density : 'balanced',content:String(item.script.preferences.content || '').slice(0,500)} : null,
      cues: Array.isArray(item.script.cues) ? item.script.cues.slice(0,12).map(c => ({trackId:String(c.trackId),kind:String(c.kind),text:String(c.text).slice(0,600),startAtMs:c.startAtMs,placement:c.placement,windowEndMs:c.windowEndMs,timingSource:c.timingSource,fitsWindow:c.fitsWindow})) : [],
    } : null,
    tracks,
  };
}

function normalizeRadioTracks(tracks) {
  return Array.isArray(tracks)
    ? tracks
        .map(track => normalizeQueueTrack(track?.provider === 'netease' && /^\d+$/.test(track.id) ? {...track,url:`/api/music/stream?id=${track.id}&full=1`,playable:true} : track))
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
    const raw = await readDataFile(LISTENING_PROFILE_FILE, "utf8");
    const profile = JSON.parse(raw);
    if (profile.accountKey && profile.accountKey !== (await getV2Identity()).accountKey) return createEmptyListeningProfile();
    return profile;
  } catch {
    const profile = createEmptyListeningProfile();
    await writeDataFile(LISTENING_PROFILE_FILE, JSON.stringify(profile, null, 2), "utf8");
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

function recommendationMetadata(track = {}) {
  return {
    radioId: /^[\w.-]{1,160}$/.test(track.radioId || '') ? track.radioId : null,
    externalPlanId: /^ext-[\w-]{1,100}$/.test(track.externalPlanId || '') ? track.externalPlanId : null,
    origin: track.origin === 'external_agent' ? 'external_agent' : 'builtin',
    recommendationId: /^[\w-]{1,100}$/.test(track.recommendationId || '') ? track.recommendationId : null,
    stageId: String(track.stageId || '').slice(0, 40),
    recommendationScene: String(track.recommendationScene || '').slice(0, 40),
    reasonSummary: String(track.reasonSummary || '').slice(0, 240),
    evidenceIds: Array.isArray(track.evidenceIds) ? track.evidenceIds.slice(0, 20).map(id => String(id).slice(0, 120)) : [],
    familiarity: ['familiar', 'adjacent', 'discovery', 'unknown'].includes(track.familiarity) ? track.familiarity : 'unknown',
    artistIds: Array.isArray(track.artistIds) ? track.artistIds.map(String).filter(id => /^\d+$/.test(id)).slice(0, 20) : [],
    playability: track.playability && ['full','preview','blocked','unknown'].includes(track.playability.state)
      ? { state: track.playability.state, checkedAt: String(track.playability.checkedAt || '').slice(0, 40), reasonCode: String(track.playability.reasonCode || '').slice(0, 80) } : null,
  };
}

function normalizeQueueTrack(track) {
  if (!track || typeof track !== "object") return null;

  const id = String(track.id || "").slice(0, 120);
  const title = String(track.title || "").slice(0, 160);
  const url = String(track.url || "").slice(0, 500);

  if (!id && !title) return null;

  return {
    ...recommendationMetadata(track),
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
    playlistStage: normalizeTrackPlaylistStage(track.playlistStage),
    hostIntro: normalizeQueueHostIntro(track.hostIntro),
  };
}

function normalizeTrackPlaylistStage(value) {
  const stage = compactRecommendationStage(value, value?.index || 0);
  return stage || null;
}

function normalizeQueueHostIntro(value) {
  if (!value || typeof value !== "object") return null;

  const displayText = cleanHostIntroText(value.displayText || value.text || "");
  if (!displayText) return null;

  return {
    enabled: value.enabled !== false,
    voiceCueId: String(value.voiceCueId || "").slice(0, 90),
    startAtMs: clampMs(value.startAtMs, 0, 0, HOST_INTRO_MAX_START_AT_MS),
    windowEndMs:Number.isFinite(value.windowEndMs) ? clampMs(value.windowEndMs,0,0,MAX_RECOMMENDATION_DURATION_MS) : null,
    timingSource:String(value.timingSource || 'legacy').slice(0,40),
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
    placement: String(value.placement || "").slice(0, 32),
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
