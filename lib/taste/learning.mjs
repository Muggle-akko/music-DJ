export function mergeRanges(ranges, duration = Infinity) {
  const result = [];
  for (const [start, end] of ranges
    .filter(
      (r) =>
        Array.isArray(r) &&
        r.length === 2 &&
        r.every(Number.isFinite) &&
        r[0] >= 0 &&
        r[1] > r[0] &&
        r[1] <= duration
    )
    .sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else if (result.length < 64) result.push([start, end]);
  }
  return result;
}
export function coverage(session) {
  return session.durationMs > 0
    ? Math.min(
        1,
        mergeRanges(session.coveredRangesMs || [], session.durationMs).reduce(
          (n, [a, b]) => n + b - a,
          0
        ) / session.durationMs
      )
    : 0;
}
export function applyEvent(store, event) {
  const id = event.trackId;
  const track = (store.tracks[id] ||= {
    id,
    actions: {},
    exposures: [],
    contextNegatives: [],
    metadata: {},
  });
  if (event.track) track.metadata = { ...track.metadata, ...event.track };
  if (event.type === "exposure")
    track.exposures = [...track.exposures.slice(-30), event.occurredAt];
  if (["like", "unlike", "dislike", "undo_dislike"].includes(event.type)) {
    const group = ["like", "unlike"].includes(event.type) ? "like" : "block";
    const last = track.actions[group];
    const older =
      last?.clientId === event.clientId && last.actionSeq >= event.actionSeq;
    const staleUndo =
      event.type === "undo_dislike" &&
      event.undoOf &&
      last?.eventId !== event.undoOf;
    if (!older && !staleUndo)
      track.actions[group] = {
        type: event.type,
        eventId: event.eventId,
        clientId: event.clientId,
        actionSeq: event.actionSeq,
        at: event.receivedAt,
      };
  }
  if (event.type === "not_now")
    track.contextNegatives.push({
      eventId: event.eventId,
      scene: event.context.scene,
      at: event.occurredAt,
      strength: 0.25,
    });
  if (event.type === "undo_not_now")
    track.contextNegatives = track.contextNegatives.filter((item) =>
      event.undoOf
        ? item.eventId !== event.undoOf
        : item.scene !== event.context.scene || item.strength !== 0.25
    );
  if (
    event.type === "skip" &&
    event.listenedMs < 20000 &&
    coverage(event) < 0.35
  )
    track.contextNegatives.push({
      scene: event.context.scene,
      at: event.occurredAt,
      strength: 0.08,
    });
  track.contextNegatives = track.contextNegatives.slice(-30);
  if (event.playbackSessionId) {
    const last = store.sessions[event.playbackSessionId];
    if (!last || event.seq > last.seq) {
      store.sessions[event.playbackSessionId] = {
        ...event,
        listenedMs: Math.max(last?.listenedMs || 0, event.listenedMs),
        coveredRangesMs: mergeRanges(
          [...(last?.coveredRangesMs || []), ...event.coveredRangesMs],
          event.durationMs
        ),
        lastAudibleAt:
          event.listenedMs > (last?.listenedMs || 0)
            ? event.occurredAt
            : last?.lastAudibleAt || null,
        completed: Boolean(last?.completed || event.type === "complete"),
      };
    }
  }
}
export function summarizeLearning(store, now = Date.now()) {
  const tracks = structuredClone(store.tracks || {});
  const artistTracks = new Map();
  const tagTracks = new Map();
  for (const track of Object.values(tracks)) {
    track.liked = track.actions.like?.type === "like";
    track.blocked = track.actions.block?.type === "dislike";
    track.implicit = track.implicitPrior
      ? track.implicitPrior.amount *
        2 **
          (-Math.max(0, now - Date.parse(track.implicitPrior.at)) /
            (30 * 86400000))
      : 0;
    track.lastListenedAt = track.implicitPrior?.lastListenedAt || null;
  }
  for (const session of Object.values(store.sessions || {})) {
    const track = tracks[session.trackId];
    if (!track) continue;
    const ratio = coverage(session);
    if (ratio < 0.7) continue;
    const at = Date.parse(session.lastAudibleAt || session.occurredAt);
    const strength =
      (session.completed && ratio >= 0.9 ? 0.2 : 0.1) *
      2 ** (-Math.max(0, now - at) / (30 * 86400000));
    track.implicit = Math.min(0.5, track.implicit + strength);
    if (!track.lastListenedAt || at > Date.parse(track.lastListenedAt))
      track.lastListenedAt = new Date(at).toISOString();
  }
  for (const track of Object.values(tracks))
    if (track.liked || track.implicit > 0.05) {
      for (const artist of track.metadata?.artistIds || []) {
        if (!artistTracks.has(artist)) artistTracks.set(artist, new Set());
        artistTracks.get(artist).add(track.id);
      }
      for (const tag of track.metadata?.tags || []) {
        if (!tagTracks.has(tag)) tagTracks.set(tag, new Set());
        tagTracks.get(tag).add(track.id);
      }
    }
  return {
    schemaVersion: 1,
    tracks,
    preferredArtistIds: [...artistTracks]
      .filter(([, ids]) => ids.size >= 3)
      .map(([id]) => id),
    preferredTags: [...tagTracks]
      .filter(([, ids]) => ids.size >= 3)
      .map(([tag]) => tag),
  };
}
