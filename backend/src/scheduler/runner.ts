/** 单目录调度器：串行本地 I/O，远端生成容量每次提交前实时查询。 */
import { Readable } from "node:stream";
import { Service, hash } from "../media/service.js";
import { Files, maxFileBytes } from "../media/files.js";
import {
  now,
  terminal,
  type Task,
  type UploadSnapshot,
} from "../media/types.js";
import {
  Client,
  RemoteError,
  isVideo,
  retryDelay,
} from "../runninghub/client.js";
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
/** 将 RunningHub 的平台状态归一成本地可展示状态，保留原始状态在 remoteState。 */
function localRemoteState(status: string): "remote_pending" | "remote_running" {
  return /RUNNING|EXECUT|PROCESS|GENERAT|WORKING|PROGRESS/i.test(status)
    ? "remote_running"
    : "remote_pending";
}
export class Runner {
  constructor(
    readonly service: Service,
    readonly files: Files,
  ) {}
  /**
   * 把进程上次退出时可能遗留的中间态恢复为可继续处理的状态。
   *
   * uploading 没有远端任务 ID，可以安全回到 queued；submitting 则相反，
   * 创建请求可能已经到达平台，所以有 remoteId 时只恢复查询，没有 ID 时
   * 进入 submission_unknown，要求人工核对，禁止自动重发造成重复计费。
   */
  recover(): void {
    for (const t of this.service.tasks()) {
      if (t.state === "submitting")
        this.service.update(t.id, (v) => {
          v.state = v.remoteId ? "remote_pending" : "submission_unknown";
          v.errorKind = v.remoteId ? "" : "submission_unknown";
          v.error = v.remoteId ? "" : "服务在创建阶段退出，请核对远端任务";
        });
      if (t.state === "uploading")
        this.service.update(t.id, (v) => {
          v.state = v.cancelRequested ? "cancelled" : "queued";
        });
    }
  }
  /** 停止时中断网络但不取消远端任务；必须等待本循环退出后关闭数据库。 */
  async run(signal: AbortSignal): Promise<void> {
    this.recover();
    while (!signal.aborted) {
      await this.step(signal);
      if (signal.aborted) break;
      await new Promise<void>((done) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          this.service.wake = () => {};
          done();
        };
        const timer = setTimeout(finish, 2000);
        this.service.wake = finish;
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
    }
  }
  /**
   * 执行一轮任务扫描。
   *
   * 本地任务按创建时间串行处理，单实例锁保证不会有第二个运行器同时领取
   * 同一目录的任务。上传不受 RunningHub 生成并发限制影响；只有素材准备好
   * 后才查询实时容量并尝试创建任务。每个 await 后都会重新从 Service 读取
   * 任务，确保取消意图和账户切换不会被旧对象覆盖。
   */
  async step(signal: AbortSignal): Promise<void> {
    for (const snapshot of this.service
      .tasks()
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
      if (signal.aborted) return;
      const t = this.service.task(snapshot.id);
      if (terminal(t.state) || Date.parse(t.nextRunAt) > Date.now()) continue;
      const config = this.service.getConfig(),
        client = new Client(config, signal);
      if (!config.apiKey) {
        this.defer(t, "请配置 RunningHub 密钥", "configuration", 30000);
        continue;
      }
      if (
        t.accountHash &&
        (t.accountHash !== hash(config.apiKey) ||
          t.providerUrl !== config.baseUrl)
      ) {
        this.defer(
          t,
          "账户已切换，请恢复原账户以查询任务",
          "configuration",
          30000,
        );
        continue;
      }
      if (t.remoteId) await this.remote(client, t, signal);
      else if (t.cancelRequested)
        this.service.update(t.id, (v) => {
          v.state = "cancelled";
        });
      else await this.submit(client, t);
    }
  }
  /**
   * 准备素材并提交一个远端生成任务。
   *
   * 上传文件名先保存到任务快照，重启后只补传缺失文件；平台满载时保留
   * queued 状态并延迟重试。创建请求的响应不明确时由 failure() 转为
   * submission_unknown，后续只能人工关联远端 ID，绝不能盲目再次创建。
   */
  private async submit(c: Client, t: Task): Promise<void> {
    const uploads: UploadSnapshot =
      t.uploads &&
      t.uploads.accountHash === hash(c.config.apiKey || "") &&
      t.uploads.providerUrl === c.config.baseUrl
        ? { ...t.uploads }
        : {
            image: "",
            video: "",
            accountHash: hash(c.config.apiKey || ""),
            providerUrl: c.config.baseUrl,
          };
    // 上传名立即保存；平台满载不阻止素材准备，重启只重复未落盘的上传。
    for (const [role, assetId] of [
      ["image", t.imageId],
      ["video", t.videoId],
    ] as const) {
      if (uploads[role]) continue;
      let cancelled = false;
      this.service.update(t.id, (v) => {
        if (v.cancelRequested) {
          v.state = "cancelled";
          cancelled = true;
        } else {
          v.state = "uploading";
          v.error = "";
        }
      });
      if (cancelled) return;
      let path: string;
      try {
        path = (await this.files.asset(assetId)).path;
      } catch {
        this.fail(t, "输入素材不可用", "asset");
        return;
      }
      try {
        uploads[role] = await c.upload(path);
      } catch (error) {
        this.failure(t, error, false);
        return;
      }
      this.service.update(t.id, (v) => {
        v.uploads = { ...uploads };
      });
    }
    this.service.update(t.id, (v) => {
      v.state = v.cancelRequested ? "cancelled" : "queued";
    });
    if (terminal(this.service.task(t.id).state)) return;
    let capacity: number;
    try {
      capacity = await c.capacity();
    } catch (error) {
      this.failure(t, error, false);
      return;
    }
    if (capacity === 0) {
      this.defer(t, "本地等待：平台并发已满", "capacity", 2000);
      return;
    }
    let cancelled = false;
    // 先提交数据库，再发付费请求；随后任何不确定故障都禁止自动重发。
    this.service.update(t.id, (v) => {
      if (v.cancelRequested) {
        v.state = "cancelled";
        cancelled = true;
        return;
      }
      v.state = "submitting";
      v.accountHash = hash(c.config.apiKey || "");
      v.providerUrl = c.config.baseUrl;
    });
    if (cancelled) return;
    let remoteId: string;
    try {
      remoteId = await c.create(t, uploads.image, uploads.video);
    } catch (error) {
      this.failure(t, error, true);
      return;
    }
    this.service.update(t.id, (v) => {
      v.remoteId = remoteId;
      v.state = "remote_pending";
      v.error = "";
      v.errorKind = "";
      v.failures = 0;
      v.nextRunAt = later(5000);
    });
  }
  /**
   * 查询已有远端任务并推进本地状态。
   *
   * remoteState 永远保存平台原始状态，state 保存本地下一步动作：排队、
   * 运行中、下载、取消或终态。查询失败只改变退避信息，不会清除 remoteId，
   * 这样重启或网络恢复后仍然查询原任务，不会重复生成。
   */
  private async remote(c: Client, t: Task, signal: AbortSignal): Promise<void> {
    if (t.state === "downloading") {
      await this.download(t, signal);
      return;
    }
    let status;
    try {
      status = await c.query(t.remoteId);
    } catch (error) {
      this.failure(t, error, false);
      return;
    }
    if (status.status === "SUCCESS") {
      const results = Array.isArray(status.results)
        ? status.results.filter(isVideo)
        : [];
      if (!results.length) {
        this.fail(t, "任务成功但没有视频输出", "output_contract");
        return;
      }
      this.service.update(t.id, (v) => {
        v.state = "downloading";
        v.remoteState = status.status;
        v.results = results;
        v.nextRunAt = now();
        v.error = "";
      });
      return;
    }
    if (status.status === "FAILED") {
      const code = /^[a-zA-Z0-9_]{0,32}$/.test(status.errorCode || "")
        ? status.errorCode
        : "unknown";
      this.fail(t, "远端工作流执行失败，错误码：" + code, "business");
      return;
    }
    if (["CANCELLED", "CANCELED"].includes(status.status)) {
      this.service.update(t.id, (v) => {
        v.state = "cancelled";
        v.remoteState = status.status;
        v.error = "";
      });
      return;
    }
    if (this.service.task(t.id).cancelRequested)
      try {
        await c.cancel(t.remoteId);
      } catch (error) {
        this.failure(t, error, false);
        return;
      }
    this.service.update(t.id, (v) => {
      v.remoteState = status.status;
      v.state = v.cancelRequested
        ? "cancel_requested"
        : localRemoteState(status.status);
      v.error = "";
      v.failures = 0;
      v.nextRunAt = later(5000);
    });
  }
  private async download(t: Task, signal: AbortSignal): Promise<void> {
    const ids: string[] = [];
    if (!t.results?.length) {
      this.defer(t, "缺少结果信息，需要查询原任务", "download", 30000);
      this.service.update(t.id, (v) => {
        v.state = "remote_pending";
      });
      return;
    }
    for (const [index, result] of t.results.entries()) {
      const key = `output-${t.id}-${t.attempt}-${index}`;
      try {
        if ((await this.files.asset(key, t.sessionId)).asset.kind === "video") {
          ids.push(key);
          continue;
        }
      } catch {
        /* 未登记或不完整的归档只重试下载。 */
      }
      let url: URL;
      try {
        url = new URL(result.url);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error();
      } catch {
        this.defer(t, "结果地址不符合 HTTPS 下载要求", "download", 60000);
        return;
      }
      let response: Response;
      try {
        // 手动验证每次跳转，避免 HTTPS 下载被重定向到明文地址。
        for (let redirects = 0; ; redirects++) {
          response = await fetch(url, {
            redirect: "manual",
            signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          await response.body?.cancel();
          if (redirects >= 9) throw new Error();
          url = new URL(response.headers.get("location") || "", url);
          if (url.protocol !== "https:" || url.username || url.password)
            throw new Error();
        }
      } catch {
        this.failure(t, new RemoteError(-1, true), false);
        return;
      }
      const expected = response.headers.has("content-length")
        ? Number(response.headers.get("content-length"))
        : undefined;
      if (
        response.status !== 200 ||
        (expected !== undefined &&
          (!Number.isSafeInteger(expected) || expected > maxFileBytes))
      ) {
        await response.body?.cancel();
        if ([403, 404].includes(response.status)) {
          this.service.update(t.id, (v) => {
            v.state = "remote_pending";
            v.error = "结果地址已失效，将查询原任务刷新地址";
            v.errorKind = "download";
            v.nextRunAt = later(60000);
          });
        } else
          this.defer(
            t,
            "结果下载暂不可用",
            "download",
            Math.max(
              2 ** Math.min(t.failures + 1, 8) * 1000,
              retryDelay(response.headers.get("retry-after")),
            ),
          );
        return;
      }
      try {
        if (!response.body) throw new Error();
        const asset = await this.files.importOutput(
          t,
          index,
          Readable.fromWeb(response.body as never),
          expected,
        );
        ids.push(asset.id);
      } catch {
        this.defer(t, "结果归档失败，将继续下载", "download", 30000);
        return;
      }
    }
    this.service.update(t.id, (v) => {
      v.outputIds = ids;
      v.state = "succeeded";
      v.error = "";
      v.errorKind = "";
    });
  }
  private failure(t: Task, error: unknown, creating: boolean): void {
    if (error instanceof RemoteError) {
      if (creating && error.unknown) {
        this.service.update(t.id, (v) => {
          v.state = "submission_unknown";
          v.errorKind = "submission_unknown";
          v.error = "创建响应不明确，请核对平台任务 ID";
        });
        return;
      }
      if (error.capacity) {
        this.service.update(t.id, (v) => {
          v.state = "queued";
          v.error = "本地等待：平台拒绝并发提交";
          v.errorKind = "capacity";
          v.nextRunAt = later(2000);
        });
        return;
      }
      if (error.temporary || t.remoteId) {
        this.defer(
          t,
          error.message,
          "network",
          Math.max(2 ** Math.min(t.failures + 1, 8) * 1000, error.retryAfter),
        );
        return;
      }
    }
    if (t.remoteId) {
      this.defer(t, "查询暂不可用", "network", 60000);
      return;
    }
    this.fail(t, "平台请求被拒绝，请检查账户和工作流配置", "business");
  }
  private defer(t: Task, message: string, kind: string, ms: number): void {
    this.service.update(t.id, (v) => {
      if (v.state === "uploading") v.state = "queued";
      v.error = message;
      v.errorKind = kind;
      v.failures++;
      v.nextRunAt = later(ms);
    });
  }
  private fail(t: Task, message: string, kind: string): void {
    this.service.update(t.id, (v) => {
      v.state = "failed";
      v.error = message;
      v.errorKind = kind;
    });
  }
}
