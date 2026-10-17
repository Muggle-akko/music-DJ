export function validateBridge(data, { remote = false } = {}) {
  const base = new URL(data.baseUrl);
  const secure = base.protocol === 'https:';
  const local = base.protocol === 'http:' && base.hostname === '127.0.0.1';
  if ((!local && !(remote && secure)) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || typeof data.token !== 'string' || data.token.length < 40) throw new Error('invalid_configuration');
  return { baseUrl:base.origin, token:data.token };
}
