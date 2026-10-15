export function classifyUrl(item, durationMs = 0) {
  if (!item) return { state: "unknown", reasonCode: "missing_result" };
  if (!item.url)
    return {
      state: "blocked",
      reasonCode: `upstream_${item.code || "no_url"}`,
    };
  if (
    item.freeTrialInfo ||
    item.freeTrialPrivilege?.resConsumable ||
    Number(item.listenType) === 1
  )
    return { state: "preview", reasonCode: "trial" };
  const time = Number(item.time || 0);
  if (
    durationMs > 0 &&
    time > 0 &&
    time < durationMs - Math.max(10000, durationMs * 0.1)
  )
    return { state: "preview", reasonCode: "short_audio" };
  // Verified player-url contract: a present freeTrialInfo:null explicitly denotes no trial.
  if (
    Object.hasOwn(item, "freeTrialInfo") &&
    item.freeTrialInfo === null &&
    (!item.code || item.code === 200)
  )
    return { state: "full", reasonCode: "no_trial_contract" };
  if (
    time > 0 &&
    durationMs > 0 &&
    time >= durationMs - Math.max(2000, durationMs * 0.02)
  )
    return { state: "full", reasonCode: "full_duration" };
  return { state: "unknown", reasonCode: "insufficient_evidence" };
}
export function createPlayability({ ncm, now = () => Date.now() }) {
  const cache = new Map();
  async function check(tracks, key, budget) {
    const output = new Map(),
      pending = [];
    for (const t of tracks.slice(0, 80)) {
      const hit = cache.get(`${key}:${t.id}`);
      if (hit && hit.expiresAt > now()) output.set(t.id, hit.value);
      else pending.push(t);
    }
    for (let i = 0; i < pending.length; i += 20) {
      const batch = pending.slice(i, i + 20),
        id = batch.map((t) => t.id).join(",");
      let rows;
      try {
        try {
          const response = await budget.call(
            "playability",
            "song_url_v1",
            (signal) =>
              ncm("/song/url/v1", { id, level: "standard" }, { signal })
          );
          if (!Array.isArray(response.data))
            throw new Error("invalid_url_shape");
          rows = response.data;
        } catch (error) {
          if (error.status === "unauthorized" || error.status === "budget")
            throw error;
          const response = await budget.call(
            "playability",
            "song_url",
            (signal) => ncm("/song/url", { id }, { signal })
          );
          if (!Array.isArray(response.data))
            throw new Error("invalid_url_shape");
          rows = response.data;
        }
      } catch (error) {
        for (const t of batch)
          output.set(t.id, {
            state: "unknown",
            reasonCode: error.status || "network_error",
            checkedAt: new Date(now()).toISOString(),
          });
        continue;
      }
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      for (const t of batch) {
        const value = {
          ...classifyUrl(byId.get(t.id), t.durationMs),
          checkedAt: new Date(now()).toISOString(),
        };
        output.set(t.id, value);
        cache.set(`${key}:${t.id}`, {
          value,
          expiresAt:
            now() +
            (value.state === "full"
              ? 600000
              : ["preview", "blocked"].includes(value.state)
              ? 120000
              : 30000),
        });
      }
    }
    return output;
  }
  return { check, invalidate: (key, id) => cache.delete(`${key}:${id}`) };
}
