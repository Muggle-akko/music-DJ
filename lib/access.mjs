import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { dataStoreEnabled } from './data-store.mjs';
import { atomicJson, readJson, serial } from './storage.mjs';

const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const digest = value => createHash('sha256').update(value).digest('hex');
const deny = message => Object.assign(new Error(message), { status: 'unauthorized', httpStatus: 401 });
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(body)); };

// A single owner, many browsers. Agent credentials never authorize browser/data routes.
export async function createAccess({ dataDir, port, mode = 'local', publicUrl = '', password = '' }) {
  if (!['local', 'server'].includes(mode)) throw new Error('AWUDIO_MODE must be local or server');
  const remote = mode === 'server';
  let origin;
  if (remote) {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('AWUDIO_PUBLIC_URL must be an HTTPS origin');
    if (password.length < 12 || password.length > 512) throw new Error('Server mode requires AWUDIO_PASSWORD (12–512 characters)');
    origin = url.origin;
  }
  const salt = randomBytes(16), passwordHash = remote ? scryptSync(password, salt, 32) : null;
  const file = join(dataDir, 'browser-sessions.json');
  const saved = remote ? await readJson(file, {}) : {};
  // Changing the owner password revokes all persisted sessions on restart.
  const passwordVersion = digest(password);
  let sessions = saved.passwordVersion === passwordVersion ? saved.sessions || {} : {};
  const connections = new Map();
  let failed = [], loginBusy = false;
  const persist = () => serial(file, async () => {
    for (const [id, session] of Object.entries(sessions)) if (session.expiresAt <= Date.now()) delete sessions[id];
    await atomicJson(file, { passwordVersion, sessions });
  });
  const cookieName = '__Host-awudio';
  function sessionId(req) {
    const raw = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return raw && /^[a-f0-9]{64}$/.test(raw) ? digest(raw) : null;
  }
  async function authenticated(req) {
    const latest=dataStoreEnabled() ? await readJson(file,{}) : null;
    const source=latest ? latest.passwordVersion===passwordVersion ? latest.sessions || {} : {} : sessions;
    const session = source[sessionId(req)];
    return Boolean(session && session.expiresAt > Date.now());
  }
  function assertRequest(req) {
    const host = String(req.headers.host || '');
    const expected = remote ? new URL(origin).host : host;
    if (remote ? host !== expected : !loopback(req.socket.remoteAddress) || ![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host)) throw deny('无效的访问地址');
    if (req.headers.origin && req.headers.origin !== (remote ? origin : `http://${host}`)) throw deny('拒绝跨来源请求');
    const navigation = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && !String(req.url).startsWith('/api/');
    if (req.headers['sec-fetch-site'] === 'cross-site' && !navigation) throw deny('拒绝跨站请求');
  }
  async function route(req, res, url, readBody) {
    assertRequest(req);
    if (!remote) return false;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (url.pathname === '/api/access/login' && req.method === 'POST') {
      failed = failed.filter(t => t > Date.now() - 60000);
      if (failed.length >= 10 || loginBusy) { json(res, 429, { ok:false, error:'尝试过于频繁，请稍后再试' }); return true; }
      loginBusy = true;
      try {
        const body = await readBody(req);
        const input = typeof body.password === 'string' ? body.password : '';
        if (input.length > 512 || !timingSafeEqual(scryptSync(input, salt, 32), passwordHash)) {
          failed.push(Date.now()); json(res, 401, { ok:false, error:'访问密码不正确' }); return true;
        }
        const token = randomBytes(32).toString('hex');
        while (Object.keys(sessions).length >= 30) delete sessions[Object.keys(sessions)[0]];
        sessions[digest(token)] = { expiresAt:Date.now() + 30 * 86400000 };
        await persist();
        res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
        json(res, 200, { ok:true }); return true;
      } finally { loginBusy = false; }
    }
    const publicAssets = ['/signin', '/signin.mjs', '/instance.css', '/styles.css'];
    if (publicAssets.includes(url.pathname) || url.pathname.startsWith('/fonts/')) return false;
    if (url.pathname.startsWith('/api/agent/')) return false; // Dedicated bearer authentication inside agent service.
    if (!await authenticated(req)) {
      res.setHeader('X-Awudio-Login', 'required');
      if (url.pathname.startsWith('/api/')) json(res, 401, { ok:false, status:'unauthorized', error:'请先登录私人电台' });
      else { res.writeHead(303, { Location:'/signin', 'Cache-Control':'no-store' }); res.end(); }
      return true;
    }
    // Track long-lived media/SSE requests so signing out closes this browser's streams.
    const id = sessionId(req);
    const active = connections.get(id) || new Set(); connections.set(id, active); active.add(res);
    res.once('close', () => { active.delete(res); if (!active.size) connections.delete(id); });
    if (url.pathname === '/api/access/logout' && req.method === 'POST') {
      delete sessions[id]; await persist();
      res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
      json(res, 200, { ok:true });
      for (const response of active) if (response !== res) response.destroy();
      return true;
    }
    return false;
  }
  return { remote, origin, route, assertRequest, authenticated,
    async reload() {const latest=await readJson(file,{});sessions=latest.passwordVersion===passwordVersion ? latest.sessions || {} : {};},
    exportRuntime:()=>({failed}),importRuntime:value=>{failed=value?.failed || [];},
  };
}
