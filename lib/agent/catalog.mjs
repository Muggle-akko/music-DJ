import { randomUUID } from 'node:crypto';
import { mapSong, extractWikiFeatures } from '../taste/profile-sync.mjs';
import { candidate, rejectReason } from '../recommendation/candidates.mjs';
import { Budget } from '../recommendation/budget.mjs';

export const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
export const numericId = value => /^\d{1,30}$/.test(String(value || ''));
const fold = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const text = (value, max = 500) => String(value || '').slice(0, max);
export const publicTrack = track => ({
  id: track.id, title: track.title, artist: track.artist, artistIds: track.artistIds,
  album: track.album, durationMs: track.durationMs, aliases: track.aliases,
  features: track.features, version: track.version, familiarity: track.familiarity,
});

export function createAgentCatalog({ ncm, profileSync, playability, learningStore }) {
  function budgetFor(session) {
    if (session.budget) return session.budget;
    const budget = new Budget({ durationMs: 10000, signal: session.signal });
    const call = budget.call.bind(budget);
    const meter = session.meter ||= { requests: [] };
    budget.call = (kind, label, fn) => {
      meter.requests = meter.requests.filter(t => t > Date.now() - 60000);
      if (meter.requests.length >= 60) throw fail('rate_limited', '音乐工具每分钟最多 60 次上游请求');
      meter.requests.push(Date.now());
      return call(kind, label, fn);
    };
    session.budget = budget;
    return budget;
  }
  function remember(session, tracks, source) {
    const lookupRef = randomUUID(), at = Date.now();
    const normalized = tracks.map(raw => candidate(raw, { source, retrievedAt: new Date(at).toISOString() }, {})).filter(Boolean);
    for (const [key, value] of session.lookups) if (value.expiresAt <= at) session.lookups.delete(key);
    while (session.lookups.size >= 100) session.lookups.delete(session.lookups.keys().next().value);
    const evidence = normalized.map(t => ({ id: `${lookupRef}:${t.id}`, trackId: t.id, source, value: `${t.title} / ${t.artist}` }));
    session.lookups.set(lookupRef, { expiresAt: at + 1800000, tracks: normalized, evidence });
    return { status: normalized.length ? 'ok' : 'empty', lookupRef,
      tracks: normalized.map(t => ({ ...publicTrack(t), evidenceRefs: [`${lookupRef}:${t.id}`] })), evidence };
  }
  async function details(ids, session, budget) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some(id => !numericId(id))) throw fail('invalid_input', '需要 1–30 个真实歌曲 ID');
    const data = await budget.call('detail', 'song_detail', signal => ncm('/song/detail', { ids: ids.join(',') }, { signal }));
    if (!Array.isArray(data.songs)) throw fail('unavailable', '上游歌曲详情结构异常');
    const wanted = new Set(ids.map(String));
    const features = await profileSync.readFeatures(session.accountKey);
    return data.songs.filter(t => wanted.has(String(t.id))).map(raw => {
      const track = candidate(mapSong(raw), { source: 'song_detail' }, {});
      if (track && features[track.id]) track.features = features[track.id].features;
      return track;
    }).filter(Boolean);
  }
  async function artist(id, budget) {
    if (!numericId(id)) throw fail('invalid_input', '音乐人 ID 无效');
    const data = await budget.call('retrieval', 'artist_detail', signal => ncm('/artist/detail', { id }, { signal }));
    const a = data.data?.artist;
    if (!a || String(a.id) !== String(id)) throw fail('not_found', '未找到该音乐人');
    return { artistId: String(a.id), name: text(a.name, 160), aliases: (a.alias || []).map(v => text(v, 160)).slice(0, 20),
      description: text(a.briefDesc, 1500), country: null, artistType: null,
      source: 'netease_artist_detail', retrievedAt: new Date().toISOString() };
  }
  async function read(tool, args, session) {
    const budget = budgetFor(session);
    const request = (path, params) => budget.call('retrieval', path, signal => ncm(path, params, { signal }));
    const limit = args.limit ?? (tool === 'awudio_search_artists' ? 10 : 30);
    const cursor = args.cursor ? Number(args.cursor) : 0;
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 100000) throw fail('invalid_input', '分页游标无效');
    if (tool === 'awudio_search_artists') {
      const queries = [...new Set([args.query, fold(args.query)])];
      const all = [];
      for (const keywords of queries) {
        const data = await request('/cloudsearch', { keywords, type: 100, limit });
        if (!Array.isArray(data.result?.artists)) throw fail('unavailable', '上游音乐人搜索结构异常');
        all.push(...data.result.artists);
      }
      const artists = [...new Map(all.filter(a => numericId(a.id)).map(a => [String(a.id), {
        artistId: String(a.id), name: text(a.name, 160), aliases: (a.alias || []).map(v => text(v, 160)).slice(0, 20),
        description: text(a.briefDesc, 500), country: null, artistType: null,
        source: 'netease_artist_search', spellingMatch: fold(a.name) === fold(args.query),
      }])).values()].slice(0, limit);
      return { status: artists.length ? 'ok' : 'empty', artists, hint: '拼写匹配不代表身份唯一；必要时查详情或用其他拼写补查，不要默认选择第一项。' };
    }
    if (tool === 'awudio_get_artist') return { status: 'ok', artist: await artist(args.artistId, budget) };
    if (tool === 'awudio_search_tracks') {
      const data = await request('/cloudsearch', { keywords: args.query, type: 1, limit, offset: cursor });
      if (!Array.isArray(data.result?.songs)) throw fail('unavailable', '上游歌曲搜索结构异常');
      return { ...remember(session, data.result.songs, 'song_search'), nextCursor: data.result.songs.length === limit ? String(cursor + limit) : null };
    }
    if (tool === 'awudio_artist_tracks') {
      const verified = await artist(args.artistId, budget);
      const data = await request('/artist/songs', { id: verified.artistId, limit, offset: cursor, order: 'hot' });
      if (!Array.isArray(data.songs)) throw fail('unavailable', '上游音乐人歌曲结构异常');
      const tracks = data.songs.filter(t => (t.ar || t.artists || []).some(a => String(a.id) === verified.artistId));
      return { ...remember(session, tracks, 'artist_tracks'), artist: verified, nextCursor: data.more ? String(cursor + limit) : null };
    }
    if (tool === 'awudio_similar_tracks') {
      if (!(await details([args.trackId], session, budget)).length) throw fail('not_found', '相似歌曲种子不存在');
      const data = await request('/simi/song', { id: args.trackId });
      if (!Array.isArray(data.songs)) throw fail('unavailable', '上游相似歌曲结构异常');
      return { ...remember(session, data.songs.slice(0, limit), 'similar'), seedId: args.trackId };
    }
    if (tool === 'awudio_library_lookup') {
      const profile = await profileSync.read(session.accountKey);
      const learning = await learningStore.summary(session.accountKey);
      const byId = new Map((profile?.allLikedSongs || []).map(t => [t.id, t]));
      for (const [id, learned] of Object.entries(learning.tracks || {})) if (learned.liked && learned.metadata?.title && !byId.has(id)) byId.set(id, { ...learned.metadata, id, durationMs: 0 });
      const rows = [...byId.values()].filter(t => !learning.tracks?.[t.id]?.blocked && (!args.query || fold(`${t.title} ${t.artist}`).includes(fold(args.query))) && (!args.artistId || t.artistIds?.includes(args.artistId)));
      return { ...remember(session, rows.slice(cursor, cursor + limit), 'liked_library'), total: rows.length, complete: Boolean(profile?.complete), coverage: profile?.dataCoverage || null, nextCursor: cursor + limit < rows.length ? String(cursor + limit) : null };
    }
    if (tool === 'awudio_check_playability') {
      const tracks = await details(args.trackIds, session, budget);
      const checked = await playability.check(tracks, session.accountKey, budget);
      return { ...remember(session, tracks, 'song_detail'), status: 'ok', results: args.trackIds.map(id => ({ trackId: id, ...(checked.get(id) || { state: 'unknown', reasonCode: 'not_found' }) })) };
    }
    throw fail('invalid_input', '未知只读音乐工具');
  }
  async function validatePlan(args, session, { recheck = false } = {}) {
    const budget = budgetFor(session);
    const rows = args.tracks;
    const references = new Map();
    if (!recheck) for (const row of rows) {
      const lookup = session.lookups.get(row.lookupRef);
      if (!lookup || lookup.expiresAt < Date.now() || !lookup.tracks.some(t => t.id === row.trackId)) throw fail('invalid_input', '检索凭据过期或不属于该歌曲，请重新检索');
      const refs = row.evidenceRefs || [];
      if (refs.some(ref => !lookup.evidence.some(e => e.id === ref && e.trackId === row.trackId))) throw fail('invalid_input', '推荐证据与歌曲不匹配');
      references.set(row.trackId, lookup.evidence.filter(e => refs.includes(e.id)));
    }
    const tracks = await details([...new Set(rows.map(t => t.trackId))], session, budget);
    const learning = await learningStore.summary(session.accountKey);
    const constraints = args.constraints || [];
    const featureRules = constraints.some(c => ['vocal', 'language', 'genre'].includes(c.field));
    if (featureRules) {
      const updates = [];
      for (const track of tracks.slice(0, 5)) {
        if (budget.remaining() < 1000) break;
        try {
          const wiki = await budget.call('wiki', 'song_wiki', signal => ncm('/song/wiki/summary', { id: track.id }, { signal }));
          track.features = extractWikiFeatures(wiki);
          updates.push({ id: track.id, features: track.features });
        } catch { /* Unknown features remain unknown, and strict constraints reject them. */ }
      }
      await profileSync.saveFeatures(session.accountKey, updates);
    }
    const checked = await playability.check(tracks, session.accountKey, budget);
    const byId = new Map(tracks.map(t => [t.id, t])), seen = new Set(), accepted = [], rejected = [];
    for (const row of rows) {
      const track = byId.get(row.trackId);
      const reason = !track ? 'not_found' : seen.has(track.id) ? 'duplicate' : rejectReason(track, { hardConstraints: constraints, allowReplay: true }, { learning, now: Date.now() });
      seen.add(row.trackId);
      const qualification = checked.get(row.trackId);
      if (reason || qualification?.state !== 'full') { rejected.push({ trackId: row.trackId, reason: reason || qualification?.state || 'unknown' }); continue; }
      accepted.push({ ...track, stageId: row.stageId || 'main', reasonSummary: row.reason || '', playability: qualification,
        evidence: recheck ? row.evidence || [] : references.get(track.id) || [], lookupRef: row.lookupRef });
    }
    return { tracks: accepted, rejected };
  }
  return { read, validatePlan, details, budgetFor };
}
