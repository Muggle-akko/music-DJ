const ALLOWED_HOST = /^p\d+\.music\.126\.net$/i;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_BYTES = 1024 * 1024;

export async function fetchMusicCover(rawUrl, { fetchImpl = fetch, timeoutMs = 8000, maxBytes = MAX_BYTES } = {}) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return { status: 400, message: '无效的封面地址' };

  let target;
  try { target = new URL(rawUrl); } catch { return { status: 400, message: '无效的封面地址' }; }
  if (target.protocol !== 'https:' || !ALLOWED_HOST.test(target.hostname) || target.username || target.password || target.port || target.hash) {
    return { status: 400, message: '不支持此封面地址' };
  }

  let upstream;
  try {
    upstream = await fetchImpl(target, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
    });
  } catch {
    return { status: 502, message: '封面暂时无法加载' };
  }
  if (!upstream.ok || !upstream.body) return { status: upstream.status === 404 ? 404 : 502, message: '封面暂时无法加载' };

  const contentType = String(upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase().replace(/^image\/jpg$/, 'image/jpeg');
  if (!ALLOWED_TYPES.has(contentType)) return { status: 415, message: '封面格式不受支持' };
  const declaredLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await upstream.body.cancel().catch(() => {});
    return { status: 413, message: '封面文件过大' };
  }

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of upstream.body) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        await upstream.body.cancel().catch(() => {});
        return { status: 413, message: '封面文件过大' };
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch {
    return { status: 502, message: '封面暂时无法加载' };
  }
  return { status: 200, contentType, body: Buffer.concat(chunks, size) };
}
