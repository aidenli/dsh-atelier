/** macOS 仅向身份一致的 Host 发送 SIGTERM，等待其与托管后端退出；不强杀或删除锁。 */
import { spawnSync, spawn } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    port: { type: "string", default: "3080" },
    "data-dir": { type: "string", default: resolve(root, ".runtime/default") },
  },
});
if (process.platform !== "darwin") throw new Error("此重启入口仅支持 macOS");
if (!process.env.DSH_SOURCE) throw new Error("请设置 DSH_SOURCE");
const source = resolve(process.env.DSH_SOURCE),
  data = resolve(values["data-dir"]);
const entry = resolve(root, "plugin/lib/backend.mjs");
if (!existsSync(join(source, "apps/cli/src/bin.ts")) || !existsSync(entry))
  throw new Error("请先准备 DSH 源码并编译插件");
const recordPath = join(data, "managed-process.json");
/** ps 仅查询指定 PID，固定语言并禁用截断；读取失败不能误判为空闲。 */
function identity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("无效 PID");
  const field = (name) => {
    const r = spawnSync(
      "/bin/ps",
      ["-ww", "-p", String(pid), "-o", `${name}=`],
      { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 5000 },
    );
    if (r.status === 1) return "";
    if (r.error || r.status !== 0) throw new Error("无法核验进程身份");
    return r.stdout.trim();
  };
  const started = field("lstart");
  if (!started || field("stat").startsWith("Z")) return null;
  const result = {
    pid,
    started,
    path: field("comm"),
    command: field("command"),
  };
  if (started !== field("lstart")) throw new Error("查询期间进程身份改变");
  return result;
}
function verify(expected) {
  const found = identity(expected.pid);
  if (
    found &&
    ["started", "path", "command"].some((key) => found[key] !== expected[key])
  )
    throw new Error("PID 身份已改变，拒绝操作");
  return found;
}
const record = existsSync(recordPath)
  ? JSON.parse(readFileSync(recordPath, "utf8"))
  : undefined;
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("无效端口");
// 未知端口占用绝不推断成当前 Host；错误时退出，不启动第二个实例。
const listeners = spawnSync(
  "/usr/sbin/lsof",
  ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
  { encoding: "utf8", timeout: 5000 },
);
if (listeners.error || ![0, 1].includes(listeners.status))
  throw new Error("无法检查 DSH 端口");
for (const pid of listeners.stdout.trim().split(/\s+/).filter(Boolean)) {
  if (!record || Number(pid) !== record.parent.pid || !verify(record.parent))
    throw new Error("DSH 端口被未核验实例占用");
}
if (record) {
  if (
    record.platform !== "darwin" ||
    resolve(record.dataDir) !== data ||
    record.entry !== entry ||
    !record.process.command.includes("--parent-pipe") ||
    !/apps\/cli\/(src\/bin\.ts|lib\/bin\.js).*web/.test(record.parent.command)
  )
    throw new Error("不是当前源码插件的托管记录");
  const parent = verify(record.parent),
    backend = verify(record.process);
  if (!parent && backend)
    throw new Error("孤立后端仍运行，请先排查，未强制停止");
  if (values["dry-run"]) {
    console.log("身份检查通过，未重启");
    process.exit(0);
  }
  if (parent) {
    verify(record.parent);
    process.kill(parent.pid, "SIGTERM");
    const deadline = Date.now() + 60000;
    while (verify(record.parent) || verify(record.process)) {
      if (Date.now() > deadline)
        throw new Error("等待退出超时，停止重启；未强制结束进程");
      await delay(300);
    }
  }
} else if (values["dry-run"]) {
  console.log("无托管记录，实际执行将启动 DSH");
  process.exit(0);
}
const logs = join(root, ".runtime");
mkdirSync(logs, { recursive: true });
const prefix = join(logs, `dsh-${Date.now()}`),
  stdout = openSync(prefix + ".stdout.log", "a", 0o600),
  stderr = openSync(prefix + ".stderr.log", "a", 0o600);
const child = spawn("pnpm", ["dsh", "web"], {
  cwd: source,
  detached: true,
  stdio: ["ignore", stdout, stderr],
});
child.on("error", () => {
  console.error("DSH 启动失败，请检查 pnpm 与日志");
  process.exitCode = 1;
});
closeSync(stdout);
closeSync(stderr);
child.unref();
for (let i = 0; i < 120; i++) {
  await delay(500);
  const url = readFileSync(prefix + ".stdout.log", "utf8").match(
    /https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/\?token=\S+/,
  )?.[0];
  if (url && existsSync(recordPath)) {
    const current = JSON.parse(readFileSync(recordPath, "utf8"));
    if (
      verify(current.process) &&
      (!record || current.parent.started !== record.parent.started)
    ) {
      const listen = current.process.command.match(
        /--listen\s+(127\.0\.0\.1:\d+)/,
      )?.[1];
      if (listen) {
        try {
          const response = await fetch(`http://${listen}/health`, {
            signal: AbortSignal.timeout(2000),
          });
          const health = await response.json();
          if (
            response.ok &&
            health.status === "ok" &&
            health.runtime === "node"
          ) {
            console.log(`DSH 与后端已就绪：${url}\n日志：${prefix}.stdout.log`);
            process.exit(0);
          }
        } catch {
          /* 后端尚未就绪时继续有界等待。 */
        }
      }
    }
  }
}
throw new Error(`启动未确认，请检查 ${prefix}.stderr.log；不要重复启动`);
