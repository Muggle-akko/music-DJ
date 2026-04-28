const audio = document.querySelector("#audio");
const voiceAudio = new Audio();
const aiInput = document.querySelector("#aiInput");
const aiComposer = document.querySelector("#aiComposer");
const searchInput = document.querySelector("#searchInput");
const generatePlaylistButton = document.querySelector("#generatePlaylistButton");
const clearAiChatButton = document.querySelector("#clearAiChatButton");
const searchButton = document.querySelector("#searchButton");
const loadPlaylistsButton = document.querySelector("#loadPlaylistsButton");
const playButton = document.querySelector("#playButton");
const playIcon = document.querySelector("#playIcon");
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const likeButton = document.querySelector("#likeButton");
const modeButton = document.querySelector("#modeButton");
const volumePixels = document.querySelector("#volumePixels");
const volumeValue = document.querySelector("#volumeValue");
const aiTab = document.querySelector("#aiTab");
const searchTab = document.querySelector("#searchTab");
const aiPane = document.querySelector("#aiPane");
const searchPane = document.querySelector("#searchPane");
const songSearchSubTab = document.querySelector("#songSearchSubTab");
const playlistSubTab = document.querySelector("#playlistSubTab");
const songSearchPane = document.querySelector("#songSearchPane");
const playlistPane = document.querySelector("#playlistPane");
const queueTab = document.querySelector("#queueTab");
const likedTab = document.querySelector("#likedTab");
const historyTab = document.querySelector("#historyTab");
const queuePrevPage = document.querySelector("#queuePrevPage");
const queueNextPage = document.querySelector("#queueNextPage");

const clockDisplay = document.querySelector("#clockDisplay");
const trackInfo = document.querySelector("#trackInfo");
const dateInfo = document.querySelector("#dateInfo");
const weekendInfo = document.querySelector("#weekendInfo");
const weatherInfo = document.querySelector("#weatherInfo");
const playState = document.querySelector("#playState");
const currentTime = document.querySelector("#currentTime");
const duration = document.querySelector("#duration");
const progressSegments = document.querySelector("#progressSegments");
const hostIntro = document.querySelector("#hostIntro");
const hostIntroTime = document.querySelector("#hostIntroTime");
const hostIntroText = document.querySelector("#hostIntroText");
const hostCaption = document.querySelector("#hostCaption");
const hostCaptionState = document.querySelector("#hostCaptionState");
const hostCaptionTimer = document.querySelector("#hostCaptionTimer");
const hostCaptionText = document.querySelector("#hostCaptionText");
const queueList = document.querySelector("#queueList");
const queueCount = document.querySelector("#queueCount");
const queuePageInfo = document.querySelector("#queuePageInfo");
const aiChatHistory = document.querySelector("#aiChatHistory");
const searchResultsList = document.querySelector("#searchResultsList");
const playlistList = document.querySelector("#playlistList");
const playlistTracksList = document.querySelector("#playlistTracksList");
const searchResultCount = document.querySelector("#searchResultCount");
const playlistCount = document.querySelector("#playlistCount");
const playlistTrackCount = document.querySelector("#playlistTrackCount");
const searchSay = document.querySelector("#searchSay");
const searchReason = document.querySelector("#searchReason");
const playlistSay = document.querySelector("#playlistSay");
const playlistReason = document.querySelector("#playlistReason");
const neteaseAccount = document.querySelector("#neteaseAccount");
const brainStatus = document.querySelector("#brainStatus");
const sourceValue = document.querySelector("#sourceValue");
const moodValue = document.querySelector("#moodValue");

const MAX_QUEUE = 200;
const MAX_LIKED_TRACKS = 2000;
const MAX_RADIO_HISTORY = 40;
const PAGE_SIZE = 10;
const SEGMENT_COUNT = 36;
const MODE_STORAGE_KEY = "awudio.playMode.v1";
const VOLUME_STORAGE_KEY = "awudio.volume.v1";
const QUEUE_FALLBACK_STORAGE_KEY = "awudio.queue.fallback.v1";
const QUEUE_LEGACY_STORAGE_KEYS = [QUEUE_FALLBACK_STORAGE_KEY, "awudio.queue.v2", "awudio.queue.v1"];
const LIKED_STORAGE_KEY = "awudio.likedTracks.v1";
const LIKED_TRACKS_STORAGE_KEY = "awudio.likedTrackData.v1";
const AI_CHAT_STORAGE_KEY = "awudio.aiChat.v1";
const MAX_AI_CHAT_MESSAGES = 80;
const CHAT_RECOMMENDATION_LIMIT = 5;
const PLAYLIST_RECOMMENDATION_LIMIT = 30;
const PLAY_MODES = ["single", "list", "shuffle"];
const PLAY_MODE_LABELS = {
  single: "单曲循环",
  list: "列表循环",
  shuffle: "随机播放",
};
const LIKE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 0 1 12 6.1a5 5 0 0 1 7.5 6.5Z"/></svg>';
const MODE_ICONS = {
  single: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/><path d="M11 10h1v4"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7L14 6.7A4 4 0 0 1 17.2 5H22"/><path d="M2 6h1.4c1.3 0 2.5.6 3.3 1.7l1.2 1.6"/><path d="M13.5 15.5c.8 1.1 2.1 1.8 3.5 1.8H22"/></svg>',
};
const VOICE_TRIGGER_LEEWAY_MS = 250;
const VOICE_TRIGGER_LATE_WINDOW_MS = 10000;
const VOICE_DUCK_RATIO = 0.20;
const VOICE_PLAYBACK_RATE = 1.2;
const VOICE_DUCK_FADE_OUT_MS = 750;
const VOICE_DUCK_FADE_IN_MS = 1400;
const VOICE_SCHEDULE_MAX_DELAY_MS = 2 ** 31 - 1;
const HOST_CAPTION_IDLE_TEXT = "等待主播解说";
const HOST_CAPTION_IDLE_TEXTS = [
  "主播认真听歌中",
  "主播看稿中",
  "主播喝咖啡中",
  "Faye 正在校准下一句开场",
  "Faye 正在翻唱片封面",
  "主播把话筒推远了一点",
  "这段先留给音乐自己说话",
  "Faye 正在记下这一拍",
  "主播低头看了一眼歌单",
  "电台暂时交给旋律",
  "Faye 正在等下一个切入点",
  "主播在听副歌怎么落地",
  "这首歌正在占用直播间",
  "Faye 把灯光调暗了一格",
  "主播暂时闭麦听歌",
  "主播正在看评论",
  "主播正在洗澡",
];
const HOST_CAPTION_MAX_LINE_CHARS = 24;
const HOST_CAPTION_VISUAL_SLOWDOWN = 1;
const HOST_CAPTION_DISPERSE_MS = 460;

const PLAY_SVG = '<path d="M9 6l9 6-9 6V6z"/>';
const PAUSE_SVG = '<path d="M9 6v12M15 6v12"/>';

let queue = [];
let currentIndex = -1;
let currentTrack = null;
let queuePage = 0;
let aiResults = [];
let searchResults = [];
let playlists = [];
let playlistTracks = [];
let selectedPlaylistId = "";
let accountUserId = "";
let saveQueueTimer = 0;
let playMode = localStorage.getItem(MODE_STORAGE_KEY) || "single";
let volume = normalizeVolume(localStorage.getItem(VOLUME_STORAGE_KEY) ?? 0.7);
let likedTrackKeys = loadLikedTrackKeys();
let likedTracks = loadLikedTracks();
let radioHistory = [];
let queueView = "queue";
let aiChatMessages = loadAiChatMessages();
let voiceGeneration = 0;
let activeVoiceTask = null;
let spokenVoiceCueKeys = new Set();
let duckingRatio = 1;
let duckAnimationFrame = 0;
let duckAnimationTimer = 0;
let activeDuckAnimation = null;
let voiceCueTimer = 0;
let lyricCache = new Map();
let currentLyrics = [];
let currentLyricTrackKey = "";
let lyricRequestToken = 0;
let lyricLoading = false;
let lastLyricRenderKey = "";
let hostCaptionLineKey = "";
let hostCaptionLines = [];
let lastHostCaptionRenderKey = "";
let hostCaptionFrame = 0;
let hostCaptionIdleTimer = 0;
let spectrumAudioContext = null;
let spectrumAnalyser = null;
let spectrumData = null;
let spectrumSource = null;
let spectrumFrame = 0;
let spectrumFallFrame = 0;
let spectrumLevels = Array.from({ length: SEGMENT_COUNT }, () => 12);
let spectrumFallVelocity = Array.from({ length: SEGMENT_COUNT }, () => 0);

init();

async function init() {
  voiceAudio.preload = "auto";
  renderSegments(0);
  resetHostCaptionDisplay();
  renderAiChat();
  resizeAiInput();
  tickClock();
  updateDateInfo();
  setInterval(tickClock, 1000);
  bindEvents();
  setPlayMode(playMode);
  setVolume(volume, { save: false });
  await restoreQueue();
  await restoreLikedTracks();
  await loadConfig();
  await loadRadioHistory({ silent: true });
  await loadNeteaseAccount();
  loadWeatherInfo();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch {
      // PWA cache is optional.
    }
  }
}

function bindEvents() {
  aiTab.addEventListener("click", () => activateTab("ai"));
  searchTab.addEventListener("click", () => activateTab("search"));
  songSearchSubTab.addEventListener("click", () => activateNeteaseSubTab("search"));
  playlistSubTab.addEventListener("click", () => {
    activateNeteaseSubTab("playlist");
    if (!playlists.length) void loadUserPlaylists();
  });
  aiComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    void askDj();
  });
  generatePlaylistButton.addEventListener("click", generateAiPlaylist);
  clearAiChatButton.addEventListener("click", clearAiChat);
  searchButton.addEventListener("click", searchMusic);
  loadPlaylistsButton.addEventListener("click", loadUserPlaylists);
  queueTab.addEventListener("click", () => setQueueView("queue"));
  likedTab.addEventListener("click", () => setQueueView("liked"));
  historyTab.addEventListener("click", () => {
    setQueueView("history");
    if (!radioHistory.length) void loadRadioHistory();
  });
  queuePrevPage.addEventListener("click", () => setQueuePage(queuePage - 1));
  queueNextPage.addEventListener("click", () => setQueuePage(queuePage + 1));
  playButton.addEventListener("click", togglePlay);
  prevButton.addEventListener("click", playPrevious);
  nextButton.addEventListener("click", playNext);
  likeButton.addEventListener("click", () => {
    if (currentTrack) toggleLikeTrack(currentTrack);
  });
  modeButton.addEventListener("click", cyclePlayMode);
  volumePixels.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-volume]");
    if (!button) return;
    setVolume(button.dataset.volume);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchMusic();
  });
  aiInput.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void askDj();
    }
  });
  aiInput.addEventListener("input", resizeAiInput);
  progressSegments.addEventListener("pointerdown", beginProgressSeek);
  progressSegments.addEventListener("keydown", handleProgressKeydown);
  document.addEventListener("click", closeQueueMenus);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", () => {
    updateProgress();
    if (!audio.paused) maybeStartHostIntroVoice();
    scheduleHostIntroVoiceCheck();
  });
  audio.addEventListener("playing", () => {
    startSpectrumMeter();
    updateHostIntroDisplay();
    maybeStartHostIntroVoice();
    scheduleHostIntroVoiceCheck();
  });
  audio.addEventListener("play", () => {
    startSpectrumMeter();
    setPlayState("[播放中]", true);
    playButton.setAttribute("aria-label", "暂停");
    playButton.title = "暂停";
    setPlayIcon(false);
    updateHostIntroDisplay();
    maybeStartHostIntroVoice();
    scheduleHostIntroVoiceCheck();
    void sendTaste("play");
  });
  audio.addEventListener("pause", () => {
    stopSpectrumMeter();
    cancelVoicePipeline({ immediateRestore: true });
    if (currentTrack) setPlayState("[已暂停]", false);
    playButton.setAttribute("aria-label", "播放");
    playButton.title = "播放";
    setPlayIcon(true);
    updateHostIntroDisplay();
  });
  audio.addEventListener("seeked", () => {
    maybeStartHostIntroVoice();
    scheduleHostIntroVoiceCheck();
  });
  audio.addEventListener("ended", handleEnded);
  audio.addEventListener("error", () => {
    stopSpectrumMeter();
    cancelVoicePipeline({ immediateRestore: true });
    setPlayState("[音源错误]", false);
    setTransientPlayState(currentTrack?.blockReason || "[音源错误]");
    resetLyricsDisplay("暂无歌词");
    updateLikeButton();
  });

  voiceAudio.addEventListener("loadedmetadata", updateHostCaptionDisplay);
  voiceAudio.addEventListener("timeupdate", updateHostCaptionDisplay);
  voiceAudio.addEventListener("play", startHostCaptionAnimation);
  voiceAudio.addEventListener("ended", handleVoiceAudioEnded);
}

