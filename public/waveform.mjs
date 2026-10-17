// Independent offline analysis: the audible media element is never routed through Web Audio.
const MAX_BYTES=12*1024*1024;
export function analyseEnvelope(buffer, step=0.04) {
  const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i));
  const size=Math.max(1,Math.round(buffer.sampleRate*step));
  const bins=new Float32Array(Math.ceil(buffer.length/size));
  for(let bin=0;bin<bins.length;bin++) {
    let sum=0,n=0;
    for(let i=bin*size;i<Math.min(buffer.length,(bin+1)*size);i+=4)for(const channel of channels){sum+=channel[i]*channel[i];n++;}
    bins[bin]=n?Math.sqrt(sum/n):0;
  }
  const sorted=Float32Array.from(bins).sort();
  return {bins,step,reference:Math.max(0.015,sorted[Math.floor(sorted.length*0.95)] || 0)};
}
export function envelopeLevel(envelope, position, index, count, volume=1, muted=false) {
  if(!envelope || muted || volume<=0)return 6;
  const time=position-0.64+(count>1?index/(count-1):0)*1.28;
  const bin=Math.round(time/envelope.step);
  const value=bin>=0&&bin<envelope.bins.length?envelope.bins[bin]:0;
  return Math.round(6+Math.pow(Math.min(1,value/envelope.reference),0.75)*84*Math.max(0,Math.min(1,volume)));
}
export function createTrackWaveform({fetchAudio=fetch,decode}={}) {
  let source='',envelope=null,pending=null,controller,generation=0;
  const cache=new Map();
  const decodeAudio=decode || (async bytes=>{
    const Offline=window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if(!Offline)throw new Error('offline_analysis_unavailable');
    const context=new Offline(1,1,22050);
    return context.decodeAudioData(bytes);
  });
  function abort(){generation++;controller?.abort();pending=null;}
  async function load(url) {
    if(!url)return;
    if(url===source && (envelope || pending))return pending;
    abort();source=url;envelope=cache.get(url) || null;
    if(envelope)return;
    const version=generation;controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]);
    const job=(async()=>{
      const response=await fetchAudio(url,{signal,credentials:'same-origin'});
      if(!response.ok || !response.headers.get('content-type')?.startsWith('audio/'))throw new Error('no_audio');
      if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw new Error('analysis_size_limit');}
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{
        for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw new Error('analysis_size_limit');chunks.push(value);}
      }finally{await reader.cancel().catch(()=>{});}
      if(signal.aborted || version!==generation)return;
      const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
      const buffer=await decodeAudio(bytes.buffer);
      if(signal.aborted || version!==generation)return;
      envelope=analyseEnvelope(buffer);cache.set(url,envelope);
      while(cache.size>2)cache.delete(cache.keys().next().value);
    })().catch(()=>{/* Analysis is optional; playback continues, with a static meter. */});
    pending=job;await job;if(version===generation)pending=null;
  }
  return {load,abort,level:(...args)=>envelopeLevel(envelope,...args),get ready(){return Boolean(envelope);}};
}
