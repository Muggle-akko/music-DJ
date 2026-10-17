import { apiFetch } from '/network.mjs?v=33';
const el = id => document.getElementById(id);
let qrTimer, qrGeneration = 0;
async function request(path, body) {
  const response = await apiFetch(path, { method:body === undefined ? 'GET':'POST', headers:{'Content-Type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || '连接失败');
  return data;
}
async function refresh() {
  const data = await request('/api/instance');
  el('connectionState').textContent = data.authenticated ? '已连接':'未连接';
  el('accountSummary').textContent = data.authenticated ? `网易云账号 ${data.account.userId} 已连接。所有设备使用此账号的播放权限。` : data.ncmConfigured ? '连接网易云后，即可搜索歌曲、访问歌单和收听电台。' : '请先在部署配置中设置网易云 API 地址。';
  if(el('mobileSettings') && data.authenticated)el('accountSummary').textContent=`${data.account.nickname || '网易云账号'}已连接，可直接使用，无需重复登录。`;
  el('createQr').disabled = !data.ncmConfigured;
  el('createQr').textContent = data.authenticated ? '重新扫码登录' : '扫码登录';
  el('remoteAgentSection').hidden = data.mode !== 'server';
  el('signout').hidden = data.mode !== 'server';
  el('instanceMode').textContent = data.mode === 'server' ? '私人服务器 · 数据独立保存':'本机模式';
}
async function busy(button, task) {
  button.disabled = true; el('settingsStatus').textContent = '';
  try { await task(); } catch (error) { el('settingsStatus').textContent = error.message; }
  finally { button.disabled = false; }
}
el('cookieForm').addEventListener('submit', event => {
  event.preventDefault();
  void busy(event.submitter, async () => {
    await request('/api/instance/cookie', {cookie:el('cookie').value.trim()}); el('cookie').value = '';
    qrGeneration++; clearTimeout(qrTimer); el('qrPanel').hidden = true;
    await refresh(); el('settingsStatus').textContent = '网易云已连接，返回播放器即可使用。';
  });
});
el('createQr').addEventListener('click', event => void busy(event.currentTarget, async () => {
  clearTimeout(qrTimer); const generation = ++qrGeneration;
  const data = await request('/api/instance/qr', {});
  el('qrImage').src = data.image; el('qrPanel').hidden = false; el('qrStatus').textContent = '请使用网易云音乐 App 扫码';
  async function poll() {
    if (generation !== qrGeneration) return;
    try {
      const result = await request('/api/instance/qr/check', {id:data.id});
      if (generation !== qrGeneration) return;
      if (result.code === 803) { el('qrStatus').textContent = '登录成功'; await refresh(); return; }
      if (result.code === 800) { el('qrStatus').textContent = '二维码已过期，请重新生成'; return; }
      el('qrStatus').textContent = result.code === 802 ? '已扫码，请在 App 中确认':'等待扫码…';
      qrTimer = setTimeout(poll, 3000);
    } catch (error) { el('qrStatus').textContent = error.message; }
  }
  qrTimer = setTimeout(poll, 3000);
}));
el('downloadBridge')?.addEventListener('click', event => void busy(event.currentTarget, async () => {
  const data = await request('/api/instance/agent-connection', {});
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'awudio-remote.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('settingsStatus').textContent = '连接文件已下载，请按下方步骤配置到电脑上的 Agent。';
}));
el('deviceName').value = localStorage.getItem('awudio.deviceName') || '';
el('saveDevice').addEventListener('click', () => { localStorage.setItem('awudio.deviceName',el('deviceName').value.trim()); el('settingsStatus').textContent = '设备名称已保存。'; });
el('signout').addEventListener('click', event => void busy(event.currentTarget, async () => { await request('/api/access/logout', {}); location.replace('/signin'); }));
document.getElementById('mobileSettings')?.addEventListener('close', () => { qrGeneration++; clearTimeout(qrTimer); el('cookie').value=''; el('qrPanel').hidden=true; });
window.addEventListener('awudio:settings-open',()=>{void refresh().catch(error=>{el('settingsStatus').textContent=error.message;});});
window.addEventListener('pagehide', () => { qrGeneration++; clearTimeout(qrTimer); });
void refresh().catch(error => { el('settingsStatus').textContent = error.message; });

el('downloadBackup')?.addEventListener('click',event=>void busy(event.currentTarget,async()=>{
  const data=await request('/api/instance/backup');
  const blob=new Blob([JSON.stringify(data.backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`awudio-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  el('settingsStatus').textContent='资料备份已下载，不包含登录凭据和音频文件。';
}));
