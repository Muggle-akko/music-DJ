import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let url;
try { url = new URL(process.argv[2]); } catch { throw new Error('用法：node scripts/setup-server.mjs https://radio.example.com'); }
if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || !/^[a-z0-9.-]+$/i.test(url.hostname) || url.port) throw new Error('请提供 HTTPS 域名，不带路径或自定义端口');
if (url.hostname.endsWith('.vercel.app')) throw new Error('此脚本用于域名直接指向 Docker 主机的部署。vercel.app 入口请先做托管平台适配，见 md/hosting-options.md');
const password = randomBytes(24).toString('base64url');
const content = `# PRIVATE: do not commit or share this file\nAWUDIO_DOMAIN=${url.hostname}\nAWUDIO_PUBLIC_URL=${url.origin}\nAWUDIO_PASSWORD=${password}\nAI_PROVIDER=local\nDEEPSEEK_API_KEY=\nOPENAI_API_KEY=\nTTS_PROVIDER=none\nFISH_AUDIO_API_KEY=\nFISH_AUDIO_REFERENCE_ID=\n`;
await writeFile(resolve(root,'.env.server'), content, {flag:'wx',mode:0o600});
console.log(`已创建 .env.server（权限 600，不覆盖已有配置）。\n访问地址：${url.origin}\n访问密码：${password}\n请保存密码，然后执行：sh scripts/server.sh up -d --build`);
