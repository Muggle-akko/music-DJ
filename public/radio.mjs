import { mobileClient } from "/device-policy.mjs?v=36";
import { apiFetch } from "/network.mjs?v=46";
export function createRadioStudio({ flushQueue, getRevision, notice, onSaved }) {
  const el = id => document.getElementById(id);
  const dialog = el('radioStudio');
  let draft, capabilities = {}, busy = false, dirty = false, preferencesDirty=false, selectedMode = 'api';
  const readPreferences=()=>({density:el('radioDensity').value,content:el('radioContentPreference').value.trim()});
  const collectCues=()=>[...el('radioScriptList').children].map(item=>({trackId:item.dataset.trackId,kind:item.querySelector('select').value,text:item.querySelector('textarea').value.trim(),startAtMs:Math.round(Number(item.querySelector('input[type=number]').value)*1000)})).filter(c=>c.text);
  async function persistLocalDraft() {
    if(!dirty && !preferencesDirty)return;
    const result=await request('awudio_write_radio_script',{operationId:operation(),draftId:draft.id,expectedRevision:draft.revision,mode:'manual',title:el('radioTitle').value.trim() || draft.title,preferences:readPreferences(),cues:collectCues()});
    draft=result.draft;dirty=false;preferencesDirty=false;
  }
  async function request(tool, args) {
    const response = await apiFetch('/api/radios/studio', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,args}),signal:AbortSignal.timeout(100000)});
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || '电台操作未完成');
    return data;
  }
  const operation = () => crypto.randomUUID();
  async function loadDraftList() {
    const data=await request('awudio_get_radio',{}),select=el('radioDraftPicker');select.replaceChildren();
    for(const item of data.drafts){const option=document.createElement('option');option.value=item.id;option.textContent=item.title;select.append(option);}
    if(draft)select.value=draft.id;
    return data;
  }
  function message(text) { el('radioStudioStatus').textContent = text; }
  function setBusy(value) {
    busy=value; dialog.setAttribute('aria-busy',String(value));
    dialog.querySelectorAll('button, input, textarea, select').forEach(node => { node.disabled=value; });
    el('radioApiMode').disabled=value || !capabilities.api;
    el('radioNarration').disabled=value || !capabilities.voice;
    el('radioSave').disabled=value || !draft;
  }
  function mode(value) {
    selectedMode=value;
    el('radioApiMode').setAttribute('aria-pressed',String(value==='api'));
    el('radioAgentMode').setAttribute('aria-pressed',String(value==='agent'));
    el('radioApiControls').hidden=value!=='api'; el('radioAgentControls').hidden=value!=='agent';
  }
  function render() {
    if (!draft) return;
    el('radioTitle').value=draft.title;
    el('radioDensity').value=draft.preferences?.density || 'balanced';
    el('radioContentPreference').value=draft.preferences?.content || '';
    el('radioSourceSummary').textContent=`${draft.tracks.length} 首 · 约 ${Math.round(draft.tracks.reduce((n,t)=>n+Number(t.durationMs || t.duration || 0),0)/60000)} 分钟 · ${draft.radioId ? '已保存，可继续修订' : '制作草稿'}`;
    el('radioNarration').checked=Boolean(draft.narration && capabilities.voice);
    el('radioVoiceHint').textContent=capabilities.voice ? '朗读会在回听时合成，生成失败不打断音乐。' : '当前未配置语音服务，解说将以文字展示。';
    const target=el('radioScriptList'); target.replaceChildren();
    for(const [index,track] of draft.tracks.entries()) {
      const existing=draft.cues.find(c=>c.trackId===track.id);
      const item=document.createElement('details'); item.className='radio-script-item'; item.dataset.trackId=track.id; item.open=Boolean(existing);
      const summary=document.createElement('summary');
      const order=document.createElement('span'); order.className='radio-track-index'; order.textContent=String(index+1).padStart(2,'0');
      const info=document.createElement('span'); info.className='radio-track-name';
      const title=document.createElement('strong'); title.textContent=track.title;
      const artist=document.createElement('small'); artist.textContent=track.artist; info.append(title,artist);
      const badge=document.createElement('span'); badge.className='radio-cue-label'; badge.textContent=existing ? '有解说' : '添加串词'; summary.append(order,info,badge);
      const body=document.createElement('div'); body.className='radio-script-body';
      const select=document.createElement('select'); select.setAttribute('aria-label',`${track.title}的解说位置`);
      const kinds=[['transition','曲间串词'],...(index===0 ? [['opening','开场']] : []),...(index===draft.tracks.length-1 && index!==0 ? [['closing','结语']] : [])];
      for(const [value,label] of kinds){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
      select.value=existing?.kind || (index===0 ? 'opening' : 'transition');
      const input=document.createElement('textarea');input.rows=4;input.maxLength=600;input.value=existing?.text || '';input.placeholder='留空则这首歌不加解说。';input.setAttribute('aria-label',`${track.title}的解说词`);
      const timing=document.createElement('label');timing.className='radio-cue-timing';timing.append('出现时间');
      const seconds=document.createElement('input');seconds.type='number';seconds.min='0';seconds.max=String(Math.max(0,Math.floor(Number(track.durationMs || track.duration || 0)/1000)));seconds.step='1';
      const fallback=existing?.kind==='closing' ? Math.max(0,Number(track.durationMs || track.duration || 0)-Math.max(12000,[...(existing.text || '')].length/4.2*1000)-8000) : 0;
      seconds.value=String(Math.round(Number(existing?.startAtMs ?? fallback)/1000));seconds.setAttribute('aria-label',`${track.title}的解说出现秒数`);seconds.addEventListener('input',()=>{dirty=true;});
      const hint=document.createElement('span');hint.textContent=existing?.fitsWindow ? '秒 · 歌词空档候选' : '秒 · 未确认足够窗口，保留文字';timing.append(seconds,hint);
      input.addEventListener('input',()=>{dirty=true;badge.textContent=input.value.trim() ? '有解说' : '添加串词';message('文案有修改，保存时一并更新。');});select.addEventListener('change',()=>{dirty=true;});
      body.append(select,timing,input);item.append(summary,body);target.append(item);
    }
    dirty=false;preferencesDirty=false;mode(selectedMode);setBusy(busy);
  }
  async function run(task) {
    if(busy)return;setBusy(true);
    try{await task();}catch(error){message(error.message);}finally{setBusy(false);}
  }
  async function refresh() {
    const data=await request('awudio_get_radio',{draftId:draft.id});
    capabilities=data.capabilities;draft=data.draft;render();
  }
  async function open(source='queue',sourceId) {
    if(mobileClient){notice('请在电脑上制作电台');return;}
    if(busy)return;
    if(!dialog.open)dialog.showModal();
    message('正在准备电台草稿…');
    await run(async()=>{
      if(!await flushQueue())throw new Error('请先解决队列冲突，再制作电台');
      const data=await request('awudio_get_radio',{});capabilities=data.capabilities;
      const match=source==='history' ? null : data.drafts.find(d=>d.source===source && (source==='queue' ? d.trackIds.join(',')===data.queueTrackIds?.join(',') : d.sourceId===sourceId));
      if(match) draft=(await request('awudio_get_radio',{draftId:match.id})).draft;
      else draft=(await request('awudio_prepare_radio',{operationId:operation(),source,...(sourceId ? {sourceId}:{}),...(source==='queue' ? {expectedQueueRevision:getRevision()}: {})})).draft;
      selectedMode=capabilities.api ? 'api':'agent';render();await loadDraftList();
      message(draft.cues.length ? '解说可直接编辑；保存后会收进历史电台。' : '先生成解说或直接写串词，也可以仅保存歌单。');
    });
  }
  async function openDraft(id) {
    if(mobileClient){notice('请在电脑上制作电台');return;}
    if(busy)return;if(!dialog.open)dialog.showModal();
    await run(async()=>{const data=await request('awudio_get_radio',{draftId:id});capabilities=data.capabilities;draft=data.draft;render();message('已恢复制作草稿。');});
  }
  el('radioApiMode').addEventListener('click',()=>mode('api'));
  el('radioDensity').addEventListener('change',()=>{preferencesDirty=true;message('频率偏好会用于下一次生成，并随电台保存。');});
  el('radioContentPreference').addEventListener('input',()=>{preferencesDirty=true;});
  el('radioDraftPicker').addEventListener('change',event=>{
    if(dirty || preferencesDirty){event.target.value=draft.id;message('请先保存本页修改，再切换草稿。');return;}
    void openDraft(event.target.value);
  });
  el('radioAgentMode').addEventListener('click',()=>mode('agent'));
  el('radioClose').addEventListener('click',()=>{
    if(busy)return;
    if(dirty || preferencesDirty){message('还有未保存的文案或偏好，请先保存，或刷新草稿放弃本页修改。');return;}
    dialog.close();
  });
  dialog.addEventListener('cancel',event=>{if(busy || dirty || preferencesDirty){event.preventDefault();message(busy ? '正在处理，请稍候。':'还有未保存的文案或偏好，请先保存或刷新草稿。');}});
  el('radioGenerate').addEventListener('click',()=>run(async()=>{
    if(!draft)return;
    if(dirty)throw new Error('请先保存本页修改；生成新解说会替换草稿里的文案。');
    message('正在写开场与串词，通常需要几十秒…');
    const result=await request('awudio_write_radio_script',{operationId:operation(),draftId:draft.id,expectedRevision:draft.revision,mode:'api',title:el('radioTitle').value.trim() || draft.title,brief:el('radioBrief').value,preferences:readPreferences()});
    draft=result.draft;render();message(`已写入 ${draft.cues.length} 段解说，请审阅时间与文案后保存。`);
  }));
  el('radioRefreshDraft').addEventListener('click',()=>run(async()=>{await refresh();message('已读取最新草稿。');}));
  el('radioCopyTask').addEventListener('click',()=>run(async()=>{
    if(!draft)return;
    await persistLocalDraft();
    await navigator.clipboard.writeText(`请使用 Awudio 音乐工具，为电台草稿 ${draft.id} 写中文开场、适量曲间串词和结语。先调用 awudio_get_radio 读取曲目、preferences、cueContext 和最新 revision，遵守草稿的频率与内容偏好；参考歌词空档设置 startAtMs，不把空档当无人声保证。再以 mode=agent 调用 awudio_write_radio_script 提交文案。每首最多一段，转述相关热评，避免模板和重复长句；不要播放，不要自动保存为历史电台，交给我审阅。`);
    message('已复制，到 Agent 聊天中粘贴；完成后点击“读取最新草稿”。');
  }));
  el('radioSave').addEventListener('click',()=>run(async()=>{
    if(!draft)return;
    const title=el('radioTitle').value.trim();if(!title)throw new Error('给这期电台起个名字。');
    await persistLocalDraft();
    const result=await request('awudio_save_radio',{operationId:operation(),draftId:draft.id,expectedRevision:draft.revision,title,narration:el('radioNarration').checked});
    draft=result.draft;render();await onSaved(result.radio);message('已保存到历史电台。队列和当前播放保持原样。');notice('电台已保存，可在“历史电台”中回听');
  }));
  el('makeRadioButton').addEventListener('click',()=>open());
  return {open,openDraft};
}
