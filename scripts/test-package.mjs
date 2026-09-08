/** 解压真实包，在独立目录验证 Node 后端启动、复用和退出，不读取真实配置。 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = resolve(
  process.argv[2] || resolve(root, `dist/dsh-atelier-0.3.0-universal.tgz`),
);
await mkdir(resolve(root, ".runtime"), { recursive: true });
const stage = await mkdtemp(resolve(root, ".runtime/package-smoke-"));
// 使用同一 tar 库，避免 Windows Git Bash 将 D: 路径误判成远程主机。
const { extract, list } = createRequire(resolve(root, "frontend/package.json"))(
  "tar",
);
await extract({ file: archive, cwd: stage });
const installed = resolve(stage, "package");
assert.ok(
  (await stat(resolve(installed, "lib/backend.mjs"))).size > 0,
  "包内缺少后端",
);
const listing = [];
await list({ file: archive, onReadEntry: (entry) => listing.push(entry.path) });
assert.doesNotMatch(
  listing.join("\n"),
  /(?:\.runtime|service\.token|config\.json|node_modules)/,
  "发布包混入运行数据",
);
// DSH 运行时提供平台依赖；这里只链接同一安装中的依赖，业务 JS 和 exe 均来自解压包。
await symlink(
  resolve(root, "plugin/node_modules"),
  resolve(installed, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);
const { Backend } = await import(
  pathToFileURL(resolve(installed, "lib/index.js")).href
);
const portProbe = createServer();
await new Promise((done) => portProbe.listen(0, "127.0.0.1", done));
const port = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const backendUrl = `http://127.0.0.1:${port}`;
const dataDir = resolve(stage, "independent-data");
const config = { backendUrl, dataDir, mode: "managed" };
const backend = new Backend(config);
const reuse = new Backend(config);
const external = new Backend({ ...config, mode: "external" });
try {
  await backend.initialize();
  assert.equal((await backend.request("GET", "/health")).status, "ok");
  assert.ok(
    (await backend.request("GET", "/health")).capabilities.includes(
      "asset-delete",
    ),
  );
  assert.equal(
    (await backend.request("GET", "/workflows"))[0].remoteId,
    "2096817694862565378",
  );
  await assert.rejects(reuse.initialize(), /另一个 DSH/);
  await external.initialize();
  await external.stop();
  assert.equal(
    (await backend.request("GET", "/health")).status,
    "ok",
    "复用方错误终止了服务",
  );
  assert.equal(
    (await fetch(`${backendUrl}/health`)).status,
    200,
    "直接请求不需要 Authorization",
  );
  await assert.rejects(stat(resolve(dataDir, "service.token")), {
    code: "ENOENT",
  });
} finally {
  await reuse.stop();
  await backend.stop();
}
await assert.rejects(
  fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(1000) }),
  "托管服务退出后仍在监听",
);
console.log(
  "发布包验收通过：内置后端、加载即就绪、活跃实例保护、外部服务不接管、卸载停止，无生成请求。",
);
// 不同数据目录仍必须尊重已有端口，禁止把无关监听者当作自己的健康服务。
const blocker = createServer();
await new Promise((done) => blocker.listen(port, "127.0.0.1", done));
const conflict = new Backend({
  ...config,
  dataDir: resolve(stage, "port-conflict"),
});
try {
  await assert.rejects(conflict.initialize(), /端口已被/);
} finally {
  await conflict.stop();
  await new Promise((done) => blocker.close(done));
}

// 在独立 Node Host 内启动包内后端，再强制结束 Host，验证管道 EOF 触发退出。
const helper = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  const { Backend } = await import(${JSON.stringify(pathToFileURL(resolve(installed, "lib/index.js")).href)});
  const backend = new Backend(${JSON.stringify(config)});
  await backend.initialize();
  process.stdout.write('ready');
`,
  ],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
try {
  await new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error("测试 Host 启动超时")),
      30000,
    );
    helper.stdout.once("data", () => {
      clearTimeout(timer);
      done();
    });
    helper.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("测试 Host 提前退出"));
    });
    helper.once("error", reject);
  });
  const exited = once(helper, "exit");
  helper.kill();
  await exited;
  let stopped = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(300) });
    } catch {
      stopped = true;
      break;
    }
    await delay(200);
  }
  assert.ok(stopped, "父 Host 强制退出后后端仍在监听");
  // 旧身份记录仍在时能够再次加载，数据库锁已释放。
  const restarted = new Backend(config);
  try {
    await restarted.initialize();
  } finally {
    await restarted.stop();
  }
  console.log("父进程强制退出与后端恢复验收通过。");
} finally {
  if (helper.exitCode === null && helper.signalCode === null) {
    const exited = once(helper, "exit");
    helper.kill();
    await exited;
  }
}
