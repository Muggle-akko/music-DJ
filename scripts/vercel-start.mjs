import { createRequire } from 'node:module';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

process.env.AWUDIO_DATABASE_URL ||= process.env.DATABASE_URL;
if(!process.env.AWUDIO_DATABASE_URL)throw new Error('Missing AWUDIO_DATABASE_URL / DATABASE_URL: persistent database is required');
if(!process.env.AWUDIO_PASSWORD || process.env.AWUDIO_PASSWORD.length<12)throw new Error('Missing strong AWUDIO_PASSWORD');
if(!process.env.AWUDIO_PUBLIC_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL)process.env.AWUDIO_PUBLIC_URL=`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
if(!process.env.AWUDIO_PUBLIC_URL)throw new Error('Missing AWUDIO_PUBLIC_URL or VERCEL_PROJECT_PRODUCTION_URL');
if(process.env.VERCEL_ENV==='preview' && !process.env.AWUDIO_ALLOW_PREVIEW)throw new Error('Preview requires an isolated database and explicit AWUDIO_ALLOW_PREVIEW=1');
Object.assign(process.env,{AWUDIO_MODE:'server',AWUDIO_DEPLOYMENT:'vercel',AWUDIO_DATA_DIR:process.env.AWUDIO_DATA_DIR || '/tmp/awudio',PORT:process.env.PORT || '8080'});

// The bundled adapter is only reachable on loopback, never a public Vercel route.
if(!process.env.NCM_API_BASE) {
  const token=join(tmpdir(),'anonymous_token');
  try {await access(token);}catch {await writeFile(token,'',{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});}
  const require=createRequire(import.meta.url);
  const {serveNcmApi}=require('../services/netease-api/server.js');
  const adapter=await serveNcmApi({port:33001,host:'127.0.0.1',checkVersion:false});
  if(!adapter.server.listening)await once(adapter.server,'listening');
  process.env.NCM_API_BASE='http://127.0.0.1:33001';
}
await import('../server.mjs');
