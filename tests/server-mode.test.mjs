import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateBridge } from '../lib/agent/connection.mjs';
import { createDeviceState } from '../lib/device-state.mjs';

test('remote MCP configuration explicitly opts in to HTTPS without URL credentials or paths', () => {
  const token='a'.repeat(64);
  assert.throws(()=>validateBridge({baseUrl:'https://radio.example',token}));
  assert.equal(validateBridge({baseUrl:'https://radio.example',token},{remote:true}).baseUrl,'https://radio.example');
  for(const baseUrl of ['http://radio.example','https://user:pass@radio.example','https://radio.example/path','https://radio.example/?token=x']) {
    assert.throws(()=>validateBridge({baseUrl,token},{remote:true}));
  }
  assert.equal(validateBridge({baseUrl:'http://127.0.0.1:4173',token}).baseUrl,'http://127.0.0.1:4173');
});

test('device state isolates asynchronous scopes and preserves the legacy queue', async () => {
  const device=createDeviceState(true);
  const root={queue:[{id:'legacy'}],queueCurrentIndex:0,queueRevision:5,deviceQueues:{}};
  await Promise.all(['a'.repeat(16),'b'.repeat(16)].map(id=>device.run(id,async()=>{
    await Promise.resolve();
    const view=device.view(structuredClone(root));assert.deepEqual(view.queue,[]);
    view.queue=[{id}];view.queueRevision=1;
    const packed=device.pack(view);
    assert.equal(packed.queue[0].id,'legacy');assert.equal(packed.deviceQueues[id].queue[0].id,id);
    assert.equal(packed.queueRevision,5);
  })));
});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function listen(server) { server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port; }

