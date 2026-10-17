import { mobileClient } from '/device-policy.mjs?v=36';
import { createPlayerMorph } from '/player-morph.mjs?v=43';
export function createMobileWorkspace({getTrack,onLocate}={}) {
  const el=id=>document.getElementById(id);
  const request=document.querySelector('.request-panel'), queue=document.querySelector('.queue-panel');
  const requestSlot=document.createComment('desktop workspace'),queueSlot=document.createComment('desktop queue');
  request.before(requestSlot);queue.before(queueSlot);
  const deck=el('mobileDeck'),stage=el('mobileDeckStage'),sheet=el('mobileSettings');
  const playerMorph=createPlayerMorph(document.querySelector('.player-panel'));
  const settingNodes=['agentConnectionSettings','radioSettings'].map(id=>{
    const node=el(id),slot=document.createComment(id);node.before(slot);return {node,slot};
  });
  const tabNames=['aiTab','searchTab','playlistTab'].map(id=>({node:el(id),desktop:el(id).textContent}));
  let compact=false,face='queue',settingsLoaded=false;
  let flipAnimation=null,flipToken=0,targetFace=face;
  const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function update() {
    const track=getTrack?.();
    el('locateCurrent').hidden=!track || face!=='queue';
  }
  function returnToPlayer() {
    playerMorph.expand();
  }

  function renderFace(value) {
    face=value;
    deck.dataset.face=value;
    const isQueue=value==='queue';
    queue.hidden=compact&&!isQueue;request.hidden=compact&&isQueue;
    queue.inert=compact && !isQueue;request.inert=compact && isQueue;
    queue.setAttribute('aria-hidden',String(compact && !isQueue));request.setAttribute('aria-hidden',String(compact && isQueue));
    el('mobileDeckTitle').textContent=isQueue?'我的音乐':'发现音乐';
    const flip=el('mobileFlip');flip.setAttribute('aria-label',isQueue?'翻到 AI 推荐、搜索和云歌单':'翻回播放队列、我喜欢和历史电台');
    flip.setAttribute('aria-pressed',String(!isQueue));el('mobileFlipLabel').textContent=isQueue?'发现音乐':'我的音乐';
    update();
  }
  function cancelFlip(){
    flipToken++;flipAnimation?.cancel();flipAnimation=null;
    deck.classList.remove('is-flipping');deck.removeAttribute('aria-busy');
    el('mobileFlip').disabled=false;
  }
  async function showFace(value,{focus=false,animate=false}={}) {
    if(animate&&flipAnimation)return;
    cancelFlip();targetFace=value;
    if(!animate||!compact||reduceMotion()||value===face){renderFace(value);return;}
    const token=flipToken;
    deck.classList.add('is-flipping');deck.setAttribute('aria-busy','true');
    el('mobileFlip').disabled=true;queue.inert=request.inert=true;
    try{
      // Rotate one complete, opaque card. Swap faces only at the edge so Safari
      // never has to composite two scrollable 3D backs on top of one another.
      flipAnimation=deck.animate([
        {transform:'perspective(1400px) rotateY(0deg)'},
        {transform:'perspective(1400px) rotateY(90deg)'},
      ],{duration:140,easing:'cubic-bezier(.5,0,.8,.6)',fill:'forwards'});
      await flipAnimation.finished;
      if(token!==flipToken)return;
      renderFace(value);queue.inert=request.inert=true;
      flipAnimation.cancel();
      flipAnimation=deck.animate([
        {transform:'perspective(1400px) rotateY(-90deg)'},
        {transform:'perspective(1400px) rotateY(0deg)'},
      ],{duration:140,easing:'cubic-bezier(.2,.5,.3,1)',fill:'both'});
      await flipAnimation.finished;
    }catch{if(token===flipToken)renderFace(value);}
    finally{
      if(token===flipToken){cancelFlip();renderFace(face);}
    }
    if(focus)el('mobileFlip').focus({preventScroll:true});
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
      cancelFlip();
      tabNames.forEach(({node,desktop})=>{node.textContent=desktop;});
      requestSlot.after(request);queueSlot.after(queue);request.classList.remove('deck-face','deck-back');queue.classList.remove('deck-face','deck-front');
      for(const {node,slot} of settingNodes){slot.after(node);node.hidden=node.id==='agentConnectionSettings';if(node.id==='radioSettings')node.setAttribute('popover','auto');}
      request.inert=queue.inert=false;request.hidden=queue.hidden=false;request.removeAttribute('aria-hidden');queue.removeAttribute('aria-hidden');sheet.close();
    }
    playerMorph.setEnabled(compact);
    update();
  }
  el('mobileFlip').addEventListener('click',()=>showFace(face==='queue'?'request':'queue',{animate:true}));
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&flipAnimation)showFace(targetFace);});
  el('mobileSettingsOpen').addEventListener('click',async()=>{
    sheet.showModal();
    if(!settingsLoaded){settingsLoaded=true;try{await import('/settings.mjs?v=44');}catch{settingsLoaded=false;el('settingsStatus').textContent='设置加载失败，请重新打开';}}
    else window.dispatchEvent(new Event('awudio:settings-open'));
  });
  el('mobileSettingsClose').addEventListener('click',()=>sheet.close());
  sheet.addEventListener('click',e=>{if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientY<r.top||e.clientX<r.left||e.clientX>r.right)sheet.close();}});
  const handle=sheet.querySelector('header');let drag=null;
  handle.addEventListener('pointerdown',event=>{if(event.target.closest('button') || event.button!==0)return;drag={id:event.pointerId,y:event.clientY};handle.setPointerCapture(event.pointerId);});
  handle.addEventListener('pointermove',event=>{if(drag?.id===event.pointerId)sheet.style.setProperty('--sheet-drag',`${Math.max(0,event.clientY-drag.y)}px`);});
  const endDrag=event=>{if(drag?.id!==event.pointerId)return;const close=event.type!=='pointercancel' && event.clientY-drag.y>80;drag=null;sheet.style.removeProperty('--sheet-drag');if(close)sheet.close();};
  handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);
  el('returnToPlayer').addEventListener('click',returnToPlayer);
  el('locateCurrent').addEventListener('click',()=>onLocate?.());
  matchMedia('(max-width: 860px)').addEventListener('change',layout);layout();
  return { update,showQueue:()=>showFace('queue'), get compact(){return compact;} };
}
