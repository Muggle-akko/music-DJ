const STATE_KEY='awudio.recentPlayback.v1';
const AUDIO_CACHE='awudio-recent-audio-v1';
const MAX_BYTES=32*1024*1024;
const MAX_AGE=7*86400000;
const key=track=>`${track?.provider || 'unknown'}:${track?.id || ''}`;

export function createRecentPlayback({storage=globalThis.localStorage,caches=globalThis.caches,fetchAudio=globalThis.fetch,
  origin=globalThis.location?.origin,now=Date.now,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}={}) {
  let generation=0,job=null,controller,objectURL='',objectKey='',scope='',lastSaved=0;
  const cacheURL=()=>new URL('/__awudio_recent_audio__',origin).href;
  const read=()=>{try{
    const value=JSON.parse(storage?.getItem(STATE_KEY) || 'null');
    if(!value?.track?.id || !value.track.url || !value.accountId || !Number.isFinite(value.savedAt) || now()-value.savedAt>MAX_AGE)return null;
    value.position=Math.max(0,Number(value.position)||0);return value;
  }catch{return null;}};
  function release(){if(objectURL)revokeURL(objectURL);objectURL='';objectKey='';}
  function cancel(){generation++;controller?.abort();job=null;}
  async function clear(){cancel();release();scope='';try{storage?.removeItem(STATE_KEY);storage?.removeItem('awudio.resume');await caches?.delete(AUDIO_CACHE);}catch{}}
  async function useScope(accountId) {
    const previous=read();
    if(previous && previous.accountId!==String(accountId))await clear();
    scope=String(accountId || '');
  }
  function remember(track,position,{force=false}={}) {
    const accountId=scope || read()?.accountId;
    if(!track?.id || !track.url || !accountId || accountId==='guest')return;
    const previous=read();
    if(!force && key(previous?.track)===key(track) && now()-lastSaved<5000)return;
    if(key(previous?.track)!==key(track)){cancel();release();}
    lastSaved=now();
    try{storage?.setItem(STATE_KEY,JSON.stringify({accountId,track,position:Math.max(0,Number(position)||0),savedAt:now()}));}catch{}
  }
  function sourceFor(track) {
    const saved=read();
    return saved && key(saved.track)===key(track) && objectKey===key(track) ? objectURL : '';
  }
  async function cachedSource(track) {
    const saved=read();if(!caches || !saved || key(saved.track)!==key(track))return '';
    if(objectKey===key(track) && objectURL)return objectURL;
    const version=generation;
    try{
      const cache=await caches.open(AUDIO_CACHE),response=await cache.match(cacheURL());
      if(!response || response.headers.get('X-Awudio-Track')!==key(track) || response.headers.get('X-Awudio-Account')!==saved.accountId || now()-Number(response.headers.get('X-Awudio-Saved'))>MAX_AGE)return '';
      const blob=await response.blob();if(version!==generation || key(read()?.track)!==key(track))return '';
      release();objectURL=createURL(blob);objectKey=key(track);return objectURL;
    }catch{return '';}
  }
  async function storeBytes(url,bytes,type='audio/mpeg') {
    const saved=read();if(!saved || !caches || (!bytes.byteLength || bytes.byteLength>MAX_BYTES))return false;
    try{
      const source=new URL(url,origin),expected=new URL(saved.track.url,origin);
      if(source.origin!==origin || source.pathname!=='/api/music/stream' || source.searchParams.get('id')!==expected.searchParams.get('id'))return false;
      // Build the Blob before decodeAudioData can detach the supplied buffer.
      const body=new Blob([bytes],{type}),version=generation;
      const cache=await caches.open(AUDIO_CACHE);
      if(version!==generation)return false;
      await cache.put(cacheURL(),new Response(body,{headers:{'Content-Type':type,'X-Awudio-Track':key(saved.track),
        'X-Awudio-Account':saved.accountId,'X-Awudio-Saved':String(now())}}));
      return version===generation;
    }catch{return false;}
  }
  async function cacheTrack(track) {
    if(job)return job;
    const saved=read();if(!saved || key(saved.track)!==key(track))return;
    if(await cachedSource(track))return;
    if(job)return job;
    if(key(read()?.track)!==key(track))return;
    const version=generation;controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);
    job=(async()=>{
      const url=new URL(track.url,origin);
      if(url.origin!==origin || url.pathname!=='/api/music/stream')return;
      const response=await fetchAudio(url.href,{credentials:'same-origin',signal,priority:'low'});
      const type=(response.headers.get('content-type') || '').split(';')[0];
      if(response.status!==200 || !type.startsWith('audio/') || response.headers.has('content-range') || Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();return;}
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)return;chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      if(signal.aborted || version!==generation)return;
      const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
      await storeBytes(track.url,bytes,type);
    })().catch(()=>{}).finally(()=>{if(version===generation)job=null;});
    return job;
  }
  return {read,useScope,remember,sourceFor,cachedSource,storeBytes,cacheTrack,clear,release};
}
export const recentPlayback=createRecentPlayback();
