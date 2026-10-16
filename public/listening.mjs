export function mergeCoveredRanges(input) {
  const result = [];
  for (const [a, b] of input
    .filter((r) => r[1] > r[0])
    .sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else if (result.length < 64) result.push([a, b]);
  }
  return result;
}
export class ListeningTracker {
  constructor({
    clock = () => performance.now(),
    date = () => Date.now(),
    uuid = () => crypto.randomUUID(),
    emit = () => {},
  } = {}) {
    this.clock = clock;
    this.date = date;
    this.uuid = uuid;
    this.emit = emit;
    this.session = null;
    this.anchor = null;
  }
  load(track, context = {}) {
    this.session = track
      ? {
          id: this.uuid(),
          track: { ...track },
          context: { ...context },
          seq: 0,
          loopIndex: 0,
          listenedMs: 0,
          ranges: [],
          started: false,
          completed: false,
        }
      : null;
    this.anchor = null;
  }
  playing(position, duration) {
    if (!this.session) return;
    this.session.durationMs = duration;
    if (!this.session.started) {
      this.session.started = true;
      this.event("play_start", position);
    }
    this.anchor = { position, clock: this.clock() };
  }
  sample(position, duration) {
    const s = this.session;
    if (!s?.started) return;
    s.durationMs = duration || s.durationMs;
    if (this.anchor) {
      const elapsed = Math.max(0, this.clock() - this.anchor.clock),
        delta = position - this.anchor.position;
      if (delta >= 0 && delta <= elapsed + 1500 && delta > 0) {
        const heard = Math.min(delta, elapsed);
        s.listenedMs += heard;
        s.ranges = mergeCoveredRanges([
          ...s.ranges,
          [Math.max(this.anchor.position, position - heard), position],
        ]);
      } else if (position < 1000 && this.anchor.position > 2000) {
        s.loopIndex++;
      }
      this.anchor = { position, clock: this.clock() };
    }
  }
  suspend(position, duration) {
    this.sample(position, duration);
    this.anchor = null;
  }
  seek() {
    this.anchor = null;
  }
  event(type, position = 0) {
    const s = this.session;
    if (!s) return null;
    const event = {
      schemaVersion: 1,
      eventId: this.uuid(),
      playbackSessionId: s.started ? s.id : null,
      seq: ++s.seq,
      loopIndex: s.loopIndex,
      recommendationId: s.track.recommendationId || null,
      trackId: s.track.id,
      type,
      positionMs: Math.round(position),
      durationMs: Math.round(s.durationMs || s.track.duration || 0),
      listenedMs: Math.round(s.listenedMs),
      coveredRangesMs: s.ranges.map((r) => r.map(Math.round)),
      occurredAt: new Date(this.date()).toISOString(),
      context: s.context,
      track: s.track,
    };
    this.emit(event);
    return event;
  }
  finish(type, position, duration) {
    if (!this.session?.started) return;
    this.suspend(position, duration);
    this.event(type, position);
    if (type === "complete") this.session.completed = true;
  }
}

