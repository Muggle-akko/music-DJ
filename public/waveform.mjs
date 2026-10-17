// Independent offline analysis: the audible media element is never routed through Web Audio.
const MAX_BYTES=32*1024*1024;
const FIRST_PREVIEW_BYTES=512*1024;
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
export function createTrackWaveform({fetchAudio=fetch,decode,retryDelayMs=1500,onAudioLoaded}={}) {
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
    if(url===source && pending)return pending;
    if(url===source && cache.has(url))return;
    abort();source=url;envelope=cache.get(url) || null;
    if(envelope)return;
    const version=generation;controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);
    const current=()=>!signal.aborted && version===generation;
    async function analyse(chunks,size,complete,type) {
      const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
      if(complete && current()){
        try{void Promise.resolve(onAudioLoaded?.(url,bytes,type)).catch(()=>{});}catch{}
      }
      const buffer=await decodeAudio(bytes.buffer);
      if(!current())return;
      envelope=analyseEnvelope(buffer);
      // Prefixes are useful immediately, but only complete tracks belong in the cache.
      if(complete){cache.set(url,envelope);while(cache.size>2)cache.delete(cache.keys().next().value);}
    }
    const job=(async()=>{
      for(let attempt=0;attempt<3 && current();attempt++) {
        let reader;
        try {
          const response=await fetchAudio(url,{signal,credentials:'same-origin'});
          if(!current()){await response.body?.cancel();return;}
          if(!response.ok){await response.body?.cancel();if(response.status<500 && response.status!==429)return;throw new Error('audio_request_failed');}
          const type=(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if(type && !type.startsWith('audio/') && type!=='application/octet-stream'){await response.body?.cancel();return;}
          if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();return;}
          reader=response.body.getReader();const chunks=[];let size=0,nextPreview=FIRST_PREVIEW_BYTES;
          for(;;){
            const {done,value}=await reader.read();if(done)break;
            if(!current())return;
            size+=value.byteLength;if(size>MAX_BYTES)return;
            chunks.push(value);
            if(size>=nextPreview){
              // MP3 prefixes can decode before the full download; other formats wait for EOF.
              try{await analyse(chunks,size,false);}catch{}
              nextPreview=Math.max(nextPreview*2,size*2);
            }
          }
          if(current())await analyse(chunks,size,true,type);
          return;
        } catch {
          if(!current() || attempt===2)return;
        } finally {await reader?.cancel().catch(()=>{});}
        await new Promise(resolve=>{
          if(!current()){resolve();return;}
          const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
          const timer=setTimeout(finish,retryDelayMs*(attempt+1));signal.addEventListener('abort',finish,{once:true});
        });
      }
    })().catch(()=>{/* Optional analysis must never interrupt native playback. */});
    pending=job;await job;if(version===generation)pending=null;
  }
  return {load,abort,level:(...args)=>envelopeLevel(envelope,...args),get ready(){return Boolean(envelope);}};
}
