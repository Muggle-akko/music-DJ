import { mobileClient } from '/device-policy.mjs?v=33';
export function createMobileWorkspace() {
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
  function showFace(value,{focus=false}={}) {
    face=value;
    deck.dataset.face=value;
    const isQueue=value==='queue';
    queue.inert=compact && !isQueue;request.inert=compact && isQueue;
    queue.setAttribute('aria-hidden',String(compact && !isQueue));request.setAttribute('aria-hidden',String(compact && isQueue));
    el('mobileDeckTitle').textContent='音乐库';
    const flip=el('mobileFlip');flip.setAttribute('aria-label',isQueue?'翻到 AI 推荐、搜索和云歌单':'翻回播放队列、我喜欢和历史电台');
    flip.setAttribute('aria-pressed',String(!isQueue));el('mobileFlipLabel').textContent=isQueue?'发现音乐':'播放列表';
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
  }
  el('mobileFlip').addEventListener('click',()=>showFace(face==='queue'?'request':'queue'));
  el('mobileSettingsOpen').addEventListener('click',async()=>{
    sheet.showModal();
    if(!settingsLoaded){settingsLoaded=true;try{await import('/settings.mjs');}catch{settingsLoaded=false;el('settingsStatus').textContent='设置加载失败，请重新打开';}}
    else window.dispatchEvent(new Event('awudio:settings-open'));
  });
  el('mobileSettingsClose').addEventListener('click',()=>sheet.close());
  sheet.addEventListener('click',e=>{if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientY<r.top||e.clientX<r.left||e.clientX>r.right)sheet.close();}});
  matchMedia('(max-width: 860px)').addEventListener('change',layout);layout();
  return { get compact(){return compact;} };
}
