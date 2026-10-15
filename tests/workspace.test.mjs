import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `Missing ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
const track = id => ({ id, provider: 'netease', playable: true, url: `/stream/${id}`, title: id });
function harness() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', hidden: false, scrollTop: 0, setAttribute() {} });
    return nodes.get(id);
  };
  const context = {
    queue: [], currentIndex: -1, currentTrack: null, MAX_QUEUE: 200, PLAYLIST_RECOMMENDATION_LIMIT: 30,
    audio: { pause() {}, removeAttribute() {}, load() {} }, cancelVoicePipeline() {}, syncQueueTabs() {},
    renderCount: 0, notices: [],
    normalizeClientTrack: value => ({ ...value }), isPlayable: value => value.playable && !!value.url,
    syncQueuePageToCurrent() {}, renderQueue() {}, persistQueue() {}, refreshResultActions() {}, closeQueueMenus() {},
    showNotice(text) { context.notices.push(text); },
    renderCurrentTrack() { context.renderCount++; },
    resolvePlayableIndex: items => items.findIndex(item => item.playable),
    document: { querySelector: node },
    playlistRequestVersion: 0, libraryRequestVersion: 0, selectedPlaylistId: '', selectedPlaylist: null,
    playlistOffset: 0, playlistTrackOffset: 0, playlists: [], playlistTracks: [], playlistsLoaded: false,
    libraryScrollTop: 0, PAGE_LOAD_SIZE: 30, accountUserId: 'user', busyScopes: new Set(),
    playlistLibraryView: node('library'), playlistDetailView: node('detail'), playlistLibraryScroll: node('libraryScroll'),
    playlistDetailScroll: node('detailScroll'), loadPlaylistsButton: node('refresh'), moreTracksButton: node('moreTracks'),
    morePlaylistsButton: node('moreLists'), playlistSay: node('say'), playlistReason: node('reason'), playlistTrackCount: node('count'), playlistTracksList: node('tracks'),
    renderCover: () => '', escapeHtml: value => value, renderResults() {}, renderPlaylists() {},
    dedupeTracks: items => [...new Map(items.map(item => [item.id, item])).values()],
    setBusy(busy, _, scope) { if (busy) context.busyScopes.add(scope); else context.busyScopes.delete(scope); },
  };
  vm.createContext(context);
  vm.runInContext(['trackKey', 'addPlayableTracks', 'scheduleNextTrack', 'replaceQueueWithTracks', 'loadPlaylistTracks', 'loadUserPlaylists'].map(functionSource).join('\n'), context);
  return context;
}

test('adding tracks appends unique songs and leaves current playback untouched', () => {
  const h = harness();
  h.queue = [track('a'), track('b')]; h.currentIndex = 1; h.currentTrack = h.queue[1];
  const current = h.currentTrack;
  h.addPlayableTracks([track('c'), track('a'), track('c'), { ...track('blocked'), playable: false }]);
  assert.equal(h.queue.map(t => t.id).join(','), 'a,b,c');
  assert.equal(h.currentIndex, 1); assert.equal(h.currentTrack, current);
  assert.equal(h.renderCount, 0, 'adding must not rerender or reset the current track');
});
test('full queue rejects additions without evicting existing songs', () => {
  const h = harness(); h.queue = Array.from({ length: 200 }, (_, i) => track(String(i)));
  h.currentIndex = 80; h.currentTrack = h.queue[80];
  assert.equal(h.addPlayableTracks([track('new')]), 0);
  assert.equal(h.queue.length, 200); assert.equal(h.currentTrack.id, '80'); assert.equal(h.queue[0].id, '0');
});
test('next-play moves an existing earlier song without losing the current track', () => {
  const h = harness(); h.queue = ['a', 'b', 'c', 'd'].map(track); h.currentIndex = 2; h.currentTrack = h.queue[2];
  h.scheduleNextTrack(track('a'));
  assert.equal(h.queue.map(t => t.id).join(','), 'b,c,a,d');
  assert.equal(h.currentIndex, 1); assert.equal(h.queue[h.currentIndex], h.currentTrack);
  h.scheduleNextTrack(track('c'));
  assert.equal(h.queue.map(t => t.id).join(','), 'b,c,a,d');
});
test('new next-play songs insert after the current song', () => {
  const h = harness(); h.queue = ['a', 'b'].map(track); h.currentIndex = 0; h.currentTrack = h.queue[0];
  h.scheduleNextTrack(track('c'));
  assert.equal(h.queue.map(t => t.id).join(','), 'a,c,b'); assert.equal(h.currentTrack.id, 'a');
});
test('late playlist responses cannot overwrite the newest selection or its busy state', async () => {
  const h = harness(), pending = [];
  h.getJson = url => new Promise(resolve => pending.push({ url, resolve }));
  const first = h.loadPlaylistTracks({ id: 'one', name: 'one', trackCount: 30 });
  const second = h.loadPlaylistTracks({ id: 'two', name: 'two', trackCount: 30 });
  pending[0].resolve({ tracks: [track('old')] }); await first;
  assert.equal(h.playlistTracks.length, 0); assert.ok(h.busyScopes.has('tracks'));
  pending[1].resolve({ tracks: [track('new')] }); await second;
  assert.equal(h.playlistTracks[0].id, 'new'); assert.equal(h.selectedPlaylistId, 'two');
  assert.equal(h.busyScopes.has('tracks'), false);
});
test('pagination preserves old rows on failure and retries the same offset', async () => {
  const h = harness(); h.selectedPlaylistId = 'one'; h.playlistTracks = [track('a')]; h.playlistTrackOffset = 30;
  h.getJson = async () => { throw new Error('offline'); };
  await h.loadPlaylistTracks({ id: 'one', name: 'one', trackCount: 60 }, { append: true });
  assert.equal(h.playlistTracks[0].id, 'a'); assert.equal(h.playlistTrackOffset, 30);
  h.getJson = async url => { assert.match(url, /offset=30/); return { tracks: [track('b')] }; };
  await h.loadPlaylistTracks({ id: 'one', name: 'one', trackCount: 60 }, { append: true });
  assert.equal(h.playlistTracks.map(t => t.id).join(','), 'a,b');
});
test('playlist library respects upstream hasMore instead of guessing from row count', async () => {
  const h = harness(); h.getJson = async () => ({ playlists: Array.from({ length: 73 }, (_, i) => ({ id: i })), hasMore: false });
  await h.loadUserPlaylists(); assert.equal(h.playlists.length, 73); assert.equal(h.morePlaylistsButton.hidden, true);
});

test('library batch playback can exceed 30 songs while AI replacement retains its existing limit', () => {
  const h = harness(); const songs = Array.from({ length: 80 }, (_, i) => track(String(i)));
  h.replaceQueueWithTracks(songs, { fullPlaylist: true });
  assert.equal(h.queue.length, 80); assert.equal(h.currentIndex, 0);
  h.replaceQueueWithTracks(songs);
  assert.equal(h.queue.length, 30);
});
