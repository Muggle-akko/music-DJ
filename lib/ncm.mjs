import { createHash } from "node:crypto";

export function accountKey(userId) {
  return createHash("sha256")
    .update(`netease:${userId}`)
    .digest("hex")
    .slice(0, 24);
}
export function createNcmClient({ baseUrl, cookie, fetchImpl = fetch }) {
  return async (path, params = {}, { signal, timeoutMs = 5000 } = {}) => {
    if (!baseUrl)
      throw Object.assign(new Error("网易云服务未配置"), { status: "error" });
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params))
      if (value !== undefined && value !== null)
        url.searchParams.set(key, String(value));
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const currentCookie = typeof cookie === 'function' ? cookie() : cookie;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          ...(currentCookie ? { Cookie: currentCookie } : {}),
        },
        signal: combined,
      });
    } catch (error) {
      throw Object.assign(
        new Error(combined.aborted ? "请求超时或已取消" : "网易云连接失败"),
        { status: combined.aborted ? "timeout" : "error" }
      );
    }
    const data = await response.json().catch(() => null);
    const code = Number(data?.code ?? response.status);
    if (!response.ok || !data || (code !== 200 && code !== 0)) {
      const status = [301, 302, 401, 403].includes(code)
        ? "unauthorized"
        : code === 429
        ? "rate_limited"
        : "error";
      throw Object.assign(new Error(`网易云请求失败 (${code})`), {
        status,
        code,
      });
    }
    return data;
  };
}
