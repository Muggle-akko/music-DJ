const audio = document.querySelector("#audio");
const aiInput = document.querySelector("#aiInput");
const searchInput = document.querySelector("#searchInput");
const askButton = document.querySelector("#askButton");
const searchButton = document.querySelector("#searchButton");
const addAiButton = document.querySelector("#addAiButton");
const addSearchButton = document.querySelector("#addSearchButton");
const playButton = document.querySelector("#playButton");
const playIcon = document.querySelector("#playIcon");
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const likeButton = document.querySelector("#likeButton");
const dislikeButton = document.querySelector("#dislikeButton");
const aiTab = document.querySelector("#aiTab");
const searchTab = document.querySelector("#searchTab");
const aiPane = document.querySelector("#aiPane");
const searchPane = document.querySelector("#searchPane");
const queuePrevPage = document.querySelector("#queuePrevPage");
const queueNextPage = document.querySelector("#queueNextPage");

const clockDisplay = document.querySelector("#clockDisplay");
const trackInfo = document.querySelector("#trackInfo");
const playState = document.querySelector("#playState");
const currentTime = document.querySelector("#currentTime");
const duration = document.querySelector("#duration");
const progressSegments = document.querySelector("#progressSegments");
const queueList = document.querySelector("#queueList");
const queueCount = document.querySelector("#queueCount");
const queuePageInfo = document.querySelector("#queuePageInfo");
const aiResultsList = document.querySelector("#aiResultsList");
const searchResultsList = document.querySelector("#searchResultsList");
const aiResultCount = document.querySelector("#aiResultCount");
const searchResultCount = document.querySelector("#searchResultCount");
const aiSay = document.querySelector("#aiSay");
const aiReason = document.querySelector("#aiReason");
const searchSay = document.querySelector("#searchSay");
const searchReason = document.querySelector("#searchReason");
const brainStatus = document.querySelector("#brainStatus");
const musicStatus = document.querySelector("#musicStatus");
const sourceValue = document.querySelector("#sourceValue");
const moodValue = document.querySelector("#moodValue");
const cacheValue = document.querySelector("#cacheValue");

const MAX_QUEUE = 30;
const PAGE_SIZE = 10;
const SEGMENT_COUNT = window.matchMedia("(max-width: 520px)").matches ? 24 : 36;
const QUEUE_STORAGE_KEY = "awudio.queue.v1";

const PLAY_SVG = '<path d="M9 6l9 6-9 6V6z"/>';
const PAUSE_SVG = '<path d="M9 6v12M15 6v12"/>';

let queue = [];
let currentIndex = -1;
let currentTrack = null;
let queuePage = 0;
let aiResults = [];
let searchResults = [];

init();

async function init() {
  renderSegments(0);
  tickClock();
  setInterval(tickClock, 1000);
  bindEvents();
  restoreQueue();
  await loadConfig();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/sw.js");
      cacheValue.textContent = "[CACHE: PWA]";
    } catch {
      cacheValue.textContent = "[CACHE: OFF]";
    }
  }
}

function bindEvents() {
  aiTab.addEventListener("click", () => activateTab("ai"));
  searchTab.addEventListener("click", () => activateTab("search"));
  askButton.addEventListener("click", askDj);
  searchButton.addEventListener("click", searchMusic);
  addAiButton.addEventListener("click", () => addPlayableTracks(aiResults));
  addSearchButton.addEventListener("click", () => addPlayableTracks(searchResults));
  queuePrevPage.addEventListener("click", () => setQueuePage(queuePage - 1));
  queueNextPage.addEventListener("click", () => setQueuePage(queuePage + 1));
  playButton.addEventListener("click", togglePlay);
  prevButton.addEventListener("click", playPrevious);
  nextButton.addEventListener("click", playNext);
  likeButton.addEventListener("click", () => sendTaste("like"));
  dislikeButton.addEventListener("click", async () => {
    await sendTaste("dislike");
    playNext();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchMusic();
  });

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("play", () => {
    playState.textContent = "[PLAYING]";
    playButton.setAttribute("aria-label", "Pause");
    playButton.title = "Pause";
    setPlayIcon(false);
  });
  audio.addEventListener("pause", () => {
    playState.textContent = "[PAUSED]";
    playButton.setAttribute("aria-label", "Play");
    playButton.title = "Play";
    setPlayIcon(true);
  });
  audio.addEventListener("ended", playNext);
  audio.addEventListener("error", () => {
    playState.textContent = "[SOURCE ERROR]";
    aiReason.textContent = currentTrack?.blockReason || "当前音源无法播放，已被浏览器或网易云上游拒绝。";
  });
}

async function loadConfig() {
  const data = await getJson("/api/config");
  brainStatus.textContent =
    data.aiProvider === "local" ? "[BRAIN: LOCAL]" : `[BRAIN: ${data.aiModel}]`;
  musicStatus.textContent = data.ncm ? "[MUSIC: NETEASE]" : "[MUSIC: DEMO]";
  sourceValue.textContent = data.ncm ? "[SOURCE: NETEASE]" : "[SOURCE: DEMO]";
}

