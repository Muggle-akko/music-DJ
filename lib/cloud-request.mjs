import { dataStoreEnabled, withDataTransaction } from './data-store.mjs';

// Single-owner metadata actor. Audio streams bypass it; expired waiting controls never run.
// Buffer responses until COMMIT so a database failure cannot be reported as a successful save.
export async function cloudRequest(req,res,handler,{before,after,invalidate}={}) {
  if (!dataStoreEnabled() || !String(req.url).startsWith('/api/') || req.url.startsWith('/api/music/stream') || req.url.startsWith('/api/tts/audio/') || req.url==='/api/tts') return handler();
  const controller=new AbortController();
  const onClose=()=>controller.abort();res.once('close',onClose);
  const original={writeHead:res.writeHead,write:res.write,end:res.end};
  const chunks=[];let head,ended=false,bytes=0;
  const add=chunk=>{if(chunk){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=b.length;if(bytes>8*1024*1024)throw new Error('Response too large');chunks.push(b);}};
  res.writeHead=function(...args){head=args;return this;};
  res.write=function(chunk,encoding,callback){add(chunk);(typeof encoding==='function'?encoding:callback)?.();return true;};
  res.end=function(chunk,encoding,callback){add(chunk);ended=true;(typeof encoding==='function'?encoding:callback)?.();return this;};
  try {
    await withDataTransaction('awudio-metadata-v1',async()=>{
      await before?.(); await handler();
      if(!ended)throw new Error('Cloud metadata must complete without a persistent stream');
      await after?.();
    },{signal:controller.signal,timeoutMs:8000});
    Object.assign(res,original);
    if(head)original.writeHead.apply(res,head);
    original.end.call(res,Buffer.concat(chunks));
  } catch(error) {
    Object.assign(res,original);invalidate?.();
    if(res.destroyed)return;
    for(const name of res.getHeaderNames())res.removeHeader(name);
    res.writeHead(error.httpStatus || 503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({ok:false,status:'unavailable',error:'云端请求未完成，请核对操作结果后重试'}));
  } finally {res.removeListener('close',onClose);Object.assign(res,original);}
}
