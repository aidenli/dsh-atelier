/** 业务工具只在已加载动作迁移技能的 Agent 作用域注册。 */
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Backend } from "./backend.ts";
import { importSessionAttachments } from "./attachments.ts";

/** 返回所有注册的撤销函数；执行器归属校验阻止子 Agent 继承父回合授权。 */
export function registerMediaTools(
  ctx: Context,
  backend: Backend,
  ownerId: string,
): () => void {
  const disposers: (() => unknown)[] = [];
  // 工具仅允许业务操作，sessionId 从执行上下文取值，模型无法伪造其他会话身份。
  const operations = {
    capabilities:
      "查询动作迁移能力、工作流和参数。仅支持 Wan Animate2 单段，固定 30fps。",
    asset_list:
      "同步当前会话附件并查询全局素材库。优先按用户明确提供的素材 ID 匹配，素材可跨会话复用；缺失或有歧义时追问，不创建占位任务。",
    asset_import:
      "将用户明确提供的本机绝对文件路径导入当前会话素材库。payload 为 {path}。",
    task_create:
      "用户提出生成要求且素材齐全时直接创建任务，无需计划确认。payload 为 {requestId,tasks:[{title,workflowId,imageId,videoId,parameters?:{width,height,frames,skip,instanceType}}]}。instanceType 可省略以按动作迁移尺寸自动选择；用户明确指定时传 plus 或 default（普通实例，平台参数省略）。requestId 必须稳定；未知提交不得重新创建。",
    task_list: "查询当前会话任务。payload 可包含 page、state。",
    task_get: "查询当前会话任务详情。payload 为 {id}。",
    task_cancel: "仅在用户明确要求时取消当前会话任务。payload 为 {id}。",
    task_retry:
      "仅在用户明确要求时重试业务失败任务，可能重新计费。payload 为 {id,revision}。",
  } as const;
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
              description:
                "业务参数 JSON；无参数时传 {}。密钥、节点 JSON 和其他会话 ID 不得作为参数。",
            },
          },
          output: {
            schema: { type: "string" },
            render: (_args, value) => [{ type: "text", text: value }],
          },
          async execute(args, execution) {
            if (!execution.agent || execution.agent.id !== ownerId)
              throw new Error("Atelier 工具需要会话上下文");
            const sessionId = execution.agent.id;
            const input = JSON.parse(args.payload) as Record<string, unknown>;
            const id =
              typeof input.id === "string" && /^[a-zA-Z0-9-]+$/.test(input.id)
                ? input.id
                : "";
            const scope = `sessionId=${encodeURIComponent(sessionId)}`;
            let result: unknown;
            switch (operation) {
              case "capabilities":
                result = {
                  workflows: await backend.request("GET", "/workflows"),
                  fps: 30,
                  autoStartWhenReady: true,
                  instructions:
                    "先查询素材，缺少素材时追问；入队后返回任务引用，无需循环查询。",
                };
                break;
              case "asset_list":
                await importSessionAttachments(ctx, backend, execution.agent);
                // 素材库与页面一致，全局可读；下方任务操作仍使用执行者的会话范围。
                result = await backend.request("GET", "/assets");
                break;
              case "asset_import":
                result = await backend.request(
                  "POST",
                  "/assets/import",
                  { sessionId, path: input.path },
                  true,
                );
                break;
              case "task_create":
                result = await backend.request("POST", "/tasks", {
                  sessionId,
                  requestId: input.requestId,
                  tasks: input.tasks,
                });
                break;
              case "task_list":
                result = await backend.request(
                  "GET",
                  `/tasks?${scope}&page=${Number(input.page) || 1}&state=${encodeURIComponent(String(input.state || ""))}`,
                );
                break;
              case "task_get":
                if (!id) throw new Error("任务 ID 无效");
                result = await backend.request("GET", `/tasks/${id}?${scope}`);
                break;
              case "task_cancel":
                if (!id) throw new Error("任务 ID 无效");
                result = await backend.request(
                  "POST",
                  `/tasks/${id}/cancel?${scope}`,
                );
                break;
              case "task_retry":
                if (!id) throw new Error("任务 ID 无效");
                result = await backend.request(
                  "POST",
                  `/tasks/${id}/retry?${scope}`,
                  { revision: input.revision },
                );
                break;
              default:
                throw new Error("未知操作");
            }
            return JSON.stringify(result);
          },
        }),
      ),
    );
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
