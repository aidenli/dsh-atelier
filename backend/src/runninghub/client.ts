/** RunningHub 协议客户端不重试创建；只向调度器返回脱敏分类。 */
import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import type { Config, ResultURL, Task } from "../media/types.js";
export class RemoteError extends Error {
  constructor(
    readonly code: number,
    readonly temporary = false,
    readonly unknown = false,
    readonly capacity = false,
    readonly retryAfter = 0,
  ) {
    super(`RunningHub 请求失败（代码 ${code}）`);
  }
}
export function retryDelay(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 86400 * 365) * 1000;
  return Math.max(0, Date.parse(value) - Date.now()) || 0;
}
interface Envelope {
  code: number;
  msg?: string;
  data?: Record<string, unknown>;
}
export interface Status {
  status: string;
  results?: ResultURL[];
  errorCode?: string;
}
export class Client {
  constructor(
    readonly config: Config,
    readonly signal?: AbortSignal,
  ) {}
  private async request(
    path: string,
    body?: BodyInit,
    creating = false,
    contentType?: string,
  ): Promise<unknown> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(90_000),
      ...(this.signal ? [this.signal] : []),
    ]);
    let response: Response;
    try {
      response = await fetch(this.config.baseUrl + path, {
        method: body === undefined ? "GET" : "POST",
        body,
        headers: {
          Authorization: "Bearer " + (this.config.apiKey || ""),
          ...(contentType ? { "Content-Type": contentType } : {}),
        },
        redirect: "error",
        signal,
      });
    } catch {
      throw new RemoteError(-1, true, creating);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new RemoteError(
        response.status,
        response.status === 429 || response.status >= 500,
        creating,
        false,
        retryDelay(response.headers.get("retry-after")),
      );
    }
    try {
      if (!response.body) throw new Error();
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4 * 1024 * 1024) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new RemoteError(-2, true, creating);
    }
  }
  private check(value: unknown, creating = false): Envelope {
    const e = value as Envelope;
    if (!e || !Number.isInteger(e.code))
      throw new RemoteError(-2, true, creating);
    if (e.code !== 0)
      throw new RemoteError(
        e.code,
        false,
        false,
        ["TASK_QUEUE_MAXED", "TASK_CONCURRENT_LIMIT"].includes(e.msg || ""),
      );
    return e;
  }
  private post(path: string, payload: unknown, creating = false) {
    return this.request(
      path,
      JSON.stringify(payload),
      creating,
      "application/json",
    );
  }
  async capacity(): Promise<number> {
    const d = this.check(await this.request("/openapi/v2/queue/status")).data;
    if (
      !d ||
      !Number.isSafeInteger(d.concurrentLimit) ||
      Number(d.concurrentLimit) < 0 ||
      !/^\d+$/.test(String(d.runningCount ?? "")) ||
      !/^\d+$/.test(String(d.queuedCount ?? ""))
    )
      throw new RemoteError(-2, true);
    const r = Number(d.runningCount),
      q = Number(d.queuedCount);
    if (!Number.isSafeInteger(r) || !Number.isSafeInteger(q))
      throw new RemoteError(-2, true);
    return Math.max(0, Number(d.concurrentLimit) - r - q);
  }
  /** 文件 Blob 从磁盘流式读取，避免把视频完整加载到内存。 */
  async upload(path: string): Promise<string> {
    const form = new FormData();
    form.append("file", await openAsBlob(path), basename(path));
    const value = this.check(
      await this.request("/openapi/v2/media/upload/binary", form),
    ).data?.fileName;
    if (typeof value !== "string" || !value) throw new RemoteError(-2, true);
    return value;
  }
  async create(task: Task, image: string, video: string): Promise<string> {
    const p = task.parameters,
      values: Record<string, string> = {
        width: String(p.width),
        height: String(p.height),
        frames: String(p.frames),
        skip: String(p.skip),
        image,
        video,
      };
    const instance =
      p.instanceType ||
      (task.workflow.id === "wan-animate2" &&
      p.width * p.height > (480 * 848 + 720 * 1280) / 2
        ? "plus"
        : "default");
    const payload = {
      apiKey: this.config.apiKey,
      workflowId: task.workflow.remoteId,
      nodeInfoList: Object.entries(values).map(([key, fieldValue]) => ({
        ...task.workflow.mapping[key],
        fieldValue,
      })),
      ...(instance === "plus" ? { instanceType: "plus" } : {}),
    };
    const value = this.check(
      await this.post("/task/openapi/create", payload, true),
      true,
    ).data?.taskId;
    if (typeof value !== "string" || !value)
      throw new RemoteError(-2, false, true);
    return value;
  }
  async query(taskId: string): Promise<Status> {
    const s = (await this.post("/openapi/v2/query", { taskId })) as Status;
    if (!s || typeof s.status !== "string" || !s.status)
      throw new RemoteError(-2, true);
    return s;
  }
  async cancel(taskId: string): Promise<void> {
    this.check(
      await this.post("/task/openapi/cancel", {
        apiKey: this.config.apiKey,
        taskId,
      }),
    );
  }
}
export const isVideo = (r: ResultURL) =>
  typeof r?.outputType === "string" &&
  /^(mp4$|webm$|video\/)/i.test(r.outputType);
