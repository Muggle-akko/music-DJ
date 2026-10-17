import { createPlanActions } from '/plan-actions.mjs?v=51';
import { apiFetch,browserDataCache } from '/network.mjs?v=46';
import { createRecommendationFeed } from '/recommendation-feed.mjs?v=48';
export function createRecommendationController(adapter) {
  const node=id=>document.getElementById(id),button=node('agentStatusRefreshButton');
  const cacheKey='/__awudio_cache/agent-plans';
  let feed;
  const actions=createPlanActions({getPlan:id=>feed.plans.find(plan=>plan.id===id),
    applyLocal:adapter.applyPlan,save:adapter.flushQueue,notice:adapter.notice});
  const apply=(...args)=>actions.run(...args);
  apply.subscribe=actions.subscribe;apply.getState=actions.state;
  node('externalAgentPanel').hidden=false;node('builtinRecommendation').hidden=true;
  document.querySelector('.radio-modebar .radio-mode-switch').hidden=true;
  node('agentConnectionSettingsButton').hidden=true;node('agentConnectionSettings').hidden=true;
  node('agentOperationPanel').hidden=true;
  node('agentConnectionState').querySelector('.connection-dot').hidden=true;
  adapter.onMode('external');
  node('agentEmptyTitle').textContent='下一段音乐，从对话开始';
  node('agentEmptyDescription').textContent='在电脑上让 Agent 选好音乐，回到这里刷新获取。已有推荐随时可听。';
  feed=createRecommendationFeed({
    load:async version=>{
      const response=await apiFetch('/api/player/recommendations',{cache:'no-store',headers:{'X-Awudio-Browser':'1',...(version?{'X-Awudio-Plans-Version':version}:{})},signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      if(!response.ok)throw new Error(data.message||data.error||'推荐读取失败');
      return data;
    },
    readCache:async()=>{const response=await browserDataCache.read(cacheKey);return response?.json();},
    writeCache:data=>browserDataCache.write(cacheKey,data,3*86400000),
    render:plans=>{node('agentEmptyState').hidden=plans.length>0;node('agentPlans').hidden=!plans.length;adapter.renderPlans(plans,apply);},
    state:({loading,error,source,count,updatedAt})=>{
      button.disabled=loading;button.setAttribute('aria-busy',String(loading));
      node('agentConnectionState').dataset.state=error?'error':'idle';
      node('agentStatus').textContent=loading?'正在获取推荐…':error?(count?'更新失败 · 已保留上次推荐':'获取失败，请点击刷新'):source==='cache'?'上次推荐 · 可刷新获取':count?`已更新 · ${new Date(updatedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`:'暂无推荐';
    },
  });
  button.addEventListener('click',()=>{void feed.refresh();});
  node('agentExampleButton').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText('推荐几首英国乐队 Bôa 的歌，保存到云端，暂不播放。');adapter.notice('已复制，到 Agent 对话中粘贴即可');}
    catch{adapter.notice('告诉 Agent 想听什么，选好后回到这里刷新推荐。');}
  });
  void feed.restore();void feed.refresh();
  return {refresh:feed.refresh,open:feed.open,get mode(){return 'external';},get playerId(){return null;}};
}
