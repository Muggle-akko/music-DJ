import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recommend,
  validateSelection,
} from "../lib/recommendation/orchestrator.mjs";
import {
  createPlayability,
  classifyUrl,
} from "../lib/recommendation/playability.mjs";
import { localIntent } from "../lib/recommendation/intent.mjs";
import {
  candidate,
  mergeCandidates,
  rejectReason,
  sameRecording,
} from "../lib/recommendation/candidates.mjs";
import { createEventStore, validateEvent } from "../lib/taste/events.mjs";
import {
  coverage,
  applyEvent,
  summarizeLearning,
} from "../lib/taste/learning.mjs";
import { ListeningTracker } from "../public/listening.mjs";
import {
  createProfileSync,
  extractWikiFeatures,
} from "../lib/taste/profile-sync.mjs";
import { createNcmClient, accountKey } from "../lib/ncm.mjs";
import { Budget } from "../lib/recommendation/budget.mjs";
import { createTools } from "../lib/recommendation/tools.mjs";
import { createTraceStore } from "../lib/recommendation/trace.mjs";
import {
  cases,
  fixtureProfile,
  fixtureNcm,
  rawSong,
} from "./fixtures/recommendation-cases.mjs";
const key = accountKey("test-user");
const run = (message, options = {}, overrides = {}) =>
  recommend({
    message,
    options,
    profile: structuredClone(fixtureProfile),
    accountKey: key,
    ncm: fixtureNcm,
    learning: { tracks: {} },
    playability: createPlayability({ ncm: fixtureNcm }),
    ...overrides,
  });
for (const [message, options, queueAction] of cases)
  test(`corpus: ${message}`, async () => {
    const r = await run(message, options);
    assert.equal(r.plan.queueAction, queueAction);
    assert.equal(new Set(r.tracks.map((t) => t.id)).size, r.tracks.length);
    assert.ok(
      r.tracks.every(
        (t) =>
          /^\d+$/.test(t.id) &&
          t.playability.state === "full" &&
          t.url.startsWith("/api/music/stream?")
      )
    );
    const context = {
      now: Date.now(),
      learning: { tracks: {} },
      requestedIds: new Set(),
      currentIds: new Set(),
      sessionIds: new Set(),
    };
    assert.ok(
      r.tracks.every(
        (t) => !rejectReason(t, r.plan, context, { relaxRepeat: true })
      )
    );
    assert.ok(
      r.trace.counts.retrieval <= 12 &&
        r.trace.counts.playability <= 8 &&
        r.trace.counts.model <= 4
    );
    assert.ok(!JSON.stringify(r.trace).includes("signed-should-never"));
    if (queueAction === "none") assert.equal(r.tracks.length, 0);
    if (r.plan.mode === "familiar")
      assert.ok(r.tracks.every((t) => t.familiarity === "familiar"));
    if (/只听英语|只听日语|只听粤语/.test(message))
      assert.equal(
        r.tracks.length,
        0,
        "unknown language must not satisfy hard constraints"
      );
  });

