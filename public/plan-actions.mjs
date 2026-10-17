// Local queue changes are immediate. A sync retry must never apply the plan twice.
export function createPlanActions({getPlan,applyLocal,save,notice=()=>{},slowAfterMs=4000}) {
  const running=new Map(),unsaved=new Map(),states=new Map(),listeners=new Map();
  function publish(id,state){
    states.set(id,state);
    for(const listener of listeners.get(id)||[])try{listener(state);}catch{}
  }
  function subscribe(id,listener){
    if(!listeners.has(id))listeners.set(id,new Set());listeners.get(id).add(listener);
    if(states.has(id))listener(states.get(id));
    return ()=>{const group=listeners.get(id);group?.delete(listener);if(!group?.size)listeners.delete(id);};
  }
  function run(id,queueMode,playback){
    if(running.has(id))return running.get(id);
    const context={queueMode,playback};
    const send=state=>publish(id,{...context,...state});
    const job=(async()=>{
      let result=unsaved.get(id),timer;
      try{
        if(!result || result.queueMode!==queueMode || result.playback!==playback){
          send({stage:'applying',text:queueMode==='append'?'正在加入队列…':'正在准备歌曲…'});
          const plan=getPlan(id);if(!plan)throw new Error('没有找到这份推荐，请刷新后重试');
          const local=await applyLocal(plan,queueMode,playback);
          result={...local,queueMode,playback};
          if(local?.changed===false){send({stage:'complete',text:local.message || '歌曲已在队列中'});notice(local.message || '歌曲已在队列中');return states.get(id);}
          unsaved.set(id,result);
        }
        const description=queueMode==='append'?`已加入本机队列${result.count?` ${result.count} 首`:''}`:'本机队列已更新';
        send({stage:'saving',text:`${description}，正在同步…`});
        timer=setTimeout(()=>send({stage:'saving',text:'云端同步较慢，歌曲已保留在本机，可继续播放'}),slowAfterMs);
        if(!await save())throw new Error('云端尚未确认');
        unsaved.delete(id);
        const text=queueMode==='append'?`已加入队列${result.count?` ${result.count} 首`:''}，云端已保存${result.skipped?`；队列已满，另有 ${result.skipped} 首未加入`:''}`:'队列已更新，云端已保存';
        send({stage:'complete',text});notice(text);
      }catch(error){
        const local=unsaved.get(id);
        const text=local?'歌曲已保留在本机，云端同步尚未确认。请重试同步；若有队列冲突，请先处理冲突':`操作失败：${error.message || '请重试'}`;
        send({stage:local?'pending_sync':'error',text});notice(text);
      }finally{clearTimeout(timer);}
      return states.get(id);
    })().finally(()=>running.delete(id));
    running.set(id,job);return job;
  }
  return {run,subscribe,state:id=>states.get(id)};
}
