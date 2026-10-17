import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceRoutes } from '../lib/instance.mjs';

test('QR login can continue on another cloud instance without exposing its private key', async () => {
  const options = { ncmBase:'https://fixture', access:{remote:true,origin:'https://radio.example'},
    connectAccount:async()=>{}, getAccount:async()=>({}), getBridge:async()=>({}) };
  const first=createInstanceRoutes(options), second=createInstanceRoutes(options);
  first.importRuntime({qr:{id:'fixture',key:'private-key',image:'data:image/png;base64,AA==',
    createdAt:Date.now(),expiresAt:Date.now()+60000,lastCheck:0}});
  second.importRuntime(JSON.parse(JSON.stringify(first.exportRuntime())));
  let status, body;
  await second({method:'POST'}, {writeHead:value=>{status=value;},end:value=>{body=JSON.parse(value);}},
    new URL('https://radio.example/api/instance/qr'), async()=>({}));
  assert.equal(status,200);
  assert.equal(body.id,'fixture');
  assert.equal(body.key,undefined);
  second.importRuntime({qr:{expiresAt:Date.now()-1}});
  assert.equal(second.exportRuntime().qr,null);
  second.importRuntime({});
  assert.equal(second.exportRuntime().qr,null);
});
