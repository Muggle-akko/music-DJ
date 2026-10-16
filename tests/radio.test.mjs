import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadioService, radioTracks, validateRadioScript } from '../lib/radio.mjs';
import { schemas, writes } from '../lib/agent/schemas.mjs';
import { serial } from '../lib/storage.mjs';

const tracks = [1,2,3].map(id=>({id:String(id),provider:'netease',title:`歌曲${id}`,artist:'测试音乐人',album:'测试专辑',duration:240000,playable:true,url:'https://expired.invalid/file'}));
function fixture(model = async()=>({cues:[{trackId:'1',kind:'opening',text:'从这三首歌开始今天的电台。'},{trackId:'3',kind:'closing',text:'这一期在这里告一段落。'}]})) {
  let state={queue:structuredClone(tracks),queueRevision:3,radioHistory:[],agent:{mode:'external',plans:{},operations:{}}};
  const key=Symbol().toString()+Math.random();
  const options={readState:async()=>structuredClone(state),mutateState:fn=>serial(key,async()=>{const next=structuredClone(state);const value=await fn(next);state=next;return structuredClone(value);}),model,brain:'fixture',voiceProvider:'none'};
  let service=createRadioService(options), n=0;
  const call=(tool,args={})=>service.call(`awudio_${tool}`,tool==='get_radio' ? args : {operationId:`test-${++n}`,...args});
  return {call,state:()=>structuredClone(state),mutate:options.mutateState,restart:()=>{service=createRadioService(options);}};
}
const prepare=f=>f.call('prepare_radio',{source:'queue',expectedQueueRevision:3,title:'一期电台'});

test('电台制作不改变队列；API 文案、归档及重启后读取保持一致',async()=>{
  const f=fixture(),before=f.state().queue;
  const {draft}=await prepare(f);
  assert.ok(draft.tracks.every(t=>t.url.startsWith('/api/music/stream?')));
  const written=await f.call('write_radio_script',{draftId:draft.id,expectedRevision:0,mode:'api'});
  const saved=await f.call('save_radio',{draftId:draft.id,expectedRevision:1,title:'出发与告别',narration:false});
  assert.equal(written.draft.cues.length,2);
  assert.equal(saved.radio.introCount,2);
  assert.equal(saved.radio.tracks[0].hostIntro.status,'text_only');
  assert.equal(saved.radio.tracks[2].hostIntro.startAtMs,220000);
  assert.deepEqual(f.state().queue,before);
  assert.equal(f.state().queueRevision,3);
  f.restart();
  assert.equal((await f.call('get_radio',{draftId:draft.id})).draft.cues.length,2);
  assert.equal((await f.call('get_radio')).history[0].title,'出发与告别');
});

test('Agent 文案共用草稿；旧 revision 和异曲解说被拒绝',async()=>{
  const f=fixture(),{draft}=await prepare(f);
  await assert.rejects(f.call('write_radio_script',{draftId:draft.id,expectedRevision:0,mode:'agent',cues:[{trackId:'999',kind:'transition',text:'别的歌'}]}),/本期以外/);
  await f.call('write_radio_script',{draftId:draft.id,expectedRevision:0,mode:'agent',cues:[{trackId:'1',kind:'opening',text:'这是 Agent 写的开场。'}]});
  await assert.rejects(f.call('write_radio_script',{draftId:draft.id,expectedRevision:0,mode:'manual',cues:[]}),/草稿已/);
  assert.equal((await f.call('get_radio',{draftId:draft.id})).draft.scriptMode,'agent');
});

test('重复操作幂等；同一草稿修订不重复新增历史电台',async()=>{
  const f=fixture(),args={operationId:'prepare-fixed',source:'queue',expectedQueueRevision:3};
  const a=await f.call('prepare_radio',args),b=await f.call('prepare_radio',args);
  assert.equal(a.draft.id,b.draft.id);
  await assert.rejects(f.call('prepare_radio',{...args,title:'其他参数'}),/操作编号/);
  const save={operationId:'save-fixed',draftId:a.draft.id,expectedRevision:0,title:'纯音乐',narration:false};
  const s1=await f.call('save_radio',save),s2=await f.call('save_radio',save);
  assert.equal(s1.radio.id,s2.radio.id);
  await f.call('save_radio',{draftId:a.draft.id,expectedRevision:1,title:'改名',narration:false});
  assert.equal(f.state().radioHistory.length,1);
  assert.equal(f.state().radioHistory[0].title,'改名');
});

