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
    queueConflict:false, queue: [], currentIndex: -1, currentTrack: null, MAX_QUEUE: 200, PLAYLIST_RECOMMENDATION_LIMIT: 30,
    audio: { paused:true, currentTime:12, addEventListener() {}, pause() {}, removeAttribute() {}, load() {} }, cancelVoicePipeline() {}, syncQueueTabs() {},
    renderCount: 0, notices: [],
    normalizeClientTrack: value => ({ ...value }), isPlayable: value => value.playable && !!value.url,
    syncQueuePageToCurrent() {}, renderQueue() {}, persistQueue() {}, refreshResultActions() {}, closeQueueMenus() {},
    showNotice(text,action) { context.notices.push(text); context.noticeAction=action; },
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
  vm.runInContext(['trackKey', 'bindTrackRow', 'addPlayableTracks', 'scheduleNextTrack', 'replaceQueueWithTracks', 'applyRecommendationPlan', 'loadPlaylistTracks', 'loadUserPlaylists'].map(functionSource).join('\n'), context);
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


test('queue replacement can restore a paused queue without replacing a later edit',()=>{
 const h=harness();h.queue=['a','b'].map(track);h.currentIndex=1;h.currentTrack=h.queue[1];
 h.replaceQueueWithTracks([track('c')]);assert.equal(h.queue[0].id,'c');
 h.noticeAction.run();assert.equal(h.queue.map(t=>t.id).join(','),'a,b');assert.equal(h.currentTrack.id,'b');assert.equal(h.audio.src,'/stream/b');
 h.replaceQueueWithTracks([track('c')]);const undo=h.noticeAction;h.addPlayableTracks([track('d')]);undo.run();
 assert.equal(h.queue.map(t=>t.id).join(','),'c,d');assert.match(h.notices.at(-1),/再次改变/);
});

test('a detached add-button icon cannot bubble into row playback',()=>{
 const h=harness();let click,plays=0;
 const row={dataset:{},classList:{add(){}},addEventListener:(type,fn)=>{click=fn;}};
 h.bindTrackRow(row,track('a'),()=>{plays++;});
 const detachedSvg={matches:()=>false},button={matches:selector=>selector.includes('button')};
 click({composedPath:()=>[detachedSvg,button,row]});assert.equal(plays,0);
 click({composedPath:()=>[{matches:()=>false},row]});assert.equal(plays,1);
});

function lyricHarness(getJson) {
  const h={currentTrack:track('1'),trackKey:t=>t.id,lyricRequestToken:0,currentLyricTrackKey:'',lyricCache:new Map(),
    lyricAbortController:null,lyricLoading:false,currentLyrics:[],getJson,AbortController,AbortSignal,
    setTimeout:fn=>setTimeout(fn,0),clearTimeout,parseLrc:text=>text?[text]:[],resetLyricsDisplay:text=>{h.message=text;},updateLyricsDisplay(){}};
  vm.createContext(h);vm.runInContext(functionSource('loadCurrentLyrics'),h);return h;
}
test('temporary lyric failure retries and only successful results are cached',async()=>{
  let calls=0;
  const h=lyricHarness(async()=>{if(++calls<3)throw new Error('temporary');return {lyric:'recovered'};});
  await h.loadCurrentLyrics();assert.equal(calls,3);assert.equal(h.currentLyrics[0],'recovered');assert.equal(h.lyricCache.has('1'),true);
  const failed=lyricHarness(async()=>{throw new Error('offline');});await failed.loadCurrentLyrics();
  assert.equal(failed.lyricCache.has('1'),false);assert.match(failed.message,/加载失败/);
  failed.getJson=async()=>({lyric:'online again'});await failed.loadCurrentLyrics();assert.equal(failed.currentLyrics[0],'online again');
});
test('changing tracks cancels the previous lyric request and rejects its late response',async()=>{
  let release,signal;
  const h=lyricHarness(async(url,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});});
  const old=h.loadCurrentLyrics();h.currentTrack=track('2');h.getJson=async()=>({lyric:'new song'});
  await h.loadCurrentLyrics();assert.equal(signal.aborted,true);release({lyric:'old song'});await old;
  assert.equal(h.currentLyrics[0],'new song');assert.equal(h.lyricCache.has('1'),false);
});
test('cover failures retry twice without replacing the image or retrying detached nodes',()=>{
  const jobs=[],image={matches:()=>true,dataset:{},style:{},src:'https://radio.example/api/music/cover?url=x',isConnected:true};
  const h={URL,location:{origin:'https://radio.example'},setTimeout:fn=>jobs.push(fn)};
  vm.createContext(h);vm.runInContext(functionSource('retryCover'),h);
  h.retryCover(image);h.retryCover(image);assert.equal(jobs.length,1);jobs.shift()();assert.match(image.src,/coverRetry=1/);
  h.retryCover(image);jobs.shift()();assert.match(image.src,/coverRetry=2/);
  h.retryCover(image);assert.equal(jobs.length,0);
  const detached={...image,dataset:{},style:{},isConnected:false};const src=detached.src;
  h.retryCover(detached);jobs.shift()();assert.equal(detached.src,src);
});

