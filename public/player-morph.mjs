// Keep one player and audio element. Scroll only updates its visible moving parts.
export function createPlayerMorph(player) {
  const anchor=document.createElement('div');
  anchor.className='mobile-player-anchor';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const title=player.querySelector('#trackInfo');
  const parts=[
    ['.panel-heading'],['#clockDisplay'],['#trackInfo','title'],['#startupStatus'],['.meter-row'],
    ['#prevButton'],['#playButton','play'],['#nextButton','next'],
    ['#likeButton'],['#modeButton'],['#hostIntro'],['#hostCaption'],
  ].map(([selector,kind='detail'])=>({node:player.querySelector(selector),kind,rendered:{}}));
  let enabled=false,frame=0,geometry=null,docked=false,folded=false,detailsHidden=false;
  const clamp=value=>Math.max(0,Math.min(1,value));
  const px=value=>`${Math.round(value*100)/100}px`;
  const variable=(node,name,value)=>node.style.setProperty(`--morph-${name}`,value);
  function style(part,name,value) {
    if(part.rendered[name]===value)return;
    part.node.style[name]=value;part.rendered[name]=value;
  }
  function setFolded(value) {
    if(folded===value)return;
    folded=value;player.classList.toggle('is-folded',value);
    if(value){title.setAttribute('role','button');title.setAttribute('tabindex','0');title.setAttribute('aria-label','返回完整播放器');}
    else {title.removeAttribute('role');title.removeAttribute('tabindex');title.removeAttribute('aria-label');}
  }
  function restore() {
    if(!docked)return;
    player.classList.remove('is-morphing');player.style.removeProperty('height');
    parts.forEach(part=>{
      part.node.inert=false;delete part.node.dataset.morphPart;
      for(const name of Object.keys(part.rendered))part.node.style[name]='';
      part.rendered={};
    });
    setFolded(false);detailsHidden=false;docked=false;observer.observe(player);
  }
  function measure() {
    if(!enabled)return;
    restore();
    // Read the complete expanded layout before writing any positioning styles.
    const rect=player.getBoundingClientRect();
    const boxes=parts.map(({node})=>node.getBoundingClientRect());
    const topInset=Number.parseFloat(getComputedStyle(anchor).paddingTop)||12;
    geometry={top:anchor.getBoundingClientRect().top+scrollY,left:rect.left,width:innerWidth,height:rect.height,topInset};
    anchor.style.height=px(rect.height);
    variable(player,'left',px(rect.left));variable(player,'width',px(rect.width));
    variable(player,'top',px(topInset));variable(player,'height',px(rect.height));
    parts.forEach((part,index)=>{
      const box=boxes[index],{node,kind}=part,x=box.left-rect.left-1,y=box.top-rect.top-1;
      const width=node.offsetWidth,height=node.offsetHeight;
      const target=kind==='title'?{x:16,y:14,scale:1}:
        kind==='play'?{x:rect.width-116,y:14,scale:44/width}:
        kind==='next'?{x:rect.width-60,y:14,scale:44/width}:null;
      part.box={x,y,width,height,target,titleWidth:rect.width-148};
      variable(node,'x',px(x));variable(node,'y',px(y));
      variable(node,'w',px(width));variable(node,'h',px(height));
    });
    paint();
  }
  function paint() {
    frame=0;
    if(!enabled||!geometry)return;
    const rawProgress=clamp((scrollY-geometry.top+geometry.topInset)/Math.max(1,geometry.height-72));
    const progress=rawProgress>=.998?1:rawProgress;
    if(progress===0){restore();return;}
    if(!docked){
      // A changing fixed-player height must not trigger an expanded-layout measurement.
      observer.unobserve(player);
      parts.forEach(({node,kind})=>{node.dataset.morphPart=kind;});
      player.classList.add('is-morphing');docked=true;
    }
    const value=reduced.matches?1:progress;
    const height=px(geometry.height+(72-geometry.height)*value);
    if(player.style.height!==height)player.style.height=height;
    const hidden=value>=1/2.8;
    if(hidden!==detailsHidden){
      detailsHidden=hidden;
      parts.filter(part=>part.kind==='detail').forEach(({node})=>{node.inert=hidden;});
    }
    const opacity=String(Math.round(Math.max(0,1-value*2.8)*100)/100);
    for(const part of parts){
      const {kind,box}=part;
      if(kind==='detail'){
        style(part,'opacity',opacity);style(part,'visibility',hidden?'hidden':'');
        continue;
      }
      const {x,y,target,width,titleWidth}=box;
      style(part,'transform',`translate3d(${px((target.x-x)*value)},${px((target.y-y)*value)},0) scale(${1+(target.scale-1)*value})`);
      if(kind==='title')style(part,'width',`${Math.round(width+(titleWidth-width)*value)}px`);
    }
    setFolded(progress>.98);
  }
  function schedule(){
    if(enabled&&!frame)frame=requestAnimationFrame(paint);
  }
  function expand(){
    if(enabled)window.scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});
  }
  const observer=new ResizeObserver(()=>{if(enabled&&!docked)measure();});
  window.addEventListener('scroll',schedule,{passive:true});
  // Safari resizes the viewport while its address bar moves. Only a width change
  // requires new player geometry; a height-only change must not reset the animation.
  window.addEventListener('resize',()=>{if(enabled&&innerWidth!==geometry?.width)measure();},{passive:true});
  reduced.addEventListener('change',schedule);
  document.fonts?.ready.then(()=>{if(enabled)measure();});
  player.addEventListener('click',event=>{
    if(folded&&!event.target.closest('button,input,[role=slider]'))expand();
  });
  title.addEventListener('keydown',event=>{
    if(folded&&['Enter',' '].includes(event.key)){event.preventDefault();expand();}
  });
  return {
    expand,
    setEnabled(value){
      if(value===enabled)return;
      enabled=value;
      if(enabled){player.before(anchor);anchor.append(player);observer.observe(player);measure();}
      else {cancelAnimationFrame(frame);frame=0;restore();observer.unobserve(player);anchor.before(player);anchor.remove();geometry=null;}
    },
  };
}