test('API 生成期间被 Agent 更新，模型结果不能覆盖新文案',async()=>{
  let release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture(async()=>{started();return pending;}),{draft}=await prepare(f);
  const generating=f.call('write_radio_script',{draftId:draft.id,expectedRevision:0,mode:'api'});
  await ready;
  await f.call('write_radio_script',{draftId:draft.id,expectedRevision:0,mode:'agent',cues:[{trackId:'1',kind:'opening',text:'保留新文案'}]});
  release({cues:[{trackId:'1',kind:'opening',text:'旧生成结果'}]});
  await assert.rejects(generating,/草稿已/);
  assert.equal((await f.call('get_radio',{draftId:draft.id})).draft.cues[0].text,'保留新文案');
});

test('没有模型或语音配置时明确失败，保存纯文字与无解说电台仍可用',async()=>{
  const f=fixture(null),{draft}=await prepare(f);
  await assert.rejects(f.call('write_radio_script',{draftId:draft.id,expectedRevision:0,mode:'api'}),/尚未配置/);
  await assert.rejects(f.call('save_radio',{draftId:draft.id,expectedRevision:0,title:'声音',narration:true}),/语音服务/);
  await f.call('save_radio',{draftId:draft.id,expectedRevision:0,title:'无解说',narration:false});
  assert.equal(f.state().radioHistory[0].introCount,0);
});

test('两份历史修订互相保护，手动清空文案可保存',async()=>{
  const f=fixture(),{draft}=await prepare(f);
  const saved=await f.call('save_radio',{draftId:draft.id,expectedRevision:0,title:'初版',narration:false});
  const one=await f.call('prepare_radio',{source:'history',sourceId:saved.radio.id});
  const two=await f.call('prepare_radio',{source:'history',sourceId:saved.radio.id});
  await f.call('write_radio_script',{draftId:one.draft.id,expectedRevision:0,mode:'manual',cues:[]});
  await f.call('save_radio',{draftId:one.draft.id,expectedRevision:1,title:'新版',narration:false});
  await assert.rejects(f.call('save_radio',{draftId:two.draft.id,expectedRevision:0,title:'旧页覆盖',narration:false}),/其他草稿更新/);
  assert.equal(f.state().radioHistory[0].title,'新版');
});

test('解说位置、重复曲目及队列版本受约束，语音沿用按曲目时机触发',async()=>{
  const f=fixture();
  await assert.rejects(f.call('prepare_radio',{source:'queue',expectedQueueRevision:2}),/队列已经变化/);
  assert.throws(()=>validateRadioScript([{trackId:'2',kind:'opening',text:'错位'}],tracks),/第一首/);
  assert.throws(()=>validateRadioScript([{trackId:'2',kind:'closing',text:'错位'}],tracks),/最后一首/);
  assert.throws(()=>validateRadioScript([{trackId:'1',kind:'opening',text:'一'},{trackId:'1',kind:'transition',text:'二'}],tracks),/最多一段/);
  const withVoice=radioTracks({id:'draft',tracks,cues:[{trackId:'1',kind:'opening',text:'开场'}]},true,'fish');
  assert.equal(withVoice[0].hostIntro.provider,'fish');
  assert.equal(withVoice[0].hostIntro.status,'pending');
  assert.equal(withVoice[1].hostIntro,null);
});

test('新版 MCP 工具已注册并带写入标记',()=>{
  for(const name of ['awudio_prepare_radio','awudio_get_radio','awudio_write_radio_script','awudio_save_radio'])assert.ok(schemas[name]);
  assert.ok(writes.has('awudio_save_radio'));
  assert.ok(!writes.has('awudio_get_radio'));
});
