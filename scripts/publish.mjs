/** 分发入口：默认只打包，all 串联源码、安装入口、npm 与正式 Release。 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, cp } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    channel: { type: "string", default: "prepare" },
    archive: { type: "string" },
  },
});
if (!["prepare", "npm", "github", "all"].includes(values.channel))
  throw new Error("channel 仅支持 prepare、npm、github、all");
if (values.channel === "all") {
  await import("./internal/distribute-all.mjs");
  process.exit(0);
}

/** 参数通过 argv 传递；npm Windows 启动器用 Node 直接运行，避免 shell 字符串解释。 */
function run(file, args, cwd = root, capture = false) {
  const result = spawnSync(file, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${file} 执行失败，分发已停止`);
  return result.stdout?.trim();
}
function npm(args) {
  const cli =
    process.platform === "win32"
      ? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
      : undefined;
  return run(cli ? process.execPath : "npm", cli ? [cli, ...args] : args);
}
const manifest = JSON.parse(
  await readFile(resolve(root, "plugin/package.json"), "utf8"),
);
const archive = resolve(
  root,
  values.archive || `dist/dsh-atelier-${manifest.version}-universal.tgz`,
);
if (values.channel !== "prepare" && !values.archive)
  throw new Error(
    "实际分发必须通过 --archive 指定已验收 TGZ，不允许隐式重新构建",
  );
if (values.channel === "prepare")
  run(process.execPath, ["scripts/internal/pack-plugin.mjs"]);
run(process.execPath, ["scripts/internal/check-archive.mjs", archive]);
if (values.channel === "prepare") {
  run(process.execPath, ["tests/scripts/test-package.mjs", archive]);
  run(process.execPath, ["tests/scripts/test-install.mjs", archive]);
  console.log(`准备完成，未发布：${archive}`);
} else if (values.channel === "npm") {
  npm([
    "publish",
    archive,
    "--access",
    "public",
    "--registry=https://registry.npmjs.org",
  ]);
} else {
  // 主线保留源码，只复制验收包的白名单安装入口，不删除源码。
  await mkdir(resolve(root, ".runtime/distribution"), { recursive: true });
  const stage = await mkdtemp(resolve(root, ".runtime/distribution/publish-"));
  const { extract } = createRequire(resolve(root, "frontend/package.json"))(
    "tar",
  );
  await extract({ file: archive, cwd: stage });
  const repo = join(stage, "repo");
  // 临时仓库不继承源码仓库的局部作者配置；显式复用，避免修改用户全局 Git 设置。
  const authorName = run("git", ["config", "user.name"], root, true);
  const authorEmail = run("git", ["config", "user.email"], root, true);
  run("git", [
    "clone",
    "--single-branch",
    "--branch",
    "main",
    "https://github.com/aidenli/dsh-atelier.git",
    repo,
  ]);
  const previous = await readFile(join(repo, "package.json"), "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
  if (previous?.version === manifest.version)
    throw new Error(
      "main 已存在同版本安装入口，禁止覆盖；请增加版本并重新验收",
    );
  await cp(join(stage, "package"), repo, { recursive: true });
  const installed = JSON.parse(
    await readFile(join(stage, "package/package.json"), "utf8"),
  );
  run("git", ["add", "-f", "--", "package.json", ...installed.files], repo);
  run(
    "git",
    [
      "-c",
      `user.name=${authorName}`,
      "-c",
      `user.email=${authorEmail}`,
      "commit",
      "-m",
      `Distribute Atelier ${manifest.version}`,
    ],
    repo,
  );
  run("git", ["push", "origin", "main"], repo);
  console.log("GitHub main 安装入口已更新；源码和 npm 未自动发布。");
}