async function loadConfig() {
  const data = await getJson("/api/config");
  brainStatus.textContent =
    data.aiProvider === "local" ? "[大脑: 本地规则]" : `[大脑: ${data.aiModel}]`;
  sourceValue.textContent = data.ncm ? "[来源: 网易云]" : "[来源: 演示]";
}

async function loadRadioHistory(options = {}) {
  try {
    const data = await getJson("/api/radios");
    radioHistory = normalizeClientRadioHistory(data.radios || []);
    if (queueView === "history") renderQueue();
  } catch (error) {
    if (!options.silent) setTransientPlayState(`[历史电台读取失败: ${error.message}]`);
  }
}

function upsertRadioHistoryItem(item) {
  const normalized = normalizeClientRadioItem(item);
  if (!normalized) return;

  radioHistory = [
    normalized,
    ...radioHistory.filter((radio) => radio.id !== normalized.id),
  ].slice(0, MAX_RADIO_HISTORY);

  if (queueView === "history") renderQueue();
}

function normalizeClientRadioHistory(items) {
  if (!Array.isArray(items)) return [];

  const seen = new Set();
  const result = [];

  for (const rawItem of items) {
    const item = normalizeClientRadioItem(rawItem);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
    if (result.length >= MAX_RADIO_HISTORY) break;
  }

  return result;
}

function normalizeClientRadioItem(item) {
  if (!item || typeof item !== "object") return null;

  const tracks = Array.isArray(item.tracks)
    ? item.tracks.map(normalizeStoredRadioTrack).filter(isPlayable).slice(0, PLAYLIST_RECOMMENDATION_LIMIT)
    : [];
  if (!tracks.length) return null;

  const createdAt = normalizeClientIsoDate(item.createdAt) || new Date().toISOString();
  const introCount = Number.isFinite(Number(item.introCount))
    ? Number(item.introCount)
    : tracks.filter(hasHostIntro).length;
  const voiceCount = Number.isFinite(Number(item.voiceCount))
    ? Number(item.voiceCount)
    : tracks.filter((track) => track.hostIntro?.audioUrl).length;

  return {
    id: String(item.id || `${createdAt}-${tracks.map(trackKey).join("|")}`).slice(0, 120),
    title: String(item.title || "历史电台").slice(0, 120),
    createdAt,
    updatedAt: normalizeClientIsoDate(item.updatedAt) || createdAt,
    request: String(item.request || "").slice(0, 360),
    mood: String(item.mood || "random").slice(0, 32),
    say: String(item.say || "").slice(0, 160),
    reason: String(item.reason || "").slice(0, 280),
    assistantText: String(item.assistantText || "").slice(0, 1200),
    trackCount: Number(item.trackCount) || tracks.length,
    introCount,
    voiceCount,
    source: item.source && typeof item.source === "object" ? item.source : {},
    tracks,
  };
}

function normalizeStoredRadioTrack(track) {
  const normalized = normalizeClientTrack(track);
  return normalized;
}

function normalizeClientIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function loadNeteaseAccount() {
  try {
    const data = await getJson("/api/music/account");
    if (!data.enabled) {
      neteaseAccount.textContent = "账号: 未配置网易云";
      return;
    }

    if (!data.loggedIn) {
      neteaseAccount.textContent = "账号: 未登录";
      return;
    }

    const vip = formatVipType(data.vipType);
    neteaseAccount.textContent = `账号: ${data.nickname || data.userId}${vip}`;
    accountUserId = data.userId ? String(data.userId) : "";
  } catch {
    neteaseAccount.textContent = "账号: 无法读取";
  }
}

function formatVipType(vipType) {
  const value = Number(vipType) || 0;
  if (!value) return "";
  if (value === 110) return " / 黑胶会员";
  return ` / 会员 ${value}`;
}

async function askDj() {
  const message = aiInput.value.trim();
  if (!message) return;

  const conversation = buildAiConversationPayload();
  const userMessage = appendAiChatMessage("user", message);
  const assistantMessage = appendAiChatMessage("assistant", "");
  aiInput.value = "";
  resizeAiInput();
  updateAiMessageStatus(assistantMessage.id, "streaming");
  setBusy(true, "[思考中]");

  try {
    await streamDjResponse(message, assistantMessage.id, conversation, {
      mode: "chat",
      limit: CHAT_RECOMMENDATION_LIMIT,
    });
  } catch (error) {
    const fallbackText = error.message || "AI 对话失败。";
    updateAiChatMessage(assistantMessage.id, fallbackText, { status: "error" });
    setTransientPlayState("[错误]");
    aiInput.value = userMessage.text;
    resizeAiInput();
  } finally {
    setBusy(false);
  }
}

async function generateAiPlaylist() {
  const rawMessage = aiInput.value.trim();
  const message = rawMessage || "按 Faye 的电台口味生成一份适合现在听的推荐歌单";
  const conversation = buildAiConversationPayload();
  const userMessage = appendAiChatMessage("user", rawMessage || "今日歌单");
  const assistantMessage = appendAiChatMessage("assistant", "");

  if (rawMessage) {
    aiInput.value = "";
    resizeAiInput();
  }
  updateAiMessageStatus(assistantMessage.id, "streaming");
  setBusy(true, "[生成歌单]");

  try {
    await streamDjResponse(message, assistantMessage.id, conversation, {
      mode: "playlist",
      limit: PLAYLIST_RECOMMENDATION_LIMIT,
      replaceQueue: true,
    });
  } catch (error) {
    const fallbackText = error.message || "生成推荐歌单失败。";
    updateAiChatMessage(assistantMessage.id, fallbackText, { status: "error" });
    setTransientPlayState("[错误]");
    aiInput.value = rawMessage || userMessage.text;
    resizeAiInput();
  } finally {
    setBusy(false);
  }
}

async function streamDjResponse(message, assistantMessageId, conversation, options = {}) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      conversation,
      mode: options.mode || "chat",
      limit: options.limit || CHAT_RECOMMENDATION_LIMIT,
      clientContext: getClientContext(),
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  if (!response.body) {
    const data = await postJson("/api/chat", {
      message,
      conversation,
      mode: options.mode || "chat",
      limit: options.limit || CHAT_RECOMMENDATION_LIMIT,
      clientContext: getClientContext(),
    });
    applyDjResponse(data, assistantMessageId, options);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedResult = false;

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const event = parseStreamEvent(line);
        if (!event) continue;

        if (event.type === "delta") {
          appendAiChatDelta(assistantMessageId, event.text || "");
        } else if (event.type === "status") {
          setTransientPlayState(event.text ? `[${event.text}]` : "[生成中]");
        } else if (event.type === "result") {
          receivedResult = true;
          applyDjResponse(event, assistantMessageId, options);
        } else if (event.type === "error") {
          throw new Error(event.error || "AI stream failed");
        }
      }
    }

    if (done) break;
  }

  if (buffer.trim()) {
    const event = parseStreamEvent(buffer);
    if (event?.type === "result") {
      receivedResult = true;
      applyDjResponse(event, assistantMessageId, options);
    }
  }

  if (!receivedResult) {
    updateAiMessageStatus(assistantMessageId, "done");
  }
}

