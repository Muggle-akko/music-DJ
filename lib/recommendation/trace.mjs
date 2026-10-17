import { join } from "node:path";
import { readdir, unlink } from "../data-store.mjs";
import { atomicJson, readJson } from "../storage.mjs";
export function createTraceStore(dataDir) {
  const root = (key) => join(dataDir, "accounts", key, "recommendations");
  return {
    async write(key, trace) {
      await atomicJson(join(root(key), `${trace.id}.json`), trace);
      for (const file of await readdir(root(key))) {
        if (!/^[\w-]+\.json$/.test(file)) continue;
        const old = await readJson(join(root(key), file));
        if (
          old?.startedAt &&
          Date.now() - Date.parse(old.startedAt) > 30 * 86400000
        )
          await unlink(join(root(key), file));
      }
    },
    async read(key, id) {
      if (!/^[\w-]{1,100}$/.test(id)) return null;
      return readJson(join(root(key), `${id}.json`));
    },
  };
}
