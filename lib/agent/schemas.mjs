import { z } from 'zod';
import { radioSchemas, radioDescriptions } from '../radio.mjs';

const id = z.string().regex(/^\d{1,30}$/);
const uuid = z.string().regex(/^[\w:.-]{1,160}$/);
const query = z.string().trim().min(1).max(80);
const page = { cursor: z.string().regex(/^\d{1,6}$/).optional(), limit: z.number().int().min(1).max(50).optional() };
const operationId = uuid;
export const schemas = {
  ...radioSchemas,
  awudio_get_context: z.object({}).strict(),
  awudio_search_artists: z.object({ query, limit: z.number().int().min(1).max(10).optional() }).strict(),
  awudio_get_artist: z.object({ artistId: id }).strict(),
  awudio_search_tracks: z.object({ query, ...page }).strict(),
  awudio_artist_tracks: z.object({ artistId: id, ...page }).strict(),
  awudio_similar_tracks: z.object({ trackId: id, limit: z.number().int().min(1).max(30).optional() }).strict(),
  awudio_library_lookup: z.object({ query: query.optional(), artistId: id.optional(), ...page }).strict(),
  awudio_check_playability: z.object({ trackIds: z.array(id).min(1).max(30) }).strict(),
  awudio_submit_plan: z.object({ operationId, requestSummary: z.string().trim().min(1).max(1000), intent: z.literal('recommend'),
    confirmedArtists: z.array(z.object({ artistId: id, name: z.string().max(160) }).strict()).max(10).optional(),
    constraints: z.array(z.object({ field: z.enum(['artistId', 'trackId', 'version', 'genre', 'vocal', 'language', 'theme', 'releasedAfter', 'releasedBefore']), operator: z.enum(['eq', 'in', 'not_in']), value: z.union([z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(20)]) }).strict()).max(20).optional(),
    tracks: z.array(z.object({ trackId: id, lookupRef: uuid, stageId: z.string().max(40).optional(), reason: z.string().max(200), evidenceRefs: z.array(z.string().max(200)).min(1).max(20) }).strict()).min(1).max(30),
    stages: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().max(80) }).strict()).max(6).optional(),
  }).strict(),
  awudio_apply_plan: z.object({ operationId, planId: uuid, expectedRevision: z.number().int().nonnegative(), queueMode: z.enum(['append', 'replace_all', 'replace_upcoming']), playback: z.enum(['keep', 'play_first']), targetPlayerId: uuid.optional() }).strict(),
  awudio_control_player: z.object({ operationId, targetPlayerId: uuid, action: z.enum(['play', 'pause', 'next', 'previous']), expectedPlaybackSessionId: uuid.nullable(), expectedRevision: z.number().int().nonnegative() }).strict(),
  awudio_get_operation: z.object({ operationId, waitMs: z.number().int().min(0).max(5000).optional() }).strict(),
  awudio_record_feedback: z.object({ operationId, trackId: id, action: z.enum(['like', 'unlike', 'dislike', 'undo_dislike', 'not_now', 'undo_not_now']), planId: uuid.optional(), undoOf: uuid.optional() }).strict(),
};

export const descriptions = {
  ...radioDescriptions,
  awudio_get_context: '读取音乐模式、连接与实时播放状态、受限队列和偏好摘要。任务开始时使用；不播放或推荐。',
  awudio_search_artists: '检索多个真实音乐人候选。拼写、重音或同名可能有歧义；不要直接选第一项。必要时用详情核对并询问用户。',
  awudio_get_artist: '按真实音乐人 ID 读取简介和区分线索，缺少的信息标记未知。',
  awudio_search_tracks: '搜索真实歌曲并返回 lookupRef 和 evidenceRefs，供自行选曲后提交计划；不修改队列。',
  awudio_artist_tracks: '取得已验证音乐人的歌曲、检索凭据和证据；不播放。',
  awudio_similar_tracks: '用真实歌曲 ID 查询相似歌曲；关联来源不等于经过音频分析。',
  awudio_library_lookup: '分页查询本账号收藏及明确喜欢的歌曲。返回覆盖率；不能据此声称了解全部收听历史。',
  awudio_check_playability: '检查歌曲 full/preview/blocked/unknown；不返回音频 URL，不播放。',
  awudio_submit_plan: '保存并在网页展示自行选好的真实歌曲和理由。必须先有检索凭据；仅在用户要求推荐或听歌时使用。不会改队列或播放。',
  awudio_apply_plan: '有副作用：按用户要求追加/替换已展示计划，并可请求开始播放。需最新 queueRevision。playback=keep 不自动播放。仅 accepted 不代表已播放，随后查回执。',
  awudio_control_player: '有副作用：控制选中网页播放器，按预期播放会话与队列版本执行。明确播放指令不必重复确认。不能盲重试下一首。',
  awudio_get_operation: '查询保存或播放操作的真实结果。可短等最多 5 秒；只有 playing 回执才能报告开始播放，uncertain 先查实际状态。',
  awudio_record_feedback: '有副作用：记录用户明确表达的本地喜欢、不喜欢或场景反馈，支持精确撤销。不会修改网易云红心；不能从问候或队列删除推断偏好。',
};
export const writes = new Set(['awudio_submit_plan', 'awudio_apply_plan', 'awudio_control_player', 'awudio_record_feedback', ...Object.keys(radioSchemas).filter(k => k !== 'awudio_get_radio')]);
