import { mergeCandidates } from "./candidates.mjs";
import { norm } from "./intent.mjs";
import { candidate } from "./candidates.mjs";
import { ranked } from "./ranking.mjs";

export function createTools({
  ncm,
  profile,
  learning,
  pool,
  context,
  budget,
  plan = { mood: "random", mode: "balanced", softPreferences: [] },
}) {
  const playlistIds = new Set(),
    artistIds = new Set(),
    knownIds = new Set((profile?.allLikedSongs || []).map((t) => t.id));
  const sources = [];
  let dailyUsed = false;
  const request = (path, args, kind = "retrieval") =>
    budget.call(kind, path, (signal) => ncm(path, args, { signal }));
  const query = (args) => {
    if (
      typeof args.query !== "string" ||
      !args.query.trim() ||
      args.query.length > 80
    )
      throw new Error("invalid_query");
    return args.query.trim();
  };
  async function execute(action) {
    const tool = action?.tool,
      args = action?.args || {},
      limit =
        args.limit ??
        (tool === "profile.lookup"
          ? 120
          : tool === "catalog.searchPlaylists"
          ? 5
          : 30);
    let rows = [],
      provenance = { source: "search" },
      status = "ok";
    try {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit >
          (tool === "profile.lookup"
            ? 120
            : tool === "catalog.searchPlaylists"
            ? 5
            : 50)
      )
        throw new Error("invalid_limit");
      switch (tool) {
        case "profile.lookup": {
          const byId = new Map(
            (profile?.allLikedSongs || []).map((t) => [t.id, t])
          );
          for (const [id, track] of Object.entries(learning.tracks || {}))
            if (track.liked && track.metadata?.title && !byId.has(id))
              byId.set(id, {
                ...track.metadata,
                id,
                provider: "netease",
                features: { genre: [] },
              });
          let songs = [...byId.values()];
          if (args.query) {
            const q = norm(query(args));
            songs = songs.filter((t) =>
              norm(
                `${t.title} ${t.artist} ${(t.features?.genre || [])
                  .map((g) => g.value)
                  .join(" ")}`
              ).includes(q)
            );
          }
          rows = ranked(
            songs
              .map((t) => candidate(t, { source: "liked_library" }, context))
              .filter(Boolean),
            plan,
            context
          )
            .sort(
              (a, b) =>
                Number(Boolean(learning.tracks?.[b.id]?.liked)) -
                  Number(Boolean(learning.tracks?.[a.id]?.liked)) ||
                b.score - a.score
            )
            .slice(0, limit);
          provenance = { source: "liked_library" };
          break;
        }
        case "catalog.searchSongs": {
          const q = query(args),
            data = await request("/cloudsearch", {
              keywords: q,
              type: 1,
              limit,
            });
          if (!Array.isArray(data.result?.songs))
            throw new Error("invalid_search_shape");
          rows = data.result.songs;
          provenance = { source: "search", query: q };
          break;
        }
        case "catalog.similarSongs": {
          const seedId = String(args.seedId || "");
          if (!knownIds.has(seedId) && !pool.has(seedId))
            throw new Error("unknown_seed");
          const data = await request("/simi/song", { id: seedId, limit });
          if (!Array.isArray(data.songs))
            throw new Error("invalid_similar_shape");
          rows = data.songs;
          provenance = { source: "similar", seedId };
          break;
        }
        case "catalog.dailySongs": {
          if (dailyUsed) throw new Error("daily_already_called");
          dailyUsed = true;
          const data = await request("/recommend/songs", {});
          rows = data.data?.dailySongs || data.recommend;
          if (!Array.isArray(rows)) throw new Error("invalid_daily_shape");
          provenance = { source: "daily" };
          break;
        }
        case "catalog.searchPlaylists": {
          const q = query(args),
            data = await request("/cloudsearch", {
              keywords: q,
              type: 1000,
              limit: 5,
            });
          if (!Array.isArray(data.result?.playlists))
            throw new Error("invalid_playlist_shape");
          const items = data.result.playlists.slice(0, 5).map((p) => ({
            id: String(p.id),
            name: String(p.name || "").slice(0, 120),
            tags: (p.tags || []).slice(0, 10),
          }));
          items.forEach((p) => playlistIds.add(p.id));
          sources.push({
            tool,
            status: items.length ? "ok" : "empty",
            count: items.length,
          });
          return { status: items.length ? "ok" : "empty", playlists: items };
        }
        case "catalog.playlistTracks": {
          const id = String(args.playlistId || "");
          if (!playlistIds.has(id)) throw new Error("unverified_playlist");
          const data = await request("/playlist/track/all", {
            id,
            limit,
            offset: 0,
          });
          if (!Array.isArray(data.songs))
            throw new Error("invalid_playlist_tracks_shape");
          rows = data.songs;
          provenance = {
            source: "playlist",
            playlistId: id,
            query: String(args.query || "").slice(0, 80),
          };
          break;
        }
        case "catalog.artistSongs": {
          const id = String(args.artistId || "");
          if (!artistIds.has(id)) throw new Error("unverified_artist");
          const data = await request("/artist/songs", {
            id,
            limit,
            offset: 0,
            order: "hot",
          });
          if (!Array.isArray(data.songs))
            throw new Error("invalid_artist_shape");
          rows = data.songs;
          provenance = { source: "artist", artistId: id };
          break;
        }
        default:
          throw new Error("tool_not_allowed");
      }
      rows = rows.slice(0, limit);
      mergeCandidates(
        pool,
        rows,
        { ...provenance, retrievedAt: new Date(context.now).toISOString() },
        context
      );
      rows.forEach((t) => knownIds.add(String(t.id)));
      status = rows.length ? "ok" : "empty";
      sources.push({ tool, status, count: rows.length });
      return { status, ids: rows.map((t) => String(t.id)), count: rows.length };
    } catch (error) {
      status = error.status || "error";
      sources.push({
        tool: String(tool || "unknown").slice(0, 80),
        status,
        reason: error.message,
        count: 0,
      });
      return { status, error: error.message };
    }
  }
  async function resolveArtist(queryText) {
    const data = await request("/cloudsearch", {
      keywords: queryText,
      type: 100,
      limit: 5,
    });
    // Punctuation is meaningful for entity identity ("周杰伦." is another account).
    const exact = (value) =>
      String(value || "")
        .normalize("NFKC")
        .trim()
        .toLowerCase();
    const allArtists = data.result?.artists || [];
    let artists = allArtists.filter((a) => exact(a.name) === exact(queryText));
    if (!artists.length)
      artists = allArtists.filter((a) =>
        (a.alias || []).some((alias) => exact(alias) === exact(queryText))
      );
    artists = [...new Map(artists.map((a) => [String(a.id), a])).values()];
    if (artists.length > 1) {
      const known = artists.filter((a) =>
        context.knownArtists?.has(String(a.id))
      );
      if (known.length === 1) artists = known;
    }
    if (artists.length !== 1)
      return { status: artists.length ? "ambiguous" : "empty" };
    const artist = artists[0];
    artistIds.add(String(artist.id));
    return { status: "ok", artistId: String(artist.id), name: artist.name };
  }
  async function verifyPlaylist(id) {
    if (!/^\d{1,30}$/.test(id)) return { status: "error" };
    const data = await request("/playlist/detail", { id, s: 0 });
    if (String(data.playlist?.id) !== id) return { status: "error" };
    playlistIds.add(id);
    return {
      status: "ok",
      id,
      name: String(data.playlist.name || "").slice(0, 120),
    };
  }
  return { execute, resolveArtist, verifyPlaylist, sources, request };
}
