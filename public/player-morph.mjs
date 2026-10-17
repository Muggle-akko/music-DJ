// One audio element, two settled layouts. Scroll selects a state; it never scrubs styles.
export function createPlayerMorph(player) {
  const anchor=document.createElement('div');anchor.className='mobile-player-anchor';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),title=player.querySelector('#trackInfo');
  const parts=[['.panel-heading'],['#clockDisplay'],['#trackInfo','title'],['#startupStatus'],['.meter-row'],['#prevButton'],['#playButton','play'],['#nextButton','next'],['#likeButton'],['#modeButton'],['#hostIntro'],['#hostCaption']]
    .map(([selector,kind='detail'])=>({node:player.querySelector(selector),kind}));
  const compactHeight=60,duration=200;
  let enabled=false,frame=0,geometry=null,docked=false,folded=false,animations=[],revision=0;
  const px=n=>`${Math.round(n*100)/100}px`;
  const variable=(node,name,value)=>node.style.setProperty(`--morph-${name}`,value);
  function cancel(){revision++;animations.forEach(a=>a.cancel());animations=[];}
  function restore(){
    cancel();player.classList.remove('is-morphing','is-folded');player.style.removeProperty('height');player.style.removeProperty('transform');
    for(const {node} of parts){node.inert=false;delete node.dataset.morphPart;for(const name of ['transform','opacity','visibility','width'])node.style.removeProperty(name);}
    title.removeAttribute('role');title.removeAttribute('tabindex');title.removeAttribute('aria-label');
    folded=false;docked=false;
  }
  function measure(){
    if(!enabled)return;
    const wasFolded=folded;observer.unobserve(player);restore();
    const rect=player.getBoundingClientRect(),boxes=parts.map(({node})=>node.getBoundingClientRect());
    const inset=parseFloat(getComputedStyle(anchor).paddingTop)||12;
    geometry={top:anchor.getBoundingClientRect().top+scrollY,inset,width:innerWidth,height:rect.height};
    anchor.style.height=px(rect.height);
    for(const [name,value] of Object.entries({left:rect.left,width:rect.width,top:inset,height:rect.height}))variable(player,name,px(value));
    parts.forEach((part,i)=>{
      const {node,kind}=part,box=boxes[i],x=box.left-rect.left-1,y=box.top-rect.top-1,width=node.offsetWidth,height=node.offsetHeight;
      const target=kind==='title'?{x:14,y:7,scale:1}:kind==='play'?{x:rect.width-112,y:7,scale:44/width}:kind==='next'?{x:rect.width-60,y:7,scale:44/width}:null;
      part.box={x,y,width,height,target,titleWidth:Math.max(80,rect.width-142)};
      for(const [name,value] of Object.entries({x,y,w:width,h:height}))variable(node,name,px(value));
    });
    observer.observe(player);
    if(wasFolded&&scrollY>geometry.top-inset-12)settle(true,false);else paint();
  }
  function settle(value,animate=true){
    if(!geometry||value===folded&&docked)return;
    // Capture interrupted native animations before cancelling them. No reads on ordinary scroll frames.
    const fromHeight=player.getBoundingClientRect().height,fromTransform=getComputedStyle(player).transform;
    const from=parts.map(({node})=>{const css=getComputedStyle(node);return {transform:css.transform,opacity:css.opacity};});
    cancel();const token=revision;folded=value;
    if(!docked){observer.unobserve(player);parts.forEach(({node,kind})=>{node.dataset.morphPart=kind;});player.classList.add('is-morphing');docked=true;}
    player.classList.toggle('is-folded',value);
    if(value){title.setAttribute('role','button');title.setAttribute('tabindex','0');title.setAttribute('aria-label','返回完整播放器');}
    const ms=animate&&!reduced.matches?duration:0;
    const options={duration:ms,easing:'cubic-bezier(.22,.8,.25,1)'};
    player.style.height=px(value?compactHeight:geometry.height);
    // Expanding near the top also returns to the player's natural position.
    const offset=value?0:Math.max(0,geometry.top-scrollY-geometry.inset);
    player.style.transform=`translate3d(0,${px(offset)},0)`;
    animations.push(player.animate([{height:px(fromHeight),transform:fromTransform},{height:player.style.height,transform:player.style.transform}],options));
    parts.forEach((part,i)=>{
      const {node,kind,box}=part;node.style.visibility='';node.inert=value&&kind==='detail';
      if(kind==='detail'){
        node.style.opacity=value?'0':'1';animations.push(node.animate([{opacity:from[i].opacity},{opacity:node.style.opacity}],options));
      }else{
        const {x,y,target,titleWidth}=box;
        node.style.transform=value?`translate3d(${px(target.x-x)},${px(target.y-y)},0) scale(${target.scale})`:'none';
        if(kind==='title')node.style.width=px(value?titleWidth:box.width);
        animations.push(node.animate([{transform:from[i].transform},{transform:node.style.transform}],options));
      }
    });
    Promise.all(animations.map(a=>a.finished)).then(()=>{
      if(token!==revision)return;
      if(!value){restore();observer.observe(player);}
      else {parts.filter(p=>p.kind==='detail').forEach(({node})=>{node.style.visibility='hidden';});cancel();}
    }).catch(()=>{});
  }
  function paint(){frame=0;if(!enabled||!geometry)return;
    const delta=scrollY-geometry.top+geometry.inset;
    if(!folded&&delta>12)settle(true);else if(folded&&delta< -12)settle(false);
  }
  function schedule(){if(enabled&&!frame)frame=requestAnimationFrame(paint);}
  function expand(){if(enabled)window.scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});}
  const observer=new ResizeObserver(()=>{if(enabled&&!docked&&(!geometry||Math.abs(player.getBoundingClientRect().height-geometry.height)>.5))measure();});
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',()=>{if(enabled&&innerWidth!==geometry?.width)measure();},{passive:true});
  reduced.addEventListener('change',()=>{if(enabled)measure();});
  document.fonts?.ready.then(()=>{if(enabled)measure();});
  player.addEventListener('click',event=>{if(folded&&!event.target.closest('button,input,[role=slider]'))expand();});
  title.addEventListener('keydown',event=>{if(folded&&['Enter',' '].includes(event.key)){event.preventDefault();expand();}});
  return {expand,setEnabled(value){
    if(value===enabled)return;enabled=value;
    if(enabled){player.before(anchor);anchor.append(player);measure();}
    else {cancelAnimationFrame(frame);frame=0;observer.unobserve(player);restore();anchor.before(player);anchor.remove();geometry=null;}
  }};
}
