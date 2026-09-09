/** 一键分发：验证后同步独立公开历史、发布 npm、创建 Release；重跑只接受相同产物。 */
import { spawnSync } from "node:child_process";
import { readFile, mkdir, mkdtemp, cp, rm, lstat } from "node:fs/promises";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: { channel: { type: "string" }, archive: { type: "string" } },
});
const repository = "aidenli/dsh-atelier";
/** 所有外部参数通过 argv 传递；失败立即停止，不继续发布其他渠道。 */
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} 执行失败；修复后用 --archive 指定原安装包继续。`,
    );
  return result.stdout?.trim();
}
const node = (args) => run(process.execPath, args);
const manifest = JSON.parse(
  await readFile(join(root, "plugin/package.json"), "utf8"),
);
const version = manifest.version;
const tag = `v${version}`;
const notes = join(root, `docs/发布说明-${version}.md`);
await readFile(notes); // 发布说明缺失时在构建和写远端之前停止。
run("gh", ["auth", "status"]);
const author = [
  "-c",
  `user.name=${run("git", ["config", "user.name"], root, true)}`,
  "-c",
  `user.email=${run("git", ["config", "user.email"], root, true)}`,
];
node(["tests/scripts/scan-secrets.mjs", "--working-tree"]);
if (!values.archive) {
  if (process.platform === "win32")
    // PowerShell 7 按 UTF-8 解析无 BOM 脚本；Windows PowerShell 5.1 会按
    // 本地代码页误读中文字符串，甚至破坏引号并导致发布在构建前失败。
    run("pwsh.exe", [
      "-NoProfile",
      "-File",
      "scripts/build.ps1",
      "-NoRestart",
    ]);
  else run("bash", ["scripts/build.sh", "--no-restart"]);
  node(["tests/scripts/test-frontend.mjs"]);
  node(["scripts/publish.mjs"]);
}
const archive = resolve(
  root,
  values.archive || `dist/dsh-atelier-${version}-universal.tgz`,
);
node(["scripts/internal/check-archive.mjs", archive]);
if (values.archive) {
  node(["tests/scripts/test-package.mjs", archive]);
  node(["tests/scripts/test-install.mjs", archive]);
}
const bytes = await readFile(archive);
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const digest = createHash("sha256").update(bytes).digest("hex");
// 只有明确 404 才代表未发布；认证、网络故障不得误判为可以新建。
const response = await fetch(
  `https://registry.npmjs.org/dsh-atelier/${version}`,
  { signal: AbortSignal.timeout(15000) },
);
if (!response.ok && response.status !== 404)
  throw new Error(`npm 查询失败：${response.status}`);
const published = response.ok ? await response.json() : undefined;
if (published && published.dist?.integrity !== integrity)
  throw new Error("npm 已存在不同内容的同版本，禁止覆盖，请增加版本号。");

await mkdir(join(root, ".runtime/distribution"), { recursive: true });
const stage = await mkdtemp(join(root, ".runtime/distribution/all-"));
const repo = join(stage, "repo");
run("git", [
  "clone",
  "--single-branch",
  "--branch",
  "main",
  `https://github.com/${repository}.git`,
  repo,
]);
const { extract } = createRequire(join(root, "frontend/package.json"))("tar");
await extract({ file: archive, cwd: stage });
const payload = join(stage, "package");
const installed = JSON.parse(
  await readFile(join(payload, "package.json"), "utf8"),
);
const old = await readFile(join(repo, "package.json"), "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
if (old?.version === version) {
  // 同版本恢复必须逐文件相同；Git 文本检出可能转换换行，先关闭转换再重新检出临时副本。
  run(
    "git",
    ["-c", "core.autocrlf=false", "checkout-index", "--all", "--force"],
    repo,
  );
  for (const name of ["package.json", ...installed.files]) {
    if (
      !(await readFile(join(repo, name))).equals(
        await readFile(join(payload, name)),
      )
    )
      throw new Error(`main 同版本内容不同：${name}`);
  }
} else {
  // 只同步 Git 可见的业务源码。运行目录、依赖与父项目历史均不进入公开仓库。
  const names = [
    ...new Set(
      run(
        "git",
        ["ls-files", "-co", "--exclude-standard", "-z", "--", "."],
        root,
        true,
      )
        .split("\0")
        .filter(Boolean),
    ),
  ];
  const allowed =
    /^(backend|frontend|plugin|contracts|scripts|tests|docs)\/|^(README\.md|\.gitignore|\.gitattributes)$/;
  const files = [];
  for (const name of names.filter((name) => allowed.test(name))) {
    const stat = await lstat(join(root, name)).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error(`拒绝发布符号链接：${name}`);
    if (stat?.isFile()) files.push(name);
  }
  for (const name of run("git", ["ls-files", "-z"], repo, true)
    .split("\0")
    .filter(Boolean)) {
    if (!allowed.test(name) || files.includes(name)) continue;
    const target = resolve(repo, name);
    if (!target.startsWith(repo + "/") && !target.startsWith(repo + "\\"))
      throw new Error("路径越界");
    await rm(target); // 仅删除已核对的临时 clone 内旧源码文件，保留根目录安装入口。
  }
  for (const name of files) {
    await mkdir(dirname(join(repo, name)), { recursive: true });
    await cp(join(root, name), join(repo, name));
  }
  await cp(payload, repo, { recursive: true });
  run("git", ["add", "--all"], repo);
  run("git", ["add", "-f", "--", "package.json", ...installed.files], repo);
  run(process.execPath, [join(root, "tests/scripts/scan-secrets.mjs")], repo);
  run("git", ["diff", "--cached", "--check"], repo);
  run("git", [...author, "commit", "-m", `Release Atelier ${version}`], repo);
  run("git", ["push", "origin", "main"], repo);
}
node(["tests/scripts/test-install.mjs", `github:${repository}#main`]);
if (!published)
  node(["scripts/publish.mjs", "--channel", "npm", "--archive", archive]);
node(["tests/scripts/test-install.mjs", `dsh-atelier@${version}`]);
const releases = JSON.parse(
  run(
    "gh",
    ["api", `repos/${repository}/releases`, "--paginate", "--slurp"],
    root,
    true,
  ),
).flat();
const release = releases.find((item) => item.tag_name === tag);
if (release) {
  if (
    release.draft ||
    !release.assets.some(
      (asset) =>
        asset.name === basename(archive) && asset.digest === `sha256:${digest}`,
    ) ||
    !release.assets.some(
      (asset) => asset.name === `${basename(archive)}.sha256`,
    )
  )
    throw new Error("已有 Release 不完整或内容不符，请人工核对；不会覆盖。");
} else {
  const commit = run("git", ["rev-parse", "HEAD"], repo, true);
  run("gh", [
    "release",
    "create",
    tag,
    archive,
    `${archive}.sha256`,
    "--repo",
    repository,
    "--target",
    commit,
    "--title",
    `Atelier ${version}`,
    "--notes-file",
    notes,
    "--latest",
  ]);
}
console.log(
  `分发完成：main、npm ${version}、https://github.com/${repository}/releases/tag/${tag}`,
);
