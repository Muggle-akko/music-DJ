import { clamp, genreMatches } from "./intent.mjs";
export const POLICY_VERSION = "v2.1";
const sceneTags = {
  focus: /instrumental|纯音乐|ambient|氛围|lofi|器乐/i,
  sleep: /ambient|氛围|轻音乐/i,
  energy: /dance|电子|electronic|funk|disco/i,
  chill: /chill|爵士|jazz|r&b/i,
};
export function rankCandidate(track, plan, context) {
  const learned = context.learning?.tracks?.[track.id];
  const tags = track.features?.genre || [];
  const soft = plan.softPreferences || [];
  const fit = soft.length
    ? soft.reduce(
        (n, p) =>
          n + (tags.some((g) => genreMatches(g.value, p.value)) ? 0.9 : 0.5),
        0
      ) / soft.length
    : 0.5;
  const requested = context.requestedIds?.has(track.id);
  const requestFit = requested ? 1 : fit;
  const sceneFit = tags.some((g) => sceneTags[plan.mood]?.test(g.value))
    ? 0.9
    : 0.5;
  const tasteBase =
    context.likedIds?.has(track.id) || learned?.liked
      ? 0.9
      : learned?.implicit > 0.05
      ? 0.75
      : track.artistIds.some((id) =>
          context.learning?.preferredArtistIds?.includes(id)
        )
      ? 0.7
      : tags.some((g) => context.learning?.preferredTags?.includes(g.value))
      ? 0.6
      : 0.5;
  const sampleCount = Math.max(
    0,
    Number(track.weeklyPlayCount) || 0,
    Number(track.allTimePlayCount) || 0
  );
  const tasteAffinity = Math.min(
    1,
    tasteBase +
      Math.min(0.05, (0.05 * Math.log1p(sampleCount)) / Math.log1p(1000))
  );
  const exposure = learned?.exposures?.some(
    (at) => context.now - Date.parse(at) < 7 * 86400000
  );
  const freshnessFit =
    plan.mode === "familiar"
      ? 0.5
      : learned?.lastListenedAt
      ? 0.2
      : exposure
      ? 0.7
      : context.historyKnown
      ? 1
      : 0.5;
  const sourceConfidence = tags.length
    ? 0.9
    : track.provenance.some((p) => ["similar", "playlist"].includes(p.source))
    ? 0.7
    : 0.5;
  const scene = plan.mood;
  const negatives = (learned?.contextNegatives || [])
    .filter((n) => n.scene === scene)
    .map(
      (n) =>
        n.strength *
        Math.max(0, 1 - (context.now - Date.parse(n.at)) / 86400000)
    );
  const contextNegativePenalty = Math.min(
    0.25,
    negatives.reduce((a, b) => a + b, 0)
  );
  const repeatPenalty = learned?.lastListenedAt
    ? 0.25 *
      2 **
        (-Math.max(0, context.now - Date.parse(learned.lastListenedAt)) /
          86400000)
    : 0;
  const sessionPositive = learned?.liked
    ? 1
    : learned?.implicit > 0.05
    ? 0.7
    : 0;
  const scores = {
    requestFit,
    tasteAffinity,
    sceneFit,
    freshnessFit,
    sourceConfidence,
    sessionPositive,
    repeatPenalty,
    contextNegativePenalty,
  };
  const score = clamp(
    0.35 * requestFit +
      0.25 * tasteAffinity +
      0.15 * sceneFit +
      0.1 * freshnessFit +
      0.1 * sourceConfidence +
      0.05 * sessionPositive -
      repeatPenalty -
      contextNegativePenalty,
    0,
    1
  );
  return { ...track, score, scores, requested: Boolean(requested) };
}
export function ranked(pool, plan, context) {
  return [...pool]
    .map((t) => rankCandidate(t, plan, context))
    .sort(
      (a, b) =>
        Number(b.requested) - Number(a.requested) ||
        b.score - a.score ||
        a.id.localeCompare(b.id)
    );
}