test("URL status distinguishes preview, full, blocked and insufficient evidence", () => {
  assert.equal(
    classifyUrl({ url: "x", freeTrialInfo: { start: 0, end: 30 } }).state,
    "preview"
  );
  assert.equal(
    classifyUrl({ url: "x", freeTrialInfo: null, code: 200 }).state,
    "full"
  );
  assert.equal(classifyUrl({ url: "x" }).state, "unknown");
  assert.equal(classifyUrl({ code: 404 }).state, "blocked");
  assert.equal(classifyUrl({ url: "x", time: 30000 }, 240000).state, "preview");
});
test("ID-keyed batch qualification handles reordered and missing results", async () => {
  const service = createPlayability({
    ncm: async () => ({ data: [{ id: 2, url: "x", freeTrialInfo: null }] }),
  });
  const r = await service.check([{ id: "1" }, { id: "2" }], key, new Budget());
  assert.equal(r.get("1").state, "unknown");
  assert.equal(r.get("2").state, "full");
});
test("qualification cache is isolated by account and transient failure is not blocked", async () => {
  let calls = 0;
  const service = createPlayability({
    ncm: async () => {
      calls++;
      return { data: [{ id: 1, url: "x", freeTrialInfo: null }] };
    },
  });
  await service.check([{ id: "1" }], key, new Budget());
  await service.check([{ id: "1" }], key, new Budget());
  assert.equal(calls, 1);
  await service.check([{ id: "1" }], accountKey("other"), new Budget());
  assert.equal(calls, 2);
  const fail = createPlayability({
    ncm: async () => {
      throw { status: "timeout" };
    },
  });
  assert.equal(
    (await fail.check([{ id: "1" }], key, new Budget())).get("1").state,
    "unknown"
  );
});
test("unknown and duplicate model IDs cannot enter selection", () => {
  const plan = localIntent("推荐三首");
  const c = [{ id: "1", evidence: [{ id: "e1" }] }];
  assert.deepEqual(
    validateSelection(
      {
        selected: [
          { trackId: "999", reasonEvidenceIds: [] },
          { trackId: "1", reasonEvidenceIds: ["invented"] },
          { trackId: "1", reasonEvidenceIds: ["e1"] },
          { trackId: "1", reasonEvidenceIds: ["e1"] },
        ],
      },
      c,
      plan
    ).map((s) => s.trackId),
    ["1"]
  );
});
test("model output chooses real IDs, invalid selection falls back without invented songs", async () => {
  let calls = 0;
  const model = async () =>
    ++calls === 1
      ? {
          actions: [
            { tool: "network.fetch", args: { url: "https://evil.invalid" } },
          ],
        }
      : { selected: [{ trackId: "999999999999", reasonEvidenceIds: [] }] };
  const r = await run("来一期", {}, { model });
  assert.ok(r.tracks.length);
  assert.ok(!r.tracks.some((t) => t.id === "999999999999"));
  assert.ok(r.trace.sources.some((s) => s.reason === "tool_not_allowed"));
});
test("invalid JSON repair is globally bounded, then deterministic fallback", async () => {
  let calls = 0;
  const r = await run(
    "来一期",
    {},
    {
      model: async () => {
        calls++;
        throw Object.assign(new Error("json"), { repairable: true });
      },
    }
  );
  assert.ok(calls <= 4);
  assert.ok(r.tracks.length);
  assert.ok(r.warnings.length);
});
test("same title by distinct artists is not the same recording", () => {
  const a = candidate(rawSong(1), { source: "search" }),
    b = candidate({ ...rawSong(2), name: a.title }, { source: "search" });
  assert.equal(sameRecording(a, b), false);
  const live = {
    ...a,
    id: "999",
    title: a.title + " (Live)",
    version: { kind: "live" },
  };
  assert.equal(sameRecording(a, live), true);
});
test("multiple sources merge into a single candidate and keep provenance", () => {
  const pool = new Map();
  mergeCandidates(pool, [rawSong(1)], { source: "daily" }, {});
  mergeCandidates(pool, [rawSong(1)], { source: "similar", seedId: "2" }, {});
  assert.equal(pool.size, 1);
  assert.equal(pool.get("1").provenance.length, 2);
});
test("explicit dislike cannot be relaxed, current queue is excluded on append", async () => {
  const blocked = Object.fromEntries(
    fixtureProfile.allLikedSongs.map((t) => [t.id, { blocked: true }])
  );
  const r = await run("今天只想听熟歌", {}, { learning: { tracks: blocked } });
  assert.equal(r.tracks.length, 0);
  const append = await run(
    "接着来几首",
    {},
    { state: { queue: [{ id: "2" }, { id: "4" }], now: { id: "6" } } }
  );
  assert.ok(append.tracks.every((t) => !["2", "4", "6"].includes(t.id)));
});
test("forged seed and unknown artist/playlist cannot invoke upstream", async () => {
  let calls = 0;
  const tools = createTools({
    ncm: async () => {
      calls++;
    },
    pool: new Map(),
    context: {},
    profile: null,
    learning: { tracks: {} },
    budget: new Budget(),
  });
  for (const action of [
    { tool: "catalog.similarSongs", args: { seedId: "99" } },
    { tool: "catalog.artistSongs", args: { artistId: "99" } },
    { tool: "catalog.playlistTracks", args: { playlistId: "99" } },
  ])
    assert.equal((await tools.execute(action)).status, "error");
  assert.equal(calls, 0);
});
test("zero qualified tracks never become a successful selection", async () => {
  const r = await run(
    "来一期",
    {},
    {
      playability: {
        check: async (tracks) =>
          new Map(tracks.map((t) => [t.id, { state: "preview" }])),
      },
    }
  );
  assert.equal(r.tracks.length, 0);
});
test("a source error is distinguishable from an empty source", async () => {
  const r = await run(
    "发现点新的",
    {},
    {
      ncm: async (path, args) => {
        if (path === "/recommend/songs")
          throw Object.assign(new Error("expired"), { status: "unauthorized" });
        return fixtureNcm(path, args);
      },
    }
  );
  assert.ok(r.trace.sources.some((s) => s.status === "unauthorized"));
  assert.ok(r.tracks.length);
});
test("cancelled request cannot complete or write a trace", async () => {
  const controller = new AbortController();
  controller.abort();
  let writes = 0;
  await assert.rejects(
    run(
      "来一期",
      {},
      { signal: controller.signal, traceStore: { write: async () => writes++ } }
    )
  );
  assert.equal(writes, 0);
});
test("hard rules are immutable when planner suggests another mode or count", async () => {
  const model = async (_s, p) =>
    p.candidates
      ? { selected: [] }
      : {
          requestedCount: 30,
          hardConstraints: [],
          mode: "balanced",
          actions: [],
        };
  const r = await run("只听纯音乐，不要Live，推荐三首", {}, { model });
  assert.equal(r.plan.requestedCount, 3);
  assert.ok(
    r.tracks.every(
      (t) =>
        t.features.vocal.value === "instrumental" && t.version.kind !== "live"
    )
  );
});
test("wiki tags belong only to the individual track; no global playlist inference", () => {
  assert.deepEqual(extractWikiFeatures({ data: { blocks: [] } }).genre, []);
  assert.equal(
    candidate({ ...rawSong(1), styleTags: ["jazz"] }, { source: "search" })
      .features.genre.length,
    0
  );
});

