// Explicit local integration probe: reads your own account; writes only ignored evidence.
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createNcmClient } from "../lib/ncm.mjs";
import { createProfileSync } from "../lib/taste/profile-sync.mjs";
import { createEventStore } from "../lib/taste/events.mjs";
import { createModel } from "../lib/recommendation/model.mjs";
import { createPlayability } from "../lib/recommendation/playability.mjs";
import { createTraceStore } from "../lib/recommendation/trace.mjs";
import { recommend } from "../lib/recommendation/orchestrator.mjs";
import { atomicJson } from "../lib/storage.mjs";
const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const dataDir = process.env.AWUDIO_DATA_DIR || join(root, "data");
const ncm = createNcmClient({
  baseUrl: process.env.NCM_API_BASE,
  cookie: process.env.NCM_COOKIE,
});
const profiles = createProfileSync({ dataDir, ncm }),
  identity = await profiles.identity();
const profile = await profiles.read(identity.accountKey);
if (!profile) throw new Error("先同步偏好再运行联调");
const learning = await createEventStore({ dataDir }).summary(
  identity.accountKey
);
const model = createModel({
  provider: process.env.AI_PROVIDER || "local",
  deepseekKey: process.env.DEEPSEEK_API_KEY,
  deepseekBase: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL,
  openaiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL,
});
const playability = createPlayability({ ncm });
const traceStore = createTraceStore(join(dataDir, "live-checks"));
const requests = [
  "按我的收藏推荐3首熟歌，不要Live",
  "发现5首收藏之外的歌曲，保留相邻口味",
  "只听纯音乐，不要Live，推荐3首",
  "来一期周杰伦的歌，包含《晴天》和《七里香》，不要Live，5首",
  "写代码10分钟，然后放松10分钟",
  "只听粤语纯音乐，不要爵士，推荐3首",
];
const summaries = [];
const caseArg = process.argv.find((arg) => arg.startsWith("--case="));
const selectedRequests = caseArg
  ? requests.slice(
      Number(caseArg.split("=")[1]) - 1,
      Number(caseArg.split("=")[1])
    )
  : process.argv.includes("--one")
  ? requests.slice(0, 1)
  : requests;
for (const message of selectedRequests) {
  const result = await recommend({
    message,
    profile,
    learning,
    accountKey: identity.accountKey,
    ncm,
    model,
    playability,
    traceStore,
    featureCache: profiles,
  });
  const summary = {
    message,
    id: result.recommendationId,
    count: result.tracks.length,
    durationMs: result.trace.durationMs,
    counts: result.trace.counts,
    sourceStatus: result.trace.sources,
    modelSelected: result.trace.decisions
      .filter((d) => d.step === "select")
      .map((d) => ({ accepted: d.selected.length, proposed: d.proposed })),
    warnings: result.warnings,
    stages: result.selectionSummary?.stages,
    fullOnly: result.tracks.every((t) => t.playability.state === "full"),
  };
  summaries.push(summary);
  console.log(
    JSON.stringify({
      ...summary,
      modelSelected: summary.modelSelected.map((s) => ({
        accepted: s.accepted,
        proposedCount: s.proposed.length,
      })),
    })
  );
}
await atomicJson(join(dataDir, "live-checks", "latest-summary.json"), {
  at: new Date().toISOString(),
  summaries,
});
