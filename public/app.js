const audio = document.querySelector("#audio");
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
const PAGE_SIZE = 10;
const SEGMENT_COUNT = window.matchMedia("(max-width: 520px)").matches ? 24 : 36;
const MODE_STORAGE_KEY = "awudio.playMode.v1";
const VOLUME_STORAGE_KEY = "awudio.volume.v1";
const QUEUE_FALLBACK_STORAGE_KEY = "awudio.queue.fallback.v1";
const QUEUE_LEGACY_STORAGE_KEYS = [QUEUE_FALLBACK_STORAGE_KEY, "awudio.queue.v2", "awudio.queue.v1"];
const LIKED_STORAGE_KEY = "awudio.likedTracks.v1";
const LIKED_TRACKS_STORAGE_KEY = "awudio.likedTrackData.v1";
const AI_CHAT_STORAGE_KEY = "awudio.aiChat.v1";
const MAX_AI_CHAT_MESSAGES = 80;
const CHAT_RECOMMENDATION_LIMIT = 3;
const PLAYLIST_RECOMMENDATION_LIMIT = 30;
const PLAY_MODES = ["single", "list", "shuffle"];
const PLAY_MODE_LABELS = {
  single: "单曲循环",
  list: "列表循环",
  shuffle: "随机播放",
};

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
let queueView = "queue";
let aiChatMessages = loadAiChatMessages();

init();

