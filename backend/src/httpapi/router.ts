/** HTTP 兼容层只校验输入和投影输出；业务状态由 Service 统一维护。 */
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { createReadStream } from "node:fs";
import { Service } from "../media/service.js";
import { Files, maxFileBytes } from "../media/files.js";
import type { BatchRequest, Config, Task, Workflow } from "../media/types.js";
const number = (v: unknown, fallback: number, max: number) =>
  /^\d+$/.test(String(v)) && Number(v) > 0
    ? Math.min(Number(v), max)
    : fallback;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const publicTask = (t: Task) => {
  const { results, uploads, accountHash, ...value } = t;
  return {
    ...value,
    platform: value.platform || "runninghub",
    accountHash: "",
  };
};
export async function router(
  service: Service,
  files: Files,
  shutdown?: () => void,
) {
  const app = Fastify({
    logger: false,
    bodyLimit: maxFileBytes + 1024 * 1024,
    requestTimeout: 120000,
  });
  // 关闭 socket 不等于异步归档已经结束。跟踪处理器，确保释放数据库锁前没有晚到的写入。
  const pending = new Set<Promise<void>>();
  app.addHook("onRoute", (route) => {
    const handler = route.handler;
    route.handler = async function (request, reply) {
      let done!: () => void;
      const completion = new Promise<void>((resolve) => {
        done = resolve;
      });
      pending.add(completion);
      try {
        return await handler.call(this, request, reply);
      } finally {
        pending.delete(completion);
        done();
      }
    };
  });
  app.addHook("onClose", async () => {
    await Promise.all(pending);
  });
  await app.register(multipart, {
    limits: { fileSize: maxFileBytes, files: 1, fields: 5, parts: 6 },
  });
  app.setErrorHandler((error, _request, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    // 不返回底层文件路径、SQL 或带签名 URL。已知业务错误保持中文文本。
    const message = e.code
      ? "请求处理失败，请检查参数、文件大小和服务状态"
      : e.message;
    reply.code(e.statusCode === 413 ? 413 : 400).send({ error: message });
  });
  app.get("/getHealth", () => ({
    status: "ok",
    version: "0.3.0",
    apiVersion: 2,
    capabilities: ["asset-delete", "operation-api"],
    runtime: "node",
  }));
  if (shutdown)
    app.post("/shutdown", async (_r, reply) => {
      reply.code(202).send({ accepted: true });
      setImmediate(shutdown);
    });
  app.get("/getConfig", () => {
    const c = service.getConfig();
    return { baseUrl: c.baseUrl, hasApiKey: Boolean(c.apiKey) };
  });
  app.post<{ Body: Config }>("/saveConfig", (r) => {
    service.saveConfig(r.body);
    return { saved: true };
  });
  app.get("/listWorkflows", () => service.workflows());
  app.get<{ Querystring: { type?: string; page?: string } }>(
    "/listProjects",
    (r) => {
      const items = service
        .projects()
        .filter((p) => !r.query.type || p.type === r.query.type);
      const page = Math.min(
        number(r.query.page, 1, 1000000),
        Math.max(1, Math.ceil(items.length / 20)),
      );
      return {
        items: items
          .slice((page - 1) * 20, page * 20)
          .map((p) => service.projectSummary(p)),
        page,
        total: items.length,
      };
    },
  );
  app.get<{ Querystring: { id: string } }>("/getProject", (r) => {
    const project = service.project(r.query.id);
    return {
      project: service.projectSummary(project),
      tasks: project.taskIds.map((id) => publicTask(service.task(id))),
    };
  });
  app.post<{ Querystring: { id: string }; Body: Workflow }>(
    "/saveWorkflow",
    (r) => {
      service.saveWorkflow({ ...r.body, id: r.query.id });
      return { saved: true };
    },
  );
  app.post<{ Querystring: { id: string } }>("/deleteWorkflow", (r) => {
    service.deleteWorkflow(r.query.id);
    return { deleted: true };
  });
  app.get<{ Querystring: { sessionId?: string } }>("/listAssets", (r) =>
    service
      .assets(text(r.query.sessionId))
      .map(({ path, ...asset }) => ({ ...asset, path: "" })),
  );
  app.post<{ Body: { sessionId?: string; ids: string[] } }>(
    "/deleteAssets",
    (r) => {
      service.deleteAssets(text(r.body?.sessionId), r.body?.ids);
      return { deleted: true };
    },
  );
  app.post("/uploadAsset", async (r) => {
    // 暂存上传流后才读取字段，支持 multipart 中 sessionId 位于 file 后面。
    const part = await r.file();
    if (!part) throw new Error("缺少上传文件");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createWriteStream } = await import("node:fs");
    const { pipeline } = await import("node:stream/promises");
    const dir = await mkdtemp(join(tmpdir(), "atelier-http-"));
    try {
      const path = join(dir, "upload");
      await pipeline(part.file, createWriteStream(path, { mode: 0o600 }));
      if (part.file.truncated) throw new Error("文件超过 30 MiB");
      const field = part.fields.sessionId;
      const session =
        field && !Array.isArray(field) && field.type === "field"
          ? text(field.value)
          : "";
      const { path: internal, ...asset } = await files.import(
        session,
        part.filename,
        createReadStream(path),
      );
      return { ...asset, path: "" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  app.post<{
    Body: { sessionId: string; path: string; sourceId?: string; name?: string };
  }>("/importAsset", async (r) => {
    const { path, ...a } = await files.importReference(
      r.body.sessionId,
      r.body.path,
      r.body.sourceId,
      r.body.name,
    );
    return { ...a, path: "" };
  });
  app.get<{ Querystring: { id: string; sessionId?: string } }>(
    "/getAssetSelection",
    async (r) => {
      const { asset, path } = await files.asset(
        r.query.id,
        text(r.query.sessionId),
      );
      return { id: asset.id, name: asset.name, absolutePath: path };
    },
  );
  app.route<{
    Querystring: { id: string; sessionId?: string; download?: string };
  }>({
    method: ["GET", "HEAD"],
    url: "/getAssetFile",
    handler: async (r, reply) => {
      const { asset, path } = await files.asset(
        r.query.id,
        text(r.query.sessionId),
      );
      reply
        .header("Content-Type", asset.mime)
        .header("X-Content-Type-Options", "nosniff")
        .header("Accept-Ranges", "bytes");
      if (r.query.download === "1")
        reply.header(
          "Content-Disposition",
          `attachment; filename="media"; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        );
      let start = 0,
        end = asset.size - 1;
      if (r.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(r.headers.range);
        if (!match || (!match[1] && !match[2]))
          return reply
            .code(416)
            .header("Content-Range", `bytes */${asset.size}`)
            .send();
        if (match[1]) {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), end) : end;
        } else start = Math.max(0, asset.size - Number(match[2]));
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= asset.size
        )
          return reply
            .code(416)
            .header("Content-Range", `bytes */${asset.size}`)
            .send();
        reply
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${asset.size}`);
      }
      reply.header("Content-Length", end - start + 1);
      return r.method === "HEAD"
        ? reply.send()
        : reply.send(createReadStream(path, { start, end }));
    },
  });
  app.post<{ Body: BatchRequest }>("/createTasks", (r) =>
    service.admit(r.body),
  );
  app.get<{
    Querystring: {
      sessionId?: string;
      state?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/listTasks", (r) => {
    const summary: Record<string, number> = {},
      all = service
        .tasks()
        .filter((t) => !r.query.sessionId || t.sessionId === r.query.sessionId);
    for (const t of all) summary[t.state] = (summary[t.state] || 0) + 1;
    const items = all
      .filter((t) => !r.query.state || t.state === r.query.state)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const page = number(r.query.page, 1, 1000000),
      size = number(r.query.pageSize, 20, 100);
    return {
      items: items.slice((page - 1) * size, page * size).map(publicTask),
      total: items.length,
      summary,
      page,
    };
  });
  app.get<{ Querystring: { id: string; sessionId?: string } }>(
    "/getTask",
    (r) => ({
      task: (() => {
        const task = service.task(r.query.id, text(r.query.sessionId));
        // 从历史素材表读取输出，逻辑删除不影响任务归档；绝不返回受管路径。
        const outputs = task.outputIds.flatMap((id) => {
          const asset = service.store.get<import("../media/types.js").Asset>(
            "assets",
            id,
          );
          if (!asset) return [];
          const { path, ...publicAsset } = asset;
          return [publicAsset];
        });
        return { ...publicTask(task), outputs };
      })(),
      attempts: service.attempts(r.query.id),
    }),
  );
  app.post<{ Querystring: { id: string; sessionId?: string } }>(
    "/cancelTask",
    (r) => {
      service.cancel(r.query.id, text(r.query.sessionId));
      return { accepted: true };
    },
  );
  app.post<{
    Querystring: { id: string; sessionId?: string };
    Body: { revision: number };
  }>("/retryTask", (r) => {
    service.retry(r.query.id, text(r.query.sessionId), r.body.revision);
    return { accepted: true };
  });
  app.post<{ Querystring: { id: string }; Body: { remoteId: string } }>(
    "/reconcileTask",
    (r) => {
      service.reconcile(r.query.id, r.body.remoteId);
      return { accepted: true };
    },
  );
  /**
   * 全局事件增量接口：after 是客户端已确认的最大 seq。
   *
   * 事件表是页面同步的唯一增量来源。接口不按 sessionId 过滤，因为项目、
   * 任务和后台调度是全局可见的；客户端必须持久化最后一个 seq，并在收到
   * 空数组时保持原游标。单次最多返回 200 条，客户端继续使用最后一条 seq
   * 查询，避免一次响应过大时丢失中间事件。
   */
  app.get<{ Querystring: { after?: string; notifications?: string } }>(
    "/listEvents",
    (r) =>
      service.store.events(
        number(r.query.after, 0, Number.MAX_SAFE_INTEGER),
        r.query.notifications === "1",
      ),
  );
  app.post<{ Querystring: { seq: string } }>("/ackEvent", (r) => {
    if (
      !/^\d+$/.test(r.query.seq) ||
      !Number.isSafeInteger(Number(r.query.seq))
    )
      throw new Error("事件序号无效");
    service.store.acknowledge(Number(r.query.seq));
    return { acknowledged: true };
  });
  return app;
}
