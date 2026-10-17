import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanActions} from '../public/plan-actions.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('enqueue happens immediately, duplicate clicks share one action, and success waits for cloud confirmation',async()=>{
  let applied=0,release;
  const stages=[];
  const actions=createPlanActions({getPlan:()=>({tracks:[{id:'1'}]}),applyLocal:()=>{applied++;return {changed:true,count:1};},save:()=>new Promise(resolve=>{release=resolve;})});
  actions.subscribe('p',state=>stages.push(state.stage));
  const pending=actions.run('p','append','keep');
  assert.equal(applied,1);
  assert.equal(actions.run('p','append','keep'),pending);
  await tick();assert.equal(actions.state('p').stage,'saving');
  release(true);await pending;
  assert.deepEqual(stages,['applying','saving','complete']);
  assert.match(actions.state('p').text,/云端已保存/);
});
test('failed sync retains local songs and retries only persistence',async()=>{
  let applied=0,saves=0;
  const actions=createPlanActions({getPlan:()=>({}),applyLocal:()=>{applied++;return {count:2};},save:async()=>++saves>1});
  await actions.run('p','append','keep');
  assert.equal(actions.state('p').stage,'pending_sync');
  const restored=[];const unsubscribe=actions.subscribe('p',state=>restored.push(state.stage));
  await actions.run('p','append','keep');unsubscribe();
  assert.equal(applied,1);assert.equal(saves,2);
  assert.deepEqual(restored,['pending_sync','saving','complete']);
});
test('local rejection reports failure and an unchanged queue does not write to cloud',async()=>{
  let saves=0;
  const actions=createPlanActions({getPlan:()=>({}),applyLocal:()=>{throw new Error('队列已满');},save:()=>{saves++;}});
  await actions.run('p','append','keep');assert.equal(actions.state('p').stage,'error');assert.match(actions.state('p').text,/队列已满/);assert.equal(saves,0);
  const noChange=createPlanActions({getPlan:()=>({}),applyLocal:()=>({changed:false,message:'已在队列中'}),save:()=>{saves++;}});
  await noChange.run('p','append','keep');assert.equal(noChange.state('p').stage,'complete');assert.equal(saves,0);
});
test('slow cloud sync explains that local songs remain usable',async()=>{
  let release;
  const actions=createPlanActions({getPlan:()=>({}),applyLocal:()=>({count:1}),save:()=>new Promise(resolve=>{release=resolve;}),slowAfterMs:1});
  const pending=actions.run('p','append','keep');
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.match(actions.state('p').text,/同步较慢.*可继续播放/);
  release(true);await pending;
});
