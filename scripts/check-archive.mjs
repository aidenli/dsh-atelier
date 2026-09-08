/** 校验发布白名单、目标二进制格式、执行位和安装脚本；不运行跨平台程序。 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = resolve(process.argv[2]);
const target = "universal";
const { list } = createRequire(resolve(root, "frontend/package.json"))("tar");
const entries = new Map();
await list({
  file: archive,
  onReadEntry: (entry) => {
    const chunks = [];
    entry.on("data", (chunk) => chunks.push(chunk));
    entry.on("end", () =>
      entries.set(entry.path.replace(/\/$/, ""), {
        data: Buffer.concat(chunks),
        mode: entry.mode,
        type: entry.type,
      }),
    );
  },
});
const manifest = JSON.parse(entries.get("package/package.json").data);
assert.equal(manifest.scripts, undefined, "安装包不应执行构建脚本");
assert.equal(manifest.os, undefined);
assert.equal(manifest.cpu, undefined);
const source = JSON.parse(
  await readFile(resolve(root, "plugin/package.json"), "utf8"),
);
const allowed = new Set([
  "package/package.json",
  ...source.files.map((v) => `package/${v}`),
]);
for (const [name, entry] of entries)
  if (entry.type !== "Directory")
    assert.ok(allowed.has(name), `非白名单内容：${name}`);
for (const name of allowed)
  assert.ok(entries.has(name), `缺少发布文件：${name}`);
const entry = entries.get("package/lib/backend.mjs");
assert.match(entry.data.toString("utf8"), /node:sqlite/);
assert.ok(
  ![...entries.keys()].some((name) => /\.(exe|node|map)$/.test(name)),
  "禁止原生程序和 source map",
);
const digest = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
assert.equal(
  (await readFile(archive + ".sha256", "utf8")).split(" ")[0],
  digest,
);
console.log(`发布包结构、架构、权限与 SHA256 通过：${target}`);
