var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name2, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name: name2, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name2, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name2]() {
    return __privateGet(this, extra);
  }, set [name2](x) {
    return __privateSet(this, extra, x);
  } }, name2));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name2) : __name(target, name2);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name2, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name2 in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name2];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name2] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name2, desc), p ? k ^ 4 ? extra : desc : target;
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// plugin/src/backend.ts
import { readFile as readFile2, writeFile as writeFile2, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { setTimeout as delay2 } from "node:timers/promises";

// contracts/http.ts
async function readJSON(response) {
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      response.ok ? `\u540E\u7AEF\u8FD4\u56DE\u683C\u5F0F\u5F02\u5E38\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u5730\u5740\u4E0E\u7248\u672C` : `\u540E\u7AEF\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u5730\u5740\u5E76\u91CD\u542F\u65B0\u7248\u540E\u7AEF`
    );
  }
  if (!response.ok) {
    const reason = typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : "\u540E\u7AEF\u8BF7\u6C42\u5931\u8D25";
    throw new Error(`${reason}\uFF08HTTP ${response.status}\uFF09`);
  }
  return value;
}

// plugin/src/managed-process.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
var execute = promisify(execFile);
async function inspect(pid, expected) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("\u6258\u7BA1\u8FDB\u7A0B PID \u65E0\u6548");
  if (process.platform === "darwin") return inspectMac(pid, expected);
  if (process.platform !== "win32")
    throw new Error("\u4E0D\u652F\u6301\u6B64\u7CFB\u7EDF\u7684\u6258\u7BA1\u8FDB\u7A0B\u6838\u9A8C");
  const script = `
$ErrorActionPreference = 'Stop'
$p = Get-Process -Id ([int]$env:ATELIER_PROCESS_PID) -ErrorAction SilentlyContinue
if ($null -eq $p) { Write-Output 'null'; exit }
try {
  $handle = $p.Handle
  $c = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $p.Id)
  if ($p.HasExited -or $null -eq $c) { Write-Output 'null'; exit }
  $identity = @{pid=$p.Id; started=$p.StartTime.ToUniversalTime().Ticks.ToString(); path=$p.Path; command=$c.CommandLine}
  if ($env:ATELIER_PROCESS_EXPECTED) {
    $e = $env:ATELIER_PROCESS_EXPECTED | ConvertFrom-Json
    if ($identity.started -ne $e.started -or $identity.path -ne $e.path -or $identity.command -cne $e.command) { throw '\u8FDB\u7A0B\u8EAB\u4EFD\u5DF2\u7ECF\u53D8\u5316\uFF0C\u62D2\u7EDD\u505C\u6B62' }
    Stop-Process -InputObject $p -Force
    if (-not $p.WaitForExit(20000)) { throw '\u7B49\u5F85\u65E7\u8FDB\u7A0B\u9000\u51FA\u8D85\u65F6' }
  }
  $identity | ConvertTo-Json -Compress
} finally { $p.Dispose() }
`;
  const { stdout } = await execute(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      timeout: 3e4,
      env: {
        ...process.env,
        ATELIER_PROCESS_PID: String(pid),
        ATELIER_PROCESS_EXPECTED: expected ? JSON.stringify(expected) : ""
      }
    }
  );
  return JSON.parse(stdout.trim());
}
async function inspectMac(pid, expected) {
  const field = async (name2) => {
    try {
      const { stdout } = await execute(
        "/bin/ps",
        ["-ww", "-p", String(pid), "-o", `${name2}=`],
        { env: { ...process.env, LC_ALL: "C" }, timeout: 5e3 }
      );
      return stdout.trim();
    } catch (error) {
      if (error.code === 1) return "";
      throw error;
    }
  };
  const started = await field("lstart");
  if (!started || (await field("stat")).startsWith("Z")) return null;
  const identity = {
    pid,
    started,
    path: await field("comm"),
    command: await field("command")
  };
  if (!identity.path || !identity.command || await field("lstart") !== started)
    throw new Error("\u8FDB\u7A0B\u8EAB\u4EFD\u8BFB\u53D6\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u62D2\u7EDD\u63A5\u7BA1");
  if (expected) {
    if (JSON.stringify(identity) !== JSON.stringify(expected))
      throw new Error("\u8FDB\u7A0B\u8EAB\u4EFD\u5DF2\u7ECF\u53D8\u5316\uFF0C\u62D2\u7EDD\u505C\u6B62");
    const latest = await inspectMac(pid);
    if (!latest || JSON.stringify(latest) !== JSON.stringify(identity))
      throw new Error("\u8FDB\u7A0B\u8EAB\u4EFD\u5DF2\u7ECF\u53D8\u5316\uFF0C\u62D2\u7EDD\u505C\u6B62");
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 100; i++) {
      const current = await inspectMac(pid);
      if (!current || current.started !== started) return identity;
      await delay(200);
    }
    throw new Error("\u65E7\u540E\u7AEF\u672A\u5728 20 \u79D2\u5185\u9000\u51FA\uFF0C\u8BF7\u4EBA\u5DE5\u68C0\u67E5\uFF1B\u672A\u5F3A\u5236\u7ED3\u675F\u4E0D\u786E\u5B9A\u8FDB\u7A0B");
  }
  return identity;
}
var recordPath = (dir) => resolve(dir, "managed-process.json");
async function reapManagedProcess(dataDir, binary, entry) {
  let record;
  try {
    record = JSON.parse(await readFile(recordPath(dataDir), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw new Error("\u6258\u7BA1\u8FDB\u7A0B\u8BB0\u5F55\u635F\u574F\uFF0C\u8BF7\u68C0\u67E5 managed-process.json");
  }
  const current = await inspect(record.process.pid);
  const alive = current && current.started === record.process.started && current.path === record.process.path && current.command === record.process.command;
  if (!record.entry && entry && alive)
    throw new Error("\u65E7 Go \u540E\u7AEF\u4ECD\u5728\u8FD0\u884C\uFF0C\u8BF7\u5148\u6B63\u5E38\u505C\u6B62\u65E7 DSH \u518D\u5207\u6362 Node \u540E\u7AEF");
  if (!alive && record.dataDir === dataDir) {
    await rm(recordPath(dataDir), { force: true });
    return;
  }
  if (entry !== void 0 && record.entry !== entry || record.platform !== void 0 && record.platform !== process.platform || record.dataDir !== dataDir || (process.platform === "win32" ? resolve(record.process.path).toLowerCase() !== resolve(binary).toLowerCase() : resolve(record.process.path) !== resolve(binary)))
    throw new Error("\u6258\u7BA1\u8FDB\u7A0B\u8BB0\u5F55\u4E0E\u5F53\u524D\u76EE\u5F55\u6216\u7A0B\u5E8F\u4E0D\u5339\u914D\uFF0C\u62D2\u7EDD\u63A5\u7BA1");
  if (current && current.started === record.process.started && current.path === record.process.path && current.command === record.process.command) {
    const parent = await inspect(record.parent.pid);
    if (parent && parent.started === record.parent.started)
      throw new Error("\u6B64\u6570\u636E\u76EE\u5F55\u7684\u6258\u7BA1\u540E\u7AEF\u4ECD\u7531\u53E6\u4E00\u4E2A DSH \u5B9E\u4F8B\u7BA1\u7406");
    await inspect(current.pid, record.process);
  }
  await rm(recordPath(dataDir), { force: true });
}
async function recordManagedProcess(dataDir, pid, entry) {
  const child = await inspect(pid);
  const parent = await inspect(process.pid);
  if (!child || !parent) throw new Error("\u6258\u7BA1\u540E\u7AEF\u5728\u767B\u8BB0\u524D\u9000\u51FA");
  const path = recordPath(dataDir);
  await writeFile(
    path + ".tmp",
    JSON.stringify({
      platform: process.platform,
      process: child,
      parent,
      dataDir,
      entry
    }),
    { mode: 384 }
  );
  await rename(path + ".tmp", path);
}

// plugin/src/backend.ts
import { createConnection } from "node:net";
var Backend = class {
  constructor(config) {
    this.config = config;
    const sourceRoot = resolve2(this.packageRoot, "..");
    const defaultData = existsSync(resolve2(sourceRoot, "backend/package.json")) ? resolve2(sourceRoot, ".runtime/default") : resolve2(homedir(), ".dsh-atelier/default");
    this.dataDir = resolve2(config.dataDir || defaultData);
    this.settingsFile = resolve2(this.dataDir, "plugin.json");
    this.settings = {
      backendUrl: config.backendUrl || "http://127.0.0.1:8787",
      mode: config.mode || "managed"
    };
  }
  settings;
  child;
  packageRoot = resolve2(
    dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  dataDir;
  settingsFile;
  /** initialize 读取部署配置并在托管模式启动子进程；无需服务令牌。 */
  async initialize() {
    await mkdir(this.dataDir, { recursive: true, mode: 448 });
    try {
      this.settings = this.validate(
        JSON.parse(await readFile2(this.settingsFile, "utf8"))
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await this.start();
  }
  /** connection 先保存有效配置再检查服务；连接失败仍保留新 URL，页面可以继续修正。 */
  async connection(next) {
    if (next) {
      const validated = this.validate(next);
      await this.stop();
      await writeFile2(
        this.settingsFile + ".tmp",
        JSON.stringify(validated, null, 2),
        { mode: 384 }
      );
      const { rename: rename2 } = await import("node:fs/promises");
      await rename2(this.settingsFile + ".tmp", this.settingsFile);
      this.settings = validated;
      await this.start();
    }
    return { ...this.settings };
  }
  validate(value) {
    const url = new URL(value.backendUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !["managed", "external"].includes(value.mode))
      throw new Error("\u540E\u7AEF\u8FDE\u63A5\u914D\u7F6E\u65E0\u6548");
    if (value.mode === "managed" && (url.protocol !== "http:" || url.pathname !== "/" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
      throw new Error("\u6258\u7BA1\u6A21\u5F0F\u4EC5\u652F\u6301\u6CA1\u6709\u8DEF\u5F84\u524D\u7F00\u7684\u672C\u673A HTTP \u5730\u5740");
    return { backendUrl: url.toString().replace(/\/$/, ""), mode: value.mode };
  }
  /** fetch 流式转发请求及响应，不附加服务令牌或 RunningHub 密钥。 */
  async fetch(path, init = {}) {
    const headers = new Headers(init.headers);
    try {
      return await fetch(this.settings.backendUrl + path, {
        ...init,
        headers,
        redirect: "error",
        signal: init.signal || AbortSignal.timeout(12e4)
      });
    } catch {
      throw new Error("\u65E0\u6CD5\u8FDE\u63A5 Atelier \u540E\u7AEF\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1 URL \u548C\u8FD0\u884C\u72B6\u6001");
    }
  }
  /** request 仅处理受限 JSON API，禁止浏览器通过 Remote 调用 Host 专用路径导入。 */
  async request(method, path, body, trusted = false) {
    if (!["GET", "POST", "PUT", "DELETE"].includes(method) || !/^\/(health|config|workflows|tasks|assets|events)(?:[/?]|$)/.test(
      path
    ) || path.includes("..") || path.includes("\\") || !trusted && path.split("?")[0] === "/assets/import")
      throw new Error("\u4E0D\u5141\u8BB8\u7684 Atelier \u64CD\u4F5C");
    const response = await this.fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    return readJSON(response);
  }
  async start() {
    if (this.settings.mode !== "managed") return;
    if (this.config.binaryPath)
      throw new Error(
        "binaryPath \u5DF2\u505C\u7528\uFF0C\u8BF7\u79FB\u9664\u65E7 Go \u7A0B\u5E8F\u914D\u7F6E\uFF0C\u4F7F\u7528 backendEntry \u6307\u5B9A Node \u5165\u53E3"
      );
    const binary = process.execPath;
    const entry = resolve2(
      this.config.backendEntry || resolve2(this.packageRoot, "lib/backend.mjs")
    );
    if (!["win32:x64", "darwin:arm64", "darwin:x64"].includes(
      `${process.platform}:${process.arch}`
    ))
      throw new Error("Atelier \u6258\u7BA1\u540E\u7AEF\u4EC5\u652F\u6301 Windows x64 \u548C macOS ARM64/x64");
    if (!existsSync(entry))
      throw new Error("\u672A\u627E\u5230 Node \u540E\u7AEF\uFF0C\u8BF7\u5148\u8FD0\u884C\u6784\u5EFA\u811A\u672C");
    await reapManagedProcess(this.dataDir, binary, entry);
    const url = new URL(this.settings.backendUrl);
    const occupied = await new Promise((done, reject) => {
      const socket = createConnection({
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 80)
      });
      socket.once("connect", () => {
        socket.destroy();
        done(true);
      });
      socket.once("error", (error) => {
        socket.destroy();
        if (error.code === "ECONNREFUSED") done(false);
        else reject(error);
      });
      socket.setTimeout(1500, () => {
        socket.destroy();
        reject(new Error("\u68C0\u6D4B\u540E\u7AEF\u7AEF\u53E3\u8D85\u65F6"));
      });
    });
    if (occupied)
      throw new Error(
        "Atelier \u7AEF\u53E3\u5DF2\u88AB\u672A\u6258\u7BA1\u7684\u670D\u52A1\u5360\u7528\uFF0C\u8BF7\u505C\u6B62\u65E7\u670D\u52A1\u6216\u4F7F\u7528\u5916\u90E8\u670D\u52A1\u6A21\u5F0F"
      );
    this.child = spawn(
      binary,
      [
        entry,
        "--listen",
        `${url.hostname}:${url.port || "80"}`,
        "--data",
        this.dataDir,
        "--parent-pipe"
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] }
    );
    this.child.stderr?.on("data", () => {
    });
    this.child.on("error", () => {
      this.child = void 0;
    });
    const child = this.child;
    child.stdin?.on("error", () => {
    });
    child.once("exit", () => {
      if (this.child === child) this.child = void 0;
    });
    try {
      if (!child.pid) throw new Error("\u6258\u7BA1\u540E\u7AEF\u672A\u542F\u52A8");
      await recordManagedProcess(this.dataDir, child.pid, entry);
      const deadline = Date.now() + 15e3;
      while (Date.now() < deadline) {
        if (this.child !== child || child.exitCode !== null)
          throw new Error("Atelier \u540E\u7AEF\u542F\u52A8\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7AEF\u53E3\u5360\u7528\u548C\u6570\u636E\u76EE\u5F55\u6743\u9650");
        try {
          const response = await this.fetch("/health", {
            signal: AbortSignal.timeout(1e3)
          });
          if (response.ok) return;
        } catch {
        }
        await delay2(100);
      }
      throw new Error("Atelier \u540E\u7AEF\u672A\u5728 15 \u79D2\u5185\u5C31\u7EEA");
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  /** stop 只结束本插件启动的进程；外部服务或发现的已有服务完全不受影响。 */
  async stop() {
    const child = this.child;
    if (!child) return;
    this.child = void 0;
    if (child.exitCode !== null) return;
    child.stdin?.end();
    if (child.exitCode !== null) return;
    await new Promise((resolve3) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve3();
      }, 2e4);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve3();
      });
    });
  }
};

// plugin/src/remote.ts
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
var _request_dec, _a, _init;
var AtelierRemote = class extends (_a = TypertRemoteService, _request_dec = [Remote], _a) {
  constructor(ctx, backend) {
    super(ctx, "atelier");
    this.backend = backend;
    __runInitializers(_init, 5, this);
  }
  async request(command) {
    if (command.length > 1e6) throw new Error("\u547D\u4EE4\u8FC7\u5927");
    const value = JSON.parse(command);
    if (value.path === "/connection")
      return JSON.stringify(
        await this.backend.connection(
          value.method === "PUT" ? value.body : void 0
        )
      );
    return JSON.stringify(
      await this.backend.request(value.method, value.path, value.body)
    );
  }
};
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "request", _request_dec, AtelierRemote);
__decoratorMetadata(_init, AtelierRemote);

// plugin/src/notifications.ts
import { SessionId } from "@deepseek-ai/dsh-session";
import { MessageId, freezeMessage } from "@deepseek-ai/dsh-llm";
function installNotifications(ctx, backend) {
  let stopped = false;
  let timer;
  let active = Promise.resolve();
  const pending = /* @__PURE__ */ new Set();
  async function deliver() {
    let cursor = 0;
    while (!stopped) {
      const events = await backend.request(
        "GET",
        `/events?notifications=1&after=${cursor}`
      );
      if (!events.length) return;
      for (const event of events) {
        cursor = event.seq;
        if (stopped) return;
        const agent = ctx.agents.get(SessionId(event.sessionId));
        if (!agent) continue;
        const id = MessageId(`atelier-event-${event.seq}-${event.entityId}`);
        const exists = agent.session.snapshotEvents().some(
          (entry) => entry.type === "agent/inbox/spliced" && entry.data.inserted.some((message) => message.id === id) || entry.type === "user/message" && entry.data.id === id
        );
        if (!exists && !pending.has(id)) {
          agent.inject(
            freezeMessage({
              id,
              role: "user",
              content: [{ type: "text", text: event.message }],
              source: { kind: "plugin", plugin: "atelier" }
            })
          );
          pending.add(id);
        }
        if (await ctx.sessions.flush(agent.session)) {
          await backend.request("POST", `/events/${event.seq}/ack`);
          pending.delete(id);
        }
      }
      if (events.length < 200) return;
    }
  }
  function tick() {
    active = deliver().catch(() => {
    }).finally(() => {
      if (!stopped) timer = setTimeout(tick, 2e3);
    });
  }
  ctx.effect(() => {
    tick();
    return async () => {
      stopped = true;
      clearTimeout(timer);
      await active;
    };
  }, "atelier: \u6301\u4E45\u5316\u4F1A\u8BDD\u901A\u77E5");
}

// plugin/src/skill.ts
import {
  renderSkillContent
} from "@deepseek-ai/dsh-skill";
import { readFileSync } from "node:fs";

// plugin/src/tools.ts
import { defineTool } from "@deepseek-ai/dsh-tools";

// plugin/src/attachments.ts
async function importSessionAttachments(ctx, backend, agent) {
  const seen = /* @__PURE__ */ new Set();
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== "user/message" || event.data.source.kind !== "user")
      continue;
    for (const block of event.data.content) {
      if (block.type !== "image" && block.type !== "file") continue;
      const ref = block.attachment;
      if (seen.has(ref.attachmentId)) continue;
      seen.add(ref.attachmentId);
      if (block.type === "file" && !/\.(png|jpe?g|webp|mp4|mov|webm)$/i.test(ref.name || ""))
        continue;
      const path = block.type === "image" ? ctx.attachments.imageHostPath(block.attachment) : ctx.attachments.fileHostPath(block.attachment);
      if (!path)
        throw new Error("\u5F53\u524D DSH \u9644\u4EF6\u5B58\u50A8\u4E0D\u63D0\u4F9B\u672C\u673A\u8DEF\u5F84\uFF0C\u8BF7\u6539\u7528\u5DE5\u4F5C\u53F0\u4E0A\u4F20");
      await backend.request(
        "POST",
        "/assets/import",
        {
          sessionId: agent.id,
          path,
          sourceId: `dsh:${ref.attachmentId}`,
          name: ref.name || "\u804A\u5929\u56FE\u7247"
        },
        true
      );
    }
  }
}

