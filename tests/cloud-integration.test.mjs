import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
test('Postgres cloud: two instances, cold restart, actor state, binary media and rollback-before-response',
  {skip:!process.env.AWUDIO_TEST_DATABASE_URL},async()=>{
  const name=`awudio_test_${randomUUID().replaceAll('-','')}`;
  const admin=new pg.Pool({connectionString:process.env.AWUDIO_TEST_DATABASE_URL});
  await admin.query(`CREATE DATABASE "${name}"`);
  const dbUrl=new URL(process.env.AWUDIO_TEST_DATABASE_URL);dbUrl.pathname=`/${name}`;
  const db=new pg.Pool({connectionString:dbUrl.href});
  const children=new Set();let cookie,upstreamBase;
  const origin='https://radio.example',device='a'.repeat(32),otherDevice='b'.repeat(32);
  const track=id=>({id:String(id),provider:'netease',title:`Fixture ${id}`,artist:'Artist',duration:180000,playable:true,url:`/api/music/stream?id=${id}&full=1`});
  const upstream=createServer((req,res)=>{
    const url=new URL(req.url,'http://fixture');let data={code:200};
    if(url.pathname==='/login/status')data={code:200,data:{profile:{userId:123}}};
    else if(url.pathname==='/cloudsearch' || url.pathname==='/song/detail') {
      const song={id:4,name:'Agent fixture',ar:[{id:10,name:'Artist'}],al:{id:20,name:'Album'},dt:180000};
      data=url.pathname==='/cloudsearch' ? {code:200,result:{songs:[song]}} : {code:200,songs:[song]};
    }
    else if(url.pathname.startsWith('/song/url'))data={code:200,data:[{id:Number(url.searchParams.get('id')),url:`${upstreamBase}/audio`,freeTrialInfo:null,time:180000,code:200}]};
    else if(url.pathname==='/audio'){res.writeHead(206,{'Content-Type':'audio/mpeg','Content-Range':'bytes 0-3/10'});res.end('song');return;}
    else if(url.pathname==='/lyric')data={code:200,lrc:{lyric:''}};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
  });
  upstreamBase=`http://127.0.0.1:${await listen(upstream)}`;
  async function request(port,path,{body,auth=true,deviceId=device,headers={}}={}) {
    return new Promise((resolve,reject)=>{
      const r=httpRequest(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{Host:'radio.example','Content-Type':'application/json','X-Awudio-Device':deviceId,...(auth&&cookie?{Cookie:cookie}:{}),...headers}},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{
          const text=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(text);}catch{data=text;}
          resolve({status:res.statusCode,data,headers:new Headers(res.headers)});
        });
      });r.on('error',reject);r.setTimeout(20000,()=>r.destroy(new Error('request timeout')));if(body!==undefined)r.write(JSON.stringify(body));r.end();
    });
  }
  async function start() {
    const probe=createServer(),port=await listen(probe);await new Promise(r=>probe.close(r));
    const dir=await mkdtemp(join(tmpdir(),'awudio-cloud-instance-'));
    const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,
      AWUDIO_DATABASE_URL:dbUrl.href,AWUDIO_DATA_DIR:dir,AWUDIO_MODE:'server',AWUDIO_PUBLIC_URL:origin,AWUDIO_PASSWORD:'fixture-password-long-enough',
      PORT:String(port),NCM_API_BASE:upstreamBase,NCM_COOKIE:'MUSIC_U=fixture',AI_PROVIDER:'local',TTS_PROVIDER:'none',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:'',FISH_AUDIO_API_KEY:''},stdio:['ignore','pipe','pipe']});
    children.add(child);let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
    for(let i=0;i<200;i++){try{if((await request(port,'/healthz')).status===200)return {port,child};}catch{}if(child.exitCode!==null)throw new Error(`fixture failed: ${logs}`);await sleep(30);}
    throw new Error(`fixture did not start: ${logs}`);
  }
  async function stop(instance){if(instance.child.exitCode===null){instance.child.kill('SIGTERM');await once(instance.child,'exit');}children.delete(instance.child);}
  try {
    const a=await start(),b=await start();
    assert.equal((await request(a.port,'/api/queue',{auth:false})).status,401);
    const login=await request(a.port,'/api/access/login',{body:{password:'fixture-password-long-enough'},headers:{Origin:origin}});
    assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request(b.port,'/api/config')).data.durableStorage,'postgres');
    assert.equal((await request(b.port,'/api/config')).data.playerEvents,false);
    const writes=await Promise.all([a,b].map((instance,index)=>request(instance.port,'/api/queue',{body:{queue:[track(index+1)],currentIndex:0,expectedRevision:0}})));
    assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
    const backup=await request(b.port,'/api/instance/backup');
    assert.equal(backup.status,200);assert.equal(backup.data.backup.includesCredentials,false);
    assert.equal((await request(a.port,'/api/instance/backup',{auth:false})).status,401);
    const queue=(await request(b.port,'/api/queue')).data;
    assert.equal(queue.revision,1);const winner=queue.queue[0].id;
    assert.equal((await request(b.port,'/api/queue',{deviceId:otherDevice,body:{queue:[track(3)],currentIndex:0,expectedRevision:0}})).status,200);
    assert.equal((await request(a.port,'/api/queue')).data.queue[0].id,winner);
    const register=(await request(a.port,'/api/player/register',{body:{name:'iPad'},headers:{'X-Awudio-Browser':'1'}})).data;
    const playerHeaders={'X-Awudio-Browser':'1','X-Awudio-Player-Token':register.token};
    assert.equal((await request(b.port,'/api/player/mode',{body:{mode:'external'},headers:playerHeaders})).status,200);
    assert.equal((await request(b.port,'/api/player/heartbeat',{body:{playback:{paused:true,queueRevision:1}},headers:playerHeaders})).status,200);
    assert.equal((await request(b.port,'/api/player/heartbeat',{body:{heartbeatMs:60000,playback:{paused:true,queueRevision:1}},headers:playerHeaders})).status,200);
    const relaxed=JSON.parse((await db.query("SELECT body FROM awudio_objects WHERE path='cloud-runtime.json'")).rows[0].body.toString());
    relaxed.agent.players.find(([id])=>id===register.playerId)[1].lastSeenAt=Date.now()-45000;
    await db.query("UPDATE awudio_objects SET body=$1 WHERE path='cloud-runtime.json'",[Buffer.from(JSON.stringify(relaxed))]);
    const bridge=(await request(a.port,'/api/instance/agent-connection',{body:{}})).data;
    const agent=(await request(a.port,'/api/agent/register',{auth:false,body:{name:'Mac Agent'},headers:{Authorization:`Bearer ${bridge.token}`}})).data;
    const agentHeaders={Authorization:`Bearer ${bridge.token}`,'X-Awudio-Agent-Session':agent.sessionId};
    const context=(await request(b.port,'/api/agent/call',{auth:false,body:{tool:'awudio_get_context',args:{}},headers:agentHeaders})).data;
    assert.equal(context.targetPlayerId,register.playerId);assert.equal(context.queue[0].id,winner);
    const lookup=(await request(a.port,'/api/agent/call',{auth:false,body:{tool:'awudio_search_tracks',args:{query:'Fixture'}},headers:agentHeaders})).data;
    // Simulate a pre-fix combined runtime, then let a heartbeat migrate its lookup refs.
    const combined=JSON.parse((await db.query("SELECT body FROM awudio_objects WHERE path='cloud-runtime.json'")).rows[0].body.toString());
    const lookupState=JSON.parse((await db.query("SELECT body FROM awudio_objects WHERE path='agent-lookups.json'")).rows[0].body.toString());
    lookupState[agent.sessionId][0][1].padding='large search evidence'.repeat(10000);
    for(const [id,session] of combined.agent.sessions)session.lookups=lookupState[id] || [];
    await db.query("UPDATE awudio_objects SET body=$1 WHERE path='cloud-runtime.json'",[Buffer.from(JSON.stringify(combined))]);
    await db.query("DELETE FROM awudio_objects WHERE path='agent-lookups.json'");
    assert.equal((await request(b.port,'/api/agent/heartbeat',{auth:false,body:{},headers:agentHeaders})).status,200);
    const runtime=JSON.parse((await db.query("SELECT body FROM awudio_objects WHERE path='cloud-runtime.json'")).rows[0].body.toString());
    assert.ok(runtime.agent.sessions.every(([,s])=>s.lookups.length===0),'heartbeats do not transport catalog results');
    assert.ok(Buffer.byteLength(JSON.stringify(runtime))<20000,'large search evidence remains outside heartbeat state');
    assert.equal((await db.query("SELECT 1 FROM awudio_objects WHERE path='agent-lookups.json'")).rowCount,1);
    const plan=(await request(b.port,'/api/agent/call',{auth:false,body:{tool:'awudio_submit_plan',args:{operationId:'cloud-plan',intent:'recommend',requestSummary:'Cross instance plan',tracks:[{trackId:'4',lookupRef:lookup.lookupRef,evidenceRefs:lookup.tracks[0].evidenceRefs,reason:'Fixture'}]}},headers:agentHeaders})).data;
    assert.ok(plan.planId);
    const apply=await request(a.port,'/api/agent/call',{auth:false,body:{tool:'awudio_apply_plan',args:{operationId:'cloud-apply',planId:plan.planId,expectedRevision:1,queueMode:'append',playback:'keep',targetPlayerId:register.playerId}},headers:agentHeaders});
    assert.equal(apply.status,200);assert.deepEqual((await request(b.port,'/api/queue')).data.queue.map(t=>t.id),[winner,'4']);

    const event={eventId:'cross-instance-like',type:'like',trackId:winner,clientId:'fixture',actionSeq:1,occurredAt:new Date().toISOString(),track:track(winner)};
    assert.deepEqual((await request(a.port,'/api/listening/events',{body:{events:[event]}})).data.accepted,[event.eventId]);
    assert.deepEqual((await request(b.port,'/api/listening/events',{body:{events:[event]}})).data.duplicate,[event.eventId]);
    const snapshot=(await request(b.port,'/api/player/snapshot',{headers:playerHeaders})).data;
    assert.equal(snapshot.feedback.find(t=>t.trackId===winner).liked,true);
    const unchanged=(await request(a.port,'/api/player/snapshot',{headers:{...playerHeaders,'X-Awudio-Plans-Version':snapshot.plansVersion,'X-Awudio-Feedback-Version':snapshot.feedbackVersion}})).data;
    assert.equal(unchanged.plansUnchanged,true);assert.equal(unchanged.feedbackUnchanged,true);
    assert.equal(unchanged.plans,undefined);assert.equal(unchanged.feedback,undefined);
    assert.ok(Array.isArray(unchanged.commands),'conditional recommendation data never suppresses commands');

    const draft=(await request(a.port,'/api/radios/studio',{body:{tool:'awudio_prepare_radio',args:{source:'queue',expectedQueueRevision:2,operationId:'cloud-prepare'}}})).data.draft;
    assert.ok(draft?.id);
    const saved=await request(b.port,'/api/radios/studio',{body:{tool:'awudio_save_radio',args:{draftId:draft.id,expectedRevision:draft.revision,operationId:'cloud-save',title:'Cloud episode',narration:false}}});
    assert.equal(saved.status,200);
    assert.equal((await request(a.port,'/api/radios',{deviceId:otherDevice})).data.radios[0].title,'Cloud episode');
    const audioName='a'.repeat(64)+'.mp3';
    await db.query('INSERT INTO awudio_objects(path,body) VALUES($1,$2)',[`tts/${audioName}`,Buffer.from('voice-fixture')]);
    assert.equal((await request(b.port,`/api/tts/audio/${audioName}`)).data,'voice-fixture');
    assert.equal((await request(a.port,`/api/tts/audio/${audioName}`,{auth:false})).status,401);
    const audio=await request(b.port,`/api/music/stream?id=${winner}&full=1`,{headers:{Range:'bytes=0-3'}});
    assert.equal(audio.status,206);assert.equal(audio.data,'song');
    // Even while the metadata writer is locked, authenticated asset reads must finish.
    const blocker=await db.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext('awudio-metadata-v1'))");
      const assets=await Promise.race([
        Promise.all([
          request(a.port,'/api/music/lyric?id=123'),
          request(a.port,'/api/music/cover?url=https://example.com/blocked'),
          request(a.port,'/api/music/lyric?id=123',{auth:false}),
        ]),
        sleep(3000).then(()=>{throw new Error('music reads waited for the metadata lock');}),
      ]);
      assert.deepEqual(assets.map(result=>result.status),[200,400,401]);
    } finally {await blocker.query('ROLLBACK');blocker.release();}
    // A failed COMMIT path must not leak an already-buffered 200 save response.
    await db.query("CREATE FUNCTION awudio_fail_runtime() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.path='cloud-runtime.json' THEN RAISE EXCEPTION 'fixture write failure'; END IF; RETURN NEW; END $$");
    await db.query('CREATE TRIGGER awudio_fail_runtime BEFORE INSERT OR UPDATE ON awudio_objects FOR EACH ROW EXECUTE FUNCTION awudio_fail_runtime()');
    const failure=await request(a.port,'/api/queue',{body:{queue:[track(9)],currentIndex:0,expectedRevision:2}});
    assert.equal(failure.status,503);
    await db.query('DROP TRIGGER awudio_fail_runtime ON awudio_objects');
    assert.equal((await request(b.port,'/api/queue')).data.queue[0].id,winner);
    await stop(a);await stop(b);
    const cold=await start();
    assert.equal((await request(cold.port,'/api/queue')).data.queue[0].id,winner);
    assert.equal((await request(cold.port,'/api/queue',{deviceId:otherDevice})).data.queue[0].id,'3');
    assert.equal((await request(cold.port,'/api/radios')).data.radios[0].title,'Cloud episode');
    assert.equal((await request(cold.port,`/api/tts/audio/${audioName}`)).data,'voice-fixture');
    const coldContext=(await request(cold.port,'/api/agent/call',{auth:false,body:{tool:'awudio_get_context',args:{}},headers:agentHeaders})).data;
    assert.equal(coldContext.targetPlayerId,register.playerId);
    const source=await mkdtemp(join(tmpdir(),'awudio-migration-source-'));
    const importKey='c'.repeat(24),audioKey='b'.repeat(64)+'.mp3';
    await mkdir(join(source,'accounts',importKey),{recursive:true});await mkdir(join(source,'tts'));
    await writeFile(join(source,'accounts',importKey,'state.json'),JSON.stringify({radioHistory:[],queue:[]}));
    await writeFile(join(source,'tts',audioKey),'import-voice');
    await writeFile(join(source,'agent-bridge.json'),JSON.stringify({token:'must-not-be-imported'}));
    async function runImport() {
      const child=spawn(process.execPath,['scripts/import-cloud-data.mjs','--source',source],{cwd:new URL('..',import.meta.url),env:{...process.env,AWUDIO_DATABASE_URL:dbUrl.href},stdio:'ignore'});
      return (await once(child,'exit'))[0];
    }
    assert.equal(await runImport(),0);
    assert.equal((await db.query('SELECT body FROM awudio_objects WHERE path=$1',[`tts/${audioKey}`])).rows[0].body.toString(),'import-voice');
    assert.equal(JSON.parse((await db.query("SELECT body FROM awudio_objects WHERE path='agent-bridge.json'")).rows[0].body.toString()).token,bridge.token);
    assert.equal(await runImport(),1); // Existing target data is never overwritten.

    assert.equal((await request(cold.port,'/api/access/logout',{body:{}})).status,200);
    assert.equal((await request(cold.port,'/api/queue')).status,401);
    await stop(cold);
  } finally {
    await Promise.all([...children].map(async child=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}));
    upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
    await db.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();
  }
});
