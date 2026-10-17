import { randomUUID } from 'node:crypto';

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(body)); };
export function createInstanceRoutes({ ncmBase, connectAccount, getAccount, access, getBridge, exportBackup }) {
  let qr = null;
  async function upstream(path, params) {
    if (!ncmBase) throw new Error('网易云服务尚未配置');
    const url = new URL(path, ncmBase);
    for (const [key, value] of Object.entries({ ...params, timestamp:Date.now() })) url.searchParams.set(key, String(value));
    const response = await fetch(url, { signal:AbortSignal.timeout(10000), redirect:'error' });
    if (!response.ok) throw new Error('网易云登录服务暂时不可用');
    return response.json();
  }
  const route = async (req, res, url, readBody) => {
    if (!url.pathname.startsWith('/api/instance')) return false;
    try {
      if (url.pathname === '/api/instance' && req.method === 'GET') {
        const account = await getAccount();
        json(res, 200, { ok:true, mode:access.remote ? 'server' : 'local', publicUrl:access.origin || null,
          ncmConfigured:Boolean(ncmBase), authenticated:Boolean(account.authenticated),
          account:account.authenticated ? { userId:account.userId, nickname:account.nickname } : null });
      } else if(url.pathname==='/api/instance/backup' && req.method==='GET'){
        if(!exportBackup)throw new Error('此环境未启用资料备份');
        json(res,200,{ok:true,backup:await exportBackup()});
      } else if (url.pathname === '/api/instance/cookie' && req.method === 'POST') {
        const body = await readBody(req);
        if (typeof body.cookie !== 'string' || body.cookie.length > 20000 || !/MUSIC_U=/.test(body.cookie) || /[\r\n]/.test(body.cookie)) throw new Error('请填写有效的网易云 Cookie（包含 MUSIC_U）');
        await connectAccount(body.cookie);
        json(res, 200, { ok:true });
      } else if (url.pathname === '/api/instance/qr' && req.method === 'POST') {
        if (qr && qr.expiresAt > Date.now() && Date.now() - qr.createdAt < 10000) {
          json(res, 200, { ok:true, id:qr.id, image:qr.image }); return true;
        }
        const key = (await upstream('/login/qr/key', {})).data?.unikey;
        if (!key) throw new Error('未能取得登录二维码，请稍后重试或填写 Cookie');
        const data = await upstream('/login/qr/create', { key, qrimg:true });
        if (!/^data:image\/png;base64,/.test(data.data?.qrimg || '')) throw new Error('二维码生成失败');
        qr = { id:randomUUID(), key, image:data.data.qrimg, createdAt:Date.now(), expiresAt:Date.now() + 180000, lastCheck:0 };
        json(res, 200, { ok:true, id:qr.id, image:qr.image });
      } else if (url.pathname === '/api/instance/qr/check' && req.method === 'POST') {
        const body = await readBody(req);
        if (!qr || qr.id !== body.id || qr.expiresAt < Date.now()) throw new Error('二维码已过期，请重新生成');
        const current = qr;
        if (Date.now() - current.lastCheck < 2000) { json(res, 200, { ok:true, code:801 }); return true; }
        current.lastCheck = Date.now();
        const result = await upstream('/login/qr/check', { key:current.key });
        const code = Number(result.code);
        if (code === 803) {
          if (!result.cookie) throw new Error('登录未返回凭证，请重新扫码');
          await connectAccount(result.cookie); if (qr === current) qr = null;
        }
        json(res, 200, { ok:true, code });
      } else if (url.pathname === '/api/instance/agent-connection' && req.method === 'POST') {
        if (!access.remote) throw new Error('本地模式使用现有 Agent 连接配置即可');
        const bridge = await getBridge();
        json(res, 200, { baseUrl:access.origin, token:bridge.token });
      } else json(res, 404, { ok:false, error:'没有找到该设置' });
    } catch (error) {
      // Do not forward upstream response bodies or credentials to the browser.
      json(res, 400, { ok:false, error:error.publicMessage || (error.message.startsWith('请') || /二维码|网易云|本地模式|登录|备份|资料/.test(error.message) ? error.message : '连接未完成，请稍后重试') });
    }
    return true;
  };
  route.exportRuntime = () => ({ qr });
  route.importRuntime = value => { qr = value?.qr?.expiresAt > Date.now() ? value.qr : null; };
  return route;
}
