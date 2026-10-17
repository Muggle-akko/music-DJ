import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecommendationFeed} from '../public/recommendation-feed.mjs';
const now=Date.now(),plan=id=>({id,createdAt:new Date(now).toISOString(),tracks:[]});
function fixture(overrides={}) {
 const renders=[],states=[];
 const feed=createRecommendationFeed({now:()=>now,readCache:async()=>null,writeCache:async()=>{},render:p=>renders.push(p),state:s=>states.push(s),...overrides});
 return {feed,renders,states};
}
test('one request serves concurrent refreshes; entering loaded feed does not poll',async()=>{
 let calls=0,resolve;
 const {feed}=fixture({load:()=>{calls++;return new Promise(r=>resolve=r);}});
 const first=feed.refresh();assert.equal(first,feed.refresh());
 resolve({plans:[plan('a')],plansVersion:'v1'});await first;
 await feed.open();await feed.open();assert.equal(calls,1);
 assert.equal(feed.plans[0].id,'a');
});
test('cached plans survive failure, expire after three days, and retry explicitly',async()=>{
 let online=false;
 const {feed,states}=fixture({readCache:async()=>({plans:[plan('a'),{...plan('old'),createdAt:new Date(now-4*86400000).toISOString()}],version:'v1'}),load:async()=>{if(!online)throw Error('offline');return {plans:[plan('b')],plansVersion:'v2'};}});
 await feed.restore();assert.deepEqual(feed.plans.map(p=>p.id),['a']);
 assert.equal(await feed.refresh(),false);assert.ok(states.at(-1).error);assert.equal(feed.plans[0].id,'a');
 online=true;assert.equal(await feed.open(),true);assert.equal(feed.plans[0].id,'b');
});
test('slow cache cannot replace a newer server response',async()=>{
 let resolve;
 const {feed}=fixture({readCache:()=>new Promise(r=>resolve=r),load:async()=>({plans:[plan('new')],plansVersion:'new'})});
 const restoring=feed.restore();await feed.refresh();resolve({plans:[plan('old')],version:'old'});await restoring;
 assert.equal(feed.plans[0].id,'new');
});
test('unchanged version keeps rows; local cache writes are optional',async()=>{
 let calls=0;
 const {feed}=fixture({load:async version=>{calls++;if(calls===1)return {plans:[plan('a')],plansVersion:'v1'};assert.equal(version,'v1');return {plansUnchanged:true,plansVersion:'v1'};},writeCache:async()=>{throw Error('storage unavailable');}});
 assert.equal(await feed.refresh(),true);assert.equal(await feed.refresh(),true);assert.equal(feed.plans[0].id,'a');
});
test('cache arriving during request keeps refresh busy',async()=>{
 let resolve;
 const {feed,states}=fixture({readCache:async()=>({plans:[plan('a')]}),load:()=>new Promise(r=>resolve=r)});
 const fetching=feed.refresh();await feed.restore();assert.equal(states.at(-1).loading,true);
 resolve({plans:[],plansVersion:'empty'});await fetching;assert.equal(states.at(-1).loading,false);
});
