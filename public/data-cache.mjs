const PREFIX='awudio-data-v1-';
const TTL=new Map([['/api/radios',120000],['/api/music/playlists',300000],['/api/music/playlist-tracks',300000],['/api/music/search',60000]]);
export function createDataCache({storage=globalThis.caches,now=Date.now,origin=globalThis.location?.origin,maxEntries=40,maxBytes=4*1024*1024}={}) {
  let name=null;
  const key=value=>new URL(value,origin).href;
  function useScope(scope){name=PREFIX+encodeURIComponent(scope);}
  async function read(path){
    if(!name || !storage)return null;
    try{const cache=await storage.open(name),entry=await cache.match(key(path));
      if(!entry)return null;
      if(Number(entry.headers.get('X-Awudio-Cache-Until'))<=now()){await cache.delete(key(path));return null;}
      return entry;
    }catch{return null;}
  }
  async function write(path,data,ttl){
    if(!name || !storage)return;
    const body=JSON.stringify(data);
    const bytes=new TextEncoder().encode(body).length;
    if(bytes>512*1024)return;
    const selected=name;
    try{
      const cache=await storage.open(selected);
      await cache.delete(key(path));
      await cache.put(key(path),new Response(body,{headers:{'Content-Type':'application/json','X-Awudio-Cache-Until':String(now()+ttl),'X-Awudio-Cache-Bytes':String(bytes)}}));
      const keys=await cache.keys();let size=0;
      for(let i=keys.length-1;i>=0;i--){const entry=await cache.match(keys[i]);size+=Number(entry.headers.get('X-Awudio-Cache-Bytes')) || 0;if(keys.length-i>maxEntries || size>maxBytes)await cache.delete(keys[i]);}
    }catch{/* Private mode/storage pressure must not block listening. */}
  }
  async function remove(path){if(!name || !storage)return;try{const cache=await storage.open(name);await cache.delete(key(path));}catch{}}
  async function clear(){if(!storage)return;try{for(const key of await storage.keys())if(key.startsWith(PREFIX))await storage.delete(key);}catch{}}
  return {useScope,read,write,remove,clear,ttl:path=>TTL.get(new URL(path,origin).pathname)||0};
}