function startupQueueHarness(getJson) {
  const local=track('recent');
  const h={getJson,AbortSignal,queueMutationVersion:0,queueDirty:false,queueConflict:false,cloudQueueReady:false,
    serverQueueRevision:0,queue:[local],currentIndex:0,currentTrack:local,localPlaybackPreview:true,MAX_QUEUE:200,
    audio:{paused:false,currentTime:18,currentSrc:'blob:cached'},isPlayable:t=>t.playable,
    normalizeClientTrack:t=>({...t}),trackKey:t=>t?.id,trimQueueKeepingCurrent:items=>items,
    resolvePlayableIndex:items=>items.length?0:-1,saveQueueFallback(){},syncQueuePageToCurrent(){},renderCurrentTrack(){},renderQueue(){},
    startupMessage:text=>{h.message=text;},document:{querySelector:()=>h.conflictPanel},conflictPanel:{hidden:true}};
  vm.createContext(h);vm.runInContext(functionSource('restoreCloudQueue'),h);return h;
}
test('initial cloud synchronization keeps the recent cached song and does not interrupt playback',async()=>{
  const h=startupQueueHarness(async()=>({revision:4,currentIndex:0,queue:[track('cloud')]}));
  await h.restoreCloudQueue();
  assert.equal(h.currentTrack.id,'recent');assert.equal(h.queue.length,2);assert.equal(h.audio.paused,false);assert.equal(h.audio.currentTime,18);
  assert.equal(h.serverQueueRevision,4);assert.equal(h.cloudQueueReady,true);
});
test('late startup reads do not overwrite user edits made while the cloud was loading',async()=>{
  let release;
  const h=startupQueueHarness(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.restoreCloudQueue();h.queueMutationVersion++;h.queue=[track('user-edit')];h.queueDirty=true;
  release({revision:5,queue:[track('cloud')],currentIndex:0});await pending;
  assert.equal(h.queue[0].id,'user-edit');assert.equal(h.queueConflict,true);assert.equal(h.conflictPanel.hidden,false);
});
test('a failed startup read leaves the recent cached song ready to play',async()=>{
  const h=startupQueueHarness(async()=>{throw new Error('offline');});
  await h.restoreCloudQueue();assert.equal(h.currentTrack.id,'recent');assert.equal(h.cloudQueueReady,false);assert.match(h.message,/本机/);
});
test('playing a cached track invokes audio.play inside the original click gesture',async()=>{
  const calls=[];
  const h={playbackAttempt:0,failedPlaybackTracks:new Set(),clearTrackLoading(){},startTrackLoading(){},queue:[track('1')],trackKey:t=>t.id,isPlayable:()=>true,cloudQueueReady:true,playMode:'single',recentPlayback:{sourceFor:()=> 'blob:cached'},
    cancelVoicePipeline(){},listeningController:null,crypto:{randomUUID:()=> 'session'},syncQueuePageToCurrent(){},renderCurrentTrack(){},renderQueue(){},persistQueue(){},
    sourceValue:{},translateSource:()=> '网易云',audio:{play(){calls.push('play');return Promise.resolve();}},maybeStartHostIntroVoice(){},scheduleHostIntroVoiceCheck(){}};
  vm.createContext(h);vm.runInContext(functionSource('playTrack'),h);
  const playing=h.playTrack(0);assert.deepEqual(calls,['play']);assert.equal(h.audio.src,'blob:cached');await playing;
});


test('stored recommendation replaces upcoming tracks without touching loaded audio',async()=>{
 const h=harness();h.queue=['a','b','c'].map(track);h.currentIndex=1;h.currentTrack=h.queue[1];h.audio.currentSrc='/stream/b';
 const current=h.currentTrack;
 await h.applyRecommendationPlan({tracks:['b','d','d','e'].map(track)},'replace_upcoming','keep');
 assert.equal(h.queue.map(t=>t.id).join(','),'b,d,e');assert.equal(h.currentTrack,current);assert.equal(h.currentIndex,0);assert.equal(h.renderCount,0);
});
test('stored recommendations play through local queue and append without remote player registration',async()=>{
 const h=harness();let played=null;h.playTrack=async index=>{played=h.queue[index].id;};
 await h.applyRecommendationPlan({tracks:['a','b'].map(track)},'replace_all','play_first');assert.equal(played,'a');
 await h.applyRecommendationPlan({tracks:['b','c'].map(track)},'append','keep');assert.equal(h.queue.map(t=>t.id).join(','),'a,b,c');assert.equal(played,'a');
});

function playbackFailureHarness() {
  const h={queue:['a','b','c'].map(track),currentIndex:0,playbackAttempt:1,failedPlaybackAttempt:-1,failedPlaybackTracks:new Set(),
    notices:[],messages:[],paused:0,played:[],clearTrackLoading(){},stopSpectrumMeter(){},cancelVoicePipeline(){},renderQueue(){},setPlayState(){},
    audio:{pause(){h.paused++;}},startupMessage:text=>h.messages.push(text),showNotice:text=>h.notices.push(text),isPlayable:t=>t.playable,
    playTrack:index=>{h.played.push(index);h.currentIndex=index;h.currentTrack=h.queue[index];h.playbackAttempt++;}};
  h.currentTrack=h.queue[0];vm.createContext(h);
  vm.runInContext(['trackKey','findNextPlayableIndex','handleTrackFailure'].map(functionSource).join('\n'),h);return h;
}
test('unavailable tracks are skipped once and an entirely unavailable queue stops',()=>{
  const h=playbackFailureHarness();
  h.handleTrackFailure();h.handleTrackFailure();h.handleTrackFailure();h.handleTrackFailure();
  assert.deepEqual(h.played,[1,2]);assert.equal(h.failedPlaybackTracks.size,3);assert.equal(h.paused,1);
  assert.match(h.messages.at(-1),/已暂停/);assert.equal(h.findNextPlayableIndex(2),-1);
});
test('loading feedback escalates for slow requests, times out, and ignores cleared timers',()=>{
  let serial=0;const timers=new Map(),messages=[],failures=[];
  const h={trackSlowTimer:0,trackLoadTimer:0,activeTrackLoad:null,currentTrack:track('a'),playbackAttempt:1,trackKey:t=>t.id,
    audio:{paused:false,readyState:0},playButton:{setAttribute(){},removeAttribute(){}},startupMessage:text=>messages.push(text),handleTrackFailure:reason=>failures.push(reason),
    setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(h);vm.runInContext(['clearTrackLoading','startTrackLoading'].map(functionSource).join('\n'),h);
  h.startTrackLoading();assert.match(messages.at(-1),/正在加载/);assert.equal(timers.size,2);
  const slow=[...timers.values()].find(t=>t.ms===4000),timeout=[...timers.values()].find(t=>t.ms===25000);
  slow.fn();assert.match(messages.at(-1),/网络响应较慢/);timeout.fn();assert.deepEqual(failures,['加载超时']);
  h.clearTrackLoading();assert.equal(timers.size,0);slow.fn();timeout.fn();assert.equal(messages.at(-1),'');assert.equal(failures.length,1);
});
test('browser autoplay restrictions prompt for a click without marking the song unavailable',async()=>{
  let failed=0;const messages=[];
  const h={playbackAttempt:0,failedPlaybackTracks:new Set(),clearTrackLoading(){},startTrackLoading(){},queue:[track('a')],trackKey:t=>t.id,isPlayable:()=>true,cloudQueueReady:false,
    playMode:'list',recentPlayback:{sourceFor:()=>null},cancelVoicePipeline(){},listeningController:null,crypto:{randomUUID:()=> 's'},syncQueuePageToCurrent(){},renderCurrentTrack(){},renderQueue(){},
    sourceValue:{},translateSource:()=> '网易云',audio:{play:async()=>{throw Object.assign(new Error('gesture'),{name:'NotAllowedError'});}},
    handleTrackFailure:()=>failed++,setPlayState(){},startupMessage:text=>messages.push(text)};
  vm.createContext(h);vm.runInContext(functionSource('playTrack'),h);await h.playTrack(0);
  assert.equal(failed,0);assert.match(messages.at(-1),/点击播放/);
});
test('starting a recommendation does not wait for slow audio before confirming its local queue change',async()=>{
  const h=harness();let started=false;
  h.playTrack=()=>{started=true;return new Promise(()=>{});};
  const result=await h.applyRecommendationPlan({tracks:[track('a')]},'replace_all','play_first');
  assert.equal(started,true);assert.equal(result.changed,true);assert.equal(result.count,1);assert.equal(h.queue[0].id,'a');
});
