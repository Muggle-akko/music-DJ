// Isolated synthetic load only. Never pass a production database URL.
import {createServer as tcpServer,connect} from 'node:net';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {accountKey} from '../lib/ncm.mjs';
const dbUrl=new URL(process.env.AWUDIO_TEST_DATABASE_URL || '');
if(!['localhost','127.0.0.1'].includes(dbUrl.hostname))throw new Error('This benchmark requires a disposable local PostgreSQL');
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const admin=new pg.Pool({connectionString:dbUrl.href});
const upstream=createServer((req,res)=>{const path=new URL(req.url,'http://fixture').pathname;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(path==='/login/status'?{code:200,data:{profile:{userId:123}}}:{code:200,lrc:{lyric:''}}));});
const upstreamBase='http://127.0.0.1:'+await listen(upstream);
const instanceCount=Number(process.env.AWUDIO_BENCH_INSTANCES || 1);
if(![1,2].includes(instanceCount))throw new Error('Use one or two local instances');
const cycles=60,device='a'.repeat(32),origin='https://fixture.example';
async function measure(root,label){
 const name='awudio_transfer_'+randomUUID().replaceAll('-','');await admin.query(`CREATE DATABASE "${name}"`);
 const direct=new URL(dbUrl);direct.pathname='/'+name;const seed=new pg.Pool({connectionString:direct.href});
 let outgoing=0,incoming=0;const sockets=new Set();
 const proxy=tcpServer(client=>{const remote=connect(Number(dbUrl.port)||5432,dbUrl.hostname);sockets.add(client);sockets.add(remote);client.on('data',b=>{incoming+=b.length;});remote.on('data',b=>{outgoing+=b.length;});client.pipe(remote);remote.pipe(client);client.on('error',()=>remote.destroy());remote.on('error',()=>client.destroy());client.on('close',()=>{remote.destroy();sockets.delete(client);});remote.on('close',()=>sockets.delete(remote));});
 const proxyPort=await listen(proxy),appDb=new URL(direct);appDb.port=String(proxyPort);
 const probe=createServer(),port=await listen(probe);await new Promise(r=>probe.close(r));
 const dir=await mkdtemp(join(tmpdir(),'awudio-transfer-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:resolve(root),env:{...process.env,AWUDIO_DATA_DIR:dir,AWUDIO_DATABASE_URL:appDb.href,AWUDIO_MODE:'server',AWUDIO_PUBLIC_URL:origin,AWUDIO_PASSWORD:'fixture-only-password',AWUDIO_DEPLOYMENT:'',PORT:String(port),NCM_API_BASE:upstreamBase,NCM_COOKIE:'MUSIC_U=fixture',AI_PROVIDER:'local',TTS_PROVIDER:'none',FISH_AUDIO_API_KEY:'',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
 let logs='',cookie,playerToken;
 const children=[child],ports=[port];let requestNumber=0;
child.stderr.on('data',c=>logs+=c);child.stdout.on('data',c=>logs+=c);
 const request=(path,body,extra={})=>new Promise((resolve,reject)=>{const r=httpRequest({host:'127.0.0.1',port:ports[Math.floor(requestNumber++/3)%ports.length],path,method:body===undefined?'GET':'POST',headers:{Host:'fixture.example',Origin:origin,'Content-Type':'application/json','X-Awudio-Device':device,...(cookie?{Cookie:cookie}:{}),...extra}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{assert.equal(res.statusCode,200,path+' '+Buffer.concat(chunks).toString().slice(0,120));resolve({data:JSON.parse(Buffer.concat(chunks)),headers:res.headers});}catch(e){reject(e);}});});r.on('error',reject);r.setTimeout(15000,()=>r.destroy());if(body!==undefined)r.write(JSON.stringify(body));r.end();});
 try{
  for(let i=0;i<150;i++){try{await request('/healthz');break;}catch{if(child.exitCode!==null)throw new Error(logs);if(i===149)throw new Error('fixture timeout');await wait(30);}}
  const key=accountKey(123),day=new Date().toISOString().slice(0,10);
  const put=(path,value)=>seed.query('INSERT INTO awudio_objects(path,body) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET body=EXCLUDED.body',[path,Buffer.from(typeof value==='string'?value:JSON.stringify(value))]);
  const state={queue:[],radioHistory:[],agent:{mode:'external',plans:{},operations:{}},padding:'s'.repeat(400*1024)};
  await put('state.json',state);await put(`accounts/${key}/state.json`,state);
  await put(`accounts/${key}/profile.json`,{allLikedSongs:Array.from({length:1378},(_,i)=>({id:String(i+1)})),padding:'p'.repeat(1600*1024)});
  await put(`accounts/${key}/feedback.json`,{schemaVersion:1,ids:{},tracks:{},sessions:{},migrated:true,maintenanceDay:day,padding:'f'.repeat(300*1024)});
  await put(`accounts/${key}/listening-events/${day}.jsonl`,JSON.stringify({eventId:'existing-log',receivedAt:new Date().toISOString(),type:'like',trackId:'1000',clientId:'fixture',actionSeq:0,occurredAt:new Date().toISOString(),padding:'l'.repeat(1200*1024)})+'\n');
  if(instanceCount===2){
   const probe2=createServer(),port2=await listen(probe2);await new Promise(r=>probe2.close(r));
   const second=spawn(process.execPath,child.spawnargs.slice(1),{cwd:resolve(root),env:{...process.env,AWUDIO_DATA_DIR:await mkdtemp(join(tmpdir(),'awudio-transfer-second-')),AWUDIO_DATABASE_URL:appDb.href,AWUDIO_MODE:'server',AWUDIO_PUBLIC_URL:origin,AWUDIO_PASSWORD:'fixture-only-password',AWUDIO_DEPLOYMENT:'',PORT:String(port2),NCM_API_BASE:upstreamBase,NCM_COOKIE:'MUSIC_U=fixture',AI_PROVIDER:'local',TTS_PROVIDER:'none',FISH_AUDIO_API_KEY:'',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
   children.push(second);second.stderr.on('data',c=>logs+=c);second.stdout.on('data',c=>logs+=c);
   for(let i=0;i<150;i++){if(second.exitCode!==null)throw new Error(logs);try{await new Promise((resolve,reject)=>{const r=httpRequest({host:'127.0.0.1',port:port2,path:'/healthz'},res=>{res.resume();res.on('end',resolve);});r.on('error',reject);r.end();});break;}catch{await wait(30);}}
   ports.push(port2);
  }
  if(process.env.AWUDIO_BENCH_DATA_DIR){
   const fixtureRoot=resolve(process.env.AWUDIO_BENCH_DATA_DIR),folders=await readdir(join(fixtureRoot,'accounts'));
   const sizes=await Promise.all(folders.filter(x=>/^[a-f0-9]{24}$/.test(x)).map(async id=>({id,size:await stat(join(fixtureRoot,'accounts',id,'profile.json')).then(s=>s.size).catch(()=>0)})));
   sizes.sort((a,b)=>b.size-a.size);const source=join(fixtureRoot,'accounts',sizes[0].id);
   for(const file of ['state.json','profile.json','feedback.json']){
    const data=JSON.parse(await readFile(join(source,file),'utf8'));if(data.accountKey)data.accountKey=key;if(data.ownerAccountKey)data.ownerAccountKey=key;
    if(file==='state.json'){data.agent={mode:'external',plans:{},operations:{}};data.queue=[];data.radioHistory=[];await put('state.json',data);}
    await put(`accounts/${key}/${file}`,data);
   }
   const logDir=join(source,'listening-events');
   for(const file of await readdir(logDir))if(/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))await put(`accounts/${key}/listening-events/${file}`,await readFile(join(logDir,file),'utf8'));
  }
  cookie=(await request('/api/access/login',{password:'fixture-only-password'})).headers['set-cookie'][0].split(';')[0];
  const player=(await request('/api/player/register',{name:'Fixture'},{'X-Awudio-Browser':'1'})).data;playerToken=player.token;
  const browser={'X-Awudio-Browser':'1','X-Awudio-Player-Token':playerToken};
  const bridge=(await request('/api/instance/agent-connection',{})).data;
  const agent=(await request('/api/agent/register',{name:'Fixture Agent'},{Authorization:'Bearer '+bridge.token})).data;
  const agentHeaders={Authorization:'Bearer '+bridge.token,'X-Awudio-Agent-Session':agent.sessionId};
  async function tick(i){await request('/api/player/heartbeat',{playback:{paused:false,loaded:true,queueRevision:0}},browser);await request('/api/player/snapshot',undefined,browser);
   if(i%3===0){await request('/api/agent/heartbeat',{name:'Fixture Agent'},agentHeaders);await request('/api/listening/events',{events:[{eventId:'progress-'+i,type:'progress',trackId:'1000',playbackSessionId:'fixture-session',clientId:'fixture',seq:i,occurredAt:new Date().toISOString(),durationMs:240000,positionMs:0,listenedMs:0}]});}
  }
  await tick(-3);const warmupDatabaseToAppBytes=outgoing;outgoing=0;incoming=0;
  for(let i=0;i<cycles;i++)await tick(i);
  const result={label,fixture:process.env.AWUDIO_BENCH_DATA_DIR?'local-data-copy':'synthetic',instances:instanceCount,warmupDatabaseToAppBytes,cycles,simulatedMinutes:cycles*5/60,databaseToAppBytes:outgoing,appToDatabaseBytes:incoming,databaseToAppMBPerHour:+(outgoing*3600/(cycles*5)/1e6).toFixed(2),totalMBPerHour:+((outgoing+incoming)*3600/(cycles*5)/1e6).toFixed(2)};console.log(JSON.stringify(result));return result;
 }finally{for(const c of children){c.kill();await once(c,'exit');}for(const s of sockets)s.destroy();await new Promise(r=>proxy.close(r));await seed.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);}
}
try{if(process.argv[2])await measure(process.argv[2],'before');await measure(new URL('..',import.meta.url).pathname,'after');}finally{await admin.end();await new Promise(r=>upstream.close(r));}