const fixedNow = Date.parse("2026-10-16T00:00:00Z");
function event(type, extra = {}) {
  return {
    eventId: `id-${type}-${extra.seq || 0}`,
    trackId: "1",
    type,
    clientId: "client",
    actionSeq: 1,
    playbackSessionId: null,
    seq: 0,
    durationMs: 100000,
    listenedMs: 0,
    positionMs: 0,
    coveredRangesMs: [],
    occurredAt: new Date(fixedNow).toISOString(),
    context: { scene: "focus" },
    track: { title: "Song", artist: "Artist", artistIds: ["1"] },
    ...extra,
  };
}
test("queue removal and unlike never become negative feedback", () => {
  const store = { tracks: {}, sessions: {} };
  for (const type of ["like", "queue_remove", "unlike"])
    applyEvent(
      store,
      validateEvent(
        event(type, { actionSeq: type === "unlike" ? 2 : 1 }),
        fixedNow
      )
    );
  const t = summarizeLearning(store, fixedNow).tracks["1"];
  assert.equal(t.liked, false);
  assert.equal(t.blocked, false);
  assert.equal(t.contextNegatives.length, 0);
});
test("not_now can be undone without changing a permanent like", () => {
  const store = { tracks: {}, sessions: {} };
  for (const type of ["like", "not_now", "undo_not_now"])
    applyEvent(store, validateEvent(event(type), fixedNow));
  const t = summarizeLearning(store, fixedNow).tracks["1"];
  assert.equal(t.liked, true);
  assert.equal(t.contextNegatives.length, 0);
});
test("duplicate event retries survive restart without changing preferences", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-events-"));
  let store = createEventStore({ dataDir: dir, now: () => fixedNow });
  const e = event("like");
  assert.equal((await store.ingest(key, [e])).accepted.length, 1);
  assert.equal((await store.ingest(key, [e])).duplicate.length, 1);
  store = createEventStore({ dataDir: dir, now: () => fixedNow });
  assert.equal((await store.ingest(key, [e])).duplicate.length, 1);
  assert.equal((await store.summary(key)).tracks["1"].liked, true);
});
test("late explicit action cannot revert newer unlike from the same client", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-actions-"));
  const store = createEventStore({ dataDir: dir, now: () => fixedNow });
  await store.ingest(key, [
    event("unlike", { actionSeq: 2 }),
    event("like", { actionSeq: 1 }),
  ]);
  assert.equal((await store.summary(key)).tracks["1"].liked, false);
});
test("seeking to the end does not earn completion", () => {
  const store = { tracks: {}, sessions: {} };
  applyEvent(
    store,
    validateEvent(
      event("complete", {
        playbackSessionId: "s",
        seq: 2,
        listenedMs: 1000,
        coveredRangesMs: [[0, 1000]],
        positionMs: 100000,
      }),
      fixedNow
    )
  );
  assert.equal(summarizeLearning(store, fixedNow).tracks["1"].implicit, 0);
});
test("coverage is unique across overlapping and repeated loops", () => {
  assert.equal(
    coverage({
      durationMs: 100000,
      coveredRangesMs: [
        [0, 50000],
        [10000, 40000],
        [0, 50000],
      ],
      listenedMs: 150000,
    }),
    0.5
  );
});
test("progress and completion replace session credit rather than stacking", () => {
  const store = { tracks: {}, sessions: {} };
  for (const e of [
    event("progress", {
      playbackSessionId: "s",
      seq: 1,
      listenedMs: 70000,
      coveredRangesMs: [[0, 70000]],
    }),
    event("complete", {
      playbackSessionId: "s",
      seq: 2,
      listenedMs: 100000,
      coveredRangesMs: [[0, 100000]],
    }),
  ])
    applyEvent(store, validateEvent(e, fixedNow));
  assert.equal(summarizeLearning(store, fixedNow).tracks["1"].implicit, 0.2);
});
test("out-of-order progress cannot roll back a session", () => {
  const store = { tracks: {}, sessions: {} };
  for (const seq of [3, 2, 1])
    applyEvent(
      store,
      validateEvent(
        event("progress", {
          playbackSessionId: "s",
          seq,
          listenedMs: seq * 20000,
          coveredRangesMs: [[0, seq * 20000]],
        }),
        fixedNow
      )
    );
  assert.equal(store.sessions.s.listenedMs, 60000);
});
test("invalid ranges and excessive coverage are rejected", () => {
  assert.throws(() =>
    validateEvent(
      event("progress", {
        playbackSessionId: "s",
        coveredRangesMs: [[0, 20000]],
        listenedMs: 1000,
      }),
      fixedNow
    )
  );
  assert.throws(() =>
    validateEvent(event("like", { coveredRangesMs: [[-1, 2]] }), fixedNow)
  );
});
test("one artist requires positive evidence on three different tracks", () => {
  const store = { tracks: {}, sessions: {} };
  for (let i = 1; i <= 2; i++)
    applyEvent(
      store,
      validateEvent(event("like", { trackId: String(i) }), fixedNow)
    );
  assert.equal(summarizeLearning(store, fixedNow).preferredArtistIds.length, 0);
  applyEvent(store, validateEvent(event("like", { trackId: "3" }), fixedNow));
  assert.deepEqual(summarizeLearning(store, fixedNow).preferredArtistIds, [
    "1",
  ]);
});
test("tracker counts time played, excludes seek gaps and pause wall time", () => {
  let clock = 0,
    seq = 0;
  const events = [];
  const t = new ListeningTracker({
    clock: () => clock,
    date: () => fixedNow + clock,
    uuid: () => `id-${++seq}`,
    emit: (e) => events.push(e),
  });
  t.load({ id: "1", duration: 100000 });
  t.playing(0, 100000);
  clock = 10000;
  t.sample(10000, 100000);
  t.suspend(10000, 100000);
  clock = 30000;
  t.playing(10000, 100000);
  clock = 40000;
  t.sample(20000, 100000);
  t.seek();
  t.playing(90000, 100000);
  clock = 45000;
  t.finish("complete", 95000, 100000);
  assert.equal(t.session.listenedMs, 25000);
  assert.deepEqual(t.session.ranges, [
    [0, 20000],
    [90000, 95000],
  ]);
  assert.equal(events.filter((e) => e.type === "play_start").length, 1);
});
test("event storage rejects a sudden impossible listening increase", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-jump-"));
  const store = createEventStore({ dataDir: dir, now: () => fixedNow });
  await store.ingest(key, [
    event("play_start", { playbackSessionId: "s", seq: 1 }),
  ]);
  const r = await store.ingest(key, [
    event("progress", {
      playbackSessionId: "s",
      seq: 2,
      listenedMs: 80000,
      coveredRangesMs: [[0, 80000]],
    }),
  ]);
  assert.equal(r.rejected.length, 1);
});
test("legacy migration preserves explicit feedback but ignores remove/skip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-migration-"));
  const store = createEventStore({ dataDir: dir, now: () => fixedNow });
  await store.migrate(key, {
    tasteProfile: {
      likedLibrary: [{ id: "1" }],
      disliked: [{ id: "2" }],
      negativeFeedback: [{ action: "remove", track: { id: "3" } }],
    },
  });
  await store.migrate(key, { tasteProfile: { likedLibrary: [] } });
  const s = await store.summary(key);
  assert.equal(s.tracks["1"].liked, true);
  assert.equal(s.tracks["2"].blocked, true);
  assert.equal(s.tracks["3"], undefined);
});
test("an interrupted final log append is quarantined and recovered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-tail-"));
  let store = createEventStore({ dataDir: dir, now: () => fixedNow });
  await store.ingest(key, [event("like")]);
  const file = join(
    dir,
    "accounts",
    key,
    "listening-events",
    "2026-10-16.jsonl"
  );
  await writeFile(file, (await readFile(file, "utf8")) + '{"broken":');
  store = createEventStore({ dataDir: dir, now: () => fixedNow });
  assert.equal((await store.summary(key)).tracks["1"].liked, true);
});
test("profile synchronization preserves last snapshot after partial and failed pages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-profile-"));
  let fail = false;
  const ncm = async (path, args) => {
    if (path === "/login/status") return { data: { profile: { userId: 1 } } };
    if (path === "/user/playlist")
      return {
        playlist: [{ id: 10, userId: 1, specialType: 5, trackCount: 501 }],
        more: false,
      };
    if (path === "/playlist/detail")
      return { playlist: { trackCount: 501, trackIds: [] } };
    if (path === "/playlist/track/all") {
      if (fail && args.offset === 500) throw new Error("network");
      return {
        songs: Array.from({ length: args.offset === 0 ? 500 : 1 }, (_, i) =>
          rawSong(args.offset + i + 1)
        ),
      };
    }
    if (path === "/user/record") throw new Error("no permission");
  };
  const sync = createProfileSync({ dataDir: dir, ncm });
  sync.start();
  await sync.wait();
  let p = await sync.read(accountKey("1"));
  assert.equal(p.complete, true);
  assert.equal(p.allLikedSongs.length, 501);
  assert.equal(p.allLikedSongs[0].allTimePlayCount, null);
  fail = true;
  sync.start();
  await sync.wait();
  p = await sync.read(accountKey("1"));
  assert.equal(p.complete, false);
  assert.equal(p.allLikedSongs.length, 501);
  assert.equal(p.dataCoverage.fetchedLikedTrackCount, 500);
  const failed = createProfileSync({
    dataDir: dir,
    ncm: async () => {
      throw new Error("offline");
    },
  });
  failed.start();
  await failed.wait();
  assert.equal(failed.status().state, "error");
  assert.equal((await sync.read(accountKey("1"))).allLikedSongs.length, 501);
});
test("HTTP 200 with an upstream business failure is not success", async () => {
  const ncm = createNcmClient({
    baseUrl: "http://fixture.invalid",
    fetchImpl: async () =>
      new Response(JSON.stringify({ code: 301 }), { status: 200 }),
  });
  await assert.rejects(
    ncm("/recommend/songs"),
    (e) => e.status === "unauthorized"
  );
});
test("trace explanations retain evidence but never signed playback URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-trace-")),
    store = createTraceStore(dir);
  const r = await run("推荐三首", {}, { traceStore: store });
  const trace = await store.read(key, r.recommendationId);
  assert.equal(trace.final.length, r.tracks.length);
  assert.ok(!JSON.stringify(trace).includes("audio.invalid"));
});

