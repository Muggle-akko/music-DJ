import { syncDelay } from '/sync-policy.mjs?v=36';
import { browserDataCache } from '/network.mjs?v=46';
import { mobileClient } from "/device-policy.mjs?v=36";
import { apiFetch } from "/network.mjs?v=46";
export { createRecommendationController as createAgentController } from '/recommendations.mjs?v=51';
// External Agent integration. The browser owns audio; the server owns durable plans and commands.
export function createRealtimeAgentController(adapter) {
  let token, playerId, mode = 'builtin', lastSnapshot, initializing, refreshing, repeat = false;
  let streamAbort, stopped = false, lastLease = null;
  let heartbeatRunning = false, renderKey = '', manualVersion = 0;
  let modeChanging = false, deviceChoiceDirty = false;
  let radioHistoryKey = '', timer, failures=0,lastAttempt=0;
  const delay=()=>syncDelay({agents:Boolean(lastSnapshot?.agents?.length),playing:!adapter.getPlayback().paused,hidden:document.hidden,pending:pendingReceipts.size>0,failures});
  function schedule(){clearTimeout(timer);const ms=delay();if(!stopped && ms!==null)timer=setTimeout(()=>{void heartbeat();},ms);}
  function wake(){clearTimeout(timer);void heartbeat();}
  const pendingReceipts = new Map();
  const seenKey = 'awudio.agent.commands.v1';
  let seen;
  try { seen = new Set(JSON.parse(sessionStorage.getItem(seenKey) || '[]')); } catch { seen = new Set(); }
  const node = id => document.getElementById(id);
  const playbackOnly = () => mobileClient || matchMedia('(max-width: 860px)').matches;
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
    const response = await apiFetch(`/api/player/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Awudio-Browser': '1', ...(token ? { 'X-Awudio-Player-Token': token } : {}),
        ...(path==='snapshot' && lastSnapshot?.plansVersion ? {'X-Awudio-Plans-Version':lastSnapshot.plansVersion} : {}),
        ...(path==='snapshot' && lastSnapshot?.feedbackVersion ? {'X-Awudio-Feedback-Version':lastSnapshot.feedbackVersion} : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { token = null; streamAbort?.abort(); }
      throw Object.assign(new Error(result.message || result.error || '播放器连接失败'), { status: result.status });
    }
    if(result.plansUnchanged)result.plans=lastSnapshot.plans;
    if(result.feedbackUnchanged)result.feedback=lastSnapshot.feedback;
    return result;
  }
  async function initialize() {
    if (token) return;
    initializing ||= api('register', { name: localStorage.getItem('awudio.deviceName') || (/iPad/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : /Mac/.test(navigator.platform) ? 'Mac 网页播放器' : '网页播放器') }).then(async result => {
      token = result.token; playerId = result.playerId;
      if(playbackOnly() && result.mode!=='external')await api('mode',{mode:'external'});
      if(adapter.events!==false)void stream();
    }).finally(() => { initializing = null; });
    await initializing;
  }
  async function heartbeat() {
    if (heartbeatRunning || stopped) return;
    heartbeatRunning = true;lastAttempt=Date.now();
    try {
      await initialize();
      await api('heartbeat', { playback: adapter.getPlayback(), heartbeatMs:delay(), name:localStorage.getItem('awudio.deviceName') || undefined });
      for (const [id, receipt] of pendingReceipts) {
        await api('receipt', receipt); pendingReceipts.delete(id);
      }
      if(await refresh())failures=0;else failures++;
    } catch (error) { failures++;status(error.message); node('agentConnectionState').dataset.state = 'error'; }
    finally { heartbeatRunning = false;schedule(); }
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
      await api('heartbeat', { playback: adapter.getPlayback() });
      await sendReceipt(command, 'applied', { outcome });
    } catch (error) {
      const gesture = error.name === 'NotAllowedError';
      node('agentResumeButton').hidden = !gesture;
      await sendReceipt(command, gesture ? 'needs_user_gesture' : 'failed', { message: gesture ? '浏览器要求手动点击开始播放' : '音频尚未确认播放成功，请核对播放器' });
    }
  }
  function render(snapshot) {
    if (snapshot.radioHistoryKey !== radioHistoryKey) { radioHistoryKey=snapshot.radioHistoryKey; adapter.onRadioChange?.(); }
    const nextMode = snapshot.mode;
    if (mode !== nextMode) manualVersion++;
    mode = nextMode;
    lastLease = snapshot.lease?.playerId === playerId ? snapshot.lease.generation : null;
    adapter.onMode(mode);
    for (const button of document.querySelectorAll('[data-radio-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.radioMode === mode));
      button.disabled = modeChanging;
    }
    node('externalAgentPanel').hidden = !playbackOnly() && mode !== 'external';
    node('builtinRecommendation').hidden = playbackOnly() || mode === 'external';
    const active = snapshot.agents || [];
    const selected = snapshot.players.find(p => p.selected);
    status(active.length ? 'Agent 已连接' : 'Agent 待命');
    node('agentConnectionState').dataset.state = active.length ? 'ready' : 'waiting';
    const select = node('agentPlayerSelect'), previous = select.value;
    const onlinePlayers = snapshot.players.filter(p => p.online);
    const playerName = p => p.playerId === playerId ? `${p.name}（本页面）` : p.name;
    const playerKey = JSON.stringify(onlinePlayers.map(p => [p.playerId,p.name]));
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
    node('agentSelectPlayerButton').textContent = selectedOptionIsTarget ? '已选择' : '让 Agent 控制此页面';
    node('agentDeviceControls').hidden = onlinePlayers.length === 1 && Boolean(selected);
    node('agentDeviceSummary').textContent = selected ? `Agent 控制：${playerName(selected)}` : '选择 Agent 控制的页面；推荐结果会同步到所有设备';
    const latest = snapshot.operations[0];
    const labels = { accepted: '等待播放器执行', delivered: '已送达，等待播放回执', pending_feedback: '正在保存反馈', applied: '已完成', needs_user_gesture: '请点击开始播放', failed: '执行失败', expired: '操作已过期', uncertain: '执行结果不确定，请核对播放器' };
    const recent = latest && (latest.status === 'needs_user_gesture' || Date.now()-Date.parse(latest.updatedAt)<(['applied','expired'].includes(latest.status)?8000:60000));
    node('agentOperationPanel').hidden = !recent;
    node('agentOperationPanel').dataset.state = latest?.status || '';
    node('agentOperationStatus').textContent = latest ? `${latest.receipt?.outcome === 'playing' ? '已开始播放' : labels[latest.status] || '处理中'}${latest.receipt?.message ? ` · ${latest.receipt.message}` : ''}` : '';
    node('agentResumeButton').hidden = latest?.status !== 'needs_user_gesture';
    const empty = !snapshot.plans.length;
    node('agentEmptyState').hidden = !empty; node('agentPlans').hidden = empty;
    node('agentEmptyTitle').textContent = active.length ? '等待你的下一段音乐' : '下一段音乐，从对话开始';
    node('agentEmptyDescription').textContent = active.length ? '告诉 Agent 想听什么，选好的歌会出现在这里。' : '需要新推荐时，在电脑上打开 Agent。已有的歌单和电台随时可听。';
    const key = JSON.stringify(snapshot.plans.map(p => [p.id, p.createdAt]));
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
        if(!snapshot.plansUnchanged)void browserDataCache.write('/__awudio_cache/agent-plans',snapshot.plans,3*86400000);
        adapter.syncFeedback(snapshot.feedback || []);
        if (!clean || before.queueMutationVersion !== adapter.getPlayback().queueMutationVersion) continue;
        await adapter.syncQueue(snapshot);
        for (const command of snapshot.commands) {
          if (version !== manualVersion) { remember(command.id); await sendReceipt(command, 'failed', { message: '等待期间发生手动操作，未执行旧命令' }); }
          else await execute(command, snapshot, before);
        }
      } while (repeat && !stopped);
      return true;
    })().catch(error => { status(error.message); node('agentConnectionState').dataset.state = 'error';return false; }).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function stream() {
    streamAbort?.abort();
    const controller = new AbortController(); streamAbort = controller;
    try {
      const response = await apiFetch('/api/player/events', { headers: { 'X-Awudio-Browser': '1', 'X-Awudio-Player-Token': token }, signal: controller.signal });
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
  const applyingPlans=new Map();
  function applyPlan(planId, queueMode, playback, onProgress=()=>{}) {
    if(applyingPlans.has(planId))return applyingPlans.get(planId);
    const progress=(stage,text)=>onProgress({stage,text,queueMode,playback});
    const job=(async()=>{
    try {
      progress('applying','正在同步当前队列…');
      await initialize();
      if (!await adapter.flushQueue()) throw new Error('请先处理队列同步失败或冲突');
      await api('heartbeat', { playback: adapter.getPlayback() });
      const snapshot = await api('snapshot');
      const target = snapshot.lease?.playerId;
      if (!target) throw new Error('请先选择接收播放的页面');
      progress('saving','正在加入队列，不会逐首等待播放校验…');
      const result=await api('apply', { operationId: crypto.randomUUID(), planId, expectedRevision: snapshot.players.find(p=>p.playerId===target)?.playback?.queueRevision ?? snapshot.revision, queueMode, playback, targetPlayerId: target });
      if(!result.queueUpdated)throw new Error('云端尚未确认队列更新，请刷新队列后核对');
      const refreshed=await refresh();
      const text=refreshed?'队列已更新，云端已保存':'云端队列已保存，本页暂未刷新，请稍后刷新查看';
      progress('complete',text);adapter.notice(text);
      return {stage:'complete',text,queueMode,playback};
    } catch (error) {
      const text=`操作未完成：${error.message}`;progress('error',text);adapter.notice(text);
      return {stage:'error',text,queueMode,playback};
    }
    })().finally(()=>applyingPlans.delete(planId));
    applyingPlans.set(planId,job);return job;
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
    node('agentSelectPlayerButton').textContent = node('agentSelectPlayerButton').disabled ? '已选择' : '让 Agent 控制此页面';
  });
  node('agentSelectPlayerButton').addEventListener('click', async () => {
    try { await api('select', { playerId: node('agentPlayerSelect').value }); deviceChoiceDirty = false; await refresh(); }
    catch (error) { adapter.notice(error.message); }
  });
  async function refreshConnectionStatus() {
    const buttons = ['agentRefreshButton', 'agentStatusRefreshButton'].map(node);
    if (buttons.some(button => button.disabled)) return;
    buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
    status('正在检查 Agent 连接…');
    try {
      await initialize();
      const snapshot = await api('snapshot');
      lastSnapshot = snapshot;failures=0;
      render(snapshot);
    } catch (error) {
      status(error.message);
      node('agentConnectionState').dataset.state = 'error';
    } finally {
      buttons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); });schedule();
    }
  }
  node('agentRefreshButton').addEventListener('click', refreshConnectionStatus);
  node('agentStatusRefreshButton').addEventListener('click', refreshConnectionStatus);
  node('agentExampleButton').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText('推荐几首英国乐队 Bôa 的歌，先展示，不要播放。'); adapter.notice('已复制，到 Agent 对话中粘贴即可'); }
    catch { adapter.notice('可以直接告诉 Agent：推荐几首英国乐队 Bôa 的歌'); }
  });
  node('agentResumeButton').addEventListener('click', async () => {
    try { await adapter.resume(); node('agentResumeButton').hidden = true; await heartbeat(); }
    catch { adapter.notice('播放未开始，请检查音源后重试'); }
  });
  for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => { manualVersion++; }, { capture: true });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();else schedule();});
  window.addEventListener('online',wake);
  document.addEventListener('pointerdown',()=>{if(Date.now()-lastAttempt>15000)wake();},{passive:true});
  void browserDataCache.read('/__awudio_cache/agent-plans').then(async cached=>{
    if(!cached || lastSnapshot)return;
    const plans=(await cached.json()).filter(plan=>Date.now()-Date.parse(plan.createdAt)<=3*86400000);
    if(plans.length && !lastSnapshot){node('agentEmptyState').hidden=true;node('agentPlans').hidden=false;adapter.renderPlans(plans,applyPlan);status('上次推荐 · 正在检查连接…');}
  }).catch(()=>{});
  void heartbeat();
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); streamAbort?.abort(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  return { refresh, get mode() { return mode; }, get playerId() { return playerId; }, get snapshot() { return lastSnapshot; } };
}
