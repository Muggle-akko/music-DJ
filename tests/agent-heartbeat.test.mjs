import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeartbeat } from '../lib/agent/heartbeat.mjs';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP process registers and reads context on its first tool call', async () => {
  const requests=[];
  const server=createServer(async (req,res)=>{
    for await(const _ of req) {};
    requests.push(req.url);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url==='/api/agent/register' ? {status:'ok',sessionId:'test-session'} : {status:'ok',profile:{count:1378}}));
  });
  const folder=await mkdtemp(join(tmpdir(),'awudio-mcp-connect-'));
  const client=new Client({name:'connection-test',version:'1.0'});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const config=join(folder,'bridge.json');
    await writeFile(config,JSON.stringify({baseUrl:`http://127.0.0.1:${server.address().port}`,token:'a'.repeat(64)}));
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../scripts/awudio-mcp.mjs',import.meta.url))],env:{...process.env,AWUDIO_BRIDGE_FILE:config},stderr:'pipe'}));
    const result=await client.callTool({name:'awudio_get_context',arguments:{}});
    assert.equal(JSON.parse(result.content[0].text).status,'ok');
    assert.deepEqual(requests,['/api/agent/register','/api/agent/call']);
  } finally {
    await client.close();
    await new Promise(resolve=>server.close(resolve));
    await rm(folder,{recursive:true,force:true});
  }
});

test('a failed heartbeat reconnects on the next tick without a music tool call', async () => {
  let session=null, registrations=0, online=true;
  const tick=createHeartbeat({
    connect:async()=>{ if (!session) session=++registrations; },
    ping:async()=>{ if (!online) throw new Error('TLS disconnected'); },
    invalidate:()=>{ session=null; },
  });
  assert.equal(await tick(),true);
  online=false;
  assert.equal(await tick(),false);
  assert.equal(session,null);
  online=true;
  assert.equal(await tick(),true);
  assert.equal(registrations,2);
});

test('registration failure is retried later and ticks cannot overlap', async () => {
  let attempts=0, release;
  const tick=createHeartbeat({
    connect:async()=>{ if (++attempts===1) throw new Error('unavailable'); await new Promise(r=>{release=r;}); },
    ping:async()=>{}, invalidate:()=>{},
  });
  assert.equal(await tick(),false);
  const pending=tick();
  assert.equal(await tick(),false);
  assert.equal(attempts,2);
  release();
  assert.equal(await pending,true);
});