async function init() {
  renderSegments(0);
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
  queuePrevPage.addEventListener("click", () => setQueuePage(queuePage - 1));
  queueNextPage.addEventListener("click", () => setQueuePage(queuePage + 1));
  playButton.addEventListener("click", togglePlay);
  prevButton.addEventListener("click", playPrevious);
  nextButton.addEventListener("click", playNext);
  likeButton.addEventListener("click", () => {
    if (currentTrack) likeTrack(currentTrack);
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

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("play", () => {
    setPlayState("[播放中]", true);
    playButton.setAttribute("aria-label", "暂停");
    playButton.title = "暂停";
    setPlayIcon(false);
    updateHostIntroDisplay();
    void sendTaste("play");
  });
  audio.addEventListener("pause", () => {
    if (currentTrack) setPlayState("[已暂停]", false);
    playButton.setAttribute("aria-label", "播放");
    playButton.title = "播放";
    setPlayIcon(true);
    updateHostIntroDisplay();
  });
  audio.addEventListener("ended", handleEnded);
  audio.addEventListener("error", () => {
    setPlayState("[音源错误]", false);
    setTransientPlayState(currentTrack?.blockReason || "[音源错误]");
    hideHostIntro();
  });
}

async function loadConfig() {
  const data = await getJson("/api/config");
  brainStatus.textContent =
    data.aiProvider === "local" ? "[大脑: 本地规则]" : `[大脑: ${data.aiModel}]`;
  sourceValue.textContent = data.ncm ? "[来源: 网易云]" : "[来源: 演示]";
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
  const message = rawMessage || "根据我的本地听歌偏好生成一份适合现在听的推荐歌单";
  const conversation = buildAiConversationPayload();
  const userMessage = appendAiChatMessage("user", `生成 30 首推荐歌单：${message}`);
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

  audio.pause();
  audio.removeAttribute("src");
  audio.load();

  queue = dedupeTracks(playableTracks).slice(0, MAX_QUEUE);
  currentIndex = resolvePlayableIndex(queue);
  currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  queueView = "queue";
  queuePage = 0;
  queueTab.classList.add("is-active");
  likedTab.classList.remove("is-active");
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

  currentIndex = index;
  currentTrack = queue[index];
  syncQueuePageToCurrent();
  renderCurrentTrack();
  renderQueue();
  persistQueue();

  audio.loop = playMode === "single";
  audio.src = currentTrack.url;

  try {
    await audio.play();
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
  if (playMode === "single") return;
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

function removeLikedTrack(track) {
  const key = trackKey(track);
  likedTrackKeys.delete(key);
  likedTracks = likedTracks.filter((item) => trackKey(item) !== key);
  saveLikedTrackKeys();
  saveLikedTracks();
  persistLikedTracks();
  renderQueue();
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
    .replace(/优先从喜欢歌单选歌，并避开最近的[^\n。]*[。]?/g, "按你的喜欢歌单和相邻风格做了筛选。")
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
    body.textContent = message.text || "…";

    item.append(meta, body);

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
      item.append(trackList);
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
  queueView = view === "liked" ? "liked" : "queue";
  queuePage = 0;
  queueTab.classList.toggle("is-active", queueView === "queue");
  likedTab.classList.toggle("is-active", queueView === "liked");
  renderQueue();
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
    currentIndex = -1;
    currentTrack = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } else if (removingCurrent) {
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
    hideHostIntro();
    setPlayState("[空闲]", false);
    return;
  }

  trackInfo.textContent =
    [currentTrack.title, currentTrack.artist].filter(Boolean).join(" - ") || "未知歌曲";
  updateHostIntroDisplay();
  refreshPlayStateForCurrent();
}

function updateHostIntroDisplay() {
  if (!hostIntro || !hostIntroText || !hostIntroTime) return;

  const intro = getHostIntro(currentTrack);
  if (!intro || !audio.currentSrc) {
    hideHostIntro();
    return;
  }

  const currentMs = Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;
  const startAtMs = Number(intro.startAtMs) || 0;
  const durationMs = Number(intro.estimatedDurationMs) || estimateClientHostIntroDurationMs(intro.displayText);
  const endAtMs = startAtMs + durationMs;

  if (currentMs < startAtMs || currentMs > endAtMs) {
    hideHostIntro();
    return;
  }

  hostIntroTime.textContent = formatTime(startAtMs / 1000);
  hostIntroText.textContent = intro.displayText;
  hostIntro.hidden = false;
}

function hideHostIntro() {
  if (!hostIntro || !hostIntroText) return;
  hostIntro.hidden = true;
  hostIntroText.textContent = "";
}

function getHostIntro(track) {
  return hasHostIntro(track) ? track.hostIntro : null;
}

function hasHostIntro(track) {
  return Boolean(track?.hostIntro?.enabled && track.hostIntro.displayText);
}

function renderTrackTitle(track, fallback = "未命名") {
  const title = escapeHtml(track?.title || fallback);
  const dot = hasHostIntro(track)
    ? '<span class="host-dot" aria-label="有讲解" title="有讲解"></span>'
    : "";
  return `${title}${dot}`;
}

function renderQueue() {
  const sourceTracks = queueView === "liked" ? likedTracks : queue;
  const pageCount = getQueuePageCount();
  queuePage = Math.min(queuePage, pageCount - 1);
  const start = queuePage * PAGE_SIZE;
  const visibleTracks = sourceTracks.slice(start, start + PAGE_SIZE);

  queueCount.textContent =
    queueView === "liked"
      ? `${String(likedTracks.length).padStart(2, "0")} 首喜欢`
      : `${String(queue.length).padStart(2, "0")} / ${MAX_QUEUE}`;
  queuePageInfo.textContent = `第 ${queuePage + 1} / ${pageCount} 页`;
  queuePrevPage.disabled = queuePage <= 0;
  queueNextPage.disabled = queuePage >= pageCount - 1;
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
    const index = start + localIndex;
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
          <button type="button" data-action="like">喜欢</button>
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
      likeTrack(track);
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
    audio.currentTime = Math.max(0, audio.currentTime - step);
    event.preventDefault();
  }

  if (event.key === "ArrowRight") {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
    event.preventDefault();
  }

  updateProgress();
}

function renderSegments(ratio) {
  const filled = Math.max(0, Math.min(SEGMENT_COUNT, Math.round(ratio * SEGMENT_COUNT)));
  progressSegments.innerHTML = "";

  for (let index = 0; index < SEGMENT_COUNT; index += 1) {
    const segment = document.createElement("i");
    if (index < filled) segment.className = "is-filled";
    progressSegments.append(segment);
  }
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
  const pageCount = getQueuePageCount();
  queuePage = Math.max(0, Math.min(page, pageCount - 1));
  renderQueue();
}

function getQueuePageCount() {
  const length = queueView === "liked" ? likedTracks.length : queue.length;
  return Math.max(1, Math.ceil(length / PAGE_SIZE));
}

function syncQueuePageToCurrent() {
  if (currentIndex < 0) return;
  queuePage = Math.floor(currentIndex / PAGE_SIZE);
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
  modeButton.textContent = PLAY_MODE_LABELS[playMode];
  modeButton.setAttribute("aria-label", `${PLAY_MODE_LABELS[playMode]}，点击切换`);
}

function setVolume(value, options = {}) {
  volume = normalizeVolume(value);
  audio.volume = volume;
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

function setPlayState(text, isPlaying) {
  playState.textContent = text;
  playState.classList.toggle("is-playing", Boolean(isPlaying));
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

  const displayText = String(value.displayText || value.text || "").trim().slice(0, 420);
  if (!displayText) return null;

  return {
    enabled: value.enabled !== false,
    startAtMs: clampMilliseconds(value.startAtMs, 0, 0, 60000),
    estimatedDurationMs: clampMilliseconds(
      value.estimatedDurationMs,
      estimateClientHostIntroDurationMs(displayText),
      12000,
      90000,
    ),
    displayText,
    tone: String(value.tone || "context").slice(0, 32),
    moodIntent: String(value.moodIntent || "random").slice(0, 32),
    source: String(value.source || "").slice(0, 40),
  };
}

function estimateClientHostIntroDurationMs(text) {
  const charCount = String(text || "").replace(/\s+/g, "").length;
  return Math.max(12000, Math.min(90000, Math.round((charCount / 4.2) * 1000)));
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
