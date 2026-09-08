/** 从本机 DSH 源码解析平台依赖，在独立临时 workspace 生成官方 Typert 契约并构建插件。 */
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  symlink,
  copyFile,
  cp,
  lstat,
  unlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dsh = process.env.DSH_SOURCE || resolve(root, "../../deepseek-harness");
const target = "universal";
const plugin = resolve(root, "plugin");
const stage = resolve(root, `.runtime/typert-build-${target}`);
const packageDir = resolve(stage, "packages/atelier");
const frontendRequire = createRequire(resolve(root, "frontend/package.json"));
const { build } = frontendRequire("esbuild");
const packages = new Map();
const contractCheck = spawnSync(
  process.execPath,
  [resolve(root, "scripts/generate-contracts.mjs"), "--check"],
  { stdio: "inherit" },
);
if (contractCheck.status !== 0) throw new Error("公开契约不一致");

// 后端 JavaScript 与依赖预先打包，安装时不执行编译或下载平台二进制。
const backend = spawnSync(
  process.execPath,
  [
    resolve(root, "backend/node_modules/typescript/bin/tsc"),
    "-p",
    resolve(root, "backend/tsconfig.json"),
  ],
  { stdio: "inherit" },
);
if (backend.status !== 0) throw new Error("Node 后端类型检查失败");
await mkdir(resolve(plugin, "lib"), { recursive: true });
await build({
  entryPoints: [resolve(root, "backend/src/main.ts")],
  outfile: resolve(plugin, "lib/backend.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.19",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

/** 只枚举平台包目录，不扫描 node_modules 或运行数据。 */
async function scan(dir, depth = 0) {
  if (existsSync(join(dir, "package.json"))) {
    const manifest = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    );
    if (manifest.name?.startsWith("@deepseek-ai/"))
      packages.set(manifest.name, dir);
    return;
  }
  if (depth > 4) return;
  for (const item of await readdir(dir, { withFileTypes: true }))
    if (
      item.isDirectory() &&
      !["node_modules", "lib", ".git"].includes(item.name)
    )
      await scan(join(dir, item.name), depth + 1);
}
await scan(resolve(dsh, "packages"));
await scan(resolve(dsh, "vendor"));

/** 本机链接保持 Cordis 单一实例，禁止将另一份 Cordis 打包进插件。 */
async function link(target, path) {
  await mkdir(dirname(path), { recursive: true });
  if (!existsSync(target)) throw new Error(`依赖不存在：${target}`);
  if (!existsSync(path)) {
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) await unlink(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await symlink(
      target,
      path,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}
for (const [name, dir] of packages) {
  await link(dir, resolve(plugin, "node_modules", name));
  await link(dir, resolve(stage, "node_modules", name));
}
const zodDir = dirname(
  createRequire(resolve(dsh, "packages/typert/registry/package.json")).resolve(
    "zod/package.json",
  ),
);
await link(
  resolve(dsh, "node_modules/@types/node"),
  resolve(stage, "node_modules/@types/node"),
);
await link(zodDir, resolve(stage, "node_modules/zod"));
await link(
  resolve(root, "frontend/node_modules/react"),
  resolve(plugin, "node_modules/react"),
);
await link(
  resolve(root, "frontend/node_modules/@types/react"),
  resolve(plugin, "node_modules/@types/react"),
);
await link(
  resolve(dsh, "node_modules/@types/node"),
  resolve(plugin, "node_modules/@types/node"),
);
await mkdir(resolve(packageDir, "src"), { recursive: true });
await mkdir(resolve(plugin, "lib"), { recursive: true });
const manifest = JSON.parse(
  await readFile(resolve(plugin, "package.json"), "utf8"),
);
const stagedManifest = {
  ...manifest,
  exports: {
    ".": { types: "./lib/types/index.d.ts", default: "./lib/index.js" },
    "./typert": manifest.exports["./typert"],
    "./remote": manifest.exports["./remote"],
  },
  dsh: undefined,
};
await writeFile(
  resolve(packageDir, "package.json"),
  JSON.stringify(stagedManifest, null, 2),
);
await writeFile(
  resolve(packageDir, "src/index.ts"),
  "export { AtelierRemote } from './remote.ts';\n",
);
for (const name of ["remote.ts", "backend.ts", "managed-process.ts"])
  await copyFile(
    resolve(plugin, "src", name),
    resolve(packageDir, "src", name),
  );
await cp(resolve(root, "contracts"), resolve(stage, "packages/contracts"), {
  recursive: true,
});
// 官方分析器按 workspace 注册身份识别 Remote 装饰器，需要同时注册协议源码所在包。
const protocolDir = resolve(stage, "packages/protocol");
await mkdir(protocolDir, { recursive: true });
await cp(
  resolve(dsh, "packages/typert/protocol/src"),
  resolve(protocolDir, "src"),
  { recursive: true },
);
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
const { WorkspaceTypertGenerator } = await import(
  pathToFileURL(resolve(dsh, "packages/typert/generator/lib/index.js")).href
);
const artifacts = new WorkspaceTypertGenerator(stage).generate(
  ["dsh-atelier"],
  ["host"],
);
for (const artifact of artifacts) {
  await writeFile(resolve(plugin, "lib/typert.host.js"), artifact.js);
  await writeFile(resolve(plugin, "lib/typert.host.d.ts"), artifact.dts);
  if (!artifact.remote) throw new Error("未生成 Remote 契约");
  await writeFile(
    resolve(plugin, "lib/typert.remote-client.js"),
    artifact.remote.js,
  );
  await writeFile(
    resolve(plugin, "lib/typert.remote-client.d.ts"),
    artifact.remote.dts,
  );
}
await link(zodDir, resolve(plugin, "node_modules/zod"));
await build({
  entryPoints: [resolve(plugin, "src/index.ts")],
  outfile: resolve(plugin, "lib/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
});
const output = await build({
  entryPoints: [resolve(plugin, "src/client.tsx")],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  write: false,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  nodePaths: [resolve(root, "frontend/node_modules")],
  outfile: "client.js",
  external: [
    "react",
    "react/jsx-runtime",
    "react-dom",
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-client-store",
    "@deepseek-ai/dsh-client-ui-slots",
    "@deepseek-ai/dsh-client-ui-primitives",
  ],
});
const js = output.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const css =
  output.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
if (!js) throw new Error("浏览器构建没有输出");
await writeFile(
  resolve(plugin, "lib/client.js"),
  `window.__ModuleLoader__.load({id:"dsh-atelier",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${js}\nconst style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.appendChild(style);return module.exports;}});\n`,
);
console.log("已生成 Typert Host/Remote 契约及插件 Host/Client 构建产物");
await import("./third-party-notices.mjs");
