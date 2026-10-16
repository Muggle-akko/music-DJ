import {
  cases,
  fixtureProfile,
  fixtureNcm,
} from "../tests/fixtures/recommendation-cases.mjs";
import { recommend } from "../lib/recommendation/orchestrator.mjs";
import { createPlayability } from "../lib/recommendation/playability.mjs";
import { localIntent } from "../lib/recommendation/intent.mjs";
import { rejectReason } from "../lib/recommendation/candidates.mjs";
import { atomicJson } from "../lib/storage.mjs";
const fixed = Date.parse("2026-10-16T00:00:00Z");
const rows = [];
for (const [message, options] of cases) {
  const plan = localIntent(message, options),
    state = { tasteProfile: {}, plays: [], queue: [] };
  const checkContext = {
    now: fixed,
    likedIds: new Set(fixtureProfile.allLikedSongs.map((t) => t.id)),
    profileComplete: true,
    learning: { tracks: {} },
    currentIds: new Set(),
    sessionIds: new Set(),
  };
  const common = {
    message,
    options,
    profile: structuredClone(fixtureProfile),
    learning: { tracks: {} },
    state,
    accountKey: "000000000000000000000000",
    ncm: fixtureNcm,
    now: () => fixed,
  };
  const deterministic = await recommend({
    ...common,
    playability: createPlayability({ ncm: fixtureNcm }),
  });
  const stubModel = async (_prompt, input) =>
    input.candidates
      ? {
          selected: [...input.candidates]
            .reverse()
            .slice(0, input.plan.requestedCount)
            .map((t) => ({
              trackId: t.id,
              stageId: input.plan.stages[0]?.id || "default",
              reasonEvidenceIds: [t.evidence[0].id],
            })),
        }
      : { actions: [] };
  const agent = await recommend({
    ...common,
    model: stubModel,
    playability: createPlayability({ ncm: fixtureNcm }),
  });
  const violations = (r) =>
    r.tracks.filter((t) =>
      rejectReason(t, r.plan, checkContext, { relaxRepeat: true })
    ).length;
  rows.push({
    message,
    v2: {
      ids: deterministic.tracks.map((t) => t.id),
      hardViolations: violations(deterministic),
      counts: deterministic.trace.counts,
    },
    v2StubAgent: {
      ids: agent.tracks.map((t) => t.id),
      hardViolations: violations(agent),
      counts: agent.trace.counts,
    },
  });
}
const summary = {
  fixtureCount: rows.length,
  agentScope:
    "Deterministic stub tests the agent protocol; not a quality evaluation of DeepSeek",
  v2HardViolations: rows.reduce((n, r) => n + r.v2.hardViolations, 0),
  v2StubHardViolations: rows.reduce(
    (n, r) => n + r.v2StubAgent.hardViolations,
    0
  ),
  rows,
};
await atomicJson(
  new URL("../data/evaluation/latest.json", import.meta.url).pathname,
  summary
);
console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
if (summary.v2HardViolations || summary.v2StubHardViolations)
  process.exitCode = 1;
