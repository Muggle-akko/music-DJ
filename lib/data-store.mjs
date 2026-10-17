import * as fs from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const COMPRESSED = Buffer.from('AWUDIOGZ1\0');
const compressed = body => body.length>=COMPRESSED.length && body.subarray(0,COMPRESSED.length).equals(COMPRESSED);
const unpack = body => compressed(body) ? gunzipSync(body.subarray(COMPRESSED.length)) : body;
function pack(file,body){
  if(!/\.json(?:\.backup)?$/.test(file) || body.length<4096)return body;
  const zipped=gzipSync(body,{level:3});
  return zipped.length+COMPRESSED.length<body.length*0.9 ? Buffer.concat([COMPRESSED,zipped]) : body;
}

let backend;
// Cache immutable bytes, never parsed/mutable state. Every read validates the DB row version.
const byteCache = new Map();
let cachedBytes = 0;
const CACHE_LIMIT = 64 * 1024 * 1024;
function forget(path) {
  const entry=byteCache.get(path);
  if(entry){cachedBytes-=entry.body.length;byteCache.delete(path);}
}
function remember(path,body,version) {
  forget(path);
  if(body.length>CACHE_LIMIT/4)return;
  byteCache.set(path,{body:Buffer.from(body),version});cachedBytes+=body.length;
  while(cachedBytes>CACHE_LIMIT)forget(byteCache.keys().next().value);
}
const scope = new AsyncLocalStorage();
const missing = () => Object.assign(new Error('Data not found'), {code:'ENOENT'});
export const dataStoreEnabled = () => Boolean(backend);
export async function configureDataStore({ url, root }) {
  if (!url) return;
  const { Pool } = await import('pg');
  const connection = new URL(url);
  const local = ['localhost','127.0.0.1','[::1]'].includes(connection.hostname);
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert']) connection.searchParams.delete(key);
  const pool = new Pool({ connectionString:connection.href, ssl:local ? false : {rejectUnauthorized:true}, max:4,
    connectionTimeoutMillis:10000, idleTimeoutMillis:10000, allowExitOnIdle:true });
  pool.on('error',()=>{});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('awudio-schema-v1'))");
    await client.query('CREATE TABLE IF NOT EXISTS awudio_objects (path text PRIMARY KEY, body bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
    await client.query('ALTER TABLE awudio_objects ADD COLUMN IF NOT EXISTS body_compressed bytea, ADD COLUMN IF NOT EXISTS compressed_md5 text');
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {client.release();}
  byteCache.clear();cachedBytes=0;
  backend={pool,root:resolve(root)};
}
function key(file) {
  const result=relative(backend.root,resolve(file)).replaceAll('\\','/');
  if (!result || result.startsWith('../') || result==='..') throw new Error('Invalid data path');
  return result;
}
const query=(sql,args)=> {
  const current=scope.getStore();
  if(current && !current.active)throw new Error('Expired database transaction');
  return (current?.client || backend.pool).query(sql,args);
};
export async function withDataTransaction(name, task, {signal, timeoutMs=10000}={}) {
  if (!backend) return task();
  if(scope.getStore()){if(!scope.getStore().active)throw new Error('Expired database transaction');return task();}
  const client=await backend.pool.connect(), current={client,active:true};
  try {
    await client.query('BEGIN');
    const deadline=Date.now()+timeoutMs;
    while (!(await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',[name])).rows[0].locked) {
      if (signal?.aborted || Date.now()>deadline) throw Object.assign(new Error('服务繁忙，请稍后重试；未执行排队操作'),{httpStatus:503});
      await new Promise(r=>setTimeout(r,30));
    }
    signal?.throwIfAborted();
    const result=await scope.run(current,task);
    signal?.throwIfAborted();
    await client.query('COMMIT');
    return result;
  } catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
  finally {current.active=false;client.release();}
}
export async function fileVersion(file) {
  if(!backend){try{const stat=await fs.stat(file);return `${stat.mtimeMs}:${stat.size}`;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  return (await query('SELECT xmin::text AS version FROM awudio_objects WHERE path=$1',[key(file)])).rows[0]?.version || null;
}
export async function readFile(file, options) {
  if (!backend) return fs.readFile(file,options);
  const path=key(file), cached=byteCache.get(path);
  // Unchanged rows return only their version, not another copy of a multi-MB JSON blob.
  const row=(await query('SELECT xmin::text AS version, CASE WHEN xmin::text=$2 THEN NULL WHEN body_compressed IS NOT NULL AND compressed_md5=md5(body) THEN body_compressed ELSE body END AS body FROM awudio_objects WHERE path=$1',[path,cached?.version || ''])).rows[0];
  if (!row) {forget(path);throw missing();}
  const body=row.body===null ? cached.body : row.body;
  if(row.body===null){byteCache.delete(path);byteCache.set(path,cached);}
  else remember(path,body,row.version);
  const encoding=typeof options==='string' ? options : options?.encoding;
  const plain=unpack(body);
  return encoding ? plain.toString(encoding) : Buffer.from(plain);
}
export async function writeFile(file, data, options) {
  if (!backend) return fs.writeFile(file,data,options);
  const path=key(file),plain=Buffer.isBuffer(data) ? data : Buffer.from(data,typeof options==='string' ? options : options?.encoding || 'utf8');
  const body=pack(path,plain);
  forget(path);
  const zipped=body===plain ? null : body;
  const checksum=zipped ? createHash('md5').update(plain).digest('hex') : null;
  // Keep the original body readable by older deployments; compression is a disposable sidecar.
  const row=(await query('INSERT INTO awudio_objects(path,body,body_compressed,compressed_md5) VALUES($1,$2,$3,$4) ON CONFLICT(path) DO UPDATE SET body=EXCLUDED.body,body_compressed=EXCLUDED.body_compressed,compressed_md5=EXCLUDED.compressed_md5,updated_at=now() WHERE awudio_objects.body IS DISTINCT FROM EXCLUDED.body OR awudio_objects.body_compressed IS DISTINCT FROM EXCLUDED.body_compressed RETURNING xmin::text AS version',[path,plain,zipped,checksum])).rows[0];
  if(row)remember(path,body,row.version);
}
export async function mkdir(file, options) {if (!backend) return fs.mkdir(file,options);}
export async function chmod(file, mode) {if (!backend) return fs.chmod(file,mode);}
export async function exists(file) {
  if (!backend) {try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
  return (await query('SELECT 1 FROM awudio_objects WHERE path=$1',[key(file)])).rowCount>0;
}
export async function copyFile(from,to) {
  if (!backend) return fs.copyFile(from,to);
  const source=key(from),target=key(to);forget(target);
  const result=await query('INSERT INTO awudio_objects(path,body,body_compressed,compressed_md5) SELECT $2,body,body_compressed,compressed_md5 FROM awudio_objects WHERE path=$1 ON CONFLICT(path) DO UPDATE SET body=EXCLUDED.body,body_compressed=EXCLUDED.body_compressed,compressed_md5=EXCLUDED.compressed_md5,updated_at=now() WHERE awudio_objects.body IS DISTINCT FROM EXCLUDED.body OR awudio_objects.body_compressed IS DISTINCT FROM EXCLUDED.body_compressed',[source,target]);
  if(!result.rowCount && !await exists(from))throw missing();
}
export async function rename(from,to) {
  if (!backend) return fs.rename(from,to);
  forget(key(from));forget(key(to));
  // atomicJson temporaries are request-scoped and replaced under the metadata transaction.
  await query('DELETE FROM awudio_objects WHERE path=$1',[key(to)]);
  const result=await query('UPDATE awudio_objects SET path=$2,updated_at=now() WHERE path=$1',[key(from),key(to)]);
  if(!result.rowCount)throw missing();
}
export async function appendFile(file,data,options) {
  if (!backend) return fs.appendFile(file,data,options);
  forget(key(file));
  const body=Buffer.from(data);
  await query('INSERT INTO awudio_objects(path,body) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET body=awudio_objects.body || EXCLUDED.body,body_compressed=NULL,compressed_md5=NULL,updated_at=now()',[key(file),body]);
}
export async function readdir(dir) {
  if (!backend) return fs.readdir(dir);
  const prefix=key(dir)+'/';
  return (await query('SELECT path FROM awudio_objects WHERE left(path,length($1))=$1',[prefix])).rows
    .map(row=>row.path.slice(prefix.length)).filter(path=>!path.includes('/'));
}
export async function unlink(file) {
  if (!backend) return fs.unlink(file);
  forget(key(file));
  if (!(await query('DELETE FROM awudio_objects WHERE path=$1',[key(file)])).rowCount) throw missing();
}
