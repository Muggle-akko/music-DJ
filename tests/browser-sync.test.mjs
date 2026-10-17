import test from 'node:test';
import assert from 'node:assert/strict';
import {createDataCache} from '../public/data-cache.mjs';
import {syncDelay} from '../public/sync-policy.mjs';
import {createAgentActivity} from '../lib/agent/heartbeat.mjs';
import {buildOwnerBackup} from '../lib/backup.mjs';
function storageFixture(){
 const stores=new Map();return {async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);},async open(name){if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name),url=k=>typeof k==='string'?k:k.url;return {async match(key){return rows.get(url(key))?.clone();},async put(key,value){rows.set(url(key),value.clone());},async delete(key){return rows.delete(url(key));},async keys(){return [...rows.keys()].map(url=>new Request(url));}};}};
}
test('browser data cache is account-scoped, expires, and clears on signout',async()=>{
 let now=0;const storage=storageFixture(),cache=createDataCache({storage,now:()=>now,origin:'https://fixture.example'});
 await cache.write('/api/radios',{radios:[1]},100);assert.equal(await cache.read('/api/radios'),null,'no cache before authenticated bootstrap');
 cache.useScope('a');await cache.write('/api/radios',{radios:[1]},100);assert.deepEqual(await(await cache.read('/api/radios')).json(),{radios:[1]});
 cache.useScope('b');assert.equal(await cache.read('/api/radios'),null);
 cache.useScope('a');now=100;assert.equal(await cache.read('/api/radios'),null);
 await cache.write('/api/radios',{radios:[2]},100);await cache.clear();cache.useScope('a');assert.equal(await cache.read('/api/radios'),null);
 assert.equal(cache.ttl('/api/queue'),0);assert.equal(cache.ttl('/api/instance/agent-connection'),0);assert.equal(cache.ttl('/api/music/stream'),0);
});
test('cache bounds and failed browser storage do not block data requests',async()=>{
 const cache=createDataCache({storage:storageFixture(),origin:'https://fixture.example',maxEntries:2});cache.useScope('a');
 for(let i=0;i<3;i++)await cache.write('/api/radios?i='+i,{i},10000);
 assert.equal(await cache.read('/api/radios?i=0'),null);assert.equal((await(await cache.read('/api/radios?i=2')).json()).i,2);
 const blocked=createDataCache({storage:{open(){throw new Error('blocked');}},origin:'https://fixture.example'});blocked.useScope('a');await blocked.write('/api/radios',{},100);assert.equal(await blocked.read('/api/radios'),null);
});
test('polling stays responsive with an Agent and backs off when idle or failing',()=>{
 assert.equal(syncDelay({agents:true}),5000);assert.equal(syncDelay({agents:true,hidden:true}),10000);
 assert.equal(syncDelay({playing:true}),30000);assert.equal(syncDelay({}),60000);assert.equal(syncDelay({playing:true,hidden:true}),60000);
 assert.equal(syncDelay({hidden:true}),null);assert.equal(syncDelay({hidden:true,pending:true}),5000);
 assert.equal(syncDelay({pending:true}),5000);assert.equal(syncDelay({failures:1}),10000);assert.equal(syncDelay({failures:8}),120000);
});
test('Agent idles after five minutes and stale sessions must reconnect on next use',()=>{
 let now=0;const activity=createAgentActivity({now:()=>now});assert.equal(activity.active,false);activity.used();activity.seen();
 assert.equal(activity.active,true);assert.equal(activity.sessionFresh,true);now=55000;assert.equal(activity.sessionFresh,false);
 now=300000;assert.equal(activity.active,false);activity.used();assert.equal(activity.active,true);assert.equal(activity.sessionFresh,false);activity.seen();assert.equal(activity.sessionFresh,true);
});
test('owner backup only reads portable data paths, with explicit size and audio boundaries',async()=>{
 const paths=[],accountKey='a'.repeat(24);const backup=await buildOwnerBackup({accountKey,state:{radioHistory:[{title:'Fixture'}]},readJson:async path=>{paths.push(path);return {fixture:true};}});
 assert.equal(backup.includesCredentials,false);assert.equal(backup.includesAudio,false);assert.equal(Object.keys(backup.files).length,4);
 assert.ok(paths.every(path=>/\/(profile|feedback|song-features)\.json$/.test(path)));
 await assert.rejects(buildOwnerBackup({accountKey,state:{padding:'x'.repeat(100)},readJson:async()=>null,maxBytes:10}),/上限/);
});
