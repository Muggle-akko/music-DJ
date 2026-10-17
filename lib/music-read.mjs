// Only these read-only assets bypass the metadata writer. Authentication still runs.
export function isIndependentMusicRead(req) {
  const path=String(req.url || '').split('?')[0];
  return req.method==='GET' && ['/api/music/cover','/api/music/lyric'].includes(path);
}

export function createMusicReadCache({maxEntries=128,maxBytes=16*1024*1024,ttlMs=6*3600000,now=Date.now}={}) {
  const entries=new Map(),pending=new Map();let bytes=0;
  function remove(key){const entry=entries.get(key);if(entry)bytes-=entry.size;entries.delete(key);}
  return async function get(key,load) {
    const cached=entries.get(key);
    if(cached && cached.until>now()){entries.delete(key);entries.set(key,cached);return cached.value;}
    remove(key);
    if(pending.has(key))return pending.get(key);
    if(pending.size>=32)throw Object.assign(new Error('资源加载繁忙，请稍后重试'),{httpStatus:503});
    const job=Promise.resolve().then(load).then(value=>{
      if(value.status!==200)return value;
      const size=Buffer.byteLength(value.body || '');
      if(size<=maxBytes){
        entries.set(key,{value,size,until:now()+ttlMs});bytes+=size;
        while(entries.size>maxEntries || bytes>maxBytes)remove(entries.keys().next().value);
      }
      return value;
    }).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  };
}
