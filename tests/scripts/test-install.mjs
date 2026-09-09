/** 用官方 CLI 在临时 profile 真正安装 tgz，覆盖 pnpm 依赖解析，不借用本地插件链接。 */
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dsh = process.env.DSH_SOURCE || resolve(root, "../../deepseek-harness");
await mkdir(resolve(root, ".runtime"), { recursive: true });
const stage = await mkdtemp(resolve(root, ".runtime/install-check-"));
const spec =
  process.argv[2] || resolve(root, `dist/dsh-atelier-0.3.0-universal.tgz`);
// 在线 tarball 保留协议和地址，不能作为本机路径 resolve。
const archive =
  /^(https?:|github:)/.test(spec) ||
  spec === "dsh-atelier" ||
  spec.startsWith("dsh-atelier@")
    ? spec
    : resolve(spec);
const child = spawn(
  process.execPath,
  [
    resolve(dsh, "apps/cli/lib/bin.js"),
    "plugin",
    "--profile",
    "web",
    "add",
    archive,
  ],
  {
    cwd: dsh,
    windowsHide: true,
    env: { ...process.env, DSH_HOME: stage },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
const code = await new Promise((done, reject) => {
  child.once("exit", done);
  child.once("error", reject);
});
await writeFile(resolve(stage, "install.log"), output);
assert.equal(code, 0, `官方 CLI 安装失败，查看 ${stage}/install.log`);
const profileFile = resolve(stage, "profiles/web/package.json");
const profile = JSON.parse(await readFile(profileFile, "utf8"));
assert.ok(profile.dsh.profile.bundles.includes("dsh-atelier"));
const require = createRequire(profileFile);
const packageFile = require.resolve("dsh-atelier/package.json");
const manifest = JSON.parse(await readFile(packageFile, "utf8"));
assert.equal(manifest.scripts, undefined);
console.log("官方 dsh plugin add 安装预编译包通过，无安装期构建脚本。");
