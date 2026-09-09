/** 编译并执行插件集成测试，依赖沿用插件构建时链接的本机 DSH 版本。 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "frontend/package.json"));
await require("esbuild").build({
  entryPoints: [resolve(root, "plugin/tests/integration.test.ts")],
  outfile: resolve(root, "plugin/lib/integration.test.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node22",
});
const result = spawnSync(
  process.execPath,
  ["--test", resolve(root, "plugin/lib/integration.test.js")],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
