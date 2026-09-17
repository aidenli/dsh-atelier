/**
 * 只重新生成 Typert 契约（typert.host.* / typert.remote-client.*）。
 *
 * 与 build-plugin.mjs 的差别：不重建 Node 后端与 React 前端，也不做
 * "先删再建" 的依赖链接刷新 —— 只补齐缺失的链接，因此可以安全地在
 * 已有 `.runtime/typert-build-universal` 暂存区上重复执行。
 *
 * 用途：DSH 的 Typert 生成器/加载器升级后（例如 codec 由 schema 改为
 * create），插件里已生成的契约会失效，用本脚本快速重生成即可。
 *
 * 用法：DSH_SOURCE=E:/project/deepseek-harness node scripts/internal/regenerate-typert.mjs
 */
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  symlink,
  copyFile,
  cp,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dsh = process.env.DSH_SOURCE || resolve(root, "../../deepseek-harness");
const target = "universal";
const plugin = resolve(root, "plugin");
const stage = resolve(root, `.runtime/typert-build-${target}`);
const packageDir = resolve(stage, "packages/atelier");
const frontendRequire = createRequire(resolve(root, "frontend/package.json"));

/** 枚举 DSH 工作区里的平台包目录，用于补齐依赖链接。 */
const packages = new Map();
async function scan(dir, depth = 0) {
  if (existsSync(join(dir, "package.json"))) {
    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    if (manifest.name?.startsWith("@deepseek-ai/")) packages.set(manifest.name, dir);
    return;
  }
  if (depth > 4) return;
  for (const item of await readdir(dir, { withFileTypes: true }))
    if (item.isDirectory() && !["node_modules", "lib", ".git"].includes(item.name))
      await scan(join(dir, item.name), depth + 1);
}
await scan(resolve(dsh, "packages"));
await scan(resolve(dsh, "vendor"));

/** 只在缺失时创建链接，已存在的链接原样保留（不删除任何内容）。 */
async function ensureLink(targetPath, path) {
  if (existsSync(path)) return;
  if (!existsSync(targetPath)) throw new Error(`依赖不存在：${targetPath}`);
  await mkdir(dirname(path), { recursive: true });
  await symlink(
    targetPath,
    path,
    process.platform === "win32" ? "junction" : "dir",
  );
}

await mkdir(resolve(packageDir, "src"), { recursive: true });
await mkdir(resolve(plugin, "lib"), { recursive: true });
for (const [name, dir] of packages) {
  await ensureLink(dir, resolve(plugin, "node_modules", name));
  await ensureLink(dir, resolve(stage, "node_modules", name));
}
await ensureLink(
  resolve(dsh, "node_modules/@types/node"),
  resolve(stage, "node_modules/@types/node"),
);
await ensureLink(
  dirname(
    createRequire(resolve(dsh, "packages/typert/registry/package.json")).resolve(
      "zod/package.json",
    ),
  ),
  resolve(stage, "node_modules/zod"),
);

// 暂存区里的源码副本按当前 plugin/src 与 DSH 源码刷新（覆盖写入，不删除）。
const manifest = JSON.parse(
  await readFile(resolve(plugin, "package.json"), "utf8"),
);
await writeFile(
  resolve(packageDir, "package.json"),
  JSON.stringify(
    {
      ...manifest,
      exports: {
        ".": { types: "./lib/types/index.d.ts", default: "./lib/index.js" },
        "./typert": manifest.exports["./typert"],
        "./remote": manifest.exports["./remote"],
      },
      dsh: undefined,
    },
    null,
    2,
  ),
);
await writeFile(
  resolve(packageDir, "src/index.ts"),
  "export { AtelierRemote } from './remote.ts';\n",
);
for (const name of ["remote.ts", "backend.ts", "managed-process.ts", "version.ts"])
  await copyFile(resolve(plugin, "src", name), resolve(packageDir, "src", name));
await cp(resolve(root, "contracts"), resolve(stage, "packages/contracts"), {
  recursive: true,
});
const protocolDir = resolve(stage, "packages/protocol");
await mkdir(protocolDir, { recursive: true });
await cp(resolve(dsh, "packages/typert/protocol/src"), resolve(protocolDir, "src"), {
  recursive: true,
});
await copyFile(
  resolve(dsh, "packages/typert/protocol/package.json"),
  resolve(protocolDir, "package.json"),
);

const compilerOptions = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  types: ["node"],
  lib: ["ES2022", "DOM", "ESNext.Decorators"],
  paths: {
    "@deepseek-ai/dsh-typert-protocol": [resolve(protocolDir, "src/index.ts")],
  },
};
await writeFile(
  resolve(stage, "tsconfig.host.json"),
  JSON.stringify({
    compilerOptions,
    files: [],
    references: [
      { path: "./packages/atelier/tsconfig.json" },
      { path: "./packages/protocol/tsconfig.json" },
    ],
  }),
);
for (const dir of [packageDir, protocolDir])
  await writeFile(
    resolve(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions, include: ["src/**/*.ts"] }),
  );

const generatorPath = resolve(dsh, "packages/typert/generator/lib/index.js");
const { WorkspaceTypertGenerator } = await import(
  pathToFileURL(generatorPath).href
);
const artifacts = new WorkspaceTypertGenerator(stage).generate(
  ["dsh-atelier"],
  ["host"],
);
if (artifacts.length === 0) throw new Error("生成器没有输出任何契约");
for (const artifact of artifacts) {
  await writeFile(resolve(plugin, "lib/typert.host.js"), artifact.js);
  await writeFile(resolve(plugin, "lib/typert.host.d.ts"), artifact.dts);
  if (!artifact.remote) throw new Error("未生成 Remote 契约");
  await writeFile(resolve(plugin, "lib/typert.remote-client.js"), artifact.remote.js);
  await writeFile(
    resolve(plugin, "lib/typert.remote-client.d.ts"),
    artifact.remote.dts,
  );
}
console.log("Typert 契约已重新生成");