test("artist punctuation cannot conflate a real artist with a similarly named account", async () => {
  const tools = createTools({
    ncm: async () => ({
      result: {
        artists: [
          { id: 1, name: "Alpha" },
          { id: 2, name: "Alpha." },
          { id: 3, name: "Alpha♚" },
        ],
      },
    }),
    profile: null,
    learning: { tracks: {} },
    pool: new Map(),
    context: { knownArtists: new Set() },
    budget: new Budget(),
  });
  assert.equal((await tools.resolveArtist("Alpha")).artistId, "1");
});
test("instrumental subtype and explicit wiki language are evidence; titles are not", () => {
  const wiki = extractWikiFeatures({
    data: {
      blocks: [
        {
          creatives: [
            {
              uiElement: { mainTitle: { title: "曲风" } },
              resources: [
                { uiElement: { mainTitle: { title: "轻音乐-器乐独奏" } } },
              ],
            },
            {
              uiElement: { mainTitle: { title: "语种" } },
              resources: [{ uiElement: { mainTitle: { title: "粤语" } } }],
            },
          ],
        },
      ],
    },
  });
  assert.equal(wiki.vocal.value, "instrumental");
  assert.equal(wiki.language.value, "粤语");
  assert.equal(
    candidate({ ...rawSong(1), name: "纯音乐" }, { source: "search" }).features
      .vocal.value,
    "unknown"
  );
});
test("explicit songs survive soft diversity restrictions", async () => {
  const r = await run("来一组两首，包含《Song 2》和《Song 9》");
  assert.deepEqual(new Set(r.tracks.map((t) => t.id)), new Set(["2", "9"]));
});
test("staged requests use ratios for actual song count rather than the 30-song ceiling", async () => {
  const r = await run("写代码10分钟，然后放松10分钟");
  assert.ok(r.tracks.some((t) => t.familiarity !== "familiar"));
  assert.ok(r.tracks.length < 15);
  assert.equal(r.selectionSummary.stages.length, 2);
});
test("features cache is account-bound and song-local", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-features-"));
  const service = createProfileSync({
    dataDir: dir,
    ncm: fixtureNcm,
    now: () => fixedNow,
  });
  const features = extractWikiFeatures({ data: { blocks: [] } });
  await service.saveFeatures(key, [{ id: "1", features }]);
  assert.equal(
    (await service.readFeatures(key))["1"].features.vocal.value,
    "unknown"
  );
  assert.deepEqual(await service.readFeatures(accountKey("other")), {});
});
test("paused progress does not make an old listen recent again", () => {
  const store = { tracks: {}, sessions: {} };
  applyEvent(
    store,
    validateEvent(
      event("progress", {
        playbackSessionId: "s",
        seq: 1,
        listenedMs: 70000,
        coveredRangesMs: [[0, 70000]],
      }),
      fixedNow
    )
  );
  const first = summarizeLearning(store, fixedNow).tracks["1"].lastListenedAt;
  const later = fixedNow + 3600000;
  applyEvent(
    store,
    validateEvent(
      event("progress", {
        playbackSessionId: "s",
        seq: 2,
        listenedMs: 70000,
        coveredRangesMs: [[0, 70000]],
        occurredAt: new Date(later).toISOString(),
      }),
      later
    )
  );
  assert.equal(
    summarizeLearning(store, later).tracks["1"].lastListenedAt,
    first
  );
});
test("undo not-now targets its event without erasing earlier feedback", () => {
  const store = { tracks: {}, sessions: {} };
  applyEvent(
    store,
    validateEvent(event("not_now", { eventId: "first" }), fixedNow)
  );
  applyEvent(
    store,
    validateEvent(event("not_now", { eventId: "second" }), fixedNow)
  );
  applyEvent(
    store,
    validateEvent(event("undo_not_now", { undoOf: "second" }), fixedNow)
  );
  assert.deepEqual(
    store.tracks["1"].contextNegatives.map((n) => n.eventId),
    ["first"]
  );
});
test("old raw events compact without losing persistent dislike or implicit decay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awudio-compaction-"));
  let time = fixedNow;
  let service = createEventStore({ dataDir: dir, now: () => time });
  await service.ingest(key, [
    event("dislike", { trackId: "2" }),
    event("play_start", { playbackSessionId: "s", seq: 1 }),
  ]);
  time += 70000;
  await service.ingest(key, [
    event("progress", {
      playbackSessionId: "s",
      seq: 2,
      listenedMs: 70000,
      coveredRangesMs: [[0, 70000]],
      occurredAt: new Date(time).toISOString(),
    }),
  ]);
  time += 91 * 86400000;
  service = createEventStore({ dataDir: dir, now: () => time });
  const one = await service.summary(key);
  assert.equal(one.tracks["2"].blocked, true);
  assert.ok(one.tracks["1"].implicit > 0);
  service = createEventStore({ dataDir: dir, now: () => time });
  const two = await service.summary(key);
  assert.equal(one.tracks["1"].implicit, two.tracks["1"].implicit);
});

