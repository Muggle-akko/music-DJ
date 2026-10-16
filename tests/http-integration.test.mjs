import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fixtureNcm, rawSong } from "./fixtures/recommendation-cases.mjs";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test("HTTP contracts: sync, concurrent queue/feedback, zero-result safety and metadata round-trip", async () => {
  const upstream = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    const args = Object.fromEntries(url.searchParams);
    if (args.type) args.type = Number(args.type);
    let data;
    if (url.pathname === "/login/status")
      data = { code: 200, data: { profile: { userId: 123 } } };
    else if (url.pathname === "/user/playlist")
      data = {
        code: 200,
        playlist: [{ id: 1, userId: 123, specialType: 5, trackCount: 3 }],
        more: false,
      };
    else if (url.pathname === "/playlist/detail")
      data = { code: 200, playlist: { trackCount: 3, trackIds: [] } };
    else if (url.pathname === "/playlist/track/all")
      data = { code: 200, songs: [rawSong(1), rawSong(2), rawSong(3)] };
    else if (url.pathname === "/user/record")
      data = { code: 200, allData: [], weekData: [] };
    else {
      try {
        data = { code: 200, ...(await fixtureNcm(url.pathname, args)) };
      } catch {
        data = { code: 404 };
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const dataDir = await mkdtemp(join(tmpdir(), "awudio-http-"));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      AWUDIO_DATA_DIR: dataDir,
      NCM_API_BASE: `http://127.0.0.1:${upstream.address().port}`,
      NCM_COOKIE: "fixture-not-real",
      AI_PROVIDER: "local",
      DEEPSEEK_API_KEY: "",
      OPENAI_API_KEY: "",
      FISH_AUDIO_API_KEY: "",
      TTS_PROVIDER: "none",
    },
    stdio: "ignore",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    async function request(path, body) {
      const r = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, data: await r.json() };
    }
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await request("/api/config");
        ready = true;
        break;
      } catch {
        await sleep(50);
      }
    }
    assert.ok(ready, "server started");
    const module = await fetch(base + "/listening.mjs");
    assert.match(module.headers.get("content-type"), /javascript/);
    assert.equal((await request("/api/profile/sync", {})).status, 202);
    let profile;
    for (let i = 0; i < 40; i++) {
      profile = (await request("/api/profile/status")).data;
      if (profile.complete) break;
      await sleep(30);
    }
    assert.equal(profile.coverage.fetchedLikedTrackCount, 3);
    const rec = (
      await request("/api/chat", {
        message: "只听熟歌，推荐两首",
        algorithmVersion: "v2",
        clientId: "integration",
        requestId: "r1",
        expectedQueueRevision: 0,
      })
    ).data;
    assert.equal(rec.algorithmVersion, "v2");
    assert.equal(rec.tracks.length, 2);
    assert.equal(rec.plan.queueAction, "cards");
    const track = rec.tracks[0];
    await Promise.all([
      request("/api/queue", { queue: rec.tracks, currentIndex: 0, expectedRevision: 0 }),
      request("/api/taste/library", { tracks: [track] }),
      request("/api/taste", { action: "like", track }),
    ]);
    const queue = (await request("/api/queue")).data;
    assert.equal(queue.queue.length, 2);
    assert.equal(queue.queue[0].recommendationId, rec.recommendationId);
    assert.ok(queue.queue[0].artistIds.length);
    assert.equal(queue.revision, 1);
    const liked = (await request("/api/taste/library")).data;
    assert.equal(liked.tracks.length, 1);
    const explanation = (
      await request(
        `/api/recommendations/${rec.recommendationId}/explanation?trackId=${track.id}`
      )
    ).data;
    assert.ok(explanation.explanation.length);
    const zero = (
      await request("/api/chat", {
        message: "只听粤语歌，生成3首歌单",
        mode: "playlist",
        algorithmVersion: "v2",
        clientId: "integration",
        requestId: "r2",
        expectedQueueRevision: 1,
      })
    ).data;
    assert.equal(zero.tracks.length, 0);
    assert.equal(zero.radioHistoryItem, null);
    assert.equal((await request("/api/queue")).data.queue.length, 2);
    const stale = (
      await request("/api/chat", {
        message: "生成两首熟歌歌单",
        mode: "playlist",
        algorithmVersion: "v2",
        clientId: "integration",
        requestId: "r3",
        expectedQueueRevision: 0,
      })
    ).data;
    assert.equal(stale.plan.queueAction, "cards");
    assert.equal(stale.radioHistoryItem, null);
    const event = {
      eventId: "integration-event",
      type: "queue_remove",
      trackId: track.id,
      occurredAt: new Date().toISOString(),
      context: { scene: "focus" },
      clientId: "test",
      actionSeq: 1,
    };
    const accepted = (
      await request("/api/listening/events", { events: [event] })
    ).data;
    assert.deepEqual(accepted.accepted, ["integration-event"]);
    assert.deepEqual(
      (await request("/api/listening/events", { events: [event] })).data
        .duplicate,
      ["integration-event"]
    );
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    await new Promise((r) => upstream.close(r));
  }
});
