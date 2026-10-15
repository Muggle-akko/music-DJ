import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createNcmClient } from "../lib/ncm.mjs";
import { createProfileSync } from "../lib/taste/profile-sync.mjs";
const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const service = createProfileSync({
  dataDir: process.env.AWUDIO_DATA_DIR || resolve(root, "data"),
  ncm: createNcmClient({
    baseUrl: process.env.NCM_API_BASE,
    cookie: process.env.NCM_COOKIE,
  }),
});
service.start();
await service.wait();
const status = service.status();
console.log(JSON.stringify(status, null, 2));
if (status.state === "error") process.exitCode = 1;
