const base=new URL(process.argv[2] || '');
if(base.protocol!=='https:' || base.username || base.password || base.pathname!=='/' || base.search || base.hash)throw new Error('用法：node scripts/check-cloud-deployment.mjs https://你的项目.vercel.app');
const checks=[['/healthz',200],['/signin',200],['/api/radios',401],['/api/queue',401],['/api/instance',401]];
for(const [path,expected] of checks) {
  const response=await fetch(new URL(path,base),{redirect:'manual',signal:AbortSignal.timeout(60000)});
  if(response.status!==expected)throw new Error(`${path}: expected ${expected}, got ${response.status}; 请检查部署日志或平台访问保护`);
  if(path==='/healthz' && !(await response.json()).ok)throw new Error('健康检查未通过');
  console.log(`PASS ${path} ${expected}`);
}
console.log('基础公网入口与未登录鉴权通过；网易云真实播放及手机锁屏仍需登录后验证。');
