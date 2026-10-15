export const norm = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]/gu, "");
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function chineseNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  const digits = "零一二三四五六七八九";
  if (text === "两") return 2;
  if (text.includes("十")) {
    const [a, b] = text.split("十");
    return (a ? digits.indexOf(a) : 1) * 10 + (b ? digits.indexOf(b) : 0);
  }
  return digits.indexOf(text);
}
export function localIntent(message, options = {}) {
  const text = message.trim();
  const countMatch = text.match(/([\d一二两三四五六七八九十]+)\s*首/);
  const explicitCount = countMatch ? chineseNumber(countMatch[1]) : null;
  const explicitPlaylist =
    options.mode === "playlist" ||
    /(?:生成|制作|安排|重排|播放整个|来一份).{0,24}歌单|来一期|来一组|排一[期组]|换一批|整期电台/.test(
      text
    );
  const requestedPlaylistIds = [
    ...text.matchAll(
      /(?:music\.163\.com\/[^\s]*playlist[^\s]*[?&]id=|歌单\s*(?:ID|id|编号|[:：])\s*[:：]?\s*)(\d{1,30})/g
    ),
  ]
    .map((match) => match[1])
    .slice(0, 3);
  const append = /接着|接下来再|再加|加入|追加/.test(text);
  let intent = "recommend";
  if (/^(暂停|继续播放|下一首|上一首|停止|清空队列)[。！!]?$/u.test(text))
    intent = "control";
  else if (/为什么.*(这首|推荐)|推荐.*(依据|逻辑|原因)/.test(text))
    intent = "explain";
  else if (
    /现在不[适合想听]|暂时不想|这首.*不合适/.test(text) &&
    !/推荐|来[点些]|换/.test(text)
  )
    intent = "feedback";
  else if (
    /^(聊聊|介绍|讲讲)|[吗呢？?]$/.test(text) &&
    !/推荐|想听|来[点些期组]|放[点些首]|找.*歌/.test(text)
  )
    intent = "music_chat";
  const modes =
    /新歌|发现|探索|别总.*收藏|不要熟歌|收藏之外|收藏以外|不在收藏|不要收藏|不听收藏/.test(
      text
    )
      ? "discovery"
      : /熟歌|只.*收藏|只.*歌库/.test(text)
      ? "familiar"
      : "balanced";
  const mood = /睡|助眠/.test(text)
    ? "sleep"
    : /写代码|专注|工作|学习/.test(text)
    ? "focus"
    : /运动|跑步|提神|战歌/.test(text)
    ? "energy"
    : /放松|通勤/.test(text)
    ? "chill"
    : "random";
  const constraints = [];
  const add = (field, operator, value) =>
    constraints.push({
      field,
      operator,
      value,
      origin: text,
      evidenceRequired: true,
    });
  if (
    /(?:只要|只听)[^，。]{0,6}纯音乐|不要人声|无人声/.test(text) &&
    !/不要纯音乐/.test(text)
  )
    add("vocal", "eq", "instrumental");
  if (/(?:不要|别放|排除|不听).{0,5}(?:live|现场)/i.test(text))
    add("version", "not_in", ["live"]);
  if (/(?:只要|只听).{0,4}(?:live|现场)/i.test(text))
    add("version", "in", ["live"]);
  for (const [word, value] of [
    ["爵士", "jazz"],
    ["摇滚", "rock"],
    ["电子", "electronic"],
  ])
    if (new RegExp(`(?:不要|排除|不听)${word}`).test(text))
      add("genre", "not_in", [value]);
  if (
    /只要新歌|只听新歌|收藏之外|收藏以外|不在收藏|不要收藏|不听收藏/.test(
      text
    ) &&
    !/发行|发布|今年|最近.*出/.test(text)
  )
    add("familiarity", "not_in", ["familiar"]);
  const lang = text.match(/(?:只要|只听)(国语|华语|英语|日语|韩语|粤语)/);
  if (lang) add("language", "eq", lang[1]);
  const quotes = [...text.matchAll(/[《「“"]([^》」”"]{1,80})[》」”"]/g)].map(
    (m) => ({ type: "song", query: m[1] })
  );
  const artistMatch = text.match(
    /(?:来一期|来一组|只听|只要)([^，。！？,]{1,30}?)(?:的歌|的经典|的歌曲|专场)/
  );
  if (artistMatch) quotes.push({ type: "artist", query: artistMatch[1] });
  const stages = [];
  for (const [i, segment] of text.split(/然后|接着|之后|再去/).entries()) {
    const duration = segment.match(
      /(半|[\d一二两三四五六七八九十]+)\s*(小时|分钟|分)/
    );
    const minutes = duration
      ? duration[1] === "半"
        ? 30
        : chineseNumber(duration[1]) * (duration[2] === "小时" ? 60 : 1)
      : null;
    if (minutes || /然后|之后|接着/.test(text)) {
      const scene = /睡/.test(segment)
        ? "sleep"
        : /代码|工作|学习/.test(segment)
        ? "focus"
        : /运动|跑步/.test(segment)
        ? "energy"
        : "chill";
      stages.push({
        id: `stage-${i + 1}`,
        label: segment.slice(0, 60),
        mood: scene,
        targetDurationMs: (minutes || 15) * 60000,
      });
    }
  }
  const softPreferences = [];
  for (const [word, value] of [
    ["爵士", "jazz"],
    ["摇滚", "rock"],
    ["电子", "electronic"],
    ["纯音乐", "instrumental"],
    ["氛围", "ambient"],
  ])
    if (
      text.includes(word) &&
      !new RegExp(`(?:不要|排除|不听)${word}`).test(text)
    )
      softPreferences.push({ field: "genre", value });
  return {
    intent: explicitPlaylist && intent === "recommend" ? "playlist" : intent,
    queueAction: ["control", "explain", "music_chat", "feedback"].includes(
      intent
    )
      ? "none"
      : append
      ? "append"
      : explicitPlaylist
      ? "replace"
      : "cards",
    mode: modes,
    mood,
    requestedCount: explicitCount
      ? clamp(explicitCount, 1, 30)
      : stages.length
      ? 30
      : explicitPlaylist
      ? 24
      : 5,
    explicitCount: Boolean(explicitCount),
    countExceeded: explicitCount > 30,
    targetDurationMs:
      stages.reduce((n, s) => n + s.targetDurationMs, 0) || null,
    hardConstraints: constraints,
    softPreferences,
    requestedEntities: quotes,
    requestedPlaylistIds,
    stages,
    voiceRequested:
      /解说|主播|讲解/.test(text) && !/不要解说|不要主播|不用讲解/.test(text),
    allowReplay: /重听|再听一遍|这次仍然播放/.test(text),
    overrideBlock: /这次仍然播放/.test(text),
    actions: [],
  };
}
export function mergeIntent(local, model = {}, message = "") {
  const result = structuredClone(local);
  if (
    local.intent === "recommend" &&
    ["music_chat", "library_query", "recommend", "playlist"].includes(
      model.intent
    )
  ) {
    result.intent = model.intent;
    if (["music_chat", "library_query"].includes(model.intent))
      result.queueAction = "none";
  }
  if (Array.isArray(model.requestedEntities))
    result.requestedEntities = [
      ...local.requestedEntities,
      ...model.requestedEntities
        .filter(
          (e) =>
            ["artist", "song"].includes(e?.type) &&
            typeof e.query === "string" &&
            e.query.length <= 80 &&
            norm(message).includes(norm(e.origin || e.query))
        )
        .slice(0, 6)
        .map((e) => ({
          type: e.type,
          query: e.query,
          exclude: Boolean(e.exclude),
        })),
    ].filter(
      (e, i, a) =>
        a.findIndex(
          (q) =>
            q.type === e.type &&
            norm(q.query) === norm(e.query) &&
            Boolean(q.exclude) === Boolean(e.exclude)
        ) === i
    );
  for (const rule of Array.isArray(model.hardConstraints)
    ? model.hardConstraints.slice(0, 10)
    : []) {
    if (
      ![
        "version",
        "genre",
        "language",
        "vocal",
        "releasedAfter",
        "releasedBefore",
      ].includes(rule?.field) ||
      !["eq", "in", "not_in"].includes(rule.operator) ||
      typeof rule.origin !== "string" ||
      rule.origin.length < 2 ||
      !message.includes(rule.origin) ||
      !/只|不要|不听|排除|不想听|限定|必须|发行|发布|之后|之前/.test(
        rule.origin
      )
    )
      continue;
    const values = Array.isArray(rule.value) ? rule.value : [rule.value];
    if (
      !values.length ||
      values.length > 10 ||
      values.some((v) => typeof v !== "string" || !v || v.length > 60)
    )
      continue;
    if (
      !result.hardConstraints.some(
        (c) =>
          c.field === rule.field &&
          c.operator === rule.operator &&
          JSON.stringify(c.value) === JSON.stringify(rule.value)
      )
    )
      result.hardConstraints.push({
        field: rule.field,
        operator: rule.operator,
        value: rule.value,
        origin: rule.origin,
        evidenceRequired: true,
      });
  }
  if (Array.isArray(model.softPreferences))
    result.softPreferences = [
      ...local.softPreferences,
      ...model.softPreferences
        .filter((p) => typeof p?.value === "string")
        .slice(0, 10)
        .map((p) => ({ field: "genre", value: p.value.slice(0, 40) })),
    ].filter(
      (p, i, a) => a.findIndex((q) => norm(q.value) === norm(p.value)) === i
    );
  if (!local.stages.length && Array.isArray(model.stages))
    result.stages = model.stages.slice(0, 5).map((s, i) => ({
      id: `stage-${i + 1}`,
      label: String(s.label || "").slice(0, 60),
      mood: ["focus", "chill", "energy", "sleep"].includes(s.mood)
        ? s.mood
        : "random",
      targetDurationMs: clamp(
        Number(s.targetDurationMs) || 15 * 60000,
        60000,
        4 * 3600000
      ),
    }));
  result.actions = Array.isArray(model.actions)
    ? model.actions.slice(0, 8)
    : [];
  return result;
}

export function genreMatches(value, wanted) {
  const patterns = {
    jazz: /jazz|爵士/i,
    rock: /rock|摇滚/i,
    electronic: /electronic|电子/i,
    instrumental: /instrumental|纯音乐|器乐/i,
    ambient: /ambient|氛围/i,
    pop: /pop|流行/i,
    hiphop: /hip.?hop|嘻哈|说唱/i,
    lofi: /lo.?fi|低保真/i,
  };
  const pattern = patterns[String(wanted).toLowerCase()];
  return pattern ? pattern.test(value) : norm(value).includes(norm(wanted));
}
