import { mapSong } from "../taste/profile-sync.mjs";
import { norm } from "./intent.mjs";

export function candidate(raw, provenance, context = {}) {
  const track = raw.name ? mapSong(raw) : structuredClone(raw);
  if (!/^\d{1,30}$/.test(String(track.id || "")) || !track.title) return null;
  track.id = String(track.id);
  track.durationMs = Number(track.durationMs || track.duration || 0);
  track.artistIds ||= [];
  track.features ||= {
    genre: [],
    vocal: { value: "unknown", confidence: 0 },
    language: { value: null, confidence: 0 },
  };
  // Legacy inferred tags are intentionally not promoted into song facts.
  track.features.genre ||= [];
  const live = /(?:\bLive\b|现场版|演唱会)/i.test(track.title),
    remix = /remix|混音/i.test(track.title);
  track.version = {
    kind: live ? "live" : remix ? "remix" : "studio",
    source: "upstream_title",
    confidence: 0.7,
  };
  track.provenance = [...(track.provenance || []), provenance];
  const learned = context.learning?.tracks?.[track.id];
  track.familiarity =
    context.likedIds?.has(track.id) ||
    learned?.liked ||
    learned?.implicit > 0.05
      ? "familiar"
      : context.profileComplete
      ? provenance.source === "similar" ||
        context.knownArtists?.has(track.artistIds[0])
        ? "adjacent"
        : "discovery"
      : "unknown";
  track.evidence = [
    {
      id: `${track.id}:metadata`,
      kind: "metadata",
      value: `${track.title} / ${track.artist}`,
      source: "netease",
      confidence: 0.9,
    },
    ...track.features.genre.map((g, i) => ({
      id: `${track.id}:genre:${i}`,
      kind: "genre",
      ...g,
    })),
    {
      id: `${track.id}:source:${provenance.source}`,
      kind: "source",
      value: provenance.source,
      source: provenance.source,
      confidence: 0.7,
    },
  ];
  return track;
}
export function mergeCandidates(pool, tracks, provenance, context) {
  for (const raw of tracks) {
    const value = candidate(raw, provenance, context);
    if (!value) continue;
    const old = pool.get(value.id);
    if (old) {
      old.provenance = [...old.provenance, ...value.provenance].filter(
        (p, i, a) =>
          a.findIndex((q) => JSON.stringify(q) === JSON.stringify(p)) === i
      );
      old.evidence = [...old.evidence, ...value.evidence].filter(
        (p, i, a) => a.findIndex((q) => q.id === p.id) === i
      );
      if (!old.features.genre.length && value.features.genre.length)
        old.features = value.features;
    } else if (pool.size < 400) pool.set(value.id, value);
  }
}
const genreAliases = {
  jazz: /jazz|爵士/i,
  rock: /rock|摇滚/i,
  electronic: /electronic|电子/i,
};
export function constraintValue(track, field) {
  if (field === "version") return track.version?.kind;
  if (field === "artistId") return track.artistIds || [];
  if (field === "genre") {
    const values = (track.features?.genre || [])
      .filter((g) => g.confidence >= 0.7)
      .map((g) => g.value);
    return values.length ? values : null;
  }
  if (field === "vocal" || field === "language")
    return track.features?.[field]?.confidence >= 0.7
      ? track.features[field].value
      : null;
  if (field === "familiarity")
    return track.familiarity === "unknown" ? null : track.familiarity;
  if (field === "trackId") return track.id;
  if (field === "theme")
    return [track.title, track.album, ...(track.aliases || [])].filter(Boolean);
  if (field === "playlistId")
    return track.provenance
      .filter((p) => p.source === "playlist")
      .map((p) => p.playlistId);
  if (field === "releasedAfter" || field === "releasedBefore")
    return track.publishTime || null;
  return null;
}
export function rejectReason(
  track,
  plan,
  context,
  { relaxRepeat = false } = {}
) {
  const learned = context.learning?.tracks?.[track.id];
  if (
    learned?.blocked &&
    !(plan.overrideBlock && context.requestedIds?.has(track.id))
  )
    return "explicit_dislike";
  if (plan.mode === "familiar" && track.familiarity !== "familiar")
    return "familiar_only";
  if (
    !plan.allowReplay &&
    (context.currentIds?.has(track.id) || context.sessionIds?.has(track.id))
  )
    return "current_session_repeat";
  if (
    !plan.allowReplay &&
    !relaxRepeat &&
    learned?.lastListenedAt &&
    context.now - Date.parse(learned.lastListenedAt) < 2 * 3600000
  )
    return "recent_listen";
  for (const rule of plan.hardConstraints) {
    const actual = constraintValue(track, rule.field);
    if (actual === null || actual === "unknown") return `unknown_${rule.field}`;
    if (rule.field === "releasedAfter" || rule.field === "releasedBefore") {
      const date = Date.parse(
        String(Array.isArray(rule.value) ? rule.value[0] : rule.value)
      );
      if (
        !Number.isFinite(date) ||
        (rule.field === "releasedAfter" ? actual < date : actual > date)
      )
        return `constraint_${rule.field}`;
      continue;
    }
    const values = Array.isArray(actual) ? actual : [actual],
      requested = Array.isArray(rule.value) ? rule.value : [rule.value];
    const matches = values.some((value) =>
      requested.some((want) =>
        rule.field === "genre" && genreAliases[want]
          ? genreAliases[want].test(value)
          : rule.field === "theme"
          ? norm(value).includes(norm(want))
          : norm(value) === norm(want)
      )
    );
    if (rule.operator === "not_in" ? matches : !matches)
      return `constraint_${rule.field}`;
  }
  return null;
}
export function sameRecording(a, b) {
  const base = (t) =>
    norm(
      t.title.replace(
        /\([^)]*(?:live|现场|remix|伴奏|重制)[^)]*\)|（[^）]*(?:Live|现场|伴奏|重制)[^）]*）/gi,
        ""
      )
    );
  return (
    a.id === b.id ||
    (base(a).length >= 2 &&
      base(a) === base(b) &&
      a.artistIds?.[0] &&
      a.artistIds[0] === b.artistIds?.[0] &&
      (a.version.kind !== "studio" || b.version.kind !== "studio"))
  );
}
