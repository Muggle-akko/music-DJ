import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { configureDataStore, withDataTransaction, writeFile, exists } from '../lib/data-store.mjs';

const at=process.argv.indexOf('--source');
if(at<0 || !process.argv[at+1])throw new Error('用法：node --env-file .env.cloud.local scripts/import-cloud-data.mjs --source /原项目/data');
if(!process.env.AWUDIO_DATABASE_URL)throw new Error('需要 AWUDIO_DATABASE_URL');
const source=resolve(process.argv[at+1]),root=resolve('/tmp/awudio'),files=[];
async function visit(relative='') {
  for(const entry of await readdir(join(source,relative),{withFileTypes:true})) {
    const name=relative ? `${relative}/${entry.name}` : entry.name;
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory() && (name==='accounts' || name.startsWith('accounts/') || name==='tts'))await visit(name);
    if(!entry.isFile())continue;
    const accepted=['state.json','listening-profile.json'].includes(name) || /^accounts\/[a-f0-9]{24}\/[\w./-]+\.(json|jsonl)$/.test(name) || /^tts\/[a-f0-9]{64}\.(mp3|wav|opus)$/.test(name);
    if(accepted && !/(?:^|\/)(?:agent-bridge|browser-sessions|netease-connection|cloud-runtime)\.json$/.test(name))files.push({name,body:await readFile(join(source,name))});
  }
}
await visit();
const bytes=files.reduce((n,f)=>n+f.body.length,0);
if(bytes>200*1024*1024)throw new Error('迁移超过 200MB，请先单独整理缓存');
await configureDataStore({url:process.env.AWUDIO_DATABASE_URL,root});
await withDataTransaction('awudio-metadata-v1',async()=>{
  for(const file of files)if(await exists(join(root,file.name)))throw new Error(`目标已有 ${file.name}，未覆盖任何文件；请使用空数据目标或先备份`);
  for(const file of files)await writeFile(join(root,file.name),file.body);
});
console.log(`已迁移 ${files.length} 份电台/偏好/解说资料（${bytes} 字节）。未迁移 Cookie、Agent 凭证或浏览器登录会话。`);
