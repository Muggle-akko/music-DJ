import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseEnvelope,envelopeLevel,createTrackWaveform} from '../public/waveform.mjs';
function fixture(values){return {numberOfChannels:2,sampleRate:100,length:values.length,getChannelData:channel=>Float32Array.from(values,n=>channel ? -n:n)};}
test('waveform follows measured signal, preserves stereo power, silence and volume',()=>{
  const envelope=analyseEnvelope(fixture([...Array(100).fill(0),...Array(100).fill(0.5)]),0.1);
  assert.equal(envelopeLevel(envelope,0.5,0,1),6);
  assert.ok(envelopeLevel(envelope,1.8,0,1)>70);
  assert.equal(envelopeLevel(envelope,1.8,0,1,1,true),6);
  assert.equal(envelopeLevel(envelope,1.8,0,1,0),6);
  assert.ok(envelopeLevel(envelope,1.8,0,1,0.5)<envelopeLevel(envelope,1.8,0,1,1));
});
test('independent analysis caches small envelopes and handles unavailable/oversized audio without playback side effects',async()=>{
  let calls=0,decodes=0;
  const waveform=createTrackWaveform({fetchAudio:async url=>{calls++;return new Response(new Uint8Array([1,2]),{headers:{'content-type':'audio/mpeg',...(url==='large'?{'content-length':String(33*1024*1024)}:{})}});},decode:async()=>{decodes++;return fixture(Array(200).fill(0.5));}});
  await waveform.load('song');assert.equal(waveform.ready,true);
  await waveform.load('song');assert.equal(calls,1);assert.equal(decodes,1);
  await waveform.load('large');assert.equal(waveform.ready,false);assert.equal(decodes,1);
  await waveform.load('song');assert.equal(waveform.ready,true);assert.equal(calls,2);
  const failed=createTrackWaveform({retryDelayMs:0,fetchAudio:async()=>{throw new Error('offline');}});
  await failed.load('song');assert.equal(failed.ready,false);assert.equal(failed.level(1,0,36),6);
});
test('a late decoder result cannot replace a newer song analysis',async()=>{
  let release,started;
  const signal=new Promise(r=>{started=r;});
  const waveform=createTrackWaveform({fetchAudio:async()=>new Response(new Uint8Array([1]),{headers:{'content-type':'audio/mpeg'}}),decode:()=>new Promise(resolve=>{release=resolve;started();})});
  const old=waveform.load('old');await signal;waveform.abort();release(fixture(Array(100).fill(0.8)));await old;
  assert.equal(waveform.ready,false);
});
test('transient analysis failures retry while playback is uninterrupted',async()=>{
  let calls=0;
  const waveform=createTrackWaveform({retryDelayMs:0,fetchAudio:async()=>{
    if(++calls===1)return new Response('temporary',{status:503});
    if(calls===2)throw new TypeError('network reset');
    return new Response(new Uint8Array([1]),{headers:{'content-type':'application/octet-stream','content-length':String(20*1024*1024)}});
  },decode:async()=>fixture(Array(200).fill(0.5))});
  await waveform.load('song');assert.equal(calls,3);assert.equal(waveform.ready,true);
});
test('mobile analysis produces measured bars before the download finishes',async()=>{
  let finishDownload,previewReady;
  const preview=new Promise(resolve=>{previewReady=resolve;});
  const waveform=createTrackWaveform({fetchAudio:async()=>new Response(new ReadableStream({start(controller){
    controller.enqueue(new Uint8Array(512*1024));finishDownload=()=>{controller.enqueue(new Uint8Array([1]));controller.close();};
  }}),{headers:{'content-type':'audio/mpeg'}}),decode:async bytes=>{
    if(bytes.byteLength===512*1024)previewReady();
    return fixture(Array(200).fill(0.5));
  }});
  const job=waveform.load('song');await preview;await Promise.resolve();
  assert.equal(waveform.ready,true);assert.ok(waveform.level(1,0,36)>6);
  finishDownload();await job;
});
test('a container that cannot decode prefixes still analyses the completed track',async()=>{
  let calls=0;
  const waveform=createTrackWaveform({fetchAudio:async()=>new Response(new Uint8Array(512*1024),{headers:{'content-type':'audio/flac'}}),decode:async()=>{
    if(++calls===1)throw new Error('incomplete container');
    return fixture(Array(200).fill(0.5));
  }});
  await waveform.load('song');assert.equal(calls,2);assert.equal(waveform.ready,true);
});
test('aborting a retry cancels further requests, and a later load can recover',async()=>{
  let calls=0,failed;
  const failure=new Promise(resolve=>{failed=resolve;});
  const waveform=createTrackWaveform({retryDelayMs:10000,fetchAudio:async()=>{
    calls++;if(calls===1){failed();throw new Error('offline');}
    return new Response(new Uint8Array([1]),{headers:{'content-type':'audio/mpeg'}});
  },decode:async()=>fixture(Array(200).fill(0.5))});
  const job=waveform.load('song');await failure;waveform.abort();await job;
  assert.equal(calls,1);assert.equal(waveform.ready,false);
  await waveform.load('song');assert.equal(calls,2);assert.equal(waveform.ready,true);
});
test('switching songs during a download discards stale previews',async()=>{
  let release,started;
  const preview=new Promise(resolve=>{started=resolve;});
  const waveform=createTrackWaveform({fetchAudio:async url=>new Response(new Uint8Array(url==='old'?512*1024:1),{headers:{'content-type':'audio/mpeg'}}),decode:async bytes=>{
    if(bytes.byteLength>1){started();return new Promise(resolve=>{release=resolve;});}
    return fixture(Array(200).fill(0));
  }});
  const old=waveform.load('old');await preview;
  await waveform.load('new');release(fixture(Array(200).fill(0.8)));await old;
  assert.equal(waveform.ready,true);assert.equal(waveform.level(1,0,36),6);
});
test('completed mobile waveform download can also populate the recent song cache',async()=>{
 const captured=[];
 const waveform=createTrackWaveform({fetchAudio:async()=>new Response(new Uint8Array([1,2]),{headers:{'content-type':'audio/mpeg'}}),decode:async()=>fixture(Array(100).fill(0.5)),onAudioLoaded:(url,bytes,type)=>captured.push({url,bytes:[...bytes],type})});
 await waveform.load('/song');assert.deepEqual(captured,[{url:'/song',bytes:[1,2],type:'audio/mpeg'}]);
});
