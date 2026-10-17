export function createMediaSession({ audio, getTrack, next, previous, notice }) {
  let metadataKey = '', loadedKey = '', savedAt = 0, buffering = false;
  // Native media remains eligible for background playback where the browser supports it.
  try { if ('audioSession' in navigator) navigator.audioSession.type='playback'; } catch { /* Optional API. */ }
  const trackKey = track => `${track?.provider}:${track?.id}`;
  function save() {
    const track = getTrack();
    if (track && loadedKey === trackKey(track) && Number.isFinite(audio.currentTime)) {
      localStorage.setItem('awudio.resume',JSON.stringify({key:trackKey(track),position:audio.currentTime}));
    }
  }
  function update() {
    if (!('mediaSession' in navigator)) return;
    const track = getTrack(), key = trackKey(track);
    if (key !== metadataKey) {
      metadataKey=key;
      navigator.mediaSession.metadata = track && 'MediaMetadata' in window ? new MediaMetadata({title:track.title,artist:track.artist,album:track.album,
        artwork:track.cover ? [{src:track.cover}] : []}) : null;
    }
    navigator.mediaSession.playbackState = !audio.currentSrc ? 'none' : audio.paused || audio.ended || audio.error || buffering ? 'paused':'playing';
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      try { navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate,position:Math.min(audio.currentTime,audio.duration)}); } catch { /* Older browser. */ }
    }
  }
  if ('mediaSession' in navigator) {
    const handlers = { play:() => audio.play().catch(() => notice('请回到播放器点击播放')), pause:() => audio.pause(),
      nexttrack:next, previoustrack:previous,
      seekto:event => { if (Number.isFinite(event.seekTime) && Number.isFinite(audio.duration)) audio.currentTime=Math.max(0,Math.min(event.seekTime,audio.duration)); },
      seekbackward:event => { audio.currentTime=Math.max(0,audio.currentTime-(event.seekOffset || 10)); },
      seekforward:event => { if(Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,audio.currentTime+(event.seekOffset || 10)); } };
    for (const [name, handler] of Object.entries(handlers)) try { navigator.mediaSession.setActionHandler(name,handler); } catch { /* Unsupported action. */ }
  }
  audio.addEventListener('loadedmetadata', () => {
    loadedKey=trackKey(getTrack());
    try {
      const resume=JSON.parse(localStorage.getItem('awudio.resume') || 'null');
      if (resume?.key===trackKey(getTrack()) && Number.isFinite(resume.position) && resume.position>0 && resume.position<audio.duration-3 && audio.currentTime<1) audio.currentTime=resume.position;
    } catch { /* Optional local resume state. */ }
    update();
  });
  audio.addEventListener('timeupdate',()=>{if(Date.now()-savedAt>5000){savedAt=Date.now();save();}});
  for(const event of ['waiting','stalled']) audio.addEventListener(event,event=>{if(!audio.paused && (event.type==='waiting' || audio.readyState<3)){buffering=true;update();}});
  for(const event of ['playing','pause','ended','emptied']) audio.addEventListener(event,()=>{buffering=false;update();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  for (const event of ['timeupdate','play','pause','ended','seeked','error']) audio.addEventListener(event,update);
  audio.addEventListener('pause',save); window.addEventListener('pagehide',save);
  return {update,get buffering(){return buffering;}};
}
