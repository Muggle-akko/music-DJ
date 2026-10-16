// External Agent integration. The browser owns audio; the server owns durable plans and commands.
export function createAgentController(adapter) {
  let token, playerId, mode = 'builtin', lastSnapshot, initializing, refreshing, repeat = false;
  let streamAbort, stopped = false, lastLease = null, externalPlayback = false;
  let heartbeatRunning = false, renderKey = '', manualVersion = 0;
  let modeChanging = false, deviceChoiceDirty = false;
  const pendingReceipts = new Map();
  const seenKey = 'awudio.agent.commands.v1';
  let seen;
  try { seen = new Set(JSON.parse(sessionStorage.getItem(seenKey) || '[]')); } catch { seen = new Set(); }
  const node = id => document.getElementById(id);
  const status = message => {
    node('agentStatus').textContent = message;
    node('agentConnectionState').title = message;
  };
  const remember = id => {
    seen.add(id);
    while (seen.size > 1000) seen.delete(seen.values().next().value);
    sessionStorage.setItem(seenKey, JSON.stringify([...seen]));
  };
  async function api(path, body) {
    const response = await fetch(`/api/player/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Awudio-Browser': '1', ...(token ? { 'X-Awudio-Player-Token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { token = null; streamAbort?.abort(); }
      throw Object.assign(new Error(result.message || '播放器连接失败'), { status: result.status });
    }
    return result;
  }
  async function initialize() {
    if (token) return;
    initializing ||= api('register', { name: `网页播放器 · ${document.title}` }).then(result => {
      token = result.token; playerId = result.playerId;
      void stream();
    }).finally(() => { initializing = null; });
    await initializing;
  }
  async function heartbeat() {
    if (heartbeatRunning || stopped) return;
    heartbeatRunning = true;
    try {
      await initialize();
      await api('heartbeat', { playback: adapter.getPlayback() });
      for (const [id, receipt] of pendingReceipts) {
        await api('receipt', receipt); pendingReceipts.delete(id);
      }
      await refresh();
    } catch (error) { status(error.message); node('agentConnectionState').dataset.state = 'error'; }
    finally { heartbeatRunning = false; }
  }
  async function sendReceipt(command, state, extra = {}) {
    const receipt = { operationId: command.id, generation: command.generation, status: state, ...extra };
    pendingReceipts.set(command.id, receipt);
    try { await api('receipt', receipt); pendingReceipts.delete(command.id); } catch { /* Retried by heartbeat; never retry the audio action. */ }
  }
  async function execute(command, snapshot, before) {
    if (seen.has(command.id)) {
      if (!pendingReceipts.has(command.id)) await sendReceipt(command, 'uncertain', { message: '页面已处理或曾开始处理该命令，未重复执行，请核对实际播放状态' });
      return;
    }
    if (mode !== 'external' || snapshot.lease?.playerId !== playerId || snapshot.lease.generation !== command.generation || Date.parse(command.expiresAt) < Date.now()) return;
    if ((before.playbackSessionId || null) !== command.expectedPlaybackSessionId || command.revision !== adapter.getPlayback().queueRevision) {
      remember(command.id); await sendReceipt(command, 'failed', { message: '本地播放或队列已经改变，未执行旧命令' }); return;
    }
    remember(command.id); // Persist before the side effect, including across a reload.
    const version = manualVersion;
    try {
      const outcome = await adapter.execute(command);
      if (manualVersion !== version || mode !== 'external' || lastLease !== command.generation) {
        await sendReceipt(command, 'uncertain', { message: '执行期间用户操作或控制设备已改变，请查看实际状态' }); return;
      }
      externalPlayback = outcome === 'playing';
      await api('heartbeat', { playback: adapter.getPlayback() });
      await sendReceipt(command, 'applied', { outcome });
    } catch (error) {
      const gesture = error.name === 'NotAllowedError';
      node('agentResumeButton').hidden = !gesture;
      await sendReceipt(command, gesture ? 'needs_user_gesture' : 'failed', { message: gesture ? '浏览器要求手动点击开始播放' : '音频尚未确认播放成功，请核对播放器' });
    }
  }
  function render(snapshot) {
    const nextMode = snapshot.mode;
    if (mode !== nextMode) manualVersion++;
    mode = nextMode;
    const wasLease = lastLease;
    lastLease = snapshot.lease?.playerId === playerId ? snapshot.lease.generation : null;
    if (wasLease && !lastLease && externalPlayback && mode === 'external') { adapter.pause(); externalPlayback = false; }
    adapter.onMode(mode);
    for (const button of document.querySelectorAll('[data-radio-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.radioMode === mode));
      button.disabled = modeChanging;
    }
    node('externalAgentPanel').hidden = mode !== 'external';
    node('builtinRecommendation').hidden = mode === 'external';
    const active = snapshot.agents || [];
    const selected = snapshot.players.find(p => p.selected);
    status(active.length ? `${active.map(a => a.name).join('、')} 已连接` : '尚未连接 Agent');
    node('agentConnectionState').dataset.state = active.length ? 'ready' : 'waiting';
    const select = node('agentPlayerSelect'), previous = select.value;
    const onlinePlayers = snapshot.players.filter(p => p.online);
    const playerName = p => p.playerId === playerId ? '本页面' : `页面 ${onlinePlayers.findIndex(item => item.playerId === p.playerId) + 1}`;
    const playerKey = JSON.stringify(onlinePlayers.map(p => p.playerId));
    if (select.dataset.players !== playerKey) {
      select.replaceChildren();
      for (const player of onlinePlayers) {
        const option = document.createElement('option'); option.value = player.playerId;
        option.textContent = playerName(player); option.title = player.name; select.append(option);
      }
      select.dataset.players = playerKey;
    }
    if (deviceChoiceDirty && onlinePlayers.some(p => p.playerId === previous)) select.value = previous;
    else { select.value = selected?.playerId || playerId; deviceChoiceDirty = false; }
    const selectedOptionIsTarget = select.value === selected?.playerId;
    node('agentSelectPlayerButton').disabled = selectedOptionIsTarget || !select.value;
    node('agentSelectPlayerButton').textContent = selectedOptionIsTarget ? '已选择' : '设为播放页面';
    node('agentDeviceControls').hidden = onlinePlayers.length === 1 && Boolean(selected);
    node('agentDeviceSummary').textContent = selected ? `${playerName(selected)}接收播放控制` : '选择一个页面来接收播放控制';
    const latest = snapshot.operations[0];
    const labels = { accepted: '等待播放器执行', delivered: '已送达，等待播放回执', pending_feedback: '正在保存反馈', applied: '已完成', needs_user_gesture: '请点击开始播放', failed: '执行失败', expired: '操作已过期', uncertain: '执行结果不确定，请核对播放器' };
    const recent = latest && (latest.status !== 'applied' || Date.now() - Date.parse(latest.updatedAt) < 8000);
    node('agentOperationPanel').hidden = !recent;
    node('agentOperationPanel').dataset.state = latest?.status || '';
    node('agentOperationStatus').textContent = latest ? `${latest.receipt?.outcome === 'playing' ? '已开始播放' : labels[latest.status] || '处理中'}${latest.receipt?.message ? ` · ${latest.receipt.message}` : ''}` : '';
    node('agentResumeButton').hidden = latest?.status !== 'needs_user_gesture';
    const empty = !snapshot.plans.length;
    node('agentEmptyState').hidden = !empty; node('agentPlans').hidden = empty;
    node('agentEmptyTitle').textContent = active.length ? '等待你的下一段音乐' : '连接你的音乐助手';
    node('agentEmptyDescription').textContent = active.length ? '告诉 Agent 想听什么，选好的歌会出现在这里。' : '在 Codex 里聊想听的音乐，选好的歌会同步到这里。';
    const key = JSON.stringify(snapshot.plans.map(p => [p.id, p.expiresAt, Date.parse(p.expiresAt) < Date.now()]));
    if (renderKey !== key) { renderKey = key; adapter.renderPlans(snapshot.plans, applyPlan); }
  }
  async function refresh() {
    if (refreshing) { repeat = true; return refreshing; }
    refreshing = (async () => {
      do {
        repeat = false;
        await initialize();
        const clean = await adapter.flushQueue();
        const before = adapter.getPlayback();
        const version = manualVersion;
        const snapshot = await api('snapshot'); lastSnapshot = snapshot;
        render(snapshot);
        adapter.syncFeedback(snapshot.feedback || []);
        if (!clean || before.queueMutationVersion !== adapter.getPlayback().queueMutationVersion) continue;
        await adapter.syncQueue(snapshot);
        for (const command of snapshot.commands) {
          if (version !== manualVersion) { remember(command.id); await sendReceipt(command, 'failed', { message: '等待期间发生手动操作，未执行旧命令' }); }
          else await execute(command, snapshot, before);
        }
      } while (repeat && !stopped);
    })().catch(error => { status(error.message); node('agentConnectionState').dataset.state = 'error'; }).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function stream() {
    streamAbort?.abort();
    const controller = new AbortController(); streamAbort = controller;
    try {
      const response = await fetch('/api/player/events', { headers: { 'X-Awudio-Browser': '1', 'X-Awudio-Player-Token': token }, signal: controller.signal });
      if (!response.ok || !response.body) throw new Error('stream_unavailable');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (!stopped) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (chunk.startsWith('event: changed')) void refresh();
        }
      }
    } catch { /* Heartbeat snapshots recover missing events. */ }
    if (!stopped && token && streamAbort === controller) setTimeout(() => { if (!stopped && token) void stream(); }, 3000);
  }
  async function applyPlan(planId, queueMode, playback) {
    try {
      if (!await adapter.flushQueue()) throw new Error('请先处理队列冲突');
      await api('heartbeat', { playback: adapter.getPlayback() });
      const snapshot = await api('snapshot');
      const target = snapshot.lease?.playerId;
      if (!target) throw new Error('请先选择接收播放的页面');
      await api('apply', { operationId: crypto.randomUUID(), planId, expectedRevision: snapshot.revision, queueMode, playback, targetPlayerId: target });
      await refresh();
    } catch (error) { adapter.notice(error.message); }
  }
  for (const button of document.querySelectorAll('[data-radio-mode]')) button.addEventListener('click', async () => {
    if (modeChanging || button.dataset.radioMode === mode) return;
    modeChanging = true;
    document.querySelectorAll('[data-radio-mode]').forEach(item => { item.disabled = true; });
    try { await initialize(); await api('mode', { mode: button.dataset.radioMode }); await heartbeat(); }
    catch (error) { adapter.notice(error.message); }
    finally { modeChanging = false; document.querySelectorAll('[data-radio-mode]').forEach(item => { item.disabled = false; }); }
  });
  node('agentConnectionSettingsButton').addEventListener('click', () => {
    const button = node('agentConnectionSettingsButton'), panel = node('agentConnectionSettings');
    panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  node('agentPlayerSelect').addEventListener('change', () => {
    deviceChoiceDirty = true;
    const selected = lastSnapshot?.players.find(p => p.selected);
    node('agentSelectPlayerButton').disabled = node('agentPlayerSelect').value === selected?.playerId;
    node('agentSelectPlayerButton').textContent = node('agentSelectPlayerButton').disabled ? '已选择' : '设为播放页面';
  });
  node('agentSelectPlayerButton').addEventListener('click', async () => {
    try { await api('select', { playerId: node('agentPlayerSelect').value }); deviceChoiceDirty = false; await refresh(); }
    catch (error) { adapter.notice(error.message); }
  });
  node('agentRefreshButton').addEventListener('click', () => { void heartbeat(); });
  node('agentExampleButton').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText('推荐几首英国乐队 Bôa 的歌，先展示，不要播放。'); adapter.notice('已复制，到 Agent 对话中粘贴即可'); }
    catch { adapter.notice('可以直接告诉 Agent：推荐几首英国乐队 Bôa 的歌'); }
  });
  node('agentResumeButton').addEventListener('click', async () => {
    try { await adapter.resume(); node('agentResumeButton').hidden = true; await heartbeat(); }
    catch { adapter.notice('播放未开始，请检查音源后重试'); }
  });
  for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => { manualVersion++; }, { capture: true });
  const timer = setInterval(() => { void heartbeat(); }, 5000);
  void heartbeat();
  window.addEventListener('pagehide', () => { stopped = true; clearInterval(timer); streamAbort?.abort(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  return { refresh, get mode() { return mode; }, get playerId() { return playerId; }, get snapshot() { return lastSnapshot; } };
}