test("application likes outside a full library remain in the lookup candidate pool", async () => {
  const pool = new Map();
  const learning = {
    tracks: {
      999999: {
        liked: true,
        metadata: {
          title: "App favorite",
          artist: "New Artist",
          artistIds: ["99"],
        },
      },
    },
  };
  const tools = createTools({
    ncm: fixtureNcm,
    profile: fixtureProfile,
    learning,
    pool,
    context: {
      now: fixedNow,
      learning,
      likedIds: new Set(),
      knownArtists: new Set(),
      profileComplete: true,
    },
    budget: new Budget(),
  });
  await tools.execute({ tool: "profile.lookup", args: { limit: 5 } });
  assert.ok(pool.has("999999"));
  assert.equal(pool.size, 5);
  const invalid = await tools.execute({
    tool: "catalog.searchSongs",
    args: { query: "music", limit: -1 },
  });
  assert.equal(invalid.status, "error");
});
test("English genre preferences match verified Chinese taxonomy", async () => {
  const { rankCandidate } = await import("../lib/recommendation/ranking.mjs");
  const plan = localIntent("推荐爵士"),
    ctx = {
      now: fixedNow,
      learning: { tracks: {} },
      likedIds: new Set(),
      requestedIds: new Set(),
    };
  const jazz = candidate(
    { ...rawSong(1), features: undefined },
    { source: "search" },
    ctx
  );
  jazz.features.genre = [{ value: "爵士-酷爵士", confidence: 0.8 }];
  assert.equal(rankCandidate(jazz, plan, ctx).scores.requestFit, 0.9);
});

