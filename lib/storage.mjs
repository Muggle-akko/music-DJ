import { mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const locks = new Map();
export async function serial(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}
export async function atomicJson(file, value, backup = false) {
  await mkdir(dirname(file), { recursive: true });
  if (backup)
    await copyFile(file, `${file}.backup`).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}
