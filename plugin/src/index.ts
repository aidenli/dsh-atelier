/** DSH Host 插件装配：Remote、文件代理和模型工具复用同一 Backend 连接。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-agent";
import { Backend, type PluginConfig } from "./backend.ts";
import { AtelierRemote } from "./remote.ts";
import { installNotifications } from "./notifications.ts";
import { installTransferSkill } from "./skill.ts";
export { AtelierRemote } from "./remote.ts";
export type { PluginConfig } from "./backend.ts";
export { Backend } from "./backend.ts";

export const name = "atelier";
export const inject = [
  "connection",
  "tools",
  "agents",
  "sessions",
  "attachments",
  "typert",
  "skills",
  "systemPrompt",
];

/**
 * apply 将根级后台连接绑定到插件生命周期；Agent 回合结束不会关闭任务服务。
 * @param ctx 根级 Host 上下文。
 * @param config URL、启动模式及本机部署位置。
 */
export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  const backend = new Backend(config);
  ctx.effect(() => () => backend.stop(), "atelier: 后端进程生命周期");
  await backend.initialize();
  new AtelierRemote(ctx, backend);
  installNotifications(ctx, backend);
  // DSH streaming 模式会无条件构造请求体，因此上传与 GET/HEAD 必须使用不同路径。
  for (const upload of [false, true])
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: upload ? "/api/atelier.upload" : "/api/atelier.file",
          methods: upload ? ["POST"] : ["GET", "HEAD"],
          requestBody: upload ? "streaming" : "buffered",
          async fetch(request: Request): Promise<Response> {
            const url = new URL(request.url);
            const headers = new Headers();
            for (const key of ["Range", "If-Range", "Content-Type"]) {
              const value = request.headers.get(key);
              if (value) headers.set(key, value);
            }
            const id = url.searchParams.get("id");
            if (
              request.method !== "POST" &&
              (!id || !/^[a-zA-Z0-9-]+$/.test(id))
            )
              return new Response("素材 ID 无效", { status: 400 });
            const path =
              request.method === "POST"
                ? "/assets"
                : `/assets/${id}/file${url.searchParams.get("download") === "1" ? "?download=1" : ""}`;
            try {
              const init: RequestInit & { duplex?: "half" } = {
                method: request.method,
                headers,
                signal: request.signal,
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
                "Content-Disposition",
              ]) {
                const value = response.headers.get(key);
                if (value) outgoing.set(key, value);
              }
              outgoing.set("X-Content-Type-Options", "nosniff");
              return new Response(response.body, {
                status: response.status,
                headers: outgoing,
              });
            } catch {
              return Response.json(
                { error: "后端文件服务不可用" },
                { status: 502 },
              );
            }
          },
        }),
      "atelier: 同源流式文件代理",
    );

  installTransferSkill(ctx, backend);
}