// plugin/src/tools.ts
function registerMediaTools(ctx, backend, ownerId) {
  const disposers = [];
  const operations = {
    capabilities: "\u67E5\u8BE2\u52A8\u4F5C\u8FC1\u79FB\u80FD\u529B\u3001\u5DE5\u4F5C\u6D41\u548C\u53C2\u6570\u3002\u4EC5\u652F\u6301 Wan Animate2 \u5355\u6BB5\uFF0C\u56FA\u5B9A 30fps\u3002",
    asset_list: "\u540C\u6B65\u5F53\u524D\u4F1A\u8BDD\u9644\u4EF6\u5E76\u67E5\u8BE2\u5168\u5C40\u7D20\u6750\u5E93\u3002\u4F18\u5148\u6309\u7528\u6237\u660E\u786E\u63D0\u4F9B\u7684\u7D20\u6750 ID \u5339\u914D\uFF0C\u7D20\u6750\u53EF\u8DE8\u4F1A\u8BDD\u590D\u7528\uFF1B\u7F3A\u5931\u6216\u6709\u6B67\u4E49\u65F6\u8FFD\u95EE\uFF0C\u4E0D\u521B\u5EFA\u5360\u4F4D\u4EFB\u52A1\u3002",
    asset_import: "\u5C06\u7528\u6237\u660E\u786E\u63D0\u4F9B\u7684\u672C\u673A\u7EDD\u5BF9\u6587\u4EF6\u8DEF\u5F84\u5BFC\u5165\u5F53\u524D\u4F1A\u8BDD\u7D20\u6750\u5E93\u3002payload \u4E3A {path}\u3002",
    task_create: "\u7528\u6237\u63D0\u51FA\u751F\u6210\u8981\u6C42\u4E14\u7D20\u6750\u9F50\u5168\u65F6\u76F4\u63A5\u521B\u5EFA\u4EFB\u52A1\uFF0C\u65E0\u9700\u8BA1\u5212\u786E\u8BA4\u3002payload \u4E3A {requestId,tasks:[{title,workflowId,imageId,videoId,parameters?:{width,height,frames,skip,instanceType}}]}\u3002instanceType \u53EF\u7701\u7565\u4EE5\u6309\u52A8\u4F5C\u8FC1\u79FB\u5C3A\u5BF8\u81EA\u52A8\u9009\u62E9\uFF1B\u7528\u6237\u660E\u786E\u6307\u5B9A\u65F6\u4F20 plus \u6216 default\uFF08\u666E\u901A\u5B9E\u4F8B\uFF0C\u5E73\u53F0\u53C2\u6570\u7701\u7565\uFF09\u3002requestId \u5FC5\u987B\u7A33\u5B9A\uFF1B\u672A\u77E5\u63D0\u4EA4\u4E0D\u5F97\u91CD\u65B0\u521B\u5EFA\u3002",
    task_list: "\u67E5\u8BE2\u5F53\u524D\u4F1A\u8BDD\u4EFB\u52A1\u3002payload \u53EF\u5305\u542B page\u3001state\u3002",
    task_get: "\u67E5\u8BE2\u5F53\u524D\u4F1A\u8BDD\u4EFB\u52A1\u8BE6\u60C5\u3002payload \u4E3A {id}\u3002",
    task_cancel: "\u4EC5\u5728\u7528\u6237\u660E\u786E\u8981\u6C42\u65F6\u53D6\u6D88\u5F53\u524D\u4F1A\u8BDD\u4EFB\u52A1\u3002payload \u4E3A {id}\u3002",
    task_retry: "\u4EC5\u5728\u7528\u6237\u660E\u786E\u8981\u6C42\u65F6\u91CD\u8BD5\u4E1A\u52A1\u5931\u8D25\u4EFB\u52A1\uFF0C\u53EF\u80FD\u91CD\u65B0\u8BA1\u8D39\u3002payload \u4E3A {id,revision}\u3002"
  };
  for (const [operation, description] of Object.entries(operations)) {
    disposers.push(
      ctx.tools.register(
        defineTool({
          name: `atelier_${operation}`,
          description,
          parameters: {
            payload: {
              type: "string",
              required: true,
              description: "\u4E1A\u52A1\u53C2\u6570 JSON\uFF1B\u65E0\u53C2\u6570\u65F6\u4F20 {}\u3002\u5BC6\u94A5\u3001\u8282\u70B9 JSON \u548C\u5176\u4ED6\u4F1A\u8BDD ID \u4E0D\u5F97\u4F5C\u4E3A\u53C2\u6570\u3002"
            }
          },
          output: {
            schema: { type: "string" },
            render: (_args, value) => [{ type: "text", text: value }]
          },
          async execute(args, execution) {
            if (!execution.agent || execution.agent.id !== ownerId)
              throw new Error("Atelier \u5DE5\u5177\u9700\u8981\u4F1A\u8BDD\u4E0A\u4E0B\u6587");
            const sessionId = execution.agent.id;
            const input = JSON.parse(args.payload);
            const id = typeof input.id === "string" && /^[a-zA-Z0-9-]+$/.test(input.id) ? input.id : "";
            const scope = `sessionId=${encodeURIComponent(sessionId)}`;
            let result;
            switch (operation) {
              case "capabilities":
                result = {
                  workflows: await backend.request("GET", "/workflows"),
                  fps: 30,
                  autoStartWhenReady: true,
                  instructions: "\u5148\u67E5\u8BE2\u7D20\u6750\uFF0C\u7F3A\u5C11\u7D20\u6750\u65F6\u8FFD\u95EE\uFF1B\u5165\u961F\u540E\u8FD4\u56DE\u4EFB\u52A1\u5F15\u7528\uFF0C\u65E0\u9700\u5FAA\u73AF\u67E5\u8BE2\u3002"
                };
                break;
              case "asset_list":
                await importSessionAttachments(ctx, backend, execution.agent);
                result = await backend.request("GET", "/assets");
                break;
              case "asset_import":
                result = await backend.request(
                  "POST",
                  "/assets/import",
                  { sessionId, path: input.path },
                  true
                );
                break;
              case "task_create":
                result = await backend.request("POST", "/tasks", {
                  sessionId,
                  requestId: input.requestId,
                  tasks: input.tasks
                });
                break;
              case "task_list":
                result = await backend.request(
                  "GET",
                  `/tasks?${scope}&page=${Number(input.page) || 1}&state=${encodeURIComponent(String(input.state || ""))}`
                );
                break;
              case "task_get":
                if (!id) throw new Error("\u4EFB\u52A1 ID \u65E0\u6548");
                result = await backend.request("GET", `/tasks/${id}?${scope}`);
                break;
              case "task_cancel":
                if (!id) throw new Error("\u4EFB\u52A1 ID \u65E0\u6548");
                result = await backend.request(
                  "POST",
                  `/tasks/${id}/cancel?${scope}`
                );
                break;
              case "task_retry":
                if (!id) throw new Error("\u4EFB\u52A1 ID \u65E0\u6548");
                result = await backend.request(
                  "POST",
                  `/tasks/${id}/retry?${scope}`,
                  { revision: input.revision }
                );
                break;
              default:
                throw new Error("\u672A\u77E5\u64CD\u4F5C");
            }
            return JSON.stringify(result);
          }
        })
      )
    );
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

// plugin/src/skill.ts
function installTransferSkill(ctx, backend) {
  const content = readFileSync(
    new URL("../skills/gd-transfer/SKILL.md", import.meta.url),
    "utf8"
  ).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const skill = {
    name: "gd-transfer",
    provider: "atelier",
    source: "bundled",
    description: "\u52A8\u4F5C\u8FC1\u79FB\uFF1A\u4EBA\u7269\u56FE\u4E0E\u53C2\u8003\u89C6\u9891\u751F\u6210 Wan Animate2 \u89C6\u9891\uFF0C\u67E5\u8BE2\u3001\u53D6\u6D88\u53CA\u91CD\u8BD5 Atelier \u4EFB\u52A1\u3002",
    content,
    invocation: { userInvocable: true, modelInvocable: true }
  };
  ctx.skills.register(skill);
  const active = /* @__PURE__ */ new Map();
  const inheritedMasks = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Set();
  const deactivate = (agent) => {
    active.get(agent)?.();
    active.delete(agent);
  };
  const activate = (agent) => {
    if (active.has(agent)) return;
    inheritedMasks.get(agent)?.();
    inheritedMasks.delete(agent);
    active.set(agent, registerMediaTools(agent.ctx, backend, agent.id));
  };
  ctx.on("agent/inbox/claimed", ({ agent, message }) => {
    if (message.source.kind === "user" && message.content.some(
      (block) => block.type === "text" && /(^|\s)\/gd-transfer(?=\s|$)/.test(block.text)
    ))
      pending.add(agent);
  });
  ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
    const agent = context.agent;
    if (!agent) return next();
    let changed = false;
    if (pending.delete(agent) && !context.signal?.aborted) {
      const loaded = await ctx.skills.get(skill.name, {
        scope: agent,
        cwd: agent.session.header.cwd,
        signal: context.signal
      });
      if (!context.signal?.aborted && loaded?.provider === skill.provider && loaded.content === content && loaded.invocation?.userInvocable !== false && ctx.tools.schemas(agent).some((tool) => tool.name === "skill")) {
        changed = !active.has(agent);
        activate(agent);
      }
    }
    if (!active.has(agent) && !inheritedMasks.has(agent)) {
      const names = ctx.tools.schemas(agent).map((tool) => tool.name).filter((name2) => name2.startsWith("atelier_"));
      if (names.length) {
        inheritedMasks.set(agent, agent.ctx.tools.restrict({ deny: names }));
        changed = true;
      }
    }
    return changed ? ctx.systemPrompt.assemble(context) : next();
  });
  const explicit = (agent, source, blocks) => {
    if (!source || typeof source !== "object" || !("kind" in source) || source.kind !== "skill-invocation" || !("name" in source) || source.name !== skill.name)
      return;
    if (blocks.some(
      (block) => block.type === "text" && block.text === renderSkillContent(skill)
    ))
      activate(agent);
  };
  ctx.on("agent/pre-step", async ({ agent }, next) => {
    const decision = await next();
    if (decision.kind !== "reject")
      for (const message of decision.messages)
        explicit(agent, message.source, message.content);
    return decision;
  });
  ctx.on("tools/result", (execution, result) => {
    if (execution.name !== "skill" || !execution.agent || execution.signal.aborted || result.isError)
      return;
    const value = result.value;
    if (value?.name === skill.name && value.provider === skill.provider && value.content === content)
      activate(execution.agent);
  });
  ctx.on("session/event", (session, event) => {
    const agent = ctx.agents.get(session.id);
    if (!agent) return;
    if (event.type === "turn/end" || event.type === "turn/start")
      deactivate(agent);
    if (event.type === "user/message")
      explicit(agent, event.data.source, event.data.content);
  });
  ctx.on("agent/disposed", ({ agent }) => {
    pending.delete(agent);
    deactivate(agent);
    inheritedMasks.get(agent)?.();
    inheritedMasks.delete(agent);
  });
  ctx.effect(
    () => () => {
      for (const agent of active.keys()) deactivate(agent);
      for (const dispose of inheritedMasks.values()) dispose();
      inheritedMasks.clear();
      pending.clear();
    },
    "atelier: \u64A4\u9500\u56DE\u5408\u5DE5\u5177\u6388\u6743"
  );
}

