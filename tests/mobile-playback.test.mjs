import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileClient, mobileRequest } from '../public/device-policy.mjs';
import { createMediaSession } from '../public/media-session.mjs';

test('mobile policy includes iPad desktop UA and server-side explicit device headers',()=>{
  assert.equal(isMobileClient({userAgent:'Mozilla/5.0 (iPhone)'}),true);
  assert.equal(isMobileClient({userAgent:'Mozilla/5.0 (Macintosh)',platform:'MacIntel',maxTouchPoints:5}),true);
  assert.equal(isMobileClient({userAgent:'Mozilla/5.0 (Macintosh)',platform:'MacIntel',maxTouchPoints:0}),false);
  assert.equal(mobileRequest({headers:{'x-awudio-client':'mobile','user-agent':'Macintosh'}}),true);
});

test('native media session reports buffering and recovers without false playing state',()=>{
  const saved=new Map(['navigator','window','document','localStorage','MediaMetadata'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  try{
    const handlers=new Map(),session={setActionHandler:(k,v)=>handlers.set(k,v),setPositionState:()=>{}};
    const win=new EventTarget(),doc=new EventTarget();doc.hidden=false;win.MediaMetadata=class{constructor(v){Object.assign(this,v);}};
    for(const [key,value] of Object.entries({navigator:{mediaSession:session,audioSession:{}},window:win,document:doc,localStorage:{getItem:()=>null,setItem:()=>{}},MediaMetadata:win.MediaMetadata}))Object.defineProperty(globalThis,key,{value,configurable:true});
    const audio=new EventTarget();Object.assign(audio,{currentSrc:'/song',currentTime:12,duration:180,playbackRate:1,paused:false,ended:false});
    const state=createMediaSession({audio,getTrack:()=>({id:'1',provider:'netease',title:'Fixture'}),next:()=>{},previous:()=>{},notice:()=>{}});
    state.update();assert.equal(session.playbackState,'playing');
    audio.readyState=4;audio.dispatchEvent(new Event('stalled'));assert.equal(state.buffering,false);assert.equal(session.playbackState,'playing');
    audio.dispatchEvent(new Event('waiting'));assert.equal(state.buffering,true);assert.equal(session.playbackState,'paused');
    audio.dispatchEvent(new Event('playing'));assert.equal(state.buffering,false);assert.equal(session.playbackState,'playing');
    audio.paused=true;audio.dispatchEvent(new Event('pause'));assert.equal(session.playbackState,'paused');
    assert.equal(navigator.audioSession.type,'playback');assert.ok(handlers.has('nexttrack'));
  }finally{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
