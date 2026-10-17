import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
  unlink,
  dataStoreEnabled,
  fileVersion,
} from "../data-store.mjs";
import { join } from "node:path";
import { readJson, atomicJson, serial } from "../storage.mjs";
import {
  applyEvent,
  coverage,
  mergeRanges,
  summarizeLearning,
} from "./learning.mjs";

const TYPES = new Set([
  "exposure",
  "play_start",
  "progress",
  "complete",
  "skip",
  "like",
  "unlike",
  "dislike",
  "undo_dislike",
  "not_now",
  "undo_not_now",
  "queue_remove",
  "play_error",
]);
const ACTIONS = new Set([
  "like",
  "unlike",
  "dislike",
  "undo_dislike",
  "not_now",
  "undo_not_now",
  "queue_remove",
  "exposure",
]);
const ID = /^[\w:.-]{1,160}$/;
export function validateEvent(raw, now = Date.now()) {
  if (
    !raw ||
    !ID.test(raw.eventId || "") ||
    !/^\d{1,30}$/.test(String(raw.trackId || "")) ||
    !TYPES.has(raw.type)
  )
    throw new Error("invalid_event");
  const occurred = Date.parse(raw.occurredAt);
  if (
    !Number.isFinite(occurred) ||
    occurred > now + 300000 ||
    occurred < now - 7 * 86400000
  )
    throw new Error("invalid_time");
  const action = ACTIONS.has(raw.type);
  const session = raw.playbackSessionId || null;
  if (
    !action &&
    (!ID.test(session || "") || !Number.isSafeInteger(raw.seq) || raw.seq < 0)
  )
    throw new Error("invalid_session");
  const durationMs = Number(raw.durationMs || 0),
    listenedMs = Number(raw.listenedMs || 0),
    positionMs = Number(raw.positionMs || 0);
  if (
    ![durationMs, listenedMs, positionMs].every(Number.isFinite) ||
    durationMs < 0 ||
    durationMs > 86400000 ||
    listenedMs < 0 ||
    listenedMs > 7 * 86400000 ||
    positionMs < 0 ||
    (durationMs && positionMs > durationMs + 2000)
  )
    throw new Error("invalid_progress");
  const inputRanges = raw.coveredRangesMs || [];
  if (
    !Array.isArray(inputRanges) ||
    inputRanges.length > 64 ||
    inputRanges.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== 2 ||
        !r.every(Number.isFinite) ||
        r[0] < 0 ||
        r[1] <= r[0] ||
        r[1] > durationMs
    )
  )
    throw new Error("invalid_ranges");
  const ranges = mergeRanges(inputRanges, durationMs);
  if (ranges.reduce((n, [a, b]) => n + b - a, 0) > listenedMs + 2000)
    throw new Error("unearned_coverage");
  if (
    ["like", "unlike", "dislike", "undo_dislike"].includes(raw.type) &&
    (!ID.test(raw.clientId || "") ||
      !Number.isSafeInteger(raw.actionSeq) ||
      raw.actionSeq < 0)
  )
    throw new Error("invalid_action_sequence");
  const metadata = raw.track || {};
  return {
    schemaVersion: 1,
    eventId: raw.eventId,
    type: raw.type,
    trackId: String(raw.trackId),
    playbackSessionId: session,
    seq: Number(raw.seq) || 0,
    actionSeq: Number(raw.actionSeq) || 0,
    clientId: String(raw.clientId || "").slice(0, 160),
    loopIndex: Math.max(0, Number(raw.loopIndex) || 0),
    recommendationId: ID.test(raw.recommendationId || "")
      ? raw.recommendationId
      : null,
    durationMs,
    listenedMs,
    positionMs,
    coveredRangesMs: ranges,
    occurredAt: new Date(occurred).toISOString(),
    receivedAt: new Date(now).toISOString(),
    context: {
      scene: String(raw.context?.scene || "unknown").slice(0, 40),
      stageId: String(raw.context?.stageId || "").slice(0, 40),
      source: String(raw.context?.source || "manual").slice(0, 40),
    },
    reason: String(raw.reason || "").slice(0, 80),
    undoOf: ID.test(raw.undoOf || "") ? raw.undoOf : null,
    track: {
      id: String(raw.trackId),
      title: String(metadata.title || "").slice(0, 160),
      artist: String(metadata.artist || "").slice(0, 160),
      artistIds: (Array.isArray(metadata.artistIds) ? metadata.artistIds : [])
        .filter((id) => /^\d+$/.test(String(id)))
        .map(String)
        .slice(0, 20),
      tags: (Array.isArray(metadata.tags) ? metadata.tags : [])
        .map((t) => String(t).slice(0, 40))
        .slice(0, 10),
    },
  };
}
export function createEventStore({ dataDir, now = () => Date.now() }) {
  const loaded = new Map();
  function dir(key) {
    if (!/^[a-f0-9]{24}$/.test(key)) throw new Error("invalid_account");
    return join(dataDir, "accounts", key);
  }
  const versions = new Map();
  async function persist(key, state) {
    const file=join(dir(key), 'feedback.json');
    await atomicJson(file,state);
    if(dataStoreEnabled())versions.set(key,await fileVersion(file));
  }
  async function load(key) {
    if(dataStoreEnabled()){
      const version=await fileVersion(join(dir(key),'feedback.json'));
      if(versions.get(key)!==version)loaded.delete(key);
      versions.set(key,version);
    }
    const maintenanceDay = new Date(now()).toISOString().slice(0, 10);
    if (loaded.has(key) && loaded.get(key).maintenanceDay === maintenanceDay)
      return loaded.get(key);
    loaded.delete(key);
    const root = dir(key),
      logDir = join(root, "listening-events");
    const state = await readJson(join(root, "feedback.json"), {
      schemaVersion: 1,
      ids: {},
      tracks: {},
      sessions: {},
      migrated: false,
    });
    await mkdir(logDir, { recursive: true });
    // In Postgres, log appends and feedback snapshots commit together. There is no
    // partially appended local-file log to recover on every request/instance.
    if(dataStoreEnabled() && state.maintenanceDay===maintenanceDay){loaded.set(key,state);return state;}
    const cutoff = new Date(now() - 90 * 86400000).toISOString().slice(0, 10);
    for (const file of (await readdir(logDir))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()) {
      if (state.compactedBefore && file.slice(0, 10) < state.compactedBefore)
        continue;
      const text = await readFile(join(logDir, file), "utf8");
      const rows = text.split("\n");
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i]) continue;
        let event;
        try {
          event = JSON.parse(rows[i]);
        } catch {
          // Only an interrupted final append is recoverable; corruption in the middle is surfaced.
          if (i !== rows.length - 1)
            throw new Error("反馈日志中间行损坏，需要检查备份");
          await writeFile(join(logDir, `${file}.tail-${now()}`), rows[i], {
            mode: 0o600,
          });
          await writeFile(
            join(logDir, file),
            rows.slice(0, i).join("\n") + "\n",
            { mode: 0o600 }
          );
          continue;
        }
        if (!state.ids[event.eventId]) {
          applyEvent(state, event);
          state.ids[event.eventId] = event.receivedAt;
        }
      }
      if (text && !text.endsWith("\n") && rows.at(-1)?.trim().endsWith("}"))
        await appendFile(join(logDir, file), "\n");
      // Snapshot below preserves persistent blocks and compacted history before rotation.
    }
    const compactAt = new Date(now()).toISOString();
    for (const [id, session] of Object.entries(state.sessions))
      if (now() - Date.parse(session.occurredAt) > 90 * 86400000) {
        const track = state.tracks[session.trackId],
          ratio = coverage(session);
        if (track && ratio >= 0.7) {
          const prior = track.implicitPrior;
          const base = prior
            ? prior.amount *
              2 ** (-(now() - Date.parse(prior.at)) / (30 * 86400000))
            : 0;
          const at = session.lastAudibleAt || session.occurredAt;
          const amount =
            (session.completed && ratio >= 0.9 ? 0.2 : 0.1) *
            2 ** (-(now() - Date.parse(at)) / (30 * 86400000));
          track.implicitPrior = {
            amount: Math.min(0.5, base + amount),
            at: compactAt,
            lastListenedAt:
              !prior?.lastListenedAt || at > prior.lastListenedAt
                ? at
                : prior.lastListenedAt,
          };
        }
        delete state.sessions[id];
      }
    for (const [id, at] of Object.entries(state.ids))
      if (now() - Date.parse(at) > 90 * 86400000) delete state.ids[id];
    for (const track of Object.values(state.tracks)) {
      track.contextNegatives = track.contextNegatives.filter(
        (n) => now() - Date.parse(n.at) < 86400000
      );
      track.exposures = track.exposures.filter(
        (at) => now() - Date.parse(at) < 7 * 86400000
      );
    }
    state.compactedBefore = cutoff;
    state.maintenanceDay = maintenanceDay;
    await persist(key,state);
    for (const file of await readdir(logDir))
      if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) && file.slice(0, 10) < cutoff)
        await unlink(join(logDir, file));
    loaded.set(key, state);
    return state;
  }
  async function ingest(key, events) {
    if (!Array.isArray(events) || events.length > 50)
      throw new Error("最多上传 50 条事件");
    return serial(`events:${dir(key)}`, async () => {
      const store = await load(key),
        accepted = [],
        duplicate = [],
        rejected = [];
      for (const raw of events) {
        try {
          const event = validateEvent(raw, now());
          if (store.ids[event.eventId]) {
            duplicate.push(event.eventId);
            continue;
          }
          const last =
            event.playbackSessionId && store.sessions[event.playbackSessionId];
          if (last && last.trackId !== event.trackId)
            throw new Error("session_track_changed");
          if (last && event.seq > last.seq) {
            const elapsed = Math.max(
              0,
              Date.parse(event.occurredAt) - Date.parse(last.occurredAt)
            );
            if (event.listenedMs > last.listenedMs + elapsed + 5000)
              throw new Error("unearned_listening_time");
          } else if (
            !last &&
            !ACTIONS.has(event.type) &&
            event.listenedMs > 20000
          )
            throw new Error("missing_session_start");
          await appendFile(
            join(
              dir(key),
              "listening-events",
              `${event.receivedAt.slice(0, 10)}.jsonl`
            ),
            JSON.stringify(event) + "\n",
            { mode: 0o600 }
          );
          applyEvent(store, event);
          store.ids[event.eventId] = event.receivedAt;
          accepted.push(event.eventId);
        } catch (error) {
          rejected.push({
            eventId: String(raw?.eventId || ""),
            reason: error.message,
          });
        }
      }
      await persist(key,store);
      return { accepted, duplicate, rejected };
    });
  }
  async function migrate(key, legacy) {
    return serial(`events:${dir(key)}`, async () => {
      const store = await load(key);
      if (store.migrated) return;
      await atomicJson(join(dir(key), "legacy-before-v2.json"), legacy);
      for (const [type, tracks] of [
        [
          "like",
          legacy.tasteProfile?.likedLibrary || legacy.tasteProfile?.liked || [],
        ],
        ["dislike", legacy.tasteProfile?.disliked || []],
      ]) {
        for (const track of tracks)
          if (/^\d+$/.test(String(track.id)))
            applyEvent(store, {
              type,
              trackId: String(track.id),
              track,
              clientId: "migration",
              actionSeq: 0,
              occurredAt: new Date(now()).toISOString(),
              receivedAt: new Date(now()).toISOString(),
              context: { scene: "unknown" },
            });
      }
      store.migrated = true;
      await persist(key,store);
    });
  }
  return {
    clearCache:()=>{loaded.clear();versions.clear();},
    ingest,
    migrate,
    summary: (key) =>
      serial(`events:${dir(key)}`, async () =>
        summarizeLearning(await load(key), now())
      ),
  };
}