async function askDj() {
  const message = aiInput.value.trim();
  if (!message) return;

  setBusy(true, "[THINKING]");

  try {
    const data = await postJson("/api/chat", { message });
    aiResults = data.tracks || [];
    aiSay.textContent = data.plan?.say ? `[${data.plan.say}]` : "[READY]";
    aiReason.textContent = getResultMessage(data.plan?.reason || "已生成 AI 推荐。", aiResults);
    moodValue.textContent = `[MOOD: ${(data.plan?.mood || "random").toUpperCase()}]`;
    sourceValue.textContent = `[SOURCE: ${(data.source?.music || "demo").toUpperCase()}]`;
    renderResults(aiResultsList, aiResultCount, aiResults, "AI");

    if (!queue.length) addPlayableTracks(aiResults, { playFirst: true });
  } catch (error) {
    aiSay.textContent = "[ERROR]";
    aiReason.textContent = error.message;
    playState.textContent = "[ERROR]";
  } finally {
    setBusy(false);
  }
}

async function searchMusic() {
  const query = searchInput.value.trim() || "私人雷达";
  setBusy(true, "[SEARCHING]");

  try {
    const data = await getJson(`/api/music/search?q=${encodeURIComponent(query)}`);
    searchResults = data.tracks || [];
    searchSay.textContent = `[SEARCH: ${query}]`;
    searchReason.textContent = data.source === "netease"
      ? `网易云返回 ${searchResults.length} 条结果，${data.playableCount || 0} 条可播放。搜索结果不会替换当前播放列表。`
      : "未连接网易云服务，当前使用 demo 音源验证播放器。";
    sourceValue.textContent = `[SOURCE: ${(data.source || "demo").toUpperCase()}]`;
    renderResults(searchResultsList, searchResultCount, searchResults, "SEARCH");
  } catch (error) {
    searchSay.textContent = "[SEARCH ERROR]";
    searchReason.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function addPlayableTracks(tracks, options = {}) {
  const playableTracks = tracks.filter(isPlayable);

  if (!playableTracks.length) {
    playState.textContent = "[NO PLAYABLE]";
    return;
  }

  const currentKey = currentTrack ? trackKey(currentTrack) : "";
  const previousLength = queue.length;
  const combined = dedupeTracks([...queue, ...playableTracks]).slice(-MAX_QUEUE);
  queue = combined;

  if (currentKey) {
    currentIndex = queue.findIndex((track) => trackKey(track) === currentKey);
  }

  if (currentIndex === -1 || !currentTrack) {
    currentIndex = Math.max(0, Math.min(previousLength, queue.length - 1));
  }

  currentTrack = queue[currentIndex] || null;
  syncQueuePageToCurrent();
  persistQueue();
  renderCurrentTrack();
  renderQueue();

  if (options.playFirst && isPlayable(currentTrack)) {
    playTrack(currentIndex);
  }
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

  if (audio.paused) {
    await audio.play();
    await sendTaste("play");
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

  audio.src = currentTrack.url;

  try {
    await audio.play();
    await sendTaste("play");
  } catch {
    playState.textContent = "[TAP PLAY]";
  }
}

function playPrevious() {
  if (!queue.length) return;
  const nextIndex = findPreviousPlayableIndex(currentIndex);
  if (nextIndex !== -1) playTrack(nextIndex);
}

function playNext() {
  if (!queue.length) return;
  const nextIndex = findNextPlayableIndex(currentIndex);
  if (nextIndex !== -1) playTrack(nextIndex);
}

async function sendTaste(action) {
  if (!currentTrack) return;
  await postJson("/api/taste", { action, track: currentTrack });
}

function renderCurrentTrack() {
  if (!currentTrack) {
    trackInfo.textContent = "ASK THE DJ";
    playState.textContent = "[IDLE]";
    return;
  }

  trackInfo.textContent = [currentTrack.title, currentTrack.artist].filter(Boolean).join(" - ") || "UNKNOWN";
  playState.textContent = isPlayable(currentTrack) ? "[READY]" : "[BLOCKED]";
}

function renderQueue() {
  const pageCount = getQueuePageCount();
  queuePage = Math.min(queuePage, pageCount - 1);
  const start = queuePage * PAGE_SIZE;
  const visibleTracks = queue.slice(start, start + PAGE_SIZE);

  queueCount.textContent = `${String(queue.length).padStart(2, "0")} / ${MAX_QUEUE}`;
  queuePageInfo.textContent = `PAGE ${queuePage + 1} / ${pageCount}`;
  queuePrevPage.disabled = queuePage <= 0;
  queueNextPage.disabled = queuePage >= pageCount - 1;
  queueList.innerHTML = "";

  if (!queue.length) {
    const empty = document.createElement("li");
    empty.className = "queue-item";
    empty.innerHTML = '<span class="queue-index">--</span><div class="queue-title"><strong>NO QUEUE</strong><span>Add AI or Netease results</span></div><span class="queue-meta">IDLE</span>';
    queueList.append(empty);
    return;
  }

  visibleTracks.forEach((track, localIndex) => {
    const index = start + localIndex;
    const item = document.createElement("li");
    item.className = `queue-item${index === currentIndex ? " is-active" : ""}`;
    item.innerHTML = `
      <span class="queue-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="queue-title">
        <strong>${escapeHtml(track.title || "Untitled")}</strong>
        <span>${escapeHtml(track.artist || "Unknown")}</span>
      </div>
      <span class="queue-meta">${index === currentIndex ? "NOW" : "PLAY"}</span>
    `;
    item.addEventListener("click", () => playTrack(index));
    queueList.append(item);
  });
}

function renderResults(listElement, countElement, tracks, label) {
  countElement.textContent = `${String(tracks.length).padStart(2, "0")} RESULTS`;
  listElement.innerHTML = "";

  if (!tracks.length) {
    const empty = document.createElement("li");
    empty.className = "result-item is-disabled";
    empty.innerHTML = '<span class="queue-index">--</span><div class="queue-title"><strong>NO RESULTS</strong><span>Try another prompt or keyword</span></div><span class="queue-meta">IDLE</span>';
    listElement.append(empty);
    return;
  }

  tracks.forEach((track, index) => {
    const playable = isPlayable(track);
    const item = document.createElement("li");
    item.className = `result-item${playable ? "" : " is-disabled"}`;
    item.innerHTML = `
      <span class="queue-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="queue-title">
        <strong>${escapeHtml(track.title || "Untitled")}</strong>
        <span>${escapeHtml(track.artist || "Unknown")}${track.blockReason ? ` - ${escapeHtml(track.blockReason)}` : ""}</span>
      </div>
      <button class="mini-action" type="button" ${playable ? "" : "disabled"}>${playable ? "ADD" : "LOCK"}</button>
    `;
    const button = item.querySelector("button");
    if (playable) button.addEventListener("click", () => addAndPlay(track));
    listElement.append(item);
  });
}

function addAndPlay(track) {
  addPlayableTracks([track]);
  const index = queue.findIndex((item) => trackKey(item) === trackKey(track));
  if (index !== -1) playTrack(index);
}

function updateProgress() {
  const total = Number.isFinite(audio.duration) ? audio.duration : 0;
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const ratio = total ? current / total : 0;

  currentTime.textContent = formatTime(current);
  duration.textContent = total ? formatTime(total) : "--:--";
  renderSegments(ratio);
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

function setQueuePage(page) {
  const pageCount = getQueuePageCount();
  queuePage = Math.max(0, Math.min(page, pageCount - 1));
  renderQueue();
}

function getQueuePageCount() {
  return Math.max(1, Math.ceil(queue.length / PAGE_SIZE));
}

function syncQueuePageToCurrent() {
  if (currentIndex < 0) return;
  queuePage = Math.floor(currentIndex / PAGE_SIZE);
}

function setBusy(isBusy, state = null) {
  askButton.disabled = isBusy;
  searchButton.disabled = isBusy;
  addAiButton.disabled = isBusy;
  addSearchButton.disabled = isBusy;
  if (state) playState.textContent = state;
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

function getResultMessage(prefix, tracks) {
  if (!tracks.length) return `${prefix} 没有搜索到结果。`;
  const playableCount = tracks.filter(isPlayable).length;
  if (playableCount) return `${prefix} ${playableCount} 首可加入播放队列。`;
  return `${prefix} 这些结果都没有可播放链接，通常是版权、地区或账号权限限制。`;
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

function trackKey(track) {
  return `${track?.provider || "unknown"}:${track?.id || track?.title || ""}`;
}

function persistQueue() {
  localStorage.setItem(
    QUEUE_STORAGE_KEY,
    JSON.stringify({
      queue,
      currentIndex,
    }),
  );
}

function restoreQueue() {
  try {
    const stored = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "{}");
    queue = Array.isArray(stored.queue) ? stored.queue.filter(isPlayable).slice(-MAX_QUEUE) : [];
    currentIndex = Number.isInteger(stored.currentIndex) ? stored.currentIndex : resolvePlayableIndex(queue);
    if (currentIndex >= queue.length) currentIndex = resolvePlayableIndex(queue);
    currentTrack = queue[currentIndex] || null;
  } catch {
    queue = [];
    currentIndex = -1;
    currentTrack = null;
  }

  renderCurrentTrack();
  renderQueue();
}

function tickClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  clockDisplay.textContent = `${hours}:${minutes}`;
}

function setPlayIcon(isPlay) {
  playIcon.innerHTML = isPlay ? PLAY_SVG : PAUSE_SVG;
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
