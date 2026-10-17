// The existing player folds in place. Audio and its controls are never recreated.
export function createPlayerMorph(player) {
  const anchor=document.createElement('div');
  anchor.className='mobile-player-anchor';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const parts=[
    ['.panel-heading'],['#clockDisplay'],['#trackInfo','title'],['.meter-row'],
    ['#prevButton'],['#playButton','play'],['#nextButton','next'],
    ['#likeButton'],['#modeButton'],['#hostIntro'],['#hostCaption'],
  ].map(([selector,kind='detail'])=>({node:player.querySelector(selector),kind}));
  let enabled=false,frame=0,geometry=null,docked=false;
  const clamp=value=>Math.max(0,Math.min(1,value));
  const set=(node,name,value)=>node.style.setProperty(`--morph-${name}`,String(value));

  function restore() {
    player.classList.remove('is-morphing','is-folded');
    parts.forEach(({node})=>{node.inert=false;delete node.dataset.morphPart;});
    const title=player.querySelector('#trackInfo');
    title.removeAttribute('role');title.removeAttribute('tabindex');title.removeAttribute('aria-label');
    docked=false;
  }

  function measure() {
    if(!enabled)return;
    // Only measure the expanded layout, never a previously folded rectangle.
    restore();
    const rect=player.getBoundingClientRect();
    const topInset=Number.parseFloat(getComputedStyle(anchor).paddingTop)||8;
    geometry={top:anchor.getBoundingClientRect().top+scrollY,left:rect.left,width:rect.width,height:rect.height,topInset};
    anchor.style.height=`${rect.height}px`;
    set(player,'left',`${rect.left}px`);set(player,'width',`${rect.width}px`);
    set(player,'top',`${topInset}px`);set(player,'height',`${rect.height}px`);
    parts.forEach(({node,kind})=>{
      const box=node.getBoundingClientRect(),x=box.left-rect.left-1,y=box.top-rect.top-1;
      const target=kind==='title'?{x:16,y:12,scale:1}:
        kind==='play'?{x:rect.width-108,y:12,scale:44/box.width}:
        kind==='next'?{x:rect.width-60,y:12,scale:44/box.width}:
        {x,y:Math.max(12,y*.35),scale:.92};
      set(node,'x',`${x}px`);set(node,'y',`${y}px`);
      set(node,'w',`${box.width}px`);set(node,'h',`${box.height}px`);
      set(node,'dx',`${target.x-x}px`);set(node,'dy',`${target.y-y}px`);
      set(node,'scale',target.scale-1);
      set(node,'dw',`${kind==='title'?rect.width-140-box.width:0}px`);
    });
    paint();
  }

  function paint() {
    frame=0;
    if(!enabled||!geometry)return;
    const distance=scrollY-geometry.top+geometry.topInset;
    const progress=clamp(distance/Math.max(1,geometry.height-68));
    if(progress===0){if(docked)restore();return;}
    if(!docked){
      parts.forEach(({node,kind})=>{node.dataset.morphPart=kind;});
      player.classList.add('is-morphing');docked=true;
    }
    const value=reduced.matches?1:progress;
    set(player,'progress',value);
    player.classList.toggle('is-folded',progress>.98);
    parts.forEach(({node,kind})=>{node.inert=kind==='detail'&&value>.35;});
    const title=player.querySelector('#trackInfo');
    if(progress>.98){
      title.setAttribute('role','button');title.setAttribute('tabindex','0');title.setAttribute('aria-label','返回完整播放器');
    }else{
      title.removeAttribute('role');title.removeAttribute('tabindex');title.removeAttribute('aria-label');
    }
  }

  function schedule(){if(enabled&&!frame)frame=requestAnimationFrame(paint);}
  function expand(){
    if(!enabled)return;
    window.scrollTo({top:Math.max(0,geometry.top-geometry.topInset),behavior:reduced.matches?'instant':'smooth'});
  }
  const observer=new ResizeObserver(()=>{
    if(enabled&&!docked)measure();
  });
  observer.observe(player);
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',measure,{passive:true});
  reduced.addEventListener('change',schedule);
  document.fonts?.ready.then(()=>{if(enabled)measure();});
  player.addEventListener('click',event=>{
    if(player.classList.contains('is-folded')&&!event.target.closest('button,input,[role=slider]'))expand();
  });
  player.querySelector('#trackInfo').addEventListener('keydown',event=>{
    if(player.classList.contains('is-folded')&&['Enter',' '].includes(event.key)){event.preventDefault();expand();}
  });
  return {
    expand,
    setEnabled(value){
      if(value===enabled)return;
      enabled=value;
      if(enabled){player.before(anchor);anchor.append(player);measure();}
      else {restore();anchor.before(player);anchor.remove();geometry=null;}
    },
  };
}
