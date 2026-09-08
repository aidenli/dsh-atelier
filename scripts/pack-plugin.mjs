/** 白名单组装自包含安装包；tar 库显式设置执行位，Windows 也能打出可执行的 Mac 文件。 */
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    target: { type: "string", default: "universal" },
    "skip-build": { type: "boolean", default: false },
  },
});
const target = values.target;
if (target !== "universal") throw new Error("无效的打包目标");
if (!values["skip-build"]) {
  const result = spawnSync(
    process.execPath,
    [resolve(root, "scripts/build-plugin.mjs")],
    { stdio: "inherit", env: { ...process.env, ATELIER_TARGET: target } },
  );
  if (result.status !== 0) throw new Error("构建失败");
}
const manifest = JSON.parse(
  await readFile(resolve(root, "plugin/package.json"), "utf8"),
);
const files = manifest.files;
await mkdir(resolve(root, ".runtime/packages"), { recursive: true });
const stage = await mkdtemp(resolve(root, `.runtime/packages/${target}-`));
for (const name of files) {
  const output = resolve(stage, "package", name);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(root, "plugin", name), output);
}
await writeFile(
  resolve(stage, "package/package.json"),
  JSON.stringify(
    { ...manifest, files, os: undefined, cpu: undefined, scripts: undefined },
    null,
    2,
  ),
);
const name = `dsh-atelier-${manifest.version}-${target}.tgz`;
await mkdir(resolve(root, "dist"), { recursive: true });
const archive = resolve(root, "dist", name);
const { create } = createRequire(resolve(root, "frontend/package.json"))("tar");
await create(
  {
    cwd: stage,
    file: archive,
    gzip: true,
    portable: true,
    noMtime: true,
    filter: (path, stat) => {
      stat.mode = (stat.mode & ~0o777) | (stat.isDirectory() ? 0o755 : 0o644);
      return true;
    },
  },
  ["package"],
);
const digest = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(archive + ".sha256", `${digest}  ${name}\n`);
console.log(`安装包：${archive}`);
