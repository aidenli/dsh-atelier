/** Host 到 Node 后端的唯一连接层：持久化连接配置、转发请求、管理子进程。 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { readJSON } from "../../contracts/http.ts";
import { reapManagedProcess, recordManagedProcess } from "./managed-process.ts";
import { createConnection } from "node:net";

/** PluginConfig 只对页面公开 URL 和模式；运行目录和二进制位置来自本地部署。 */
export interface PluginConfig {
  backendUrl?: string;
  mode?: "managed" | "external";
  dataDir?: string;
  binaryPath?: string;
  backendEntry?: string;
}
export interface Settings {
  backendUrl: string;
  mode: "managed" | "external";
}

/** Backend 不实现任务状态机，所有业务状态由独立服务数据库负责。 */
export class Backend {
  private settings: Settings;
  private child?: ChildProcess;
  private readonly packageRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  readonly dataDir: string;
  private readonly settingsFile: string;
  constructor(private readonly config: PluginConfig) {
    // 源码安装保留已有数据；发布包的数据必须独立于 node_modules，升级和卸载不能带走任务。
    const sourceRoot = resolve(this.packageRoot, "..");
    const defaultData = existsSync(resolve(sourceRoot, "backend/package.json"))
      ? resolve(sourceRoot, ".runtime/default")
      : resolve(homedir(), ".dsh-atelier/default");
    this.dataDir = resolve(config.dataDir || defaultData);
    this.settingsFile = resolve(this.dataDir, "plugin.json");
    this.settings = {
      backendUrl: config.backendUrl || "http://127.0.0.1:8787",
      mode: config.mode || "managed",
    };
  }
  /** initialize 读取部署配置并在托管模式启动子进程；无需服务令牌。 */
  async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    try {
      this.settings = this.validate(
        JSON.parse(await readFile(this.settingsFile, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.start();
  }
  /** connection 先保存有效配置再检查服务；连接失败仍保留新 URL，页面可以继续修正。 */
  async connection(next?: Settings): Promise<Settings> {
    if (next) {
      const validated = this.validate(next);
      await this.stop();
      await writeFile(
        this.settingsFile + ".tmp",
        JSON.stringify(validated, null, 2),
        { mode: 0o600 },
      );
      const { rename } = await import("node:fs/promises");
      await rename(this.settingsFile + ".tmp", this.settingsFile);
      this.settings = validated;
      await this.start();
    }
    return { ...this.settings };
  }
  private validate(value: Settings): Settings {
    const url = new URL(value.backendUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["managed", "external"].includes(value.mode)
    )
      throw new Error("后端连接配置无效");
    if (
      value.mode === "managed" &&
      (url.protocol !== "http:" ||
        url.pathname !== "/" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
      throw new Error("托管模式仅支持没有路径前缀的本机 HTTP 地址");
    return { backendUrl: url.toString().replace(/\/$/, ""), mode: value.mode };
  }
  /** fetch 流式转发请求及响应，不附加服务令牌或 RunningHub 密钥。 */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    try {
      return await fetch(this.settings.backendUrl + path, {
        ...init,
        headers,
        redirect: "error",
        signal: init.signal || AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error("无法连接 Atelier 后端，请检查服务 URL 和运行状态");
    }
  }
  /** request 仅处理受限 JSON API，禁止浏览器通过 Remote 调用 Host 专用路径导入。 */
  async request(
    method: string,
    path: string,
    body?: unknown,
    trusted = false,
  ): Promise<unknown> {
    if (
      !["GET", "POST", "PUT", "DELETE"].includes(method) ||
      !/^\/(health|config|workflows|projects|tasks|assets|events)(?:[/?]|$)/.test(
        path,
      ) ||
      path.includes("..") ||
      path.includes("\\") ||
      (!trusted && path.split("?")[0] === "/assets/import")
    )
      throw new Error("不允许的 Atelier 操作");
    const response = await this.fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return readJSON(response);
  }
  private async start(): Promise<void> {
    if (this.settings.mode !== "managed") return;
    if (this.config.binaryPath)
      throw new Error(
        "binaryPath 已停用，请移除旧 Go 程序配置，使用 backendEntry 指定 Node 入口",
      );
    const binary = process.execPath;
    const entry = resolve(
      this.config.backendEntry || resolve(this.packageRoot, "lib/backend.mjs"),
    );
    if (
      !["win32:x64", "darwin:arm64", "darwin:x64"].includes(
        `${process.platform}:${process.arch}`,
      )
    )
      throw new Error("Atelier 托管后端仅支持 Windows x64 和 macOS ARM64/x64");
    if (!existsSync(entry))
      throw new Error("未找到 Node 后端，请先运行构建脚本");
    await reapManagedProcess(this.dataDir, binary, entry);
    const url = new URL(this.settings.backendUrl);
    // 旧版本没有身份记录时不能证明归属，必须报告冲突，不能按端口终止。
    const occupied = await new Promise<boolean>((done, reject) => {
      const socket = createConnection({
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 80),
      });
      socket.once("connect", () => {
        socket.destroy();
        done(true);
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        socket.destroy();
        if (error.code === "ECONNREFUSED") done(false);
        else reject(error);
      });
      socket.setTimeout(1500, () => {
        socket.destroy();
        reject(new Error("检测后端端口超时"));
      });
    });
    if (occupied)
      throw new Error(
        "Atelier 端口已被未托管的服务占用，请停止旧服务或使用外部服务模式",
      );
    this.child = spawn(
      binary,
      [
        entry,
        "--listen",
        `${url.hostname}:${url.port || "80"}`,
        "--data",
        this.dataDir,
        "--parent-pipe",
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
    );
    this.child.stderr?.on("data", () => {
      /* 后端日志在独立终端诊断，避免平台自由文本意外进入 DSH 日志。 */
    });
    this.child.on("error", () => {
      this.child = undefined;
    });
    const child = this.child;
    child.stdin?.on("error", () => {
      /* 后端先退出时管道错误不应使 Host 崩溃。 */
    });
    child.once("exit", () => {
      if (this.child === child) this.child = undefined;
    });
    // 加载插件即启动服务，并等待 SQLite 初始化与 HTTP 就绪；不依赖浏览器打开工作台。
    // 早退或超时必须让加载失败，不能把启动失败伪装成一个稍后可能恢复的连接。
    try {
      if (!child.pid) throw new Error("托管后端未启动");
      await recordManagedProcess(this.dataDir, child.pid, entry);
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (this.child !== child || child.exitCode !== null)
          throw new Error("Atelier 后端启动失败，请检查端口占用和数据目录权限");
        try {
          const response = await this.fetch("/health", {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) return;
        } catch {
          /* 进程已创建但尚未监听时，短暂等待下一次就绪检查。 */
        }
        await delay(100);
      }
      throw new Error("Atelier 后端未在 15 秒内就绪");
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  /** stop 只结束本插件启动的进程；外部服务或发现的已有服务完全不受影响。 */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    if (child.exitCode !== null) return;
    // 专属管道只属于这个子进程；避免向已被其他服务占用的 HTTP 端口发送停机请求。
    child.stdin?.end();
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 20_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