test('server HTTP: private media, owner login, device queues, remote Agent scope and restart persistence', async () => {
  let upstreamBase, mediaCalls=0, loginAvailable=true, lyricCalls=0;
  const upstream=createServer((req,res)=>{
    const url=new URL(req.url,'http://fixture');
    let data={code:200};
    if(url.pathname==='/login/status') {
      const valid=loginAvailable && req.headers.cookie?.includes('MUSIC_U=valid');
      data={code:200,data:{profile:valid ? {userId:req.headers.cookie.includes('other') ? 999:123}:null}};
    } else if(url.pathname==='/cloudsearch' || url.pathname==='/song/detail') {
      const song={id:3,name:'Agent fixture',ar:[{id:10,name:'Artist'}],al:{id:20,name:'Album'},dt:180000};
      data=url.pathname==='/cloudsearch' ? {code:200,result:{songs:[song]}} : {code:200,songs:[song]};
    } else if(url.pathname.startsWith('/song/url')) data={code:200,data:[{id:Number(url.searchParams.get('id') || 1),url:`${upstreamBase}/audio`,freeTrialInfo:null,code:200,time:180000}]};
    else if(url.pathname==='/audio') {
      mediaCalls++;res.writeHead(206,{'Content-Type':'audio/mpeg','Content-Range':'bytes 0-3/10','Accept-Ranges':'bytes','Content-Length':'4'});res.end('test');return;
    } else if(url.pathname==='/login/qr/key') data={code:200,data:{unikey:'fixture-key'}};
    else if(url.pathname==='/login/qr/create') data={code:200,data:{qrimg:'data:image/png;base64,dGVzdA=='}};
    else if(url.pathname==='/login/qr/check') data={code:803,cookie:'MUSIC_U=valid'};
    else if(url.pathname==='/lyric') {lyricCalls++;data=lyricCalls===1 ? {code:500,message:'temporary lyric failure'} : {code:200,lrc:{lyric:'[00:01.00]Recovered lyric'}};}
    else if(url.pathname==='/user/playlist') data={code:200,playlist:[],more:false};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
  });
  upstreamBase=`http://127.0.0.1:${await listen(upstream)}`;
  const probe=createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));
  const dir=await mkdtemp(join(tmpdir(),'awudio-server-mode-'));
  let child, cookie;
  const origin='https://radio.example';
  const deviceA='a'.repeat(32), deviceB='b'.repeat(32);
  async function request(path,{body,auth=true,device=deviceA,headers={}}={}) {
    const {response,text}=await new Promise((resolve,reject)=>{
      const request=httpRequest(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',
        headers:{Host:'radio.example','Content-Type':'application/json','X-Awudio-Device':device,...(auth&&cookie?{Cookie:cookie}:{}),...headers}},res=>{
          let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({response:{status:res.statusCode,headers:new Headers(res.headers)},text}));
        });request.on('error',reject);if(body!==undefined)request.write(JSON.stringify(body));request.end();
    });
    let data;try{data=JSON.parse(text);}catch{data=text;}
    return {response,data,status:response.status};
  }
  async function start() {
    child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),stdio:'ignore',env:{...process.env,
      PORT:String(port),AWUDIO_MODE:'server',AWUDIO_PUBLIC_URL:origin,AWUDIO_PASSWORD:'fixture-password-long-enough',AWUDIO_DATA_DIR:dir,
      NCM_API_BASE:upstreamBase,NCM_COOKIE:'',AI_PROVIDER:'local',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:'',TTS_PROVIDER:'none',FISH_AUDIO_API_KEY:''}});
    for(let i=0;i<100;i++){try{if((await request('/healthz')).status===200)return;}catch{}await sleep(30);}
    throw new Error('fixture server did not start');
  }
  async function stop() { if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');} }
  try {
    await start();
    for(const path of ['/api/music/lyric?id=1','/api/music/cover?url=https%3A%2F%2Fp1.music.126.net%2Fcover.jpg','/api/queue','/api/radios','/api/config','/api/music/stream?id=1','/api/tts/audio/fixture.mp3','/api/instance']) {
      assert.equal((await request(path,{auth:false})).status,401,path);
    }
    assert.equal(mediaCalls,0);
    assert.equal((await request('/',{auth:false})).response.headers.get('location'),'/signin');
    assert.equal((await request('/signin',{auth:false})).status,200);
    assert.equal((await request('/api/access/login',{body:{password:'bad'},headers:{Origin:origin}})).status,401);
    assert.equal((await request('/api/access/login',{body:{password:'fixture-password-long-enough'},headers:{Origin:'https://evil.example'}})).status,401);
    const login=await request('/api/access/login',{body:{password:'fixture-password-long-enough'},headers:{Origin:origin}});
    assert.equal(login.status,200);const setCookie=login.response.headers.get('set-cookie');
    assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Strict/);cookie=setCookie.split(';')[0];
    assert.equal((await request('/api/instance/cookie',{body:{cookie:'MUSIC_U=valid'}})).status,200);
    assert.equal((await request('/api/instance')).data.authenticated,true);
    assert.equal((await request('/api/music/lyric?id=1')).status,500,'upstream failure must not look like a song without lyrics');
    const recovered=await request('/api/music/lyric?id=1');
    assert.equal(recovered.status,200);assert.match(recovered.data.lyric,/Recovered lyric/);
    await request('/api/music/lyric?id=1');assert.equal(lyricCalls,2,'successful lyrics reuse the server cache');
    assert.equal((await request('/api/music/lyric?id=bad')).status,400);
    assert.equal((await request('/api/music/cover?url=https://example.com/cover.jpg')).status,400);

    assert.equal((await request('/api/instance/cookie',{body:{cookie:'MUSIC_U=valid-other'}})).status,400);
    assert.equal((await request('/api/instance')).data.account.userId,'123');
    assert.equal((await stat(join(dir,'netease-connection.json'))).mode&0o777,0o600);
    const track={id:'1',provider:'netease',title:'Fixture',artist:'Artist',url:'/api/music/stream?id=1&full=1',playable:true,duration:180000};
    const writes=await Promise.all([deviceA,deviceB].map((device,index)=>request('/api/queue',{device,body:{queue:[{...track,id:String(index+1)}],currentIndex:0,expectedRevision:0}})));
    assert.deepEqual(writes.map(r=>r.status),[200,200]);
    assert.equal((await request('/api/queue')).data.queue[0].id,'1');
    assert.equal((await request('/api/queue',{device:deviceB})).data.queue[0].id,'2');
    assert.equal((await request('/api/queue',{body:{queue:[],expectedRevision:0}})).status,409);
    assert.equal((await request('/api/queue',{headers:{Host:'evil.example'}})).status,401);
    assert.equal((await request('/api/queue',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,401);
    const audio=await request('/api/music/stream?id=1&full=1',{headers:{Range:'bytes=0-3'}});
    assert.equal(audio.status,206);assert.equal(audio.data,'test');assert.equal(audio.response.headers.get('content-range'),'bytes 0-3/10');
    const bridge=(await request('/api/instance/agent-connection',{body:{}})).data;
    assert.equal(bridge.baseUrl,origin);assert.ok(bridge.token.length>=40);
    assert.equal((await request('/api/queue',{auth:false,headers:{Authorization:`Bearer ${bridge.token}`}})).status,401);
    assert.equal((await request('/api/agent/register',{auth:false,body:{name:'Remote Agent'},headers:{Authorization:'Bearer wrong'}})).status,401);
    const agent=(await request('/api/agent/register',{auth:false,body:{name:'Remote Agent'},headers:{Authorization:`Bearer ${bridge.token}`}})).data;
    assert.ok(agent.sessionId);
    const register=await request('/api/player/register',{body:{name:'iPad'},headers:{'X-Awudio-Browser':'1'}});
    const player=register.data;
    const playerHeaders={'X-Awudio-Browser':'1','X-Awudio-Player-Token':player.token};
    await request('/api/player/mode',{body:{mode:'external'},headers:playerHeaders});
    await request('/api/player/heartbeat',{body:{playback:{queueRevision:1,paused:true}},headers:playerHeaders});
    const context=await request('/api/agent/call',{auth:false,body:{tool:'awudio_get_context',args:{}},headers:{Authorization:`Bearer ${bridge.token}`,'X-Awudio-Agent-Session':agent.sessionId}});
    assert.equal(context.data.queue[0].id,'1');
    const agentHeaders={Authorization:`Bearer ${bridge.token}`,'X-Awudio-Agent-Session':agent.sessionId};
    const search=(await request('/api/agent/call',{auth:false,body:{tool:'awudio_search_tracks',args:{query:'Fixture'}},headers:agentHeaders})).data;
    const plan=(await request('/api/agent/call',{auth:false,body:{tool:'awudio_submit_plan',args:{operationId:'submit-plan',intent:'recommend',requestSummary:'Fixture plan',tracks:[{trackId:'3',lookupRef:search.lookupRef,evidenceRefs:search.tracks[0].evidenceRefs,reason:'Fixture selection'}]}},headers:agentHeaders})).data;
    assert.ok(plan.planId);
    const applied=await request('/api/agent/call',{auth:false,body:{tool:'awudio_apply_plan',args:{operationId:'apply-plan',planId:plan.planId,targetPlayerId:player.playerId,expectedRevision:1,queueMode:'append',playback:'keep'}},headers:agentHeaders});
    assert.equal(applied.status,200);
    assert.deepEqual((await request('/api/queue')).data.queue.map(t=>t.id),['1','3']);
    assert.equal((await request('/api/queue',{device:deviceB})).data.queue[0].id,'2');

    // A mobile browser can listen but cannot invoke authoring/model endpoints.
    for(const path of ['/api/radios/studio','/api/chat','/api/chat/stream']) {
      assert.equal((await request(path,{body:{},headers:{'X-Awudio-Client':'mobile'}})).status,403);
      assert.equal((await request(path,{body:{},headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}})).status,403);
    }
    assert.equal((await request('/api/player/mode',{body:{mode:'builtin'},headers:{...playerHeaders,'X-Awudio-Client':'mobile'}})).status,400);
    assert.equal((await request('/api/radios',{headers:{'X-Awudio-Client':'mobile'}})).status,200);

    // Agent-produced history is shared; device queues remain independent.
    const draft=await request('/api/radios/studio',{body:{tool:'awudio_prepare_radio',args:{source:'queue',expectedQueueRevision:2,operationId:'prepare-radio'}}});
    assert.equal(draft.status,200);
    const saved=await request('/api/radios/studio',{body:{tool:'awudio_save_radio',args:{draftId:draft.data.draft.id,expectedRevision:draft.data.draft.revision,operationId:'save-radio',title:'Shared episode',narration:false}}});
    assert.equal(saved.status,200);
    assert.equal((await request('/api/radios',{device:deviceB})).data.radios[0].title,'Shared episode');
    const qr=(await request('/api/instance/qr',{body:{}})).data;
    const qrCheck=await request('/api/instance/qr/check',{body:{id:qr.id}});
    assert.equal(qrCheck.data.code,803);assert.equal(qrCheck.data.cookie,undefined);
    await stop();loginAvailable=false;await start();
    assert.equal((await request('/api/queue')).data.queue[0].id,'1');
    assert.equal((await request('/api/queue',{device:deviceB})).data.queue[0].id,'2');
    assert.equal((await request('/api/radios')).data.radios[0].title,'Shared episode');
    loginAvailable=true;
    assert.equal((await request('/api/instance')).data.authenticated,true);
    assert.ok(JSON.parse(await readFile(join(dir,'browser-sessions.json'),'utf8')).sessions);
    assert.equal((await request('/api/access/logout',{body:{}})).status,200);
    assert.equal((await request('/api/queue')).status,401);
    assert.equal((await request('/api/music/stream?id=1')).status,401);
  } finally { await stop();upstream.closeAllConnections();await new Promise(r=>upstream.close(r)); }
});
