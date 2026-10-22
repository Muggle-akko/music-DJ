import { nextPlayerLayout, keyboardVisible } from '/player-layout-policy.mjs?v=52';

// Both views control the original audio element. The full player stays in normal flow.
export function createPlayerMorph(player, {deck}={}) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),viewport=window.visualViewport;
  const sourceTitle=player.querySelector('#trackInfo'),sourcePlay=player.querySelector('#playButton');
  const bar=document.createElement('section');bar.className='mobile-playback-bar';bar.hidden=true;
  bar.setAttribute('aria-label','精简播放器');
  bar.innerHTML='<button class="mobile-playback-title" type="button" aria-label="返回完整播放器"></button><button class="mobile-playback-play" type="button" aria-label="播放"></button><button class="mobile-playback-next" type="button" aria-label="下一首"><svg class="ph-icon" viewBox="0 0 256 256" aria-hidden="true"><use href="/assets/phosphor.svg#skip-forward"></use></svg></button>';
  const [title,play,next]=bar.querySelectorAll('button');document.body.append(bar);
  let enabled=false,compact=false,desired=false,busy=false,epoch=0,animations=[];
  let frame=0,geometry=null,needsMeasure=false,touching=false,lastScroll=0;
  let viewportTimer=0,focusTimer=0,focusPending=false,keyboardOpen=false,snapshot=null;
  let baselineHeight=viewport?.height||innerHeight,lastWidth=innerWidth;
  const editable=()=>document.activeElement?.matches('input,textarea,[contenteditable="true"]');
  const locked=()=>focusPending||keyboardOpen||Boolean(snapshot);
  const px=n=>`${Math.round(n*100)/100}px`;
  function syncControls(){
    title.textContent=sourceTitle.textContent;title.title='返回完整播放器';
    const icon=player.querySelector('#playIcon').cloneNode(true);icon.removeAttribute('id');
    play.replaceChildren(icon);
    play.setAttribute('aria-label',sourcePlay.getAttribute('aria-label')||'播放');
    play.setAttribute('aria-busy',sourcePlay.getAttribute('aria-busy')||'false');play.disabled=sourcePlay.disabled;
    next.disabled=player.querySelector('#nextButton').disabled;
  }
  const controlObserver=new MutationObserver(syncControls);
  controlObserver.observe(sourceTitle,{childList:true,characterData:true,subtree:true});
  controlObserver.observe(sourcePlay,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label','aria-busy','disabled']});
  controlObserver.observe(player.querySelector('#nextButton'),{attributes:true,attributeFilter:['disabled']});
  syncControls();
  function measure(){
    if(!enabled||!deck.isConnected)return;
    const rect=deck.getBoundingClientRect();
    geometry={deckTop:rect.top+scrollY,dockTop:parseFloat(getComputedStyle(deck).scrollMarginTop)||84};
    bar.style.left=px(rect.left);bar.style.width=px(rect.width);
  }
  async function settle(){
    if(!enabled||busy||desired===compact)return;
    busy=true;compact=desired;const token=++epoch;
    bar.hidden=false;bar.inert=!compact;bar.setAttribute('aria-hidden',String(!compact));
    player.inert=compact;player.classList.toggle('is-docked-source',compact);
    document.body.dataset.playerLayout=compact?'compacting':'expanding';
    const options={duration:reduced.matches?0:190,easing:'cubic-bezier(.22,.8,.25,1)'};
    animations=[bar.animate(compact?[{opacity:0,transform:'translateY(-8px)'},{opacity:1,transform:'none'}]:[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(-8px)'}],options),
      player.animate([{opacity:compact?1:0},{opacity:compact?0:1}],options)];
    try{await Promise.all(animations.map(animation=>animation.finished));}catch{/* Disable/resize can end the view. */}
    if(token!==epoch)return;
    animations.forEach(animation=>animation.cancel());animations=[];busy=false;
    bar.hidden=!compact;document.body.dataset.playerLayout=compact?'compact':'expanded';
    // A gesture may request another state while the transition runs. Finish this one first.
    if(!locked())void settle();
  }
  function paint(){
    frame=0;if(!enabled)return;
    if(needsMeasure){needsMeasure=false;measure();}
    if(!geometry)return;
    desired=nextPlayerLayout({compact:desired,deckTop:geometry.deckTop-scrollY,dockTop:geometry.dockTop,locked:locked()});
    if(!locked())void settle();
  }
  function schedule(measureAgain=false){needsMeasure ||= measureAgain;if(enabled&&!frame)frame=requestAnimationFrame(paint);}
  function settleViewport(){
    clearTimeout(viewportTimer);if(!enabled)return;
    if(touching||Date.now()-lastScroll<120){viewportTimer=setTimeout(settleViewport,160);return;}
    if(Math.abs((viewport?.scale||1)-1)>.05)return;
    const height=viewport?.height||innerHeight;
    if(innerWidth!==lastWidth){lastWidth=innerWidth;baselineHeight=Math.max(height,innerHeight);}
    keyboardOpen=keyboardVisible({focused:editable(),wasOpen:keyboardOpen,baseline:baselineHeight,height,scale:viewport?.scale||1});
    if(keyboardOpen)return;
    baselineHeight=height;document.body.style.setProperty('--mobile-viewport-height',px(height));
    measure();
    const restore=snapshot;snapshot=null;focusPending=false;
    if(restore&&geometry){
      // Correct browser keyboard panning only after the keyboard and finger have settled.
      window.scrollTo({top:restore.compact?Math.max(0,geometry.deckTop-geometry.dockTop):restore.scrollY,behavior:'instant'});
    }
    schedule(true);
  }
  function viewportChanged(){
    if(!enabled)return;
    const height=viewport?.height||innerHeight;
    const open=keyboardVisible({focused:editable(),wasOpen:keyboardOpen,baseline:baselineHeight,height,scale:viewport?.scale||1});
    if(open&&!keyboardOpen&&deck.contains(document.activeElement))snapshot ||= {compact:desired,scrollY};
    keyboardOpen=open;
    clearTimeout(viewportTimer);viewportTimer=setTimeout(settleViewport,180);
  }
  function expand(){
    if(!enabled)return;
    if(editable())document.activeElement.blur();
    snapshot=null;focusPending=false;
    window.scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});
  }
  title.addEventListener('click',expand);
  play.addEventListener('click',()=>sourcePlay.click());next.addEventListener('click',()=>player.querySelector('#nextButton').click());
  const observer=new ResizeObserver(()=>schedule(true));
  window.addEventListener('scroll',()=>{lastScroll=Date.now();schedule();},{passive:true});
  window.addEventListener('resize',viewportChanged,{passive:true});
  viewport?.addEventListener('resize',viewportChanged,{passive:true});
  viewport?.addEventListener('scroll',()=>{if(keyboardOpen)viewportChanged();},{passive:true});
  document.addEventListener('touchstart',()=>{touching=true;},{passive:true});
  const endTouch=event=>{touching=event.touches.length>0;if(!touching&&enabled)viewportChanged();};
  document.addEventListener('touchend',endTouch,{passive:true});document.addEventListener('touchcancel',endTouch,{passive:true});
  document.addEventListener('focusin',()=>{
    if(!enabled||!editable())return;
    if(deck.contains(document.activeElement))snapshot ||= {compact:desired,scrollY};
    focusPending=true;clearTimeout(focusTimer);
    focusTimer=setTimeout(()=>{focusPending=false;viewportChanged();},350);
  });
  document.addEventListener('focusout',()=>{if(enabled)viewportChanged();});
  reduced.addEventListener('change',()=>{if(enabled)schedule(true);});
  document.fonts?.ready.then(()=>schedule(true));
  return {expand,setEnabled(value){
    if(value===enabled)return;enabled=value;
    if(enabled){
      baselineHeight=viewport?.height||innerHeight;lastWidth=innerWidth;
      document.body.style.setProperty('--mobile-viewport-height',px(baselineHeight));
      observer.observe(player);observer.observe(deck);measure();schedule();
    }else{
      epoch++;animations.forEach(animation=>animation.cancel());animations=[];observer.disconnect();
      clearTimeout(viewportTimer);clearTimeout(focusTimer);cancelAnimationFrame(frame);frame=0;
      compact=desired=busy=focusPending=keyboardOpen=false;snapshot=null;geometry=null;bar.hidden=true;
      player.inert=false;player.classList.remove('is-docked-source');delete document.body.dataset.playerLayout;
      document.body.style.removeProperty('--mobile-viewport-height');
    }
  }};
}