export function createListeningController({
  audio,
  getTrack,
  post,
  accountId,
  clientId,
  storage = localStorage,
}) {
  const key = `awudio.events.v2.${accountId}`,
    actionKey = `awudio.actions.v2.${accountId}`;
  let pending = [];
  try {
    pending = JSON.parse(storage.getItem(key) || "[]");
  } catch {
    /* A broken local retry cache must not block playback. */
  }
  let actionSeq = Number(storage.getItem(actionKey) || 0),
    flushing = false;
  const save = () => {
    try {
      storage.setItem(key, JSON.stringify(pending.slice(-1000)));
    } catch {}
  };
  const enqueue = (event) => {
    if (!/^\d+$/.test(String(event.trackId))) return;
    pending.push(event);
    save();
  };
  const tracker = new ListeningTracker({ emit: enqueue });
  const position = () =>
    Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;
  const duration = () =>
    Number.isFinite(audio.duration)
      ? audio.duration * 1000
      : Number(getTrack()?.duration) || 0;
  const context = (track) => ({
    stageId: track?.stageId || "",
    scene:
      track?.playlistStage?.mood || track?.recommendationScene || "unknown",
    source: track?.origin === 'external_agent' ? 'external_agent' : track?.recommendationId ? "radio" : "manual",
  });
  async function flush() {
    if (flushing || !pending.length) return;
    flushing = true;
    let madeProgress = false;
    try {
      const result = await post("/api/listening/events", {
        events: pending.slice(0, 50),
      });
      const acknowledged = new Set([
        ...(result.accepted || []),
        ...(result.duplicate || []),
        ...(result.rejected || []).map((r) => r.eventId),
      ]);
      pending = pending.filter((e) => !acknowledged.has(e.eventId));
      madeProgress = acknowledged.size > 0;
      save();
    } catch {
      /* Retry with stable eventIds; playback never waits for telemetry. */
    } finally {
      flushing = false;
      if (madeProgress && pending.length) queueMicrotask(flush);
    }
  }
  function action(type, track, extra = {}) {
    if (!track) return;
    actionSeq++;
    storage.setItem(actionKey, String(actionSeq));
    const eventId = crypto.randomUUID();
    enqueue({
      schemaVersion: 1,
      eventId,
      clientId,
      actionSeq,
      type,
      trackId: track.id,
      track,
      undoOf: extra.undoOf || null,
      playbackSessionId: null,
      seq: 0,
      recommendationId: track.recommendationId || null,
      positionMs: 0,
      listenedMs: 0,
      durationMs: Number(track.duration) || 0,
      coveredRangesMs: [],
      occurredAt: new Date().toISOString(),
      context: context(track),
    });
    void flush();
    return eventId;
  }
  audio.addEventListener("playing", () => {
    if (!tracker.session || tracker.session.track.id !== getTrack()?.id)
      tracker.load(getTrack(), context(getTrack()));
    tracker.playing(position(), duration());
    if (audio.muted || audio.volume === 0)
      tracker.suspend(position(), duration());
    void flush();
  });
  audio.addEventListener("timeupdate", () => {
    if (audio.muted || audio.volume === 0)
      tracker.suspend(position(), duration());
    else tracker.sample(position(), duration());
  });
  audio.addEventListener("volumechange", () => {
    if (audio.muted || audio.volume === 0)
      tracker.suspend(position(), duration());
    else if (!audio.paused) tracker.playing(position(), duration());
  });
  for (const type of ["pause", "waiting", "stalled"])
    audio.addEventListener(type, () => {
      tracker.suspend(position(), duration());
      if (tracker.session?.started) tracker.event("progress", position());
      void flush();
    });
  audio.addEventListener("emptied", () => {
    if (tracker.session?.started) tracker.event("progress", position());
    tracker.load(null);
  });
  audio.addEventListener("seeking", () => tracker.seek());
  audio.addEventListener("seeked", () => {
    if (!audio.paused) tracker.playing(position(), duration());
  });
  audio.addEventListener("error", () => {
    tracker.finish("play_error", position(), duration());
    void flush();
  });
  const timer = setInterval(() => {
    if (
      tracker.session?.started &&
      tracker.anchor &&
      !audio.paused &&
      !audio.ended
    ) {
      tracker.sample(position(), duration());
      tracker.event("progress", position());
    }
    void flush();
  }, 15000);
  window.addEventListener("pagehide", () => {
    tracker.suspend(position(), duration());
    if (tracker.session?.started) tracker.event("progress", position());
    save();
    void flush();
  });
  return {
    get playbackSessionId() { return tracker.session?.id || null; },
    hasPendingLike(trackId) { return pending.some(e => e.trackId === trackId && ['like', 'unlike'].includes(e.type)); },
    action,
    flush,
    load(track) {
      tracker.suspend(position(), duration());
      if (tracker.session?.started) tracker.event("progress", position());
      tracker.load(track, context(track));
      void flush();
    },
    skip() {
      if (!tracker.session?.started) return;
      tracker.sample(position(), duration());
      const s = tracker.session;
      const covered = s.ranges.reduce((n, [a, b]) => n + b - a, 0);
      tracker.event(
        s.listenedMs < 20000 && covered / (s.durationMs || Infinity) < 0.35
          ? "skip"
          : "progress",
        position()
      );
      void flush();
    },
    complete() {
      tracker.finish("complete", position(), duration());
      void flush();
    },
    dispose() {
      clearInterval(timer);
    },
  };
}