test("budget stops an upstream promise even if it ignores AbortSignal", async () => {
  const budget = new Budget({ requestTimeoutMs: 20, durationMs: 1000 });
  await assert.rejects(
    budget.call("retrieval", "hung", () => new Promise(() => {})),
    (error) => error.status === "timeout"
  );
  assert.equal(budget.active, 0);
  assert.equal(budget.calls[0].status, "timeout");
});

test("concurrent retrieval and dependent followups never exceed four active calls", async () => {
  const budget = new Budget();
  let running = 0,
    maximum = 0;
  const call = () =>
    budget.call("retrieval", "parallel", async () => {
      running++;
      maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running--;
    });
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      await call();
      await call();
    })
  );
  assert.ok(maximum <= 4);
  assert.equal(budget.active, 0);
});

test("mentioning a playlist as a source cannot implicitly replace the queue", () => {
  assert.equal(localIntent("按我的歌单推荐3首").queueAction, "cards");
  assert.equal(localIntent("生成3首歌单").queueAction, "replace");
});
test("explicit playlist IDs require verified detail before reading tracks", async () => {
  const calls = [];
  const r = await run(
    "只从歌单ID 900推荐3首",
    {},
    {
      ncm: async (path, args) => {
        calls.push(path);
        if (path === "/playlist/detail")
          return { playlist: { id: 900, name: "Source playlist" } };
        return fixtureNcm(path, args);
      },
    }
  );
  assert.ok(calls.includes("/playlist/detail"));
  assert.equal(r.tracks.length, 3);
  assert.ok(
    r.tracks.every((t) => t.provenance.some((p) => p.playlistId === "900"))
  );
});

test("undo queued during a feedback upload flushes immediately after its acknowledgement", async () => {
  const { createListeningController } = await import("../public/listening.mjs");
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  const values = new Map(),
    batches = [];
  let finishFirst;
  const controller = createListeningController({
    audio: {
      addEventListener() {},
      currentTime: 0,
      paused: true,
      duration: 100,
      volume: 1,
    },
    getTrack: () => null,
    accountId: "fixture",
    clientId: "client",
    storage: {
      getItem: (k) => values.get(k),
      setItem: (k, v) => values.set(k, v),
    },
    post: async (_path, { events }) => {
      batches.push(events);
      if (batches.length === 1)
        await new Promise((resolve) => (finishFirst = resolve));
      return { accepted: events.map((e) => e.eventId) };
    },
  });
  try {
    const id = controller.action("dislike", { id: "1", duration: 100000 });
    controller.action(
      "undo_dislike",
      { id: "1", duration: 100000 },
      { undoOf: id }
    );
    finishFirst();
    for (let i = 0; i < 20 && batches.length < 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(batches.length, 2);
    assert.equal(batches[1][0].type, "undo_dislike");
  } finally {
    controller.dispose();
    globalThis.window = previousWindow;
  }
});