function parseStreamEvent(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function getClientContext() {
  return {
    date: dateInfo?.textContent || "",
    weekend: weekendInfo?.textContent || "",
    weather: weatherInfo?.textContent || "",
    timezoneOffset: new Date().getTimezoneOffset(),
  };
}

function applyDjResponse(data, assistantMessageId, options = {}) {
  aiResults = data.tracks || [];
  const text = data.assistantText || buildClientDjReply(data.plan, aiResults);
  const mode = options.mode || data.mode || "chat";
  const chatTracks = mode === "chat" ? summarizeChatTracks(aiResults, CHAT_RECOMMENDATION_LIMIT) : [];

  updateAiChatMessage(assistantMessageId, text, {
    status: "done",
    tracks: chatTracks,
  });

  moodValue.textContent = `[心情: ${translateMood(data.plan?.mood || "random")}]`;
  sourceValue.textContent = `[来源: ${translateSource(data.source?.music || "demo")}]`;
  if (data.radioHistoryItem) {
    upsertRadioHistoryItem(data.radioHistoryItem);
  }
  if (options.replaceQueue || mode === "playlist") {
    replaceQueueWithTracks(aiResults);
  }
}

function buildClientDjReply(plan, tracks) {
  const playableCount = tracks.filter(isPlayable).length;
  const reason = cleanAssistantText(plan?.reason || "已生成 AI 推荐。");
  return playableCount ? `${reason}\n找到 ${playableCount} 首可添加到队列的歌。` : reason;
}

function summarizeChatTracks(tracks, limit = CHAT_RECOMMENDATION_LIMIT) {
  return tracks.filter(isPlayable).slice(0, limit).map(normalizeClientTrack);
}

async function searchMusic() {
  const query = searchInput.value.trim() || "私人雷达";
  setBusy(true, "[搜索中]");

  try {
    const data = await getJson(`/api/music/search?q=${encodeURIComponent(query)}`);
    searchResults = data.tracks || [];
    searchSay.textContent = `[搜索: ${query}]`;
    searchReason.textContent =
      data.source === "netease"
        ? `网易云返回 ${searchResults.length} 条结果，${data.playableCount || 0} 条可播放。搜索结果不会替换当前播放队列。`
        : "未连接网易云服务，当前使用演示音源验证播放器。";
    sourceValue.textContent = `[来源: ${translateSource(data.source || "demo")}]`;
    renderResults(searchResultsList, searchResultCount, searchResults);
  } catch (error) {
    searchSay.textContent = "[搜索错误]";
    searchReason.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function loadUserPlaylists() {
  if (!accountUserId) {
    playlistSay.textContent = "[账号未就绪]";
    playlistReason.textContent = "请确认网易云账号已登录，或者重启 4173 后重新读取账号状态。";
    return;
  }

  setBusy(true, "[读取歌单]");

  try {
    const data = await getJson(`/api/music/playlists?uid=${encodeURIComponent(accountUserId)}&limit=30`);
    playlists = data.playlists || [];
    playlistSay.textContent = `[歌单: ${playlists.length} 个]`;
    playlistReason.textContent = playlists.length
      ? "选择一个歌单读取歌曲，读取结果不会替换当前播放队列。"
      : "当前账号没有读取到歌单。";
    renderPlaylists();
  } catch (error) {
    playlistSay.textContent = "[读取失败]";
    playlistReason.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function loadPlaylistTracks(playlist) {
  if (!playlist?.id) return;

  selectedPlaylistId = playlist.id;
  playlistTracks = [];
  renderPlaylists();
  renderResults(playlistTracksList, playlistTrackCount, playlistTracks, "条歌曲");
  setBusy(true, "[读取歌曲]");

  try {
    const data = await getJson(`/api/music/playlist-tracks?id=${encodeURIComponent(playlist.id)}&limit=30`);
    playlistTracks = data.tracks || [];
    playlistSay.textContent = `[${playlist.name}]`;
    playlistReason.textContent = `读取 ${playlistTracks.length} 首，${data.playableCount || 0} 首可播放。可在歌曲条目里逐首添加。`;
    renderResults(playlistTracksList, playlistTrackCount, playlistTracks, "条歌曲");
  } catch (error) {
    playlistSay.textContent = "[歌曲读取失败]";
    playlistReason.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function addPlayableTracks(tracks) {
  const playableTracks = tracks.filter(isPlayable).map(normalizeClientTrack);

  if (!playableTracks.length) {
    setTransientPlayState("[没有可播歌曲]");
    return;
  }

  const currentKey = currentTrack ? trackKey(currentTrack) : "";
  const seen = new Set(queue.map(trackKey));
  let addedCount = 0;
  const newTracks = [];

  for (const track of playableTracks) {
    const key = trackKey(track);
    if (seen.has(key)) continue;
    newTracks.push(track);
    seen.add(key);
    addedCount += 1;
  }

  queue = trimQueueKeepingCurrent([...newTracks, ...queue], currentKey);

  if (currentKey) {
    currentIndex = queue.findIndex((track) => trackKey(track) === currentKey);
    currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  }

  if (!currentTrack && queue.length) {
    currentIndex = resolvePlayableIndex(queue);
    currentTrack = queue[currentIndex] || null;
  }

  syncQueuePageToCurrent();
  renderCurrentTrack();
  renderQueue();
  persistQueue();

  setTransientPlayState(addedCount ? `[已添加 ${addedCount} 首]` : "[已在队列中]");
}

function replaceQueueWithTracks(tracks) {
  const playableTracks = tracks.filter(isPlayable).map(normalizeClientTrack).slice(0, PLAYLIST_RECOMMENDATION_LIMIT);

  if (!playableTracks.length) {
    setTransientPlayState("[没有可播歌曲]");
    return;
  }

  cancelVoicePipeline({ immediateRestore: true });
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  spokenVoiceCueKeys = new Set();

  queue = dedupeTracks(playableTracks).slice(0, MAX_QUEUE);
  currentIndex = resolvePlayableIndex(queue);
  currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  queueView = "queue";
  queuePage = 0;
  syncQueueTabs();
  syncQueuePageToCurrent();
  renderCurrentTrack();
  renderQueue();
  persistQueue();
  setTransientPlayState(`[已替换 ${queue.length} 首]`);
}

async function togglePlay() {
  if (!currentTrack && queue.length) {
    await playTrack(resolvePlayableIndex(queue));
    return;
  }

  if (!isPlayable(currentTrack)) {
    const nextIndex = findNextPlayableIndex(currentIndex);
    if (nextIndex !== -1) await playTrack(nextIndex);
    return;
  }

  if (!audio.currentSrc) {
    await playTrack(currentIndex);
    return;
  }

  if (audio.paused) {
    await audio.play();
  } else {
    audio.pause();
  }
}

async function playTrack(index) {
  if (index < 0 || !queue[index] || !isPlayable(queue[index])) return;

  cancelVoicePipeline({ immediateRestore: true });
  spokenVoiceCueKeys = new Set();
  currentIndex = index;
  currentTrack = queue[index];
  syncQueuePageToCurrent();
  renderCurrentTrack();
  renderQueue();
  persistQueue();

  audio.loop = playMode === "single";
  audio.src = currentTrack.url;
  audio.currentTime = 0;

  try {
    await audio.play();
    maybeStartHostIntroVoice();
    scheduleHostIntroVoiceCheck();
  } catch {
    setPlayState("[点击播放]", false);
  }
}

async function playLikedTrack(track) {
  if (!isPlayable(track)) return;
  let index = queue.findIndex((item) => trackKey(item) === trackKey(track));

  if (index === -1) {
    const currentKey = currentTrack ? trackKey(currentTrack) : "";
    queue = trimQueueKeepingCurrent([normalizeClientTrack(track), ...queue], currentKey);
    index = queue.findIndex((item) => trackKey(item) === trackKey(track));
    persistQueue();
  }

  if (index !== -1) await playTrack(index);
}

function playPrevious() {
  if (!queue.length) return;
  const nextIndex =
    playMode === "shuffle" ? findRandomPlayableIndex(currentIndex) : findPreviousPlayableIndex(currentIndex);
  if (nextIndex !== -1) playTrack(nextIndex);
}

function playNext() {
  if (!queue.length) return;
  if (shouldRecordSkip()) void sendTaste("skip");
  const nextIndex =
    playMode === "shuffle" ? findRandomPlayableIndex(currentIndex) : findNextPlayableIndex(currentIndex);
  if (nextIndex !== -1) playTrack(nextIndex);
}

function handleEnded() {
  cancelVoicePipeline({ immediateRestore: true });
  if (playMode === "single") return;
  stopSpectrumMeter();
  void sendTaste("complete");
  playNext();
}

async function sendTaste(action, track = currentTrack) {
  if (!track) return;

  try {
    await postJson("/api/taste", { action, track, clientContext: getClientContext() });
  } catch {
    // Taste data is helpful, but playback should never depend on it.
  }
}

function shouldRecordSkip() {
  if (!currentTrack || audio.paused || audio.ended) return false;
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (current < 20) return true;
  return duration > 0 && current / duration < 0.35;
}

function likeTrack(track) {
  if (!track) return;
  likedTrackKeys.add(trackKey(track));
  upsertLikedTrack(track);
  saveLikedTrackKeys();
  saveLikedTracks();
  persistLikedTracks();
  if (currentTrack && trackKey(currentTrack) === trackKey(track)) {
    void sendTaste("like");
  } else {
    void postJson("/api/taste", { action: "like", track, clientContext: getClientContext() }).catch(() => {});
  }
  renderQueue();
  updateLikeButton();
}

function toggleLikeTrack(track) {
  if (!track) return;

  if (isLikedTrack(track)) {
    removeLikedTrack(track, { sendTaste: true });
    return;
  }

  likeTrack(track);
}

function isLikedTrack(track) {
  return likedTrackKeys.has(trackKey(track));
}

function loadLikedTrackKeys() {
  try {
    const keys = JSON.parse(localStorage.getItem(LIKED_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(keys) ? keys.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveLikedTrackKeys() {
  localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify([...likedTrackKeys].slice(-500)));
}

function upsertLikedTrack(track) {
  const normalized = normalizeClientTrack(track);
  likedTracks = [normalized, ...likedTracks.filter((item) => trackKey(item) !== trackKey(track))].slice(0, MAX_LIKED_TRACKS);
}

function removeLikedTrack(track, options = {}) {
  const key = trackKey(track);
  likedTrackKeys.delete(key);
  likedTracks = likedTracks.filter((item) => trackKey(item) !== key);
  saveLikedTrackKeys();
  saveLikedTracks();
  persistLikedTracks();
  if (options.sendTaste) {
    void postJson("/api/taste", { action: "remove", track, clientContext: getClientContext() }).catch(() => {});
  }
  renderQueue();
  updateLikeButton();
}

function loadLikedTracks() {
  try {
    const tracks = JSON.parse(localStorage.getItem(LIKED_TRACKS_STORAGE_KEY) || "[]");
    return Array.isArray(tracks) ? tracks.filter(isPlayable).map(normalizeClientTrack).slice(0, MAX_LIKED_TRACKS) : [];
  } catch {
    return [];
  }
}

function saveLikedTracks() {
  localStorage.setItem(LIKED_TRACKS_STORAGE_KEY, JSON.stringify(likedTracks.slice(0, MAX_LIKED_TRACKS)));
}

async function restoreLikedTracks() {
  try {
    const data = await getJson("/api/taste/library");
    const serverTracks = Array.isArray(data.tracks)
      ? data.tracks.filter(isPlayable).map(normalizeClientTrack).slice(0, MAX_LIKED_TRACKS)
      : [];
    const localTracks = loadLikedTracks();
    likedTracks = mergeLikedTracks(serverTracks, localTracks);
    likedTrackKeys = new Set(likedTracks.map(trackKey));
    saveLikedTrackKeys();
    saveLikedTracks();
    if (localTracks.length && localTracks.length !== serverTracks.length) {
      persistLikedTracks();
    }
  } catch {
    likedTracks = loadLikedTracks();
    likedTrackKeys = new Set(likedTracks.map(trackKey));
  }
}

function persistLikedTracks() {
  void postJson("/api/taste/library", { tracks: likedTracks }).catch(() => {});
}

function mergeLikedTracks(primary, fallback) {
  const result = [];
  const seen = new Set();

  for (const track of [...primary, ...fallback]) {
    const key = trackKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }

  return result.slice(0, MAX_LIKED_TRACKS);
}

function loadAiChatMessages() {
  try {
    const messages = JSON.parse(localStorage.getItem(AI_CHAT_STORAGE_KEY) || "[]");
    return normalizeAiChatMessages(messages).map((message) =>
      message.status === "streaming" ? { ...message, status: "done" } : message,
    );
  } catch {
    return [];
  }
}

function saveAiChatMessages() {
  localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(aiChatMessages.slice(-MAX_AI_CHAT_MESSAGES)));
}

function normalizeAiChatMessages(messages) {
  return Array.isArray(messages)
    ? messages
        .map((message) => {
          const role = message?.role === "assistant" ? "assistant" : "user";
          const rawText = String(message?.text || "").slice(0, 4000);
          const text = role === "assistant" ? cleanAssistantText(rawText) : rawText;
          const id = String(message?.id || createMessageId(role));
          if (!text && message?.status !== "streaming") return null;

          return {
            id,
            role,
            text,
            at: message?.at || new Date().toISOString(),
            status: ["streaming", "done", "error"].includes(message?.status) ? message.status : "done",
            tracks: Array.isArray(message?.tracks)
              ? message.tracks.filter(isPlayable).map(normalizeClientTrack).slice(0, CHAT_RECOMMENDATION_LIMIT)
              : [],
          };
        })
        .filter(Boolean)
        .slice(-MAX_AI_CHAT_MESSAGES)
    : [];
}

function cleanAssistantText(text) {
  return String(text || "")
    .replace(/^Faye[^\n]*\n/, "")
    .replace(/^收到，我会按[^\n]*\n\n?/, "")
    .replace(/你的本地听歌偏好/g, "Faye 的电台口味")
    .replace(/你的听歌偏好/g, "Faye 的电台口味")
    .replace(/你的偏好/g, "Faye 的偏好")
    .replace(/你的口味/g, "Faye 的口味")
    .replace(/你的喜欢歌单/g, "Faye 的歌库")
    .replace(/你的收藏/g, "Faye 的歌库")
    .replace(/你的曲库/g, "Faye 的歌库")
    .replace(/优先从喜欢歌单选歌，并避开最近的[^\n。]*[。]?/g, "按 Faye 的歌库和相邻风格做了筛选。")
    .replace(/\n先从 .+ 开始。$/s, "")
    .trim();
}

function buildAiConversationPayload() {
  return aiChatMessages
    .filter((message) => message.text && message.status !== "streaming")
    .slice(-12)
    .map((message) => ({
      role: message.role,
      text: message.text,
      at: message.at,
    }));
}

function appendAiChatMessage(role, text, options = {}) {
  const message = {
    id: createMessageId(role),
    role,
    text,
    at: new Date().toISOString(),
    status: options.status || "done",
    tracks: options.tracks || [],
  };

  aiChatMessages = [...aiChatMessages, message].slice(-MAX_AI_CHAT_MESSAGES);
  saveAiChatMessages();
  renderAiChat();
  return message;
}

function updateAiChatMessage(id, text, options = {}) {
  aiChatMessages = aiChatMessages.map((message) =>
    message.id === id
      ? {
          ...message,
          text,
          status: options.status || message.status || "done",
          tracks: options.tracks || message.tracks || [],
        }
      : message,
  );
  saveAiChatMessages();
  renderAiChat();
}

function appendAiChatDelta(id, text) {
  if (!text) return;
  aiChatMessages = aiChatMessages.map((message) =>
    message.id === id ? { ...message, text: `${message.text || ""}${text}`, status: "streaming" } : message,
  );
  saveAiChatMessages();
  renderAiChat();
}

function updateAiMessageStatus(id, status) {
  aiChatMessages = aiChatMessages.map((message) => (message.id === id ? { ...message, status } : message));
  saveAiChatMessages();
  renderAiChat();
}

function clearAiChat() {
  aiChatMessages = [];
  aiResults = [];
  saveAiChatMessages();
  renderAiChat();
}

function resizeAiInput() {
  const styles = window.getComputedStyle(aiInput);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
  const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const maxHeight = Math.ceil(lineHeight * 8 + paddingY);

  aiInput.style.height = "0px";
  const nextHeight = Math.min(Math.max(aiInput.scrollHeight, 24), maxHeight);
  aiInput.style.height = `${nextHeight}px`;
  aiInput.style.overflowY = aiInput.scrollHeight > maxHeight ? "auto" : "hidden";
}

function renderAiChat() {
  aiChatHistory.innerHTML = "";

  if (!aiChatMessages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "等你的下一次点歌。";
    aiChatHistory.append(empty);
    return;
  }

  for (const message of aiChatMessages) {
    const item = document.createElement("article");
    item.className = `chat-message is-${message.role}${message.status === "streaming" ? " is-streaming" : ""}${
      message.status === "error" ? " is-error" : ""
    }`;

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = message.role === "user" ? `你 · ${formatChatTime(message.at)}` : `Faye · ${formatChatTime(message.at)}`;

    const body = document.createElement("div");
    body.className = "chat-bubble";
    body.textContent = message.text || "";

    const content = document.createElement("div");
    content.className = "chat-message-content";
    content.append(meta, body);

    if (message.role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "chat-avatar";
      avatar.setAttribute("aria-hidden", "true");
      item.append(avatar, content);
    } else {
      item.append(content);
    }

    if (message.tracks?.length) {
      const trackList = document.createElement("div");
      trackList.className = "chat-track-cards";
      for (const track of message.tracks) {
        const card = document.createElement("div");
        card.className = `chat-track-card${isPlayable(track) ? "" : " is-disabled"}`;
        card.innerHTML = `
          ${renderCover(track)}
          <div class="queue-title">
            <strong>${renderTrackTitle(track, "未命名歌曲")}</strong>
            <span>${escapeHtml(track.artist || "未知艺人")}</span>
          </div>
          <button class="mini-action" type="button" ${isPlayable(track) ? "" : "disabled"}>添加</button>
        `;

        const button = card.querySelector("button");
        if (isPlayable(track)) button.addEventListener("click", () => addPlayableTracks([track]));
        trackList.append(card);
      }
      content.append(trackList);
    }

    aiChatHistory.append(item);
  }

  aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
}

function createMessageId(role) {
  return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatChatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function setQueueView(view) {
  queueView = view === "liked" ? "liked" : view === "history" ? "history" : "queue";
  queuePage = 0;
  syncQueueTabs();
  renderQueue();
}

function syncQueueTabs() {
  queueTab.classList.toggle("is-active", queueView === "queue");
  likedTab.classList.toggle("is-active", queueView === "liked");
  historyTab.classList.toggle("is-active", queueView === "history");
}

function toggleQueueMenu(item) {
  const menu = item.querySelector(".queue-menu");
  const shouldOpen = menu?.hidden;
  closeQueueMenus();
  if (menu) menu.hidden = !shouldOpen;
}

function closeQueueMenus(event) {
  if (event?.target?.closest?.(".queue-menu, .menu-button")) return;
  queueList.querySelectorAll(".queue-menu").forEach((menu) => {
    menu.hidden = true;
  });
}

function removeQueueItem(index) {
  if (index < 0 || index >= queue.length) return;

  const removedTrack = queue[index];
  const removingCurrent = index === currentIndex;
  queue.splice(index, 1);

  if (!queue.length) {
    cancelVoicePipeline({ immediateRestore: true });
    currentIndex = -1;
    currentTrack = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } else if (removingCurrent) {
    cancelVoicePipeline({ immediateRestore: true });
    currentIndex = Math.min(index, queue.length - 1);
    currentTrack = queue[currentIndex];
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } else if (index < currentIndex) {
    currentIndex -= 1;
    currentTrack = queue[currentIndex] || null;
  }

  syncQueuePageToCurrent();
  renderCurrentTrack();
  renderQueue();
  persistQueue();
  if (removedTrack) void sendTaste("remove", removedTrack);
}

function renderCurrentTrack() {
  if (!currentTrack) {
    trackInfo.textContent = "等待推荐或搜索";
    currentLyrics = [];
    currentLyricTrackKey = "";
    hideHostIntro();
    updateLikeButton();
    setPlayState("[空闲]", false);
    return;
  }

  trackInfo.textContent =
    [currentTrack.title, currentTrack.artist].filter(Boolean).join(" - ") || "未知歌曲";
  updateHostIntroDisplay();
  updateLikeButton();
  void loadCurrentLyrics();
  refreshPlayStateForCurrent();
}

function updateLikeButton() {
  if (!likeButton) return;
  const liked = Boolean(currentTrack && isLikedTrack(currentTrack));
  const label = liked ? "已喜欢" : "喜欢";
  likeButton.innerHTML = LIKE_ICON;
  likeButton.classList.toggle("is-active", liked);
  likeButton.title = label;
  likeButton.setAttribute("aria-label", label);
  likeButton.setAttribute("aria-pressed", String(liked));
}

function updateHostIntroDisplay() {
  updateLyricsDisplay();
  updateHostCaptionDisplay();
}

function hideHostIntro() {
  resetHostCaptionDisplay();
  resetLyricsDisplay("暂无歌词");
}

function resetLyricsDisplay(text = "暂无歌词") {
  if (!hostIntro || !hostIntroText || !hostIntroTime) return;
  if (text === "暂无歌词") lyricLoading = false;
  hostIntro.hidden = false;
  hostIntro.classList.remove("is-speaking");
  hostIntroTime.textContent = "LYRIC";
  renderLyricRows([{ text, role: "current" }], `reset:${text}`);
}

async function loadCurrentLyrics() {
  const track = currentTrack;
  const key = trackKey(track);
  const token = ++lyricRequestToken;

  currentLyricTrackKey = key;
  currentLyrics = [];
  lyricLoading = Boolean(track?.id);
  resetLyricsDisplay(track?.id ? "歌词加载中" : "暂无歌词");

  if (!track?.id) {
    lyricLoading = false;
    resetLyricsDisplay("暂无歌词");
    return;
  }

  if (lyricCache.has(key)) {
    currentLyrics = lyricCache.get(key);
    lyricLoading = false;
    updateLyricsDisplay();
    return;
  }

  try {
    const data = await getJson(`/api/music/lyric?id=${encodeURIComponent(track.id)}`);
    if (token !== lyricRequestToken || currentLyricTrackKey !== key) return;
    currentLyrics = parseLrc(data.lyric || "");
    lyricLoading = false;
    lyricCache.set(key, currentLyrics);
    updateLyricsDisplay();
  } catch {
    if (token !== lyricRequestToken || currentLyricTrackKey !== key) return;
    currentLyrics = [];
    lyricLoading = false;
    lyricCache.set(key, currentLyrics);
    resetLyricsDisplay("暂无歌词");
  }
}

function updateLyricsDisplay() {
  if (!hostIntro || !hostIntroText || !hostIntroTime) return;
  const voiceIsActive = Boolean(activeVoiceTask);
  hostIntro.hidden = false;
  hostIntro.classList.toggle("is-speaking", voiceIsActive);

  if (!currentTrack) {
    resetLyricsDisplay("暂无歌词");
    return;
  }

  if (!currentLyrics.length) {
    hostIntroTime.textContent = "LYRIC";
    const text = lyricLoading ? "歌词加载中" : "暂无歌词";
    renderLyricRows([{ text, role: "current" }], `empty:${text}`);
    return;
  }

  const currentMs = Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;
  const lyricIndex = getCurrentLyricIndex(currentLyrics, currentMs);
  const activeIndex = lyricIndex >= 0 ? lyricIndex : 0;
  const activeLine = currentLyrics[activeIndex];
  hostIntroTime.textContent = "LYRIC";
  renderLyricRows(
    [
      { ...currentLyrics[activeIndex - 1], role: "previous" },
      { ...activeLine, role: "current" },
      { ...currentLyrics[activeIndex + 1], role: "next" },
    ],
    `line:${activeIndex}`,
  );
}

function renderLyricRows(rows, renderKey) {
  if (!hostIntroText || lastLyricRenderKey === renderKey) return;
  lastLyricRenderKey = renderKey;
  hostIntroText.replaceChildren(
    ...rows.map((line) => {
      const row = document.createElement("div");
      const role = line?.role || "current";
      row.className = `lyric-line lyric-line-${role}`;
      const time = document.createElement("span");
      time.className = "lyric-line-time";
      time.textContent = Number.isFinite(line?.timeMs) ? formatTime(line.timeMs / 1000) : "--:--";
      const text = document.createElement("span");
      text.className = "lyric-line-text";
      text.textContent = line?.text || "";
      row.replaceChildren(time, text);
      if (role === "current") row.setAttribute("aria-current", "true");
      return row;
    }),
  );
}

function resetHostCaptionDisplay(text = getHostCaptionIdleText()) {
  if (!hostCaption || !hostCaptionText || !hostCaptionState || !hostCaptionTimer) return;
  clearHostCaptionIdleTimer();
  hostCaption.classList.remove("is-speaking", "is-preparing", "is-dispersing", "has-intro");
  hostCaption.classList.add("is-idle");
  hostCaptionState.textContent = "Faye";
  hostCaptionTimer.textContent = "--:--";
  hostCaptionLineKey = "";
  hostCaptionLines = [];
  lastHostCaptionRenderKey = "";
  renderHostCaptionIdleText(text);
}

function getHostCaptionIdleText() {
  if (!HOST_CAPTION_IDLE_TEXTS.length) return HOST_CAPTION_IDLE_TEXT;
  const index = Math.floor(Date.now() / 7000) % HOST_CAPTION_IDLE_TEXTS.length;
  return HOST_CAPTION_IDLE_TEXTS[index];
}

function renderHostCaptionIdleText(value) {
  const text = String(value || HOST_CAPTION_IDLE_TEXT).trim() || HOST_CAPTION_IDLE_TEXT;
  const row = document.createElement("div");
  row.className = "host-caption-line host-caption-line-current host-caption-line-idle";
  row.setAttribute("aria-current", "true");

  const body = document.createElement("span");
  body.className = "host-caption-text host-caption-idle-text";
  body.textContent = text;
  body.style.removeProperty("--caption-fill");

  row.replaceChildren(body);
  hostCaptionText.replaceChildren(row);
}

function updateHostCaptionDisplay() {
  if (!hostCaption || !hostCaptionText || !hostCaptionState || !hostCaptionTimer) return;

  const task = activeVoiceTask;
  if (!task || task.state === "restoring") {
    resetHostCaptionDisplay();
    return;
  }

  if (task.state === "dispersing" && task.disperseStartedAt && performance.now() - task.disperseStartedAt > HOST_CAPTION_DISPERSE_MS + 80) {
    activeVoiceTask = null;
    stopHostCaptionAnimation();
    resetHostCaptionDisplay();
    return;
  }

  const intro = task.intro || getHostIntro(currentTrack);
  if (!intro?.displayText) {
    resetHostCaptionDisplay();
    return;
  }

  const text = String(intro.displayText || "").trim();
  if (hostCaptionLineKey !== text) {
    hostCaptionLineKey = text;
    hostCaptionLines = splitHostCaptionLines(text);
    lastHostCaptionRenderKey = "";
  }

  const state = task?.state || "queued";
  const durationMs = getHostCaptionDurationMs(intro, task);
  const elapsedMs = getHostCaptionElapsedMs(durationMs, state);
  const ratio = durationMs ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 0;
  const timing = getHostCaptionLineTiming(hostCaptionLines, ratio, state === "dispersing");
  const activeIndex = timing.index;
  const lineFill = timing.fill;

  hostCaption.classList.add("has-intro");
  hostCaption.classList.remove("is-idle");
  hostCaption.classList.toggle("is-speaking", state === "speaking");
  hostCaption.classList.toggle("is-preparing", state === "preparing" || state === "ducking");
  hostCaption.classList.toggle("is-dispersing", state === "dispersing");
  hostCaptionState.textContent = getHostCaptionStateLabel(state);
  hostCaptionTimer.textContent = durationMs
    ? `${formatTime(elapsedMs / 1000)} / ${formatTime(durationMs / 1000)}`
    : "--:--";

  renderHostCaptionRows(
    [
      { text: hostCaptionLines[activeIndex - 1], role: "previous", fill: 1 },
      { text: hostCaptionLines[activeIndex], role: "current", fill: lineFill },
      { text: hostCaptionLines[activeIndex + 1], role: "next", fill: 0 },
    ],
    `caption:${hostCaptionLineKey}:${activeIndex}:${state}`,
  );
  setHostCaptionFill(lineFill);
}

function renderHostCaptionRows(rows, renderKey) {
  if (!hostCaptionText) return;
  if (lastHostCaptionRenderKey !== renderKey) {
    lastHostCaptionRenderKey = renderKey;
    hostCaptionText.replaceChildren(
      ...rows.map((line) => {
        const row = document.createElement("div");
        const role = line?.role || "current";
        row.className = `host-caption-line host-caption-line-${role}`;
        const text = document.createElement("span");
        text.className = "host-caption-text";
        text.textContent = line?.text || "";
        text.style.setProperty("--caption-fill", `${Math.round(Math.max(0, Math.min(1, line?.fill || 0)) * 100)}%`);
        row.replaceChildren(text);
        if (role === "current") row.setAttribute("aria-current", "true");
        return row;
      }),
    );
  }
}

function setHostCaptionFill(fill) {
  const currentText = hostCaptionText?.querySelector(".host-caption-line-current .host-caption-text");
  if (!currentText) return;
  currentText.style.setProperty("--caption-fill", `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`);
}

function splitHostCaptionLines(text) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleanText) return [HOST_CAPTION_IDLE_TEXT];

  const lines = [];
  let clause = "";
  for (const char of Array.from(cleanText)) {
    clause += char;
    if ("，,。.!！?？；;、".includes(char)) {
      pushHostCaptionChunks(lines, clause);
      clause = "";
    }
  }
  pushHostCaptionChunks(lines, clause);
  return lines.length ? lines : [cleanText];
}

function pushHostCaptionChunks(lines, value) {
  const tokens = tokenizeHostCaptionLine(value);
  if (!tokens.length) return;

  let chunk = "";
  for (const token of tokens) {
    const candidate = chunk ? `${chunk}${token}` : token.trimStart();
    if (chunk && Array.from(candidate).length > HOST_CAPTION_MAX_LINE_CHARS) {
      lines.push(chunk.trim());
      chunk = token.trimStart();
    } else {
      chunk = candidate;
    }
  }
  if (chunk.trim()) lines.push(chunk.trim());
}

function tokenizeHostCaptionLine(value) {
  return String(value || "")
    .match(/\s*[A-Za-z0-9]+(?:[ '-][A-Za-z0-9]+)*|\s*[\u4e00-\u9fff]|\s*[^\s]/g) || [];
}

function getHostCaptionLineTiming(lines, ratio, forceEnd = false) {
  const weights = lines.map((line) => Math.max(1, Array.from(String(line || "")).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  if (forceEnd) {
    return {
      index: Math.max(0, lines.length - 1),
      fill: 1,
    };
  }

  const target = Math.max(0, Math.min(1, ratio)) * total;
  let cursor = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const next = cursor + weights[index];
    if (target <= next || index === weights.length - 1) {
      return {
        index,
        fill: Math.max(0, Math.min(1, (target - cursor) / weights[index])),
      };
    }
    cursor = next;
  }

  return { index: 0, fill: 0 };
}

function getHostCaptionDurationMs(intro, task) {
  if (task?.state === "speaking" && Number.isFinite(voiceAudio.duration) && voiceAudio.duration > 0) {
    return Math.round(voiceAudio.duration * 1000 * HOST_CAPTION_VISUAL_SLOWDOWN);
  }
  return clampMilliseconds(task?.durationMs || intro?.estimatedDurationMs, estimateClientHostIntroDurationMs(intro?.displayText), 1000, 180000);
}

function getHostCaptionElapsedMs(durationMs, state) {
  if (state === "restoring") return durationMs;
  if (state !== "speaking") return 0;
  return Math.max(0, Math.min(durationMs, Math.round((Number(voiceAudio.currentTime) || 0) * 1000)));
}

function getHostCaptionStateLabel(state) {
  return state === "speaking" ? "Faye / ON AIR" : "Faye";
}

function startHostCaptionAnimation() {
  if (hostCaptionFrame) return;
  const render = () => {
    updateHostCaptionDisplay();
    if (activeVoiceTask) {
      hostCaptionFrame = window.requestAnimationFrame(render);
    } else {
      hostCaptionFrame = 0;
    }
  };
  hostCaptionFrame = window.requestAnimationFrame(render);
}

function stopHostCaptionAnimation() {
  if (!hostCaptionFrame) return;
  window.cancelAnimationFrame(hostCaptionFrame);
  hostCaptionFrame = 0;
}

function handleVoiceAudioEnded() {
  if (activeVoiceTask) return;
  resetHostCaptionDisplay();
}

function scheduleHostCaptionIdleReset(token) {
  clearHostCaptionIdleTimer();
  hostCaptionIdleTimer = window.setTimeout(() => {
    if (activeVoiceTask?.token !== token || activeVoiceTask?.state !== "dispersing") return;
    activeVoiceTask = null;
    stopHostCaptionAnimation();
    resetHostCaptionDisplay();
  }, HOST_CAPTION_DISPERSE_MS + 80);
}

function clearHostCaptionIdleTimer() {
  window.clearTimeout(hostCaptionIdleTimer);
  hostCaptionIdleTimer = 0;
}

function parseLrc(value) {
  const lines = [];
  String(value || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const text = line.replace(/\[[0-9:.]+\]/g, "").trim();
      const matches = [...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g)];
      if (!text || !matches.length) return;
      for (const match of matches) {
        const minutes = Number(match[1]) || 0;
        const seconds = Number(match[2]) || 0;
        const fraction = String(match[3] || "0").padEnd(3, "0").slice(0, 3);
        lines.push({
          timeMs: minutes * 60000 + seconds * 1000 + (Number(fraction) || 0),
          text,
        });
      }
    });

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function getCurrentLyricLine(lines, currentMs) {
  let selected = null;
  for (const line of lines) {
    if (line.timeMs > currentMs + 250) break;
    selected = line;
  }
  return selected;
}

function getCurrentLyricIndex(lines, currentMs) {
  let selectedIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].timeMs > currentMs + 250) break;
    selectedIndex = index;
  }
  return selectedIndex;
}

function getHostIntro(track) {
  return hasHostIntro(track) ? track.hostIntro : null;
}

function hasHostIntro(track) {
  return Boolean(track?.hostIntro?.enabled && track.hostIntro.displayText);
}

function maybeStartHostIntroVoice() {
  if (!currentTrack || !audio.currentSrc || audio.paused || audio.ended || activeVoiceTask) return;

  const intro = getHostIntro(currentTrack);
  if (!intro) return;

  const currentMs = Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;
  const startAtMs = Number(intro.startAtMs) || 0;
  if (currentMs + VOICE_TRIGGER_LEEWAY_MS < startAtMs) return;
  if (currentMs > startAtMs + VOICE_TRIGGER_LATE_WINDOW_MS) return;

  const cueKey = getVoiceCueKey(currentTrack, intro);
  if (spokenVoiceCueKeys.has(cueKey)) return;

  spokenVoiceCueKeys.add(cueKey);
  const token = ++voiceGeneration;
  void startHostIntroVoice(currentTrack, intro, cueKey, token);
}

function scheduleHostIntroVoiceCheck() {
  clearHostIntroVoiceTimer();

  if (!currentTrack || !audio.currentSrc || audio.paused || audio.ended || activeVoiceTask) return;

  const intro = getHostIntro(currentTrack);
  if (!intro) return;

  const cueKey = getVoiceCueKey(currentTrack, intro);
  if (spokenVoiceCueKeys.has(cueKey)) return;

  const currentMs = Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;
  const startAtMs = Number(intro.startAtMs) || 0;
  if (currentMs > startAtMs + VOICE_TRIGGER_LATE_WINDOW_MS) return;

  const delayMs = Math.max(0, startAtMs - currentMs - VOICE_TRIGGER_LEEWAY_MS);
  voiceCueTimer = window.setTimeout(runScheduledHostIntroVoiceCheck, Math.min(delayMs, VOICE_SCHEDULE_MAX_DELAY_MS));
}

function runScheduledHostIntroVoiceCheck() {
  voiceCueTimer = 0;
  maybeStartHostIntroVoice();
  scheduleHostIntroVoiceCheck();
}

function clearHostIntroVoiceTimer() {
  window.clearTimeout(voiceCueTimer);
  voiceCueTimer = 0;
}

function handleVisibilityChange() {
  if (document.hidden) completeActiveDuckingAnimation();
  maybeStartHostIntroVoice();
  scheduleHostIntroVoiceCheck();
}

async function startHostIntroVoice(track, intro, cueKey, token) {
  activeVoiceTask = {
    token,
    cueKey,
    state: "preparing",
    intro,
    durationMs: intro.estimatedDurationMs,
  };
  startHostCaptionAnimation();
  updateHostIntroDisplay();

  const ducking = normalizeClientVoiceDucking(intro.ducking);

  try {
    const cue = await resolveHostIntroVoiceCue(track, intro, ducking);
    if (!isCurrentVoiceToken(token)) return;

    const cueDucking = normalizeClientVoiceDucking(cue.ducking || ducking);
    activeVoiceTask = {
      token,
      cueKey,
      state: "ducking",
      intro,
      durationMs: cue.estimatedDurationMs || intro.estimatedDurationMs,
    };
    updateHostIntroDisplay();
    await animateMusicDucking(cueDucking.targetRatio, cueDucking.fadeOutMs, token);
    if (!isCurrentVoiceToken(token)) return;

    activeVoiceTask = {
      token,
      cueKey,
      state: "speaking",
      intro,
      durationMs: cue.estimatedDurationMs || intro.estimatedDurationMs,
    };
    setPlayState("[主播讲解]", true);
    updateHostIntroDisplay();

    if (!cue.audioUrl) throw new Error("Voice cue has no audio URL");
    await playVoiceAudio(cue.audioUrl, token);
  } catch {
    // Voice is optional; a failed cue should never interrupt music playback.
  } finally {
    if (isCurrentVoiceToken(token)) {
      activeVoiceTask = {
        token,
        cueKey,
        state: "dispersing",
        intro,
        durationMs: intro.estimatedDurationMs,
        disperseStartedAt: performance.now(),
      };
      updateHostIntroDisplay();
      scheduleHostCaptionIdleReset(token);
      await delay(HOST_CAPTION_DISPERSE_MS);
      if (isCurrentVoiceToken(token)) {
        activeVoiceTask = null;
        stopHostCaptionAnimation();
        resetHostCaptionDisplay();
      }
      await animateMusicDucking(1, ducking.fadeInMs);
      if (!activeVoiceTask) {
        refreshPlayStateForCurrent();
        resetHostCaptionDisplay();
      }
    }
  }
}

async function resolveHostIntroVoiceCue(track, intro, ducking) {
  const savedStatus = String(intro.status || "").toLowerCase();

  if (intro.audioUrl) {
    return {
      audioUrl: intro.audioUrl,
      provider: intro.provider || "cached",
      status: intro.status || "ready",
      voiceCueId: intro.voiceCueId || "",
      speed: intro.speed || 0,
      estimatedDurationMs: intro.estimatedDurationMs,
      ducking,
    };
  }

  if (intro.provider === "none" || ["error", "failed", "unavailable", "skipped"].includes(savedStatus)) {
    throw new Error("Voice cue was not generated");
  }

  const cue = await postJson("/api/tts", {
    text: intro.displayText,
    speed: intro.speed || VOICE_PLAYBACK_RATE,
    durationMs: intro.estimatedDurationMs,
    tone: intro.tone,
    moodIntent: intro.moodIntent,
    ducking,
  });

  if (!cue?.audioUrl) {
    throw new Error(cue?.error || cue?.reason || "Voice cue was not generated");
  }

  persistVoiceCueToCurrentTrack(track, intro, cue);
  return {
    audioUrl: String(cue.audioUrl || ""),
    provider: cue.provider || "tts",
    status: cue.status || "ready",
    voiceCueId: cue.voiceCueId || intro.voiceCueId || "",
    speed: cue.speed || intro.speed || VOICE_PLAYBACK_RATE,
    estimatedDurationMs: cue.durationMs || cue.estimatedDurationMs || intro.estimatedDurationMs,
    fallback: Boolean(cue.fallback),
    ducking: normalizeClientVoiceDucking(cue.ducking || ducking),
  };
}

function persistVoiceCueToCurrentTrack(track, intro, cue) {
  if (!cue || typeof cue !== "object") return;

  const mergedIntro = normalizeClientHostIntro({
    ...intro,
    voiceCueId: cue.voiceCueId || intro.voiceCueId,
    audioUrl: cue.audioUrl || intro.audioUrl,
    status: cue.status || (cue.audioUrl ? "ready" : intro.status),
    provider: cue.provider || intro.provider,
    fallback: Boolean(cue.fallback ?? intro.fallback),
    cacheHit: Boolean(cue.cacheHit ?? intro.cacheHit),
    model: cue.model || intro.model,
    voiceId: cue.voiceId || intro.voiceId,
    speed: cue.speed || intro.speed,
    ducking: cue.ducking || intro.ducking,
  });
  if (!mergedIntro) return;

  Object.assign(intro, mergedIntro);

  const key = trackKey(track);
  let changed = false;
  for (const item of queue) {
    if (trackKey(item) !== key) continue;
    item.hostIntro = normalizeClientHostIntro({
      ...(item.hostIntro || {}),
      ...mergedIntro,
    });
    changed = true;
  }

  if (currentTrack && trackKey(currentTrack) === key) {
    currentTrack.hostIntro = mergedIntro;
    changed = true;
  }

  if (changed) persistQueue();
}

async function playVoiceAudio(src, token) {
  stopVoiceAudio();
  voiceAudio.src = src;
  voiceAudio.playbackRate = VOICE_PLAYBACK_RATE;
  voiceAudio.currentTime = 0;
  await voiceAudio.play();
  startHostCaptionAnimation();
  updateHostCaptionDisplay();
  await waitForVoiceAudio(token);
}

function waitForVoiceAudio(token) {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      window.clearInterval(timer);
      voiceAudio.removeEventListener("ended", handleEnded);
      voiceAudio.removeEventListener("error", handleError);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const handleEnded = () => finish();
    const handleError = () => {
      cleanup();
      reject(new Error("Voice audio failed"));
    };

    timer = window.setInterval(() => {
      if (!isCurrentVoiceToken(token)) finish();
    }, 120);
    voiceAudio.addEventListener("ended", handleEnded, { once: true });
    voiceAudio.addEventListener("error", handleError, { once: true });
  });
}

function cancelVoicePipeline(options = {}) {
  const shouldRestore = options.restore !== false;
  voiceGeneration += 1;
  activeVoiceTask = null;
  clearHostIntroVoiceTimer();
  clearHostCaptionIdleTimer();
  stopVoiceAudio();
  stopHostCaptionAnimation();
  resetHostCaptionDisplay();

  stopDuckingAnimation();
  if (options.immediateRestore) {
    setDuckingRatio(1);
  } else if (shouldRestore) {
    void animateMusicDucking(1, VOICE_DUCK_FADE_IN_MS);
  }

  updateHostIntroDisplay();
  refreshPlayStateForCurrent();
}

function stopVoiceAudio() {
  voiceAudio.pause();
  voiceAudio.removeAttribute("src");
  voiceAudio.load();
}

function isCurrentVoiceToken(token) {
  return Boolean(activeVoiceTask && activeVoiceTask.token === token);
}

function getVoiceCueKey(track, intro) {
  return [
    trackKey(track),
    intro.voiceCueId || "",
    Number(intro.startAtMs) || 0,
    intro.displayText,
  ].join("::");
}

function normalizeClientVoiceDucking(value = {}) {
  const targetRatio = Number(value.targetRatio);
  const cappedTargetRatio = Number.isFinite(targetRatio)
    ? Math.min(targetRatio, VOICE_DUCK_RATIO)
    : VOICE_DUCK_RATIO;

  return {
    targetRatio: clampRatio(cappedTargetRatio, VOICE_DUCK_RATIO, 0.08, 0.9),
    fadeOutMs: clampMilliseconds(value.fadeOutMs, VOICE_DUCK_FADE_OUT_MS, 0, 5000),
    fadeInMs: clampMilliseconds(value.fadeInMs, VOICE_DUCK_FADE_IN_MS, 0, 8000),
  };
}

function animateMusicDucking(targetRatio, durationMs = 0, token = 0) {
  const target = clampRatio(targetRatio, 1, 0, 1);
  const duration = Math.max(0, Number(durationMs) || 0);
  const start = duckingRatio;
  const startedAt = performance.now();

  stopDuckingAnimation();

  return new Promise((resolve) => {
    let animation = null;

    const cleanup = () => {
      window.clearTimeout(duckAnimationTimer);
      window.cancelAnimationFrame(duckAnimationFrame);
      duckAnimationTimer = 0;
      duckAnimationFrame = 0;
    };

    const finish = (applyTarget = true) => {
      if (activeDuckAnimation !== animation) return;
      cleanup();
      if (applyTarget) setDuckingRatio(target);
      activeDuckAnimation = null;
      resolve();
    };

    const step = () => {
      if (activeDuckAnimation !== animation) return;

      if (token && !isCurrentVoiceToken(token)) {
        finish(false);
        return;
      }

      const now = performance.now();
      const ratio = duration ? Math.min(1, (now - startedAt) / duration) : 1;
      setDuckingRatio(start + (target - start) * easeInOut(ratio));

      if (ratio >= 1) {
        finish(false);
        return;
      }

      duckAnimationTimer = window.setTimeout(step, document.hidden ? 250 : 50);
    };

    animation = { finish };
    activeDuckAnimation = animation;

    if (!duration || document.hidden) {
      finish(true);
      return;
    }

    step();
  });
}

function stopDuckingAnimation() {
  const animation = activeDuckAnimation;
  if (animation) {
    animation.finish(false);
    return;
  }

  window.clearTimeout(duckAnimationTimer);
  window.cancelAnimationFrame(duckAnimationFrame);
  duckAnimationTimer = 0;
  duckAnimationFrame = 0;
}

function completeActiveDuckingAnimation() {
  activeDuckAnimation?.finish?.(true);
}

function setDuckingRatio(value) {
  duckingRatio = clampRatio(value, 1, 0, 1);
  applyMusicVolume();
}

function easeInOut(value) {
  const ratio = Math.max(0, Math.min(1, value));
  return ratio < 0.5 ? 2 * ratio * ratio : 1 - Math.pow(-2 * ratio + 2, 2) / 2;
}

function clampRatio(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function renderTrackTitle(track, fallback = "未命名") {
  const title = escapeHtml(track?.title || fallback);
  const dot = hasHostIntro(track)
    ? '<span class="host-dot" aria-label="有讲解" title="有讲解"></span>'
    : "";
  return `${title}${dot}`;
}

function renderQueue() {
  if (queueView === "history") {
    renderRadioHistory();
    return;
  }

  const sourceTracks = queueView === "liked" ? likedTracks : queue;
  const visibleTracks = sourceTracks;

  queueCount.textContent =
    queueView === "liked"
      ? `${String(likedTracks.length).padStart(2, "0")} 首喜欢`
      : `${String(queue.length).padStart(2, "0")} / ${MAX_QUEUE}`;
  queuePageInfo.textContent = "";
  queuePrevPage.disabled = true;
  queueNextPage.disabled = true;
  queueList.innerHTML = "";

  if (!sourceTracks.length) {
    const empty = document.createElement("li");
    empty.className = "queue-item is-empty";
    empty.innerHTML =
      `<span class="queue-index">--</span><div class="queue-cover queue-cover-placeholder" aria-hidden="true"></div><div class="queue-title"><strong>${queueView === "liked" ? "暂无喜欢" : "暂无队列"}</strong><span>${queueView === "liked" ? "在歌曲菜单里点击喜欢后会保存到这里" : "从 AI 推荐或网易云搜索添加歌曲"}</span></div><span class="queue-duration">--:--</span><span class="queue-meta">空</span>`;
    queueList.append(empty);
    return;
  }

  visibleTracks.forEach((track, localIndex) => {
    const index = localIndex;
    const isCurrent = queueView === "queue" && index === currentIndex;
    const isLiked = isLikedTrack(track);
    const item = document.createElement("li");
    item.className = `queue-item${isCurrent ? " is-active" : ""}`;
    item.innerHTML = `
      <span class="queue-index">${String(index + 1).padStart(2, "0")}</span>
      ${renderCover(track)}
      <div class="queue-title">
        <strong>${renderTrackTitle(track, "未命名")}</strong>
        <span>${escapeHtml([track.artist, track.album].filter(Boolean).join(" / ") || "未知艺人")}</span>
      </div>
      <span class="queue-duration">${formatTrackDuration(track.duration)}</span>
      <div class="queue-actions">
        ${isLiked ? '<span class="pixel-heart" aria-label="已喜欢" title="已喜欢"></span>' : ""}
        <button class="menu-button" type="button" data-action="menu" aria-label="更多操作" title="更多操作">
          <span></span><span></span><span></span>
        </button>
        <div class="queue-menu" hidden>
          <button type="button" data-action="like">${isLiked ? "取消喜欢" : "喜欢"}</button>
          <button type="button" data-action="remove">${queueView === "liked" ? "移出喜欢" : "删除"}</button>
        </div>
      </div>
    `;
    item.addEventListener("dblclick", () => {
      if (queueView === "liked") {
        playLikedTrack(track);
      } else {
        playTrack(index);
      }
    });
    item.querySelector('[data-action="menu"]').addEventListener("click", (event) => {
      event.stopPropagation();
      toggleQueueMenu(item);
    });
    item.querySelector('[data-action="like"]').addEventListener("click", (event) => {
      event.stopPropagation();
      toggleLikeTrack(track);
      closeQueueMenus();
    });
    item.querySelector('[data-action="remove"]').addEventListener("click", (event) => {
      event.stopPropagation();
      if (queueView === "liked") {
        removeLikedTrack(track);
      } else {
        removeQueueItem(index);
      }
      closeQueueMenus();
    });
    queueList.append(item);
  });
}

function renderRadioHistory() {
  const visibleRadios = radioHistory;

  queueCount.textContent = `${String(radioHistory.length).padStart(2, "0")} 个电台`;
  queuePageInfo.textContent = "";
  queuePrevPage.disabled = true;
  queueNextPage.disabled = true;
  queueList.innerHTML = "";

  if (!radioHistory.length) {
    const empty = document.createElement("li");
    empty.className = "queue-item radio-history-item is-empty";
    empty.innerHTML =
      '<span class="queue-index">--</span><div class="queue-cover queue-cover-placeholder" aria-hidden="true"></div><div class="queue-title"><strong>暂无历史电台</strong><span>生成推荐歌单后会保存到这里</span></div><span class="queue-duration">--</span><button class="mini-action" type="button" disabled>填充</button>';
    queueList.append(empty);
    return;
  }

  visibleRadios.forEach((radio, localIndex) => {
    const index = localIndex;
    const item = document.createElement("li");
    item.className = "queue-item radio-history-item";
    const details = [
      formatRadioCreatedAt(radio.createdAt),
      `${radio.trackCount || radio.tracks.length} 首`,
      `${radio.introCount || 0} 段讲解`,
      `${radio.voiceCount || 0} 段语音`,
    ].join(" / ");

    item.innerHTML = `
      <span class="queue-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="queue-cover queue-cover-placeholder radio-history-cover" aria-hidden="true"></div>
      <div class="queue-title">
        <strong>${escapeHtml(radio.title || "历史电台")}</strong>
        <span>${escapeHtml(details)}</span>
      </div>
      <span class="queue-duration">${escapeHtml(translateMood(radio.mood || "random"))}</span>
      <button class="mini-action" type="button">填充</button>
    `;

    item.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      loadRadioHistoryItem(radio);
    });
    item.addEventListener("dblclick", () => loadRadioHistoryItem(radio));
    item.querySelector("button").addEventListener("click", (event) => {
      event.stopPropagation();
      loadRadioHistoryItem(radio);
    });
    queueList.append(item);
  });
}

function loadRadioHistoryItem(radio) {
  const tracks = Array.isArray(radio?.tracks)
    ? radio.tracks.map(normalizeStoredRadioTrack).filter(isPlayable)
    : [];

  if (!tracks.length) {
    setTransientPlayState("[历史电台为空]");
    return;
  }

  replaceQueueWithTracks(tracks);
  moodValue.textContent = `[心情: ${translateMood(radio.mood || "random")}]`;
  sourceValue.textContent = "[来源: 历史电台]";
  setTransientPlayState(`[历史电台: ${tracks.length} 首]`);
}

function formatRadioCreatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}.${day} ${hours}:${minutes}`;
}

function renderResults(listElement, countElement, tracks, unit = "条结果") {
  countElement.textContent = `${String(tracks.length).padStart(2, "0")} ${unit}`;
  listElement.innerHTML = "";

  if (!tracks.length) {
    const empty = document.createElement("li");
    empty.className = "result-item is-disabled";
    empty.innerHTML =
      '<span class="queue-index">--</span><div class="queue-cover queue-cover-placeholder" aria-hidden="true"></div><div class="queue-title"><strong>暂无结果</strong><span>换一个提示词或关键词试试</span></div><span class="queue-duration">--:--</span><span class="queue-meta">空</span>';
    listElement.append(empty);
    return;
  }

  tracks.forEach((track, index) => {
    const playable = isPlayable(track);
    const item = document.createElement("li");
    item.className = `result-item${playable ? "" : " is-disabled"}`;
    item.innerHTML = `
      <span class="queue-index">${String(index + 1).padStart(2, "0")}</span>
      ${renderCover(track)}
      <div class="queue-title">
        <strong>${renderTrackTitle(track, "未命名")}</strong>
        <span>${escapeHtml(track.artist || "未知艺人")}${track.blockReason ? ` / ${escapeHtml(track.blockReason)}` : ""}</span>
      </div>
      <span class="queue-duration">${formatTrackDuration(track.duration)}</span>
      <button class="mini-action" type="button" ${playable ? "" : "disabled"}>${playable ? "添加" : "锁定"}</button>
    `;
    const button = item.querySelector("button");
    if (playable) button.addEventListener("click", () => addPlayableTracks([track]));
    listElement.append(item);
  });
}

function renderPlaylists() {
  playlistCount.textContent = `${String(playlists.length).padStart(2, "0")} 个歌单`;
  playlistList.innerHTML = "";

  if (!playlists.length) {
    const empty = document.createElement("li");
    empty.className = "playlist-item is-disabled";
    empty.innerHTML =
      '<div class="queue-cover queue-cover-placeholder" aria-hidden="true"></div><div class="queue-title"><strong>暂无歌单</strong><span>点击读取歌单，或检查网易云登录状态</span></div><span class="queue-duration">--</span>';
    playlistList.append(empty);
    return;
  }

  playlists.forEach((playlist) => {
    const item = document.createElement("li");
    item.className = `playlist-item${String(playlist.id) === String(selectedPlaylistId) ? " is-active" : ""}`;
    item.innerHTML = `
      ${renderCover({ cover: playlist.cover })}
      <div class="queue-title">
        <strong>${escapeHtml(playlist.name || "未命名歌单")}</strong>
        <span>${playlist.trackCount || 0} 首 / ${escapeHtml(playlist.creator || "未知创建者")}</span>
      </div>
      <button class="mini-action" type="button">打开</button>
    `;
    item.querySelector("button").addEventListener("click", () => loadPlaylistTracks(playlist));
    playlistList.append(item);
  });
}

function updateProgress() {
  const total = Number.isFinite(audio.duration) ? audio.duration : 0;
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const ratio = total ? current / total : 0;

  currentTime.textContent = formatTime(current);
  duration.textContent = total ? formatTime(total) : "--:--";
  progressSegments.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  renderSegments(ratio);
  updateHostIntroDisplay();
  maybeStartHostIntroVoice();
  scheduleHostIntroVoiceCheck();
}

function beginProgressSeek(event) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  event.preventDefault();
  seekFromPointer(event);
  progressSegments.setPointerCapture?.(event.pointerId);
  progressSegments.addEventListener("pointermove", seekFromPointer);
  progressSegments.addEventListener("pointerup", endProgressSeek, { once: true });
  progressSegments.addEventListener("pointercancel", endProgressSeek, { once: true });
}

function seekFromPointer(event) {
  cancelVoicePipeline({ immediateRestore: true });
  const rect = progressSegments.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
  updateProgress();
}

function endProgressSeek(event) {
  progressSegments.releasePointerCapture?.(event.pointerId);
  progressSegments.removeEventListener("pointermove", seekFromPointer);
}

function handleProgressKeydown(event) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const step = event.shiftKey ? 15 : 5;

  if (event.key === "ArrowLeft") {
    cancelVoicePipeline({ immediateRestore: true });
    audio.currentTime = Math.max(0, audio.currentTime - step);
    event.preventDefault();
  }

  if (event.key === "ArrowRight") {
    cancelVoicePipeline({ immediateRestore: true });
    audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
    event.preventDefault();
  }

  updateProgress();
}

function renderSegments(ratio) {
  const filled = Math.max(0, Math.min(SEGMENT_COUNT, Math.round(ratio * SEGMENT_COUNT)));
  progressSegments.style.setProperty("--progress-ratio", String(Math.max(0, Math.min(1, ratio))));
  progressSegments.innerHTML = "";

  for (let index = 0; index < SEGMENT_COUNT; index += 1) {
    const segment = document.createElement("i");
    segment.style.setProperty("--segment-level", `${getFallbackSpectrumLevel(index)}%`);
    segment.style.setProperty("--fall-delay", `${Math.round(index * 7)}ms`);
    if (index < filled) segment.className = "is-filled";
    if (index === filled - 1) segment.classList.add("is-current");
    progressSegments.append(segment);
  }

  updateSpectrumBars();
}

function startSpectrumMeter() {
  if (!progressSegments || spectrumFrame) return;
  if (spectrumFallFrame) {
    window.cancelAnimationFrame(spectrumFallFrame);
    spectrumFallFrame = 0;
  }
  progressSegments.classList.remove("is-meter-calm");
  progressSegments.classList.add("is-meter-live");
  ensureSpectrumAnalyser();
  void spectrumAudioContext?.resume?.().catch(() => {});
  const render = () => {
    updateSpectrumBars();
    spectrumFrame = window.requestAnimationFrame(render);
  };
  spectrumFrame = window.requestAnimationFrame(render);
}

function stopSpectrumMeter() {
  progressSegments?.classList.remove("is-meter-live");
  if (spectrumFrame) {
    window.cancelAnimationFrame(spectrumFrame);
    spectrumFrame = 0;
  }
  startSpectrumFall();
}

function ensureSpectrumAnalyser() {
  if (spectrumAnalyser || !window.AudioContext && !window.webkitAudioContext) return;

  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    spectrumAudioContext = spectrumAudioContext || new AudioContextConstructor();
    spectrumAnalyser = spectrumAudioContext.createAnalyser();
    spectrumAnalyser.fftSize = 256;
    spectrumAnalyser.smoothingTimeConstant = 0.82;
    spectrumData = new Uint8Array(spectrumAnalyser.frequencyBinCount);
    spectrumSource = spectrumSource || spectrumAudioContext.createMediaElementSource(audio);
    spectrumSource.connect(spectrumAnalyser);
    spectrumAnalyser.connect(spectrumAudioContext.destination);
  } catch {
    spectrumAnalyser = null;
    spectrumData = null;
  }
}

function updateSpectrumBars(options = {}) {
  const bars = progressSegments ? [...progressSegments.querySelectorAll("i")] : [];
  if (!bars.length) return;

  let hasSignal = false;
  if (spectrumAnalyser && spectrumData && !options.fallbackOnly) {
    spectrumAnalyser.getByteFrequencyData(spectrumData);
    hasSignal = spectrumData.some((value) => value > 3);
  }

  bars.forEach((bar, index) => {
    const level = hasSignal
      ? getAnalyserSpectrumLevel(index)
      : getFallbackSpectrumLevel(index);
    spectrumLevels[index] = level;
    bar.style.setProperty("--segment-level", `${level}%`);
  });
}

function startSpectrumFall() {
  const bars = progressSegments ? [...progressSegments.querySelectorAll("i")] : [];
  if (!bars.length) return;

  if (spectrumFallFrame) window.cancelAnimationFrame(spectrumFallFrame);
  progressSegments.classList.add("is-meter-calm");
  spectrumFallVelocity = spectrumLevels.map((_, index) => 0.34 + index * 0.012);

  const settleLevel = 6;
  const gravity = 0.18;
  const step = () => {
    let active = false;

    bars.forEach((bar, index) => {
      const current = spectrumLevels[index] ?? settleLevel;
      const velocity = spectrumFallVelocity[index] + gravity;
      const next = Math.max(settleLevel, current - velocity);
      spectrumFallVelocity[index] = velocity;
      spectrumLevels[index] = next;
      bar.style.setProperty("--segment-level", `${next}%`);
      if (next > settleLevel + 0.4) active = true;
    });

    if (active) {
      spectrumFallFrame = window.requestAnimationFrame(step);
    } else {
      spectrumFallFrame = 0;
      spectrumLevels = spectrumLevels.map(() => settleLevel);
    }
  };

  spectrumFallFrame = window.requestAnimationFrame(step);
}

function getAnalyserSpectrumLevel(index) {
  const binStart = Math.floor((index / SEGMENT_COUNT) ** 1.45 * (spectrumData.length - 1));
  const binEnd = Math.max(binStart + 1, Math.floor(((index + 1) / SEGMENT_COUNT) ** 1.45 * spectrumData.length));
  let peak = 0;

  for (let bin = binStart; bin < binEnd; bin += 1) {
    peak = Math.max(peak, spectrumData[bin] || 0);
  }

  const level = Math.pow(peak / 255, 0.72);
  return Math.round(14 + level * 82);
}

function getFallbackSpectrumLevel(index) {
  const time = Number.isFinite(audio.currentTime) ? audio.currentTime : performance.now() / 1000;
  const wave =
    Math.sin(time * 3.1 + index * 0.55) * 0.5 +
    Math.sin(time * 1.65 + index * 0.23) * 0.32 +
    Math.sin(time * 5.4 + index * 0.11) * 0.18;
  const normalized = (wave + 1) / 2;
  return Math.round(16 + normalized * 64);
}

function activateTab(tab) {
  const isAi = tab === "ai";
  aiTab.classList.toggle("is-active", isAi);
  searchTab.classList.toggle("is-active", !isAi);
  aiTab.setAttribute("aria-selected", String(isAi));
  searchTab.setAttribute("aria-selected", String(!isAi));
  aiPane.classList.toggle("is-active", isAi);
  searchPane.classList.toggle("is-active", !isAi);
}

function activateNeteaseSubTab(tab) {
  const isSearch = tab === "search";
  songSearchSubTab.classList.toggle("is-active", isSearch);
  playlistSubTab.classList.toggle("is-active", !isSearch);
  songSearchSubTab.setAttribute("aria-selected", String(isSearch));
  playlistSubTab.setAttribute("aria-selected", String(!isSearch));
  songSearchPane.classList.toggle("is-active", isSearch);
  playlistPane.classList.toggle("is-active", !isSearch);
}

function setQueuePage(page) {
  queuePage = 0;
  renderQueue();
}

function getQueuePageCount() {
  return 1;
}

function syncQueuePageToCurrent() {
  queuePage = 0;
}

function setBusy(isBusy, state = null) {
  generatePlaylistButton.disabled = isBusy;
  clearAiChatButton.disabled = isBusy;
  searchButton.disabled = isBusy;
  loadPlaylistsButton.disabled = isBusy;
  if (state) setTransientPlayState(state);
}

function cyclePlayMode() {
  const currentModeIndex = PLAY_MODES.indexOf(playMode);
  const nextMode = PLAY_MODES[(currentModeIndex + 1) % PLAY_MODES.length] || "single";
  setPlayMode(nextMode);
}

function setPlayMode(mode) {
  playMode = PLAY_MODES.includes(mode) ? mode : "single";
  localStorage.setItem(MODE_STORAGE_KEY, playMode);
  audio.loop = playMode === "single";
  modeButton.innerHTML = MODE_ICONS[playMode] || MODE_ICONS.list;
  modeButton.title = PLAY_MODE_LABELS[playMode];
  modeButton.dataset.mode = playMode;
  modeButton.setAttribute("aria-label", `${PLAY_MODE_LABELS[playMode]}，点击切换`);
}

function setVolume(value, options = {}) {
  volume = normalizeVolume(value);
  applyMusicVolume();
  audio.muted = volume === 0;
  volumeValue.textContent = `${Math.round(volume * 100)}%`;

  const buttons = [...volumePixels.querySelectorAll("button[data-volume]")];
  buttons.forEach((button) => {
    const buttonVolume = normalizeVolume(button.dataset.volume);
    button.classList.toggle("is-active", buttonVolume <= volume && volume > 0);
    button.classList.toggle("is-zero", buttonVolume === 0 && volume === 0);
  });

  if (options.save !== false) {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  }
}

function applyMusicVolume() {
  audio.volume = normalizeVolume(volume * duckingRatio);
  audio.muted = volume === 0;
}

function setPlayState(text, isPlaying) {
  playState.textContent = normalizePlayStateLabel(text, isPlaying);
  playState.classList.toggle("is-playing", Boolean(isPlaying));
}

function normalizePlayStateLabel(text, isPlaying) {
  const raw = String(text || "").replace(/[\[\]【】]/g, "").trim();
  if (isPlaying && /主播|讲解|host|air/i.test(raw)) return "ON AIR";
  if (isPlaying) return "LIVE";
  if (/暂停|paused/i.test(raw)) return "PAUSED";
  if (/空闲|idle/i.test(raw)) return "IDLE";
  if (/就绪|点击播放|ready/i.test(raw)) return "READY";
  if (/错误|不可播放|没有可播|error|fault/i.test(raw)) return "FAULT";
  return raw || "READY";
}

function setTransientPlayState(text) {
  if (!isAudioPlaying()) setPlayState(text, false);
}

function refreshPlayStateForCurrent() {
  if (!currentTrack) {
    setPlayState("[空闲]", false);
    return;
  }

  if (!isPlayable(currentTrack)) {
    setPlayState("[不可播放]", false);
    return;
  }

  if (isAudioPlaying()) {
    setPlayState("[播放中]", true);
    return;
  }

  if (audio.currentSrc && audio.paused && audio.currentTime > 0) {
    setPlayState("[已暂停]", false);
    return;
  }

  setPlayState("[就绪]", false);
}

function isAudioPlaying() {
  return Boolean(currentTrack && !audio.paused && !audio.ended);
}

function isPlayable(track) {
  return Boolean(track?.playable && track?.url);
}

function resolvePlayableIndex(tracks) {
  const playableIndex = tracks.findIndex(isPlayable);
  if (playableIndex !== -1) return playableIndex;
  return tracks.length ? 0 : -1;
}

function findNextPlayableIndex(fromIndex) {
  if (!queue.length) return -1;

  for (let offset = 1; offset <= queue.length; offset += 1) {
    const index = (Math.max(fromIndex, 0) + offset) % queue.length;
    if (isPlayable(queue[index])) return index;
  }

  return -1;
}

function findPreviousPlayableIndex(fromIndex) {
  if (!queue.length) return -1;

  for (let offset = 1; offset <= queue.length; offset += 1) {
    const index = (Math.max(fromIndex, 0) - offset + queue.length) % queue.length;
    if (isPlayable(queue[index])) return index;
  }

  return -1;
}

function findRandomPlayableIndex(fromIndex) {
  const playableIndexes = queue
    .map((track, index) => (isPlayable(track) ? index : -1))
    .filter((index) => index !== -1);

  if (!playableIndexes.length) return -1;
  if (playableIndexes.length === 1) return playableIndexes[0];

  const candidates = playableIndexes.filter((index) => index !== fromIndex);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function getResultMessage(prefix, tracks) {
  if (!tracks.length) return `${prefix} 没有搜索到结果。`;
  const playableCount = tracks.filter(isPlayable).length;
  if (playableCount) return `${prefix} ${playableCount} 首可添加到播放队列。`;
  return `${prefix} 这些结果都没有可播放链接，通常是版权、地区或账号权限限制。`;
}

function trimQueueKeepingCurrent(tracks, currentKey) {
  const result = dedupeTracks(tracks);

  while (result.length > MAX_QUEUE) {
    const currentAt = currentKey ? result.findIndex((track) => trackKey(track) === currentKey) : -1;
    let removeAt = -1;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (index !== currentAt) {
        removeAt = index;
        break;
      }
    }
    if (removeAt === -1) break;
    result.splice(removeAt, 1);
  }

  return result;
}

function dedupeTracks(tracks) {
  const seen = new Set();
  const result = [];

  for (const track of tracks) {
    const key = trackKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }

  return result;
}

function normalizeClientTrack(track) {
  return {
    id: String(track.id || ""),
    provider: String(track.provider || "unknown"),
    title: String(track.title || ""),
    artist: String(track.artist || ""),
    album: String(track.album || ""),
    url: String(track.url || ""),
    cover: String(track.cover || ""),
    duration: Number(track.duration) || 0,
    playable: Boolean(track.playable && track.url),
    playState: String(track.playState || ""),
    blockReason: String(track.blockReason || ""),
    br: Number(track.br) || 0,
    sourceCode: Number(track.sourceCode) || 0,
    tags: Array.isArray(track.tags) ? track.tags : [],
    hostIntro: normalizeClientHostIntro(track.hostIntro),
  };
}

function normalizeClientHostIntro(value) {
  if (!value || typeof value !== "object") return null;

  const displayText = String(value.displayText || value.text || "").trim().slice(0, 1200);
  if (!displayText) return null;

  return {
    enabled: value.enabled !== false,
    voiceCueId: String(value.voiceCueId || "").slice(0, 90),
    startAtMs: clampMilliseconds(value.startAtMs, 0, 0, 60000),
    estimatedDurationMs: clampMilliseconds(
      value.estimatedDurationMs,
      estimateClientHostIntroDurationMs(displayText),
      12000,
      180000,
    ),
    displayText,
    audioUrl: String(value.audioUrl || "").slice(0, 500),
    status: String(value.status || "pending").slice(0, 32),
    provider: String(value.provider || "").slice(0, 32),
    fallback: Boolean(value.fallback),
    cacheHit: Boolean(value.cacheHit),
    model: String(value.model || "").slice(0, 80),
    voiceId: String(value.voiceId || "").slice(0, 120),
    speed: clampRatio(value.speed, 0, 0, 1.5),
    ducking: normalizeClientVoiceDucking(value.ducking),
    tone: String(value.tone || "context").slice(0, 32),
    moodIntent: String(value.moodIntent || "random").slice(0, 32),
    source: String(value.source || "").slice(0, 40),
  };
}

function estimateClientHostIntroDurationMs(text) {
  const charCount = String(text || "").replace(/\s+/g, "").length;
  return Math.max(12000, Math.min(180000, Math.round((charCount / 4.2) * 1000)));
}

function clampMilliseconds(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.7;
  return Math.max(0, Math.min(1, number));
}

function trackKey(track) {
  return `${track?.provider || "unknown"}:${track?.id || track?.title || ""}`;
}

function persistQueue() {
  clearTimeout(saveQueueTimer);
  saveQueueTimer = window.setTimeout(() => {
    void saveQueue();
  }, 120);
}

async function saveQueue() {
  try {
    await postJson("/api/queue", { queue, currentIndex });
    saveQueueFallback();
  } catch {
    saveQueueFallback();
  }
}

async function restoreQueue() {
  try {
    const data = await getJson("/api/queue");
    queue = Array.isArray(data.queue) ? data.queue.filter(isPlayable).map(normalizeClientTrack).slice(0, MAX_QUEUE) : [];
    currentIndex = Number.isInteger(data.currentIndex) ? data.currentIndex : resolvePlayableIndex(queue);
    if (currentIndex >= queue.length || currentIndex < -1) currentIndex = resolvePlayableIndex(queue);
    currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  } catch {
    const fallback = loadQueueFallback();
    queue = fallback.queue;
    currentIndex = fallback.currentIndex;
    currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  }

  syncQueuePageToCurrent();
  renderCurrentTrack();
  renderQueue();
}

function saveQueueFallback() {
  localStorage.setItem(QUEUE_FALLBACK_STORAGE_KEY, JSON.stringify({ queue, currentIndex }));
}

function loadQueueFallback() {
  for (const storageKey of QUEUE_LEGACY_STORAGE_KEYS) {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
      const fallbackQueue = Array.isArray(stored.queue)
        ? stored.queue.filter(isPlayable).map(normalizeClientTrack).slice(0, MAX_QUEUE)
        : [];

      if (!fallbackQueue.length) continue;

      let fallbackIndex = Number.isInteger(stored.currentIndex)
        ? stored.currentIndex
        : resolvePlayableIndex(fallbackQueue);

      if (fallbackIndex >= fallbackQueue.length || fallbackIndex < -1) {
        fallbackIndex = resolvePlayableIndex(fallbackQueue);
      }

      return { queue: fallbackQueue, currentIndex: fallbackIndex };
    } catch {
      // Keep trying older keys.
    }
  }

  return { queue: [], currentIndex: -1 };
}

function tickClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  clockDisplay.textContent = `${hours}:${minutes}`;
}

function updateDateInfo() {
  const now = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const weekday = weekdays[now.getDay()];
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  dateInfo.textContent = `${month}.${day} ${weekday}`;
  weekendInfo.textContent = isWeekend ? "周末" : `距周末 ${daysUntilWeekend(now)} 天`;
}

function daysUntilWeekend(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return 0;
  return 6 - day;
}

function loadWeatherInfo() {
  if (!navigator.geolocation) {
    weatherInfo.textContent = "天气: 未授权";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      try {
        const data = await getJson(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}&current=temperature_2m,weather_code&timezone=auto`,
        );
        const current = data.current || {};
        const temperature = Math.round(Number(current.temperature_2m));
        weatherInfo.textContent = Number.isFinite(temperature)
          ? `天气: ${translateWeatherCode(current.weather_code)} ${temperature}°C`
          : `天气: ${translateWeatherCode(current.weather_code)}`;
      } catch {
        weatherInfo.textContent = "天气: 暂不可用";
      }
    },
    () => {
      weatherInfo.textContent = "天气: 未授权";
    },
    { maximumAge: 600000, timeout: 5000 },
  );
}

