/** 从已校验的 TGZ 生成分发目录；npm 与 GitHub 使用同一产物，禁止重新编译。 */
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(resolve(root, "plugin/package.json"), "utf8"),
);
const archive = resolve(
  root,
  `dist/dsh-atelier-${manifest.version}-universal.tgz`,
);
const check = spawnSync(
  process.execPath,
  [resolve(root, "scripts/check-archive.mjs"), archive],
  { stdio: "inherit" },
);
if (check.status !== 0) throw new Error("安装包校验失败，停止准备发布");
await mkdir(resolve(root, ".runtime/distribution"), { recursive: true });
const stage = await mkdtemp(resolve(root, ".runtime/distribution/release-"));
const { extract } = createRequire(resolve(root, "frontend/package.json"))(
  "tar",
);
await extract({ file: archive, cwd: stage });
console.log(`分发目录：${resolve(stage, "package")}`);
