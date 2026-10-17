// Portable owner data only. Login cookies, sessions, Agent credentials and audio are excluded.
export async function buildOwnerBackup({accountKey,state,readJson,now=()=>new Date().toISOString(),maxBytes=6*1024*1024}) {
  if(!/^[a-f0-9]{24}$/.test(accountKey))throw new Error('尚未绑定网易云账号');
  const files={[`accounts/${accountKey}/state.json`]:state};
  for(const name of ['profile.json','feedback.json','song-features.json']){
    const path=`accounts/${accountKey}/${name}`,value=await readJson(path);
    if(value!==null)files[path]=value;
  }
  const backup={format:'awudio-owner-backup',version:1,createdAt:now(),accountKey,includesAudio:false,includesCredentials:false,files};
  if(Buffer.byteLength(JSON.stringify(backup))>maxBytes)throw new Error('资料超过网页备份大小上限，请使用服务器备份工具');
  return backup;
}
