import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJson, serial } from '../storage.mjs';
import { createAgentCatalog, fail, publicTrack } from './catalog.mjs';
import { schemas, writes } from './schemas.mjs';

const at = () => new Date().toISOString();
const keyPattern = /^[\w:.-]{1,160}$/;
const online = player => player && Date.now() - player.lastSeenAt < 15000;
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && timingSafeEqual(aa, bb);
};
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

export async function createAgentService({ dataDir, port, getIdentity, readState, mutateState, normalizeQueueState,
  ncm, profileSync, playability, listeningEvents, abortRecommendations, radioService }) {
  const credentialPath = join(dataDir, 'agent-bridge.json');
  let credential = await readJson(credentialPath);
  if (!credential?.token || credential.token.length < 40) credential = { token: `${randomUUID()}${randomUUID()}` };
  await atomicJson(credentialPath, { token: credential.token, baseUrl: `http://127.0.0.1:${port}` });
  await chmod(credentialPath, 0o600);
  const catalog = createAgentCatalog({ ncm, profileSync, playability, learningStore: listeningEvents });
  const sessions = new Map(), players = new Map(), streams = new Set();
  const instanceId = randomUUID();
  let lease = null, sequence = 0;
  const notify = () => {
    sequence++;
    for (const stream of streams) stream.write(`event: changed\ndata: ${JSON.stringify({ instanceId, sequence })}\n\n`);
  };
  function store(state) {
    state.agent ||= { mode: 'builtin', plans: {}, operations: {} };
    state.agent.plans ||= {}; state.agent.operations ||= {};
    for (const [id, plan] of Object.entries(state.agent.plans)) if (Date.now() - Date.parse(plan.createdAt) > 30 * 86400000) delete state.agent.plans[id];
    for (const [id, op] of Object.entries(state.agent.operations)) {
      if (Date.now() - Date.parse(op.createdAt) > 7 * 86400000) { delete state.agent.operations[id]; continue; }
      if (['accepted', 'delivered'].includes(op.status) && op.command &&
        (op.command.instanceId !== instanceId || Date.parse(op.command.expiresAt) < Date.now())) {
        op.status = op.status === 'delivered' ? 'uncertain' : 'expired'; op.updatedAt = at();
      }
    }
    return state.agent;
  }
  const leaseValid = () => lease && lease.expiresAt > Date.now() && online(players.get(lease.playerId));
  function requirePlayer(id) {
    if (!id || !leaseValid() || lease.playerId !== id) throw fail('unavailable', '需要打开播放器并选择本页面接收控制');
    return players.get(id);
  }
  function requireMode(state) { if (store(state).mode !== 'external') throw fail('mode_inactive', '请先在网页切换到外部 Agent 模式'); }
  function requireActive(session) { if (session?.signal?.aborted) throw fail('cancelled', '工具请求已取消'); }
  const serializeQueue = state => ({ queue: state.queue || [], currentIndex: state.queueCurrentIndex ?? -1, revision: state.queueRevision || 0 });
  function playerSummary(player) {
    return { playerId: player.id, name: player.name, online: Boolean(online(player)), lastSeenAt: new Date(player.lastSeenAt).toISOString(),
      selected: Boolean(leaseValid() && lease.playerId === player.id), playback: online(player) ? player.playback : null };
  }
  async function context() {
    const identity = await getIdentity();
    const state = await readState(), agent = store(state), profile = await profileSync.read(identity.accountKey);
    return { schemaVersion: 1, status: 'ok', mode: agent.mode, queueRevision: state.queueRevision || 0,
      queue: (state.queue || []).slice(0, 20).map(t => ({ id: t.id, title: t.title, artist: t.artist, planId: t.externalPlanId || null })),
      recentPlays: (state.plays || []).slice(-20).map(t => ({ id: t.id, title: t.title, artist: t.artist, at: t.at })),
      profile: { authenticated: identity.authenticated, count: profile?.allLikedSongs?.length || 0, complete: Boolean(profile?.complete), coverage: profile?.dataCoverage || null },
      players: [...players.values()].map(playerSummary), targetPlayerId: leaseValid() ? lease.playerId : null,
      agents: [...sessions.values()].filter(s => s.expiresAt > Date.now()).map(s => ({ name: s.name, lastSeenAt: s.lastSeenAt })),
      plans: Object.values(agent.plans).slice(-10).reverse().map(p => ({ planId: p.id, requestSummary: p.requestSummary, count: p.tracks.length, createdAt: p.createdAt, expiresAt: p.expiresAt })),
      radios: radioService ? await radioService.context() : null,
    };
  }
  function duplicate(state, args, tool) {
    const digest = createHash('sha256').update(JSON.stringify({ tool, args })).digest('hex');
    const old = store(state).operations[args.operationId];
    if (old) {
      if (old.digest !== digest) throw fail('conflict', '相同 operationId 已用于不同参数');
      return { old, digest };
    }
    return { digest };
  }
  function saveOperation(state, args, tool, result, command = null) {
    const { old, digest } = duplicate(state, args, tool);
    if (old) return old;
    const op = { operationId: args.operationId, digest, kind: tool, status: command ? 'accepted' : 'applied', createdAt: at(), updatedAt: at(), result, command };
    store(state).operations[args.operationId] = op;
    return op;
  }
  function publicOperation(op) {
    if (!op) throw fail('not_found', '没有找到该操作');
    return { schemaVersion: 1, operationId: op.operationId, status: op.status, ...op.result, receipt: op.receipt || null, updatedAt: op.updatedAt };
  }
  function ensureNoPending(state, id) {
    if (Object.values(store(state).operations).some(o => o.command?.targetPlayerId === id && ['accepted', 'delivered'].includes(o.status))) throw fail('conflict', '该播放器尚有操作等待回执，请先查询结果');
  }
  function makeCommand(player, state, action, args, revision) {
    ensureNoPending(state, player.id);
    return { id: args.operationId, action, instanceId, targetPlayerId: player.id, generation: lease.generation,
      expectedPlaybackSessionId: player.playback?.playbackSessionId || null, revision,
      expiresAt: new Date(Date.now() + 15000).toISOString() };
  }
  function queueTrack(track, plan) {
    return { ...track, provider: 'netease', duration: track.durationMs, playable: true, url: `/api/music/stream?id=${encodeURIComponent(track.id)}&full=1`,
      recommendationId: plan.id, externalPlanId: plan.id, origin: 'external_agent', evidenceIds: track.evidence.map(e => e.id),
      recommendationScene: track.stageId || 'main', playlistStage: { label: plan.stages.find(s => s.id === track.stageId)?.label || '外部 Agent 推荐', index: 0 } };
  }
  async function submit(args, session) {
    const current = await readState(); requireMode(current);
    const existing = duplicate(current, args, 'awudio_submit_plan').old;
    if (existing) return publicOperation(existing);
    const stageIds = new Set((args.stages || [{ id: 'main', label: '推荐' }]).map(s => s.id));
    if (args.tracks.some(t => !stageIds.has(t.stageId || 'main'))) throw fail('invalid_input', '歌曲阶段必须在 stages 中定义');
    for (const confirmed of args.confirmedArtists || []) {
      const result = await catalog.read('awudio_get_artist', { artistId: confirmed.artistId }, session);
      if (result.artist.name.normalize('NFKC').toLowerCase() !== confirmed.name.normalize('NFKC').toLowerCase()) throw fail('invalid_input', '确认的音乐人名称与真实 ID 不一致');
    }
    const validated = await catalog.validatePlan(args, session);
    if (!validated.tracks.length) throw fail('empty', '没有符合约束且可完整播放的歌曲', { rejected: validated.rejected });
    const plan = { id: `ext-${randomUUID()}`, ownerAccountKey: session.accountKey, createdAt: at(), expiresAt: new Date(Date.now() + 1800000).toISOString(),
      requestSummary: args.requestSummary, clientName: session.name, confirmedArtists: args.confirmedArtists || [], constraints: args.constraints || [],
      stages: args.stages || [{ id: 'main', label: '推荐' }], tracks: validated.tracks, rejected: validated.rejected };
    const op = await mutateState(state => {
      requireActive(session);
      requireMode(state);
      const old = duplicate(state, args, 'awudio_submit_plan').old;
      if (old) return old;
      store(state).plans[plan.id] = plan;
      return saveOperation(state, args, 'awudio_submit_plan', { planId: plan.id, displayed: true,
        count: plan.tracks.length, durationMs: plan.tracks.reduce((sum, t) => sum + t.durationMs, 0),
        tracks: plan.tracks.map(publicTrack), rejected: plan.rejected, expiresAt: plan.expiresAt });
    });
    notify(); return publicOperation(op);
  }
  async function apply(args, session) {
    const initial = await readState(); requireMode(initial);
    const existing = duplicate(initial, args, 'awudio_apply_plan').old;
    if (existing) return publicOperation(existing);
    const plan = store(initial).plans[args.planId];
    if (!plan) throw fail('not_found', '没有找到该计划');
    if (Date.parse(plan.expiresAt) < Date.now()) throw fail('invalid_input', '计划已过期，请重新检索并提交');
    requirePlayer(args.targetPlayerId);
    for (const t of plan.tracks) playability.invalidate(session.accountKey, t.id);
    const checked = await catalog.validatePlan({ tracks: plan.tracks.map(t => ({ ...t, trackId: t.id })), constraints: plan.constraints }, session, { recheck: true });
    if (JSON.stringify(checked.tracks.map(t => t.id)) !== JSON.stringify(plan.tracks.map(t => t.id))) throw fail('plan_changed', '播放资格或约束已变化，请重新提交计划', { rejected: checked.rejected });
    const op = await mutateState(state => {
      requireActive(session);
      requireMode(state);
      const old = duplicate(state, args, 'awudio_apply_plan').old;
      if (old) return old;
      if ((state.queueRevision || 0) !== args.expectedRevision) throw fail('conflict', '队列已改变，请重新读取上下文', { revision: state.queueRevision || 0 });
      const player = requirePlayer(args.targetPlayerId);
      if (player.playback?.queueRevision !== args.expectedRevision) throw fail('conflict', '目标网页尚未同步当前队列');
      if (args.queueMode === 'replace_all' && args.playback === 'keep' && player.playback?.loaded) throw fail('conflict', '已有加载的音频，请选择替换待播或明确开始播放');
      const items = checked.tracks.map(t => queueTrack(t, plan));
      const oldQueue = state.queue || [], activeId = player.playback?.trackId;
      let next, index = state.queueCurrentIndex ?? -1;
      if (args.queueMode === 'append') {
        const ids = new Set(oldQueue.map(t => `${t.provider}:${t.id}`));
        next = [...oldQueue, ...items.filter(t => !ids.has(`${t.provider}:${t.id}`))];
      } else if (args.queueMode === 'replace_upcoming') {
        const current = oldQueue.find(t => t.id === activeId);
        if (player.playback?.loaded && !current) throw fail('conflict', '当前音频与队列不一致');
        next = [...(current ? [current] : []), ...items.filter(t => t.id !== current?.id)]; index = current ? 0 : -1;
      } else { next = items; index = -1; }
      if (next.length > 200) throw fail('conflict', '队列超过 200 首，请先整理队列');
      const firstId = items[0]?.id;
      if (args.playback === 'play_first' && !next.some(t => t.id === firstId)) throw fail('conflict', '计划首曲未进入队列');
      // Validate command availability before mutating any queue fields.
      if (args.playback === 'play_first') ensureNoPending(state, player.id);
      state.queue = next; state.queueCurrentIndex = index;
      state.queueRevision = (state.queueRevision || 0) + 1; state.queueUpdatedAt = at();
      const command = args.playback === 'play_first' ? { ...makeCommand(player, state, 'play_first', args, state.queueRevision), trackId: firstId, playMode: 'list' } : null;
      return saveOperation(state, args, 'awudio_apply_plan', { planId: plan.id, queueUpdated: true, revision: state.queueRevision, count: next.length }, command);
    });
    notify(); return publicOperation(op);
  }
  async function control(args, session) {
    const op = await mutateState(state => {
      requireActive(session);
      requireMode(state);
      const old = duplicate(state, args, 'awudio_control_player').old;
      if (old) return old;
      const player = requirePlayer(args.targetPlayerId);
      if ((player.playback?.playbackSessionId || null) !== args.expectedPlaybackSessionId || args.expectedRevision !== (state.queueRevision || 0) || player.playback?.queueRevision !== args.expectedRevision) throw fail('conflict', '播放会话或队列已变化，请重新读取上下文');
      const command = makeCommand(player, state, args.action, args, args.expectedRevision);
      return saveOperation(state, args, 'awudio_control_player', { action: args.action }, command);
    });
    notify(); return publicOperation(op);
  }
  async function feedback(args, session) {
    const state = await readState(); requireMode(state);
    const existing = duplicate(state, args, 'awudio_record_feedback').old;
    if (existing && existing.status !== 'pending_feedback') return publicOperation(existing);
    if (args.action.startsWith('undo_') && !args.undoOf) throw fail('invalid_input', '撤销必须提供原 eventId');
    if (!existing && args.action.startsWith('undo_')) {
      const learning = await listeningEvents.summary(session.accountKey);
      const track = learning.tracks?.[args.trackId];
      if (args.action === 'undo_dislike' && (track?.actions?.block?.type !== 'dislike' || track.actions.block.eventId !== args.undoOf)) throw fail('conflict', '不喜欢反馈已变化，不能撤销另一次反馈');
      if (args.action === 'undo_not_now' && !track?.contextNegatives?.some(item => item.eventId === args.undoOf)) throw fail('conflict', '没有找到对应的场景反馈');
    }
    const tracks = await catalog.details([args.trackId], session, catalog.budgetFor(session));
    if (!tracks.length) throw fail('not_found', '没有找到该歌曲');
    const eventId = `agent:${args.operationId}`, plan = args.planId ? store(state).plans[args.planId] : null;
    if (args.planId && !plan?.tracks.some(t => t.id === args.trackId)) throw fail('invalid_input', '该歌曲不属于指定计划');
    await listeningEvents.migrate(session.accountKey, state);
    const event = { eventId, type: args.action, trackId: args.trackId, track: tracks[0], clientId: 'external-agent', actionSeq: Date.now(), seq: 0,
      playbackSessionId: null, occurredAt: at(), recommendationId: plan?.id || null, undoOf: args.undoOf || null,
      context: { source: 'external_agent', stageId: plan?.tracks.find(t => t.id === args.trackId)?.stageId || '', scene: 'unknown' } };
    const reserved = await mutateState(latest => {
      requireActive(session);
      requireMode(latest);
      const old = duplicate(latest, args, 'awudio_record_feedback').old;
      if (old) return old;
      store(latest).feedbackSequence = Math.max(Date.now(), (store(latest).feedbackSequence || 0) + 1);
      event.actionSeq = store(latest).feedbackSequence;
      const op = saveOperation(latest, args, 'awudio_record_feedback', { eventId, action: args.action, trackId: args.trackId });
      op.status = 'pending_feedback'; op.feedbackEvent = event; return op;
    });
    const result = await listeningEvents.ingest(session.accountKey, [reserved.feedbackEvent]);
    if (!result.accepted.includes(eventId) && !result.duplicate.includes(eventId)) throw fail('invalid_input', '反馈未被事件服务接受');
    const op = await mutateState(latest => {
      const op = duplicate(latest, args, 'awudio_record_feedback').old;
      op.status = 'applied'; op.updatedAt = at(); return op;
    });
    notify(); return publicOperation(op);
  }
  async function call(tool, input, session, signal) {
    if (!schemas[tool]) throw fail('invalid_input', '未知工具');
    const parsed = schemas[tool].safeParse(input);
    if (!parsed.success) throw fail('invalid_input', '工具参数格式不符合契约');
    const args = parsed.data;
    session = Object.create(session); // One deadline per call; shared lookup and rate-meter references.
    session.signal = signal;
    if (tool === 'awudio_get_context') return context();
    if (['awudio_prepare_radio','awudio_get_radio','awudio_write_radio_script','awudio_save_radio'].includes(tool)) return radioService.call(tool,args,{signal});
    if (tool === 'awudio_get_operation') {
      const until = Date.now() + (args.waitMs || 0);
      let op;
      do {
        op = store(await readState()).operations[args.operationId];
        if (!op || !['accepted', 'delivered'].includes(op.status) || Date.now() >= until) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      } while (true);
      return publicOperation(op);
    }
    if (!writes.has(tool)) return { schemaVersion: 1, ...await catalog.read(tool, args, session) };
    return serial(`agent-op:${session.accountKey}:${args.operationId}`, () => {
      if (tool === 'awudio_submit_plan') return submit(args, session);
      if (tool === 'awudio_apply_plan') return apply(args, session);
      if (tool === 'awudio_control_player') return control(args, session);
      return feedback(args, session);
    });
  }
  function localRequest(req) {
    if (!loopback(req.socket.remoteAddress)) throw fail('unauthorized', '音乐控制只接受本机请求');
    const host = String(req.headers.host || '');
    if (![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host)) throw fail('unauthorized', '无效的本地主机');
    if (req.headers.origin && req.headers.origin !== `http://${host}`) throw fail('unauthorized', '拒绝跨来源音乐控制');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('unauthorized', '拒绝跨站音乐控制');
  }
  function browser(req, allowRegister = false) {
    localRequest(req);
    if (req.headers['x-awudio-browser'] !== '1') throw fail('unauthorized', '缺少播放器请求标识');
    if (allowRegister) return null;
    const token = req.headers['x-awudio-player-token'];
    const player = [...players.values()].find(p => safeEqual(token, p.token));
    if (!player) throw fail('unauthorized', '播放器会话过期，请刷新页面');
    return player;
  }
  async function browserSnapshot(player) {
    const initial = await readState();
    const build = state => {
      const agent = store(state), commands = [];
      if (agent.mode === 'external' && leaseValid() && lease.playerId === player.id) {
        for (const op of Object.values(agent.operations)) if (op.command?.targetPlayerId === player.id && ['accepted', 'delivered'].includes(op.status)) {
          if (op.command.generation !== lease.generation) { op.status = 'expired'; continue; }
          if (op.status === 'accepted') { op.status = 'delivered'; op.updatedAt = at(); }
          commands.push(op.command);
        }
      }
      return { mode: agent.mode, ...serializeQueue(state), commands,
        radioHistoryKey: JSON.stringify((state.radioHistory || []).map(r=>[r.id,r.updatedAt])),
        plans: Object.values(agent.plans).slice(-10).reverse().map(p => ({ ...p, ownerAccountKey: undefined, tracks: p.tracks.map(t => queueTrack(t, p)) })),
        operations: Object.values(agent.operations).slice(-15).reverse().map(publicOperation) };
    };
    const hasPending = Object.values(initial.agent?.operations || {}).some(op => ['accepted', 'delivered'].includes(op.status));
    const snapshot = hasPending ? await mutateState(build) : build(initial);
    const identity = await getIdentity();
    const learning = await listeningEvents.summary(identity.accountKey);
    const feedback = Object.values(learning.tracks || {}).filter(t => t.actions?.like).map(t => ({ trackId: t.id,
      liked: t.liked, eventId: t.actions.like.eventId, metadata: t.metadata }));
    return { schemaVersion: 1, status: 'ok', ...snapshot, instanceId, sequence, feedback,
      players: [...players.values()].map(playerSummary), lease: leaseValid() ? { playerId: lease.playerId, generation: lease.generation } : null,
      agents: [...sessions.values()].filter(s => s.expiresAt > Date.now()).map(s => ({ name: s.name, lastSeenAt: s.lastSeenAt })) };
  }
  async function route(req, res, url, readBody) {
    if (!url.pathname.startsWith('/api/agent/') && !url.pathname.startsWith('/api/player/')) return false;
    try {
      localRequest(req);
      await getIdentity();
      if (url.pathname.startsWith('/api/agent/')) {
        if (!safeEqual(req.headers.authorization, `Bearer ${credential.token}`)) throw fail('unauthorized', 'Agent 桥接认证失败');
        if (req.method !== 'POST') throw fail('invalid_input', '使用 POST');
        const identity = await getIdentity();
        const body = await readBody(req);
        if (url.pathname === '/api/agent/register') {
          if (sessions.size >= 100) for (const [id, s] of sessions) if (s.expiresAt < Date.now()) sessions.delete(id);
          if (sessions.size >= 100) throw fail('rate_limited', 'Agent 连接过多');
          const sessionId = randomUUID();
          sessions.set(sessionId, { id: sessionId, accountKey: identity.accountKey, name: String(body.name || 'MCP client').slice(0, 80), lastSeenAt: at(), expiresAt: Date.now() + 60000, lookups: new Map(), meter: { requests: [] }, active: 0 });
          json(res, 200, { status: 'ok', sessionId }); notify(); return true;
        }
        const session = sessions.get(req.headers['x-awudio-agent-session']);
        if (!session || session.expiresAt < Date.now() || session.accountKey !== identity.accountKey) throw fail('unauthorized', 'Agent 会话已失效，请重新连接');
        session.expiresAt = Date.now() + 60000; session.lastSeenAt = at();
        if (body.name) session.name = String(body.name).slice(0, 80);
        if (url.pathname === '/api/agent/heartbeat') { json(res, 200, { status: 'ok' }); return true; }
        if (url.pathname !== '/api/agent/call') throw fail('not_found', '未知 Agent 接口');
        if (session.active >= 4) throw fail('rate_limited', '最多同时执行 4 个音乐工具');
        session.active++;
        const controller = new AbortController();
        res.once('close', () => controller.abort());
        try { json(res, 200, await call(body.tool, body.args, session, controller.signal)); }
        finally { session.active--; }
        return true;
      }
      const registering = url.pathname === '/api/player/register';
      let player = browser(req, registering);
      if (registering && req.method === 'POST') {
        const body = await readBody(req);
        for (const [id, p] of players) if (p.lastSeenAt < Date.now() - 600000) players.delete(id);
        if (players.size >= 30) throw fail('rate_limited', '播放器页面过多');
        const id = randomUUID();
        player = { id, token: `${randomUUID()}${randomUUID()}`, name: String(body.name || '网页播放器').slice(0, 80), lastSeenAt: Date.now(), playback: null };
        players.set(id, player);
        json(res, 200, { status: 'ok', playerId: id, token: player.token }); notify(); return true;
      }
      if (url.pathname === '/api/player/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        streams.add(res); res.write(`event: changed\ndata: ${JSON.stringify({ instanceId, sequence })}\n\n`);
        const timer = setInterval(() => res.write(': heartbeat\n\n'), 10000);
        res.on('close', () => { clearInterval(timer); streams.delete(res); }); return true;
      }
      if (url.pathname === '/api/player/snapshot' && req.method === 'GET') { json(res, 200, await browserSnapshot(player)); return true; }
      if (req.method !== 'POST') throw fail('invalid_input', '未知播放器接口');
      const body = await readBody(req);
      if (url.pathname === '/api/player/apply') {
        const identity = await getIdentity();
        const session = { id: player.id, accountKey: identity.accountKey, name: '网页', lookups: new Map(), meter: player.meter ||= { requests: [] } };
        json(res, 200, await call('awudio_apply_plan', body, session)); return true;
      }
      if (url.pathname === '/api/player/heartbeat') {
        const p = body.playback || {};
        player.playback = { trackId: /^\d{1,30}$/.test(p.trackId || '') ? p.trackId : null,
          playbackSessionId: keyPattern.test(p.playbackSessionId || '') ? p.playbackSessionId : null,
          paused: Boolean(p.paused), loaded: Boolean(p.loaded), positionMs: Math.max(0, Math.min(86400000, Number(p.positionMs) || 0)),
          durationMs: Math.max(0, Math.min(86400000, Number(p.durationMs) || 0)), queueRevision: Number.isSafeInteger(p.queueRevision) ? p.queueRevision : -1 };
        player.lastSeenAt = Date.now();
        const state = await readState();
        if (store(state).mode === 'external' && (!leaseValid() && [...players.values()].filter(online).length === 1 || lease?.playerId === player.id)) {
          lease = { playerId: player.id, generation: leaseValid() && lease.playerId === player.id ? lease.generation : randomUUID(), expiresAt: Date.now() + 20000 };
        }
        json(res, 200, { status: 'ok' }); return true;
      }
      if (url.pathname === '/api/player/select') {
        const target = players.get(body.playerId || player.id);
        if (!online(target)) throw fail('unavailable', '目标网页离线');
        requireMode(await readState());
        lease = { playerId: target.id, generation: randomUUID(), expiresAt: Date.now() + 20000 };
        await mutateState(state => { for (const op of Object.values(store(state).operations)) if (['accepted', 'delivered'].includes(op.status)) op.status = op.status === 'delivered' ? 'uncertain' : 'expired'; });
        json(res, 200, { status: 'ok' }); notify(); return true;
      }
      if (url.pathname === '/api/player/mode') {
        if (!['external', 'builtin'].includes(body.mode)) throw fail('invalid_input', '未知模式');
        abortRecommendations();
        await mutateState(state => {
          const agent = store(state); agent.mode = body.mode;
          for (const op of Object.values(agent.operations)) if (['accepted', 'delivered'].includes(op.status)) op.status = op.status === 'delivered' ? 'uncertain' : 'expired';
        });
        lease = body.mode === 'external' && [...players.values()].filter(online).length === 1 ? { playerId: player.id, generation: randomUUID(), expiresAt: Date.now() + 20000 } : null;
        json(res, 200, { status: 'ok' }); notify(); return true;
      }
      if (url.pathname === '/api/player/receipt') {
        const allowed = ['applied', 'needs_user_gesture', 'failed', 'uncertain'];
        if (!keyPattern.test(body.operationId || '') || !allowed.includes(body.status)) throw fail('invalid_input', '回执无效');
        await mutateState(state => {
          const op = store(state).operations[body.operationId];
          if (!op?.command || op.command.targetPlayerId !== player.id || body.generation !== op.command.generation) throw fail('conflict', '回执目标不匹配');
          const receipt = { outcome: ['playing', 'paused'].includes(body.outcome) ? body.outcome : null, message: String(body.message || '').slice(0, 200), at: at() };
          if (body.status === 'applied') {
            const pause = op.command.action === 'pause';
            if (body.outcome !== (pause ? 'paused' : 'playing') || !online(player) || player.playback?.paused !== pause || (!pause && !player.playback?.loaded) || (op.command.action === 'play_first' && player.playback?.trackId !== op.command.trackId)) throw fail('conflict', '回执未匹配浏览器实际播放状态');
          }
          if (['accepted', 'delivered'].includes(op.status) && leaseValid() && lease.generation === body.generation) op.status = body.status;
          else if (op.status !== body.status) receipt.late = true;
          op.receipt = receipt; op.updatedAt = at();
        });
        json(res, 200, { status: 'ok' }); notify(); return true;
      }
      throw fail('not_found', '未知播放器接口');
    } catch (error) {
      const code = error.status === 'unauthorized' ? 401 : error.status === 'not_found' ? 404 : error.status === 'conflict' ? 409 : 400;
      json(res, code, { schemaVersion: 1, status: error.status || 'unavailable', message: error.status ? error.message : '音乐服务暂时不可用', revision: error.revision, rejected: error.rejected });
      return true;
    }
  }
  return { route, notify, context, guardBrowserMutation: req => localRequest(req),
    async isExternal() { return store(await readState()).mode === 'external'; },
    async explain(id, trackId) { const plan = store(await readState()).plans[id]; return plan?.tracks.find(t => t.id === trackId)?.reasonSummary || null; },
  };
}
