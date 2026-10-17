import { mobileClient } from '/device-policy.mjs?v=36';
export function createMobileWorkspace({audio,getTrack,renderCover,onPlay,onNext,onLocate}={}) {
  const el=id=>document.getElementById(id);
  const request=document.querySelector('.request-panel'), queue=document.querySelector('.queue-panel');
  const requestSlot=document.createComment('desktop workspace'),queueSlot=document.createComment('desktop queue');
  request.before(requestSlot);queue.before(queueSlot);
  const deck=el('mobileDeck'),stage=el('mobileDeckStage'),sheet=el('mobileSettings');
  const settingNodes=['agentConnectionSettings','radioSettings'].map(id=>{
    const node=el(id),slot=document.createComment(id);node.before(slot);return {node,slot};
  });
  const tabNames=['aiTab','searchTab','playlistTab'].map(id=>({node:el(id),desktop:el(id).textContent}));
  let compact=false,face='queue',settingsLoaded=false;
  const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function update() {
    const track=getTrack?.(),mini=el('miniPlayer');
    mini.hidden=!compact || !track || document.querySelector('.controls').getBoundingClientRect().bottom>0;
    document.body.classList.toggle('has-mini-player',!mini.hidden);
    el('locateCurrent').hidden=!track || face!=='queue';
    if(!track)return;
    const key=[track.id,track.title,track.artist,track.cover].join('|');
    if(el('miniTrack').dataset.track!==key){
      el('miniTrack').dataset.track=key;el('miniCover').innerHTML=renderCover(track);
      el('miniTitle').textContent=track.title || '未知歌曲';
    }
    el('miniArtist').textContent=audio.error ? '音源不可用，点击重试' : !audio.paused && audio.readyState<3 ? '正在缓冲…' : track.artist || '未知音乐人';
    const label=audio.paused ? '播放':'暂停',symbol=audio.paused ? 'play-fill':'pause-fill';
    if(!el('miniPlay').firstElementChild || el('miniPlay').getAttribute('aria-label')!==label){el('miniPlay').setAttribute('aria-label',label);el('miniPlay').innerHTML=`<svg class="ph-icon" viewBox="0 0 256 256" aria-hidden="true"><use href="/assets/phosphor.svg#${symbol}"></use></svg>`;}
  }
  function showFace(value,{focus=false}={}) {
    face=value;
    deck.dataset.face=value;
    const isQueue=value==='queue';
    queue.inert=compact && !isQueue;request.inert=compact && isQueue;
    queue.setAttribute('aria-hidden',String(compact && !isQueue));request.setAttribute('aria-hidden',String(compact && isQueue));
    el('mobileDeckTitle').textContent=isQueue?'我的音乐':'发现音乐';
    const flip=el('mobileFlip');flip.setAttribute('aria-label',isQueue?'翻到 AI 推荐、搜索和云歌单':'翻回播放队列、我喜欢和历史电台');
    flip.setAttribute('aria-pressed',String(!isQueue));el('mobileFlipLabel').textContent=isQueue?'发现音乐':'我的音乐';
    update();
    if(focus)flip.focus({preventScroll:true});
  }
  function layout() {
    const next=mobileClient || matchMedia('(max-width: 860px)').matches;
    if(next===compact)return;
    compact=next;document.body.classList.toggle('compact-player',compact);deck.hidden=!compact;
    if(compact){
      document.querySelector('.player-panel').after(deck);
      ['AI 推荐','搜索','云歌单'].forEach((name,i)=>{tabNames[i].node.textContent=name;});
      stage.append(queue,request);queue.classList.add('deck-face','deck-front');request.classList.add('deck-face','deck-back');
      for(const {node} of settingNodes){node.removeAttribute('popover');node.hidden=false;el(node.id==='radioSettings'?'mobilePreferenceSettings':'mobilePlayerSettings').append(node);}
      showFace(face);
    }else{
      tabNames.forEach(({node,desktop})=>{node.textContent=desktop;});
      requestSlot.after(request);queueSlot.after(queue);request.classList.remove('deck-face','deck-back');queue.classList.remove('deck-face','deck-front');
      for(const {node,slot} of settingNodes){slot.after(node);node.hidden=node.id==='agentConnectionSettings';if(node.id==='radioSettings')node.setAttribute('popover','auto');}
      request.inert=queue.inert=false;request.removeAttribute('aria-hidden');queue.removeAttribute('aria-hidden');sheet.close();
    }
    update();
  }
  el('mobileFlip').addEventListener('click',()=>showFace(face==='queue'?'request':'queue'));
  el('mobileSettingsOpen').addEventListener('click',async()=>{
    sheet.showModal();
    if(!settingsLoaded){settingsLoaded=true;try{await import('/settings.mjs');}catch{settingsLoaded=false;el('settingsStatus').textContent='设置加载失败，请重新打开';}}
    else window.dispatchEvent(new Event('awudio:settings-open'));
  });
  el('mobileSettingsClose').addEventListener('click',()=>sheet.close());
  sheet.addEventListener('click',e=>{if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientY<r.top||e.clientX<r.left||e.clientX>r.right)sheet.close();}});
  const handle=sheet.querySelector('header');let drag=null;
  handle.addEventListener('pointerdown',event=>{if(event.target.closest('button') || event.button!==0)return;drag={id:event.pointerId,y:event.clientY};handle.setPointerCapture(event.pointerId);});
  handle.addEventListener('pointermove',event=>{if(drag?.id===event.pointerId)sheet.style.setProperty('--sheet-drag',`${Math.max(0,event.clientY-drag.y)}px`);});
  const endDrag=event=>{if(drag?.id!==event.pointerId)return;const close=event.type!=='pointercancel' && event.clientY-drag.y>80;drag=null;sheet.style.removeProperty('--sheet-drag');if(close)sheet.close();};
  handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);
  el('miniPlay').addEventListener('click',()=>onPlay?.());el('miniNext').addEventListener('click',()=>onNext?.());
  el('miniTrack').addEventListener('click',()=>document.querySelector('.player-panel').scrollIntoView({block:'start',behavior:reduceMotion()?'instant':'smooth'}));
  el('locateCurrent').addEventListener('click',()=>onLocate?.());
  for(const event of ['play','pause','playing','waiting','stalled','error','emptied'])audio?.addEventListener(event,update);
  let scrollFrame=0;
  window.addEventListener('scroll',()=>{if(!scrollFrame)scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;update();});},{passive:true});
  window.addEventListener('resize',update);
  matchMedia('(max-width: 860px)').addEventListener('change',layout);layout();
  return { update,showQueue:()=>showFace('queue'), get compact(){return compact;} };
}
