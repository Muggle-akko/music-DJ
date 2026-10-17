import { createDataCache } from '/data-cache.mjs?v=44';
import { mobileClient } from "/device-policy.mjs?v=36";
let deviceId = localStorage.getItem('awudio.deviceId');
if (!/^[a-f0-9-]{16,64}$/.test(deviceId || '')) {
  deviceId = crypto.randomUUID(); localStorage.setItem('awudio.deviceId', deviceId);
}
export { deviceId };
export const browserDataCache=createDataCache();
export async function clearLocalCaches() {
  await browserDataCache.clear();
  if (!globalThis.caches) return;
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith('awudio-workspace-') || name === 'awudio-covers-v1') await caches.delete(name);
    }
  } catch { /* Storage may be unavailable in private browsing mode. */ }
}
export async function apiFetch(input, init = {}) {
  if (new URL(input, location.href).origin !== location.origin) return fetch(input, init);
  const method=init.method || 'GET',ttl=method==='GET' ? browserDataCache.ttl(input) : 0;
  if(ttl && init.cache!=='reload' && init.cache!=='no-store'){
    const cached=await browserDataCache.read(input);if(cached)return cached;
  }
  const headers = new Headers(init.headers);
  headers.set('X-Awudio-Device', deviceId);
  headers.set('X-Awudio-Client', mobileClient ? 'mobile' : 'desktop');
  const response = await fetch(input, { ...init, headers });
  if(response.ok && method==='POST'){
    if(String(input).startsWith('/api/access/logout') || String(input).startsWith('/api/instance/cookie') || String(input).startsWith('/api/instance/qr/check'))await browserDataCache.clear();
    if(String(input).startsWith('/api/radios'))await browserDataCache.remove('/api/radios');
  }
  if(ttl && response.ok){
    const data=await response.clone().json().catch(()=>null);
    if(data && data.ok!==false && data.status!=='unavailable' && data.source!=='demo')await browserDataCache.write(input,data,ttl);
  }
  if (response.status === 401 && !location.pathname.startsWith('/signin')) {
    // Avoid navigation during local player-session expiry; those calls re-register.
    if(response.headers.get('X-Awudio-Login'))await browserDataCache.clear();
    if (response.headers.get('X-Awudio-Login') || !String(input).startsWith('/api/player/')) location.assign('/signin');
  }
  return response;
}