function translateWeatherCode(code) {
  const value = Number(code);
  if ([0, 1].includes(value)) return "晴";
  if ([2, 3].includes(value)) return "多云";
  if ([45, 48].includes(value)) return "雾";
  if ([51, 53, 55, 56, 57].includes(value)) return "毛毛雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "雪";
  if ([95, 96, 99].includes(value)) return "雷雨";
  return "未知";
}

function renderCover(track) {
  if (!track.cover) {
    return '<div class="queue-cover queue-cover-placeholder" aria-hidden="true"></div>';
  }

  return `<img class="queue-cover" src="${escapeHtml(track.cover)}" alt="" loading="lazy">`;
}

function setPlayIcon(isPlay) {
  playIcon.innerHTML = isPlay ? PLAY_SVG : PAUSE_SVG;
}

function translateMood(value) {
  const map = {
    focus: "专注",
    chill: "放松",
    energy: "高能",
    sleep: "睡眠",
    random: "随机",
  };
  return map[value] || "随机";
}

function translateSource(value) {
  const map = {
    netease: "网易云",
    demo: "演示",
    library: "本地曲库",
  };
  return map[value] || value;
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function formatTrackDuration(value) {
  const number = Number(value) || 0;
  if (!number) return "--:--";
  return formatTime(number > 1000 ? number / 1000 : number);
}

function formatTime(value) {
  const safe = Math.max(0, Math.floor(value || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}
