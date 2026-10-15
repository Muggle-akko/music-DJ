export const cases = [
  ["来点适合现在听的", {}, "cards"],
  ["来一期随便听", {}, "replace"],
  ["帮我生成歌单", {}, "replace"],
  ["接着来几首", {}, "append"],
  ["今天只想听熟歌", {}, "cards"],
  ["只要收藏里的歌", {}, "cards"],
  ["发现点新的", {}, "cards"],
  ["别总是收藏里的，探索一下", {}, "cards"],
  ["推荐三首歌", {}, "cards"],
  ["推荐一首", {}, "cards"],
  ["来一组10首歌", {}, "replace"],
  ["生成50首歌单", {}, "replace"],
  ["只要纯音乐，不要爵士", {}, "cards"],
  ["只听纯音乐", {}, "cards"],
  ["不要人声", {}, "cards"],
  ["不要Live的歌", {}, "cards"],
  ["只听现场版", {}, "cards"],
  ["不要摇滚", {}, "cards"],
  ["不要电子", {}, "cards"],
  ["只听英语歌", {}, "cards"],
  ["只听日语歌", {}, "cards"],
  ["只听粤语歌", {}, "cards"],
  ["只要新歌", {}, "cards"],
  ["推荐一些爵士", {}, "cards"],
  ["写半小时代码，然后放松15分钟", {}, "cards"],
  ["写代码30分钟", {}, "cards"],
  ["运动20分钟，然后睡觉10分钟", {}, "cards"],
  ["来一期睡前歌单", {}, "replace"],
  ["播放《Song 2》", {}, "cards"],
  ["来一期Alpha的歌", {}, "replace"],
  ["来一期Alpha的歌，不要Live", {}, "replace"],
  ["来一期Missing的歌", {}, "replace"],
  ["暂停", {}, "none"],
  ["下一首", {}, "none"],
  ["继续播放", {}, "none"],
  ["为什么推荐这首", {}, "none"],
  ["这首现在不适合，但我挺喜欢的", {}, "none"],
  ["介绍一下爵士", {}, "none"],
  ["生成今日歌单", { mode: "playlist" }, "replace"],
  ["重听收藏里的歌", {}, "cards"],
];
export const rawSong = (id) => ({
  id,
  name: `Song ${id}${id % 11 === 0 ? " (Live)" : ""}`,
  ar: [
    {
      id: (id % 7) + 1,
      name: id % 7 === 0 ? "Alpha" : `Artist ${(id % 7) + 1}`,
    },
  ],
  al: { id: Math.floor(id / 4), name: `Album ${Math.floor(id / 4)}` },
  dt: 180000 + (id % 3) * 30000,
  freeTrialInfo: null,
});
export const fixtureProfile = {
  version: "fixture-1",
  complete: true,
  dataCoverage: {
    fetchedLikedTrackCount: 35,
    likedPlaylistDeclaredTrackCount: 35,
  },
  allLikedSongs: Array.from({ length: 35 }, (_, i) => {
    const raw = rawSong(i + 1);
    return {
      id: String(raw.id),
      title: raw.name,
      artist: raw.ar[0].name,
      artistIds: [String(raw.ar[0].id)],
      albumId: String(raw.al.id),
      durationMs: raw.dt,
      features: {
        genre: [
          {
            value: i % 2 ? "jazz" : "instrumental",
            confidence: 0.8,
            source: "song_wiki",
          },
        ],
        vocal: {
          value: i % 2 ? "unknown" : "instrumental",
          confidence: i % 2 ? 0 : 0.8,
        },
        language: { value: null, confidence: 0 },
      },
    };
  }),
};
export async function fixtureNcm(path, args = {}) {
  const songs = Array.from({ length: 65 }, (_, i) => rawSong(i + 40));
  if (path === "/cloudsearch") {
    if (args.type === 100)
      return {
        result: {
          artists: args.keywords === "Alpha" ? [{ id: 1, name: "Alpha" }] : [],
        },
      };
    if (args.type === 1000)
      return {
        result: { playlists: [{ id: 900, name: "Instrumental focus" }] },
      };
    const exact = String(args.keywords).match(/^Song (\d+)$/);
    return { result: { songs: exact ? [rawSong(Number(exact[1]))] : songs } };
  }
  if (path === "/simi/song") return { songs };
  if (path === "/recommend/songs")
    return { data: { dailySongs: songs.slice(20) } };
  if (path === "/playlist/track/all") return { songs };
  if (path === "/artist/songs")
    return { songs: songs.filter((s) => s.ar[0].id === Number(args.id)) };
  if (path === "/song/detail")
    return { songs: String(args.ids).split(",").map(Number).map(rawSong) };
  if (path === "/song/wiki/summary")
    return {
      data: {
        blocks: [
          {
            creatives: [
              {
                uiElement: { mainTitle: { title: "曲风" } },
                resources: [
                  {
                    uiElement: {
                      mainTitle: {
                        title: Number(args.id) % 2 ? "爵士" : "纯音乐",
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
  if (path.startsWith("/song/url"))
    return {
      data: String(args.id)
        .split(",")
        .reverse()
        .map((id) => ({
          id: Number(id),
          url: "https://audio.invalid/signed-should-never-be-in-trace",
          code: 200,
          freeTrialInfo: null,
          time: rawSong(Number(id)).dt,
        })),
    };
  throw new Error(`unexpected fixture request ${path}`);
}
