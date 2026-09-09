/** 更新检查只请求固定 npm 元数据地址，不携带账户配置；失败缓存一分钟，成功缓存十五分钟。 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { VersionInfo } from "../../contracts/types.ts";

/** 当前分发使用三段稳定版本；未知格式不推断更新，避免把预发布版误当稳定升级。 */
export function newerVersion(latest: string, current: string): boolean {
  if (![latest, current].every((v) => /^\d+\.\d+\.\d+$/.test(v))) return false;
  const a = latest.split(".").map(BigInt),
    b = current.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

let cached: VersionInfo | undefined;
let expires = 0;
let pending: Promise<VersionInfo> | undefined;
/** 缓存归 Host 实例共享，多个页面同时打开不会并发重复查询。 */
export async function versionInfo(): Promise<VersionInfo> {
  if (cached && Date.now() < expires) return cached;
  if (pending) return pending;
  pending = (async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    const info: VersionInfo = {
      current: manifest.version,
      source: existsSync(resolve(root, "../backend/package.json")),
      hasUpdate: false,
    };
    try {
      const response = await fetch(
        "https://registry.npmjs.org/dsh-atelier/latest",
        { signal: AbortSignal.timeout(5000), redirect: "error" },
      );
      if (!response.ok) throw new Error();
      const metadata = (await response.json()) as {
        name?: string;
        version?: string;
      };
      if (
        metadata.name !== "dsh-atelier" ||
        typeof metadata.version !== "string" ||
        !/^\d+\.\d+\.\d+$/.test(metadata.version)
      )
        throw new Error();
      info.latest = metadata.version;
      info.hasUpdate = newerVersion(metadata.version, info.current);
      expires = Date.now() + 15 * 60 * 1000;
    } catch {
      info.error = "暂时无法检查更新";
      expires = Date.now() + 60000;
    }
    cached = info;
    return info;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
