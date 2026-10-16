export const DEFAULT_NARRATION_PREFERENCES = Object.freeze({ density:'balanced', content:'自然、亲近的 Faye 主播口吻；音乐背景、听感线索、情绪陪伴与文化联想交替展开，不要每段都报歌名或重复点歌需求。避免剧透，不编造个人经历。' });
export function narrationCount(count,density='balanced') {
  if(count<3)return count;
  const ratio={sparse:.2,balanced:.38,frequent:.6}[density] || .38;
  return Math.min(12,count,Math.max(density==='sparse' ? 1 : 3,Math.ceil(count*ratio)));
}
export function coverageSlots(count,target) {
  return Array.from({length:target},(_,i)=>target===1 ? 0 : Math.round(i*(count-1)/(target-1)));
}
export function lyricWindows(lyric,durationMs) {
  const times=[];
  for(const line of String(lyric || '').split(/\r?\n/)) {
    if(!line.replace(/\[[^\]]*\]/g,'').trim())continue;
    for(const m of line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g))times.push(Number(m[1])*60000+Number(m[2])*1000+Number((m[3] || '0').padEnd(3,'0').slice(0,3)));
  }
  const ordered=[...new Set(times)].sort((a,b)=>a-b).filter(t=>t<=durationMs);
  if(!ordered.length)return [];
  const windows=[];
  function add(placement,start,end) {
    if(end-start<12000)return;
    windows.push({placement,startAtMs:start,safeUntilMs:end,maxChars:Math.floor((end-start-2000)/1000*4.2),basis:'lyric_gap_heuristic'});
  }
  add('intro',0,ordered[0]-2500);
  for(let i=1;i<ordered.length;i++)if(ordered[i]-ordered[i-1]>=12000)add('interlude',ordered[i-1]+2500,ordered[i]-2500);
  add('outro',ordered.at(-1)+2500,durationMs-3000);
  return windows.sort((a,b)=>(b.safeUntilMs-b.startAtMs)-(a.safeUntilMs-a.startAtMs)).slice(0,6).sort((a,b)=>a.startAtMs-b.startAtMs);
}
export function relevantComments(data,track) {
  return [...(data.hotComments || []),...(data.comments || [])].map(c=>String(c.content || '').replace(/\s+/g,' ').trim())
    .filter(t=>t.length>=12 && t.length<=300 && !/打卡|求赞|互赞|第一|日推来的|日推集合|签到|占楼/.test(t))
    .filter(t=>/歌词|编曲|旋律|声线|人声|鼓点|贝斯|吉他|钢琴|前奏|间奏|副歌|现场|耳机|通勤|夜晚/.test(t) || t.includes(track.title))
    .filter((t,i,all)=>all.indexOf(t)===i).slice(0,3);
}
export function filterNarration(cues) {
  const accepted=[],rejected=[];
  const fingerprint=text=>text.replace(/《[^》]*》/g,'《Song》').replace(/[\s，,]/g,'');
  for(const cue of cues) {
    const value=fingerprint(cue.text),sentences=value.split(/[。！？!?；;]/).filter(s=>s.length>=18);
    if(/今晚[，,]?\s*让我们|就像是|今天的歌就到这里|后面的路.*(?:自己|你)|把后面的路交给你/u.test(cue.text) ||
      accepted.some(c=>fingerprint(c.text)===value || sentences.some(s=>fingerprint(c.text).includes(s))))rejected.push(cue.trackId);
    else accepted.push(cue);
  }
  return {cues:accepted,rejected};
}
export function scheduleNarration(cues,context={},respectRequested=false) {
  return cues.map(c=>{
    const needed=Math.max(12000,Math.round([...c.text].length/4.2*1000));
    const windows=(context[c.trackId]?.cueWindows || []).filter(w=>w.safeUntilMs-w.startAtMs>=needed);
    const preferred=c.kind==='opening' ? 'intro' : c.kind==='closing' ? 'outro' : 'interlude';
    const requested=Number.isFinite(c.startAtMs) ? windows.find(w=>c.startAtMs>=w.startAtMs && c.startAtMs+needed<=w.safeUntilMs) : null;
    const selected=requested || (respectRequested && Number.isFinite(c.startAtMs) ? null : windows.find(w=>w.placement===preferred) || windows[0]);
    const fallback=c.kind==='closing' ? Math.max(0,(context[c.trackId]?.durationMs || 0)-needed-8000) : 0;
    return {...c,startAtMs:selected ? requested ? c.startAtMs : selected.startAtMs : c.startAtMs ?? fallback,
      placement:selected?.placement || c.placement || (c.kind==='closing' ? 'outro' : 'intro'),
      windowEndMs:selected?.safeUntilMs, timingSource:selected ? 'lyric_gap_heuristic' : 'unverified',
      fitsWindow:Boolean(selected)};
  });
}

export function createNarrationContext(ncm) {
  const cache=new Map();
  return async (tracks,{signal}={})=>{
    if(!ncm)return Object.fromEntries(tracks.map(t=>[t.id,{durationMs:Number(t.durationMs || t.duration) || 0,cueWindows:[],hotComments:[]}]));
    const timeout=AbortSignal.timeout(8000),combined=signal ? AbortSignal.any([signal,timeout]) : timeout;
    const commentIds=new Set(coverageSlots(tracks.length,Math.min(8,tracks.length)).map(i=>tracks[i]?.id));
    const output={},jobs=[...tracks];
    async function worker() {
      while(jobs.length) {
        const t=jobs.shift(),cached=cache.get(t.id);
        if(cached && Date.now()-cached.at<3600000){output[t.id]=cached.value;continue;}
        let lyrics={},comments={};
        if(!combined.aborted)try{lyrics=await ncm('/lyric',{id:t.id},{signal:combined,timeoutMs:1200});}catch{/* Optional context. */}
        if(commentIds.has(t.id) && !combined.aborted)try{comments=await ncm('/comment/music',{id:t.id,limit:20},{signal:combined,timeoutMs:1200});}catch{/* Optional context. */}
        const value={durationMs:Number(t.durationMs || t.duration) || 0,cueWindows:lyricWindows(lyrics.lrc?.lyric,Number(t.durationMs || t.duration) || 0),hotComments:relevantComments(comments,t),timingNote:'歌词时间戳空档只是候选位置，不等于已验证的无人声片段。'};
        output[t.id]=value;
        if(value.cueWindows.length || value.hotComments.length)cache.set(t.id,{at:Date.now(),value});
        while(cache.size>1000)cache.delete(cache.keys().next().value);
      }
    }
    await Promise.all(Array.from({length:Math.min(4,tracks.length)},worker));
    signal?.throwIfAborted();
    return output;
  };
}
