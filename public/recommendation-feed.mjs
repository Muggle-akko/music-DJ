const RETENTION=3*86400000;
export function createRecommendationFeed({load,readCache,writeCache,render,state,now=Date.now}) {
  let plans=[],version=null,updatedAt=null,received=false,pending=null;
  const live=items=>(Array.isArray(items)?items:[]).filter(plan=>Number.isFinite(Date.parse(plan.createdAt))&&now()-Date.parse(plan.createdAt)<=RETENTION);
  const show=(source,error=null,loading=false)=>state?.({source,error,loading,count:plans.length,updatedAt});
  async function restore(){
    try{
      const cached=await readCache();
      if(received||!cached)return;
      plans=live(Array.isArray(cached)?cached:cached.plans);
      version=Array.isArray(cached)?null:cached.version;
      updatedAt=Array.isArray(cached)?null:cached.updatedAt;
      render(plans);show('cache',null,Boolean(pending));
    }catch{/* Cache failure does not block the server. */}
  }
  function refresh(){
    if(pending)return pending;
    show(received?'server':'cache',null,true);
    pending=(async()=>{
      try{
        const data=await load(version);
        if(data.plansUnchanged&&!version)throw new Error('推荐版本失效，请重试');
        plans=live(data.plansUnchanged?plans:data.plans);version=data.plansVersion;
        updatedAt=new Date(now()).toISOString();received=true;render(plans);show('server');
        try{await writeCache({plans,version,updatedAt});}catch{/* Optional storage. */}
        return true;
      }catch(error){show(plans.length?'cache':'empty',error);return false;}
      finally{pending=null;}
    })();
    return pending;
  }
  return {restore,refresh,open:()=>received?Promise.resolve(true):refresh(),get plans(){return plans;},get loaded(){return received;}};
}
