import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { schemas, descriptions, writes } from '../lib/agent/schemas.mjs';
import { validateBridge } from '../lib/agent/connection.mjs';
import { createHeartbeat, createAgentActivity } from '../lib/agent/heartbeat.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = process.env.AWUDIO_BRIDGE_FILE ? resolve(process.env.AWUDIO_BRIDGE_FILE) : resolve(process.env.AWUDIO_DATA_DIR || resolve(root, 'data'), 'agent-bridge.json');
const server = new McpServer({ name: 'awudio', version: '0.2.0' }, {
  instructions: 'Awudio 私人音乐工具。支持本机或已配置的 HTTPS 音乐服务。对话留在当前 Agent；仅按用户需求查询、提交或播放。问候不推荐。先读 context，歧义查音乐人详情并必要时追问；工具回执确认后才能报告已播放。',
});
let configuration, sessionId, registering;
const activity=createAgentActivity();
// 网页显示的名字取自这里。部分客户端把连接器占位名当客户端名上报（WorkBuddy 上报 "awudio"），
// 这种占位名直接展示会让人以为是其它 Agent，映射成产品名。需要固定名字时用 AWUDIO_AGENT_NAME 覆盖。
const AGENT_NAME_OVERRIDE = process.env.AWUDIO_AGENT_NAME?.trim() || null;
const PLACEHOLDER_CLIENT_NAMES = new Set(['awudio']);
const clientName = () => {
  if (AGENT_NAME_OVERRIDE) return AGENT_NAME_OVERRIDE;
  const reported = (server.server.getClientVersion()?.name || '').trim();
  if (!reported) return 'MCP client';
  return PLACEHOLDER_CLIENT_NAMES.has(reported.toLowerCase()) ? 'workbuddy' : reported;
};

async function request(path, body, { signal, useSession = true } = {}) {
  if (!configuration) {
    const data = JSON.parse(await readFile(configFile, 'utf8'));
    configuration = validateBridge(data, { remote:Boolean(process.env.AWUDIO_BRIDGE_FILE) });
  }
  const timeout = AbortSignal.timeout(body?.tool === 'awudio_write_radio_script' && body?.args?.mode === 'api' ? 95000 : body?.tool === 'awudio_submit_plan' ? 60000 : path.endsWith('/call') ? 15000 : process.env.AWUDIO_BRIDGE_FILE ? 20000 : 6000);
  const response = await fetch(`${configuration.baseUrl}${path}`, { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${configuration.token}`, ...(useSession && sessionId ? { 'X-Awudio-Agent-Session': sessionId } : {}) },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const result = await response.json();
  if(response.ok)activity.seen();
  if (response.status === 401) sessionId = null;
  return { response, result };
}
async function ensureSession() {
  if(!activity.sessionFresh){sessionId=null;if(!registering)configuration=null;}
  if (sessionId) return;
  registering ||= request('/api/agent/register', { name: clientName() }, { useSession: false }).then(({ response, result }) => {
    if (!response.ok || !result.sessionId) throw new Error('connection_rejected');
    sessionId = result.sessionId;
  }).finally(() => { registering = null; });
  await registering;
}
for (const [name, schema] of Object.entries(schemas)) {
  server.registerTool(name, { description: descriptions[name], inputSchema: schema.shape,
    annotations: { readOnlyHint: !writes.has(name), destructiveHint: name === 'awudio_apply_plan', idempotentHint: writes.has(name), openWorldHint: !['awudio_get_context', 'awudio_get_operation'].includes(name) } },
  async (args, extra) => {
    activity.used();
    try {
      await ensureSession();
      const { response, result } = await request('/api/agent/call', { tool: name, args, name: clientName() }, { signal: extra.signal });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: !response.ok };
    } catch {
      // Do not retry a mutating call after an ambiguous transport failure.
      const result = { schemaVersion: 1, status: 'unavailable', message: '未取得音乐服务响应。请确认 Awudio 已启动；有副作用的请求可能已送达，恢复后先用同一 operationId 查询结果，勿盲重发下一首。' };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true };
    }
  });
}
const keepAlive = createHeartbeat({
  connect: ensureSession,
  ping: async () => {
    const { response } = await request('/api/agent/heartbeat', { name: clientName() });
    if (!response.ok) throw new Error('heartbeat_rejected');
  },
  invalidate: () => { sessionId = null; configuration = null; },
});
const heartbeat = setInterval(() => {
  if (server.server.getClientVersion() && activity.active) void keepAlive();
}, 15000);
heartbeat.unref();
await server.connect(new StdioServerTransport());
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, async () => { clearInterval(heartbeat); await server.close(); process.exit(0); });
