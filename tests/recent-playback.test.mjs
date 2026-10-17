import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecentPlayback} from '../public/recent-playback.mjs';
function fixture(options={}){
 const rows=new Map(),stores=new Map();
 const storage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 const caches={async delete(k){return stores.delete(k);},async open(k){if(!stores.has(k))stores.set(k,new Map());const store=stores.get(k);return{async match(url){return store.get(url)?.clone();},async put(url,response){store.set(url,response.clone());}};}};
 let now=1000;const revoked=[],created=[];
 const recent=createRecentPlayback({storage,caches,origin:'https://fixture.example',now:()=>now,createURL:blob=>{created.push(blob);return 'blob:fixture-'+created.length;},revokeURL:url=>revoked.push(url),...options});
 return{recent,rows,stores,created,revoked,setTime:value=>now=value};
}
const song=id=>({id,provider:'netease',title:`Song ${id}`,playable:true,url:`/api/music/stream?id=${id}&full=1`});
test('last song and progress survive reopening without a cloud request',async()=>{
 const f=fixture();await f.recent.useScope('123');f.recent.remember(song('1'),38,{force:true});
 assert.equal(f.recent.read().position,38);assert.equal(f.recent.read().track.id,'1');
 assert.equal(await f.recent.storeBytes(song('1').url,new Uint8Array([1,2,3]),'audio/mpeg'),true);
 assert.equal(await f.recent.cachedSource(song('1')),'blob:fixture-1');assert.equal(f.created[0].size,3);
 assert.equal(await f.recent.cachedSource(song('1')),'blob:fixture-1');assert.equal(f.created.length,1);
});
test('only one track is cached; stale downloads, other origins and accounts cannot be played',async()=>{
 const f=fixture();await f.recent.useScope('123');f.recent.remember(song('1'),12,{force:true});
 await f.recent.storeBytes(song('1').url,new Uint8Array([1]));await f.recent.cachedSource(song('1'));
 f.recent.remember(song('2'),0,{force:true});
 assert.equal(await f.recent.storeBytes(song('1').url,new Uint8Array([1])),false);
 assert.equal(await f.recent.storeBytes('https://other.example/api/music/stream?id=2',new Uint8Array([1])),false);
 assert.equal(await f.recent.cachedSource(song('2')),'');
 await f.recent.storeBytes(song('2').url,new Uint8Array([2]));assert.equal((await f.recent.cachedSource(song('2'))).startsWith('blob:'),true);
 assert.equal([...f.stores.values()][0].size,1);
 await f.recent.useScope('456');assert.equal(f.recent.read(),null);assert.equal(f.stores.size,0);assert.ok(f.revoked.length);
});
test('cache clear, expiry and unavailable storage leave network playback usable',async()=>{
 const f=fixture();await f.recent.useScope('123');f.recent.remember(song('1'),15,{force:true});
 f.setTime(8*86400000);assert.equal(f.recent.read(),null);
 await f.recent.clear();assert.equal(f.rows.size,0);
 const broken=createRecentPlayback({storage:{getItem(){throw new Error('denied');}},caches:{open(){throw new Error('denied');}},origin:'https://fixture.example'});
 assert.equal(broken.read(),null);await broken.useScope('123');broken.remember(song('1'),0);assert.equal(await broken.cachedSource(song('1')),'');
});
test('only complete successful audio is cached, not range fragments or login errors',async()=>{
 for(const response of [new Response('partial',{status:206,headers:{'Content-Type':'audio/mpeg','Content-Range':'bytes 0-6/100'}}),new Response('login',{status:401}),new Response('html',{headers:{'Content-Type':'text/html'}})]){
  const f=fixture({fetchAudio:async()=>response});await f.recent.useScope('123');f.recent.remember(song('1'),0,{force:true});
  await f.recent.cacheTrack(song('1'));assert.equal(await f.recent.cachedSource(song('1')),'');
 }
 const f=fixture({fetchAudio:async()=>new Response(new Uint8Array([1,2]),{headers:{'Content-Type':'audio/mpeg'}})});
 await f.recent.useScope('123');f.recent.remember(song('1'),0,{force:true});await f.recent.cacheTrack(song('1'));assert.ok(await f.recent.cachedSource(song('1')));
});
