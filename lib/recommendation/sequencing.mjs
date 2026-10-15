import { sameRecording } from "./candidates.mjs";
import { ranked } from "./ranking.mjs";
const RATIOS = {
  balanced: [0.55, 0.35, 0.1],
  discovery: [0.2, 0.6, 0.2],
  familiar: [1, 0, 0],
};
export function selectTracks(input, plan, context, modelOrder = []) {
  const warnings = [],
    selected = [],
    stageSummary = [];
  const categories = ["familiar", "adjacent", "discovery"];
  const ratios = RATIOS[plan.mode] || RATIOS.balanced;
  const counts = [0, 0, 0];
  const stages = plan.stages.length
    ? plan.stages
    : [{ id: "default", mood: plan.mood, label: "本期" }];
  const order = new Map(modelOrder.map((s, i) => [s.trackId, i]));
  const modelStages = new Map(modelOrder.map((s) => [s.trackId, s.stageId]));
  const pool = [...input];
  for (const stage of stages) {
    let duration = 0,
      stageTracks = 0;
    const source = ranked(pool, { ...plan, mood: stage.mood }, context).sort(
      (a, b) =>
        Number(b.requested) - Number(a.requested) ||
        (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) ||
        b.score - a.score
    );
    while (
      selected.length < plan.requestedCount &&
      (!stage.targetDurationMs || duration < stage.targetDurationMs)
    ) {
      let candidates = source.filter(
        (t) =>
          !selected.some((s) =>
            !plan.allowVersions ? sameRecording(s, t) : s.id === t.id
          ) &&
          (!stage.targetDurationMs || t.durationMs > 0)
      );
      if (!candidates.length) break;
      const explicitlyRequested = candidates.find((t) => t.requested);
      const diversity = (t) => {
        if (plan.artistTopic) return true;
        const artist = t.artistIds[0] || t.artist;
        return (
          !(
            selected.at(-1) &&
            (selected.at(-1).artistIds[0] || selected.at(-1).artist) === artist
          ) &&
          selected
            .slice(-5)
            .filter((s) => (s.artistIds[0] || s.artist) === artist).length <
            2 &&
          (!t.albumId ||
            selected.filter((s) => s.albumId === t.albumId).length < 2)
        );
      };
      const varied = candidates.filter(diversity);
      if (varied.length) candidates = varied;
      else if (!warnings.includes("候选有限，已放宽歌手或专辑间隔"))
        warnings.push("候选有限，已放宽歌手或专辑间隔");
      const preferredStage = candidates.filter(
        (t) => !modelStages.get(t.id) || modelStages.get(t.id) === stage.id
      );
      if (preferredStage.length) candidates = preferredStage;
      const available = categories
        .map((category, i) => ({
          category,
          deficit: ratios[i] * (selected.length + 1) - counts[i],
        }))
        .filter((bucket) =>
          candidates.some((t) => t.familiarity === bucket.category)
        )
        .sort((a, b) => b.deficit - a.deficit);
      const quota = candidates.filter(
        (t) => t.familiarity === available[0]?.category
      );
      const track = explicitlyRequested || quota[0] || candidates[0];
      if (
        explicitlyRequested &&
        !diversity(explicitlyRequested) &&
        !warnings.includes("为保留明确点歌，已放宽歌手或专辑间隔")
      )
        warnings.push("为保留明确点歌，已放宽歌手或专辑间隔");
      selected.push({
        ...track,
        stageId: stage.id,
        playlistStage:
          stage.id === "default"
            ? null
            : {
                index: stageSummary.length,
                label: stage.id,
                title: stage.label,
                mood: stage.mood,
                targetMinutes: stage.targetDurationMs / 60000,
              },
      });
      duration += track.durationMs;
      stageTracks++;
      const index = categories.indexOf(track.familiarity);
      if (index >= 0) counts[index]++;
      if (!stage.targetDurationMs && stageTracks >= plan.requestedCount) break;
    }
    stageSummary.push({
      id: stage.id,
      label: stage.label,
      targetDurationMs: stage.targetDurationMs || null,
      actualDurationMs: duration,
      count: stageTracks,
      shortfallMs: Math.max(0, (stage.targetDurationMs || 0) - duration),
    });
  }
  if (
    !plan.artistTopic &&
    !plan.exactOnly &&
    categories.some(
      (_, i) => Math.abs(counts[i] - ratios[i] * selected.length) > 1
    )
  )
    warnings.push("合规候选不足，熟悉与探索比例未完全达到目标");
  return {
    tracks: selected,
    warnings,
    stages: stageSummary,
    counts: Object.fromEntries(
      [...categories, "unknown"].map((k) => [
        k,
        selected.filter((t) => t.familiarity === k).length,
      ])
    ),
  };
}
