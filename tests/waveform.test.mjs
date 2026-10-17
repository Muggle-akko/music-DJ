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
  const waveform=createTrackWaveform({fetchAudio:async url=>{calls++;return new Response(new Uint8Array([1,2]),{headers:{'content-type':'audio/mpeg',...(url==='large'?{'content-length':String(13*1024*1024)}:{})}});},decode:async()=>{decodes++;return fixture(Array(200).fill(0.5));}});
  await waveform.load('song');assert.equal(waveform.ready,true);
  await waveform.load('song');assert.equal(calls,1);assert.equal(decodes,1);
  await waveform.load('large');assert.equal(waveform.ready,false);assert.equal(decodes,1);
  await waveform.load('song');assert.equal(waveform.ready,true);assert.equal(calls,2);
  const failed=createTrackWaveform({fetchAudio:async()=>{throw new Error('offline');}});
  await failed.load('song');assert.equal(failed.ready,false);assert.equal(failed.level(1,0,36),6);
});
test('a late decoder result cannot replace a newer song analysis',async()=>{
  let release,started;
  const signal=new Promise(r=>{started=r;});
  const waveform=createTrackWaveform({fetchAudio:async()=>new Response(new Uint8Array([1]),{headers:{'content-type':'audio/mpeg'}}),decode:()=>new Promise(resolve=>{release=resolve;started();})});
  const old=waveform.load('old');await signal;waveform.abort();release(fixture(Array(100).fill(0.8)));await old;
  assert.equal(waveform.ready,false);
});
