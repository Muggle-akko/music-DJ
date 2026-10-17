import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicReadCache,isIndependentMusicRead} from '../lib/music-read.mjs';
import {cloudRequest} from '../lib/cloud-request.mjs';

test('only exact GET artwork and lyric routes bypass the metadata transaction',async()=>{
  for(const url of ['/api/music/cover?url=x','/api/music/lyric?id=1']) {
    assert.equal(isIndependentMusicRead({method:'GET',url}),true);
    assert.equal(isIndependentMusicRead({method:'POST',url}),false);
    let handled=false;
    await cloudRequest({method:'GET',url},{},async()=>{handled=true;},{before(){throw new Error('must not acquire writer');},after(){throw new Error('must not persist runtime');}});
    assert.equal(handled,true);
  }
  for(const url of ['/api/music/lyric/extra','/api/music/account','/api/queue','/api/access/logout'])assert.equal(isIndependentMusicRead({method:'GET',url}),false);
});
test('resource requests coalesce, expire and do not cache failures',async()=>{
  let now=0,calls=0,release;
  const get=createMusicReadCache({ttlMs:10,now:()=>now});
  const load=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const a=get('cover',load),b=get('cover',load);await Promise.resolve();
  assert.equal(calls,1);release({status:200,body:Buffer.from('image')});
  assert.equal(await a,await b);await get('cover',load);assert.equal(calls,1);
  now=10;await get('cover',async()=>{calls++;return {status:502};});assert.equal(calls,2);
  await assert.rejects(get('cover',async()=>{throw new Error('offline');}));
  const recovered=await get('cover',async()=>({status:200,body:'recovered'}));assert.equal(recovered.body,'recovered');
});
test('resource cache respects entry and byte bounds with least recently used eviction',async()=>{
  const get=createMusicReadCache({maxEntries:2,maxBytes:6});let calls=0;
  const load=async()=>{calls++;return {status:200,body:'123'};};
  await get('a',load);await get('b',load);await get('a',load);await get('c',load);
  assert.equal(calls,3);await get('b',load);assert.equal(calls,4);
  await get('large',async()=>({status:200,body:'1234567'}));
  const retry=await get('large',async()=>({status:200,body:'fresh'}));assert.equal(retry.body,'fresh');
});