// plugin/src/index.ts
var name = "atelier";
var inject = [
  "connection",
  "tools",
  "agents",
  "sessions",
  "attachments",
  "typert",
  "skills",
  "systemPrompt"
];
async function apply(ctx, config) {
  const backend = new Backend(config);
  ctx.effect(() => () => backend.stop(), "atelier: \u540E\u7AEF\u8FDB\u7A0B\u751F\u547D\u5468\u671F");
  await backend.initialize();
  new AtelierRemote(ctx, backend);
  installNotifications(ctx, backend);
  for (const upload of [false, true])
    ctx.effect(
      () => ctx.connection.fetch.register({
        path: upload ? "/api/atelier.upload" : "/api/atelier.file",
        methods: upload ? ["POST"] : ["GET", "HEAD"],
        requestBody: upload ? "streaming" : "buffered",
        async fetch(request) {
          const url = new URL(request.url);
          const headers = new Headers();
          for (const key of ["Range", "If-Range", "Content-Type"]) {
            const value = request.headers.get(key);
            if (value) headers.set(key, value);
          }
          const id = url.searchParams.get("id");
          if (request.method !== "POST" && (!id || !/^[a-zA-Z0-9-]+$/.test(id)))
            return new Response("\u7D20\u6750 ID \u65E0\u6548", { status: 400 });
          const path = request.method === "POST" ? "/assets" : `/assets/${id}/file${url.searchParams.get("download") === "1" ? "?download=1" : ""}`;
          try {
            const init = {
              method: request.method,
              headers,
              signal: request.signal
            };
            if (request.method === "POST") {
              init.body = request.body;
              init.duplex = "half";
            }
            const response = await backend.fetch(path, init);
            const outgoing = new Headers();
            for (const key of [
              "Content-Type",
              "Content-Length",
              "Content-Range",
              "Accept-Ranges",
              "ETag",
              "Last-Modified",
              "Content-Disposition"
            ]) {
              const value = response.headers.get(key);
              if (value) outgoing.set(key, value);
            }
            outgoing.set("X-Content-Type-Options", "nosniff");
            return new Response(response.body, {
              status: response.status,
              headers: outgoing
            });
          } catch {
            return Response.json(
              { error: "\u540E\u7AEF\u6587\u4EF6\u670D\u52A1\u4E0D\u53EF\u7528" },
              { status: 502 }
            );
          }
        }
      }),
      "atelier: \u540C\u6E90\u6D41\u5F0F\u6587\u4EF6\u4EE3\u7406"
    );
  installTransferSkill(ctx, backend);
}
export {
  AtelierRemote,
  Backend,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
