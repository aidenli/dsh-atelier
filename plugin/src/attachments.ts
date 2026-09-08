/** 从当前会话已记录的原生附件导入素材库；不接受模型伪造的附件 ID 或任意其他会话。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-attachment";
import type { Backend } from "./backend.ts";

/**
 * importSessionAttachments 在模型查询素材时同步原生附件，稳定身份使重复查询不复制文件。
 * @param ctx 提供本机附件存储服务的 Host 上下文。
 * @param backend 独立后端连接。
 * @param agent 当前工具执行者，素材权限从其已记录消息推导。
 * @returns 所有支持的原生媒体附件已进入素材库。
 */
export async function importSessionAttachments(
  ctx: Context,
  backend: Backend,
  agent: Agent,
): Promise<void> {
  const seen = new Set<string>();
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== "user/message" || event.data.source.kind !== "user")
      continue;
    for (const block of event.data.content) {
      if (block.type !== "image" && block.type !== "file") continue;
      const ref = block.attachment;
      if (seen.has(ref.attachmentId)) continue;
      seen.add(ref.attachmentId);
      if (
        block.type === "file" &&
        !/\.(png|jpe?g|webp|mp4|mov|webm)$/i.test(ref.name || "")
      )
        continue;
      const path =
        block.type === "image"
          ? ctx.attachments.imageHostPath(block.attachment)
          : ctx.attachments.fileHostPath(block.attachment);
      if (!path)
        throw new Error("当前 DSH 附件存储不提供本机路径，请改用工作台上传");
      await backend.request(
        "POST",
        "/assets/import",
        {
          sessionId: agent.id,
          path,
          sourceId: `dsh:${ref.attachmentId}`,
          name: ref.name || "聊天图片",
        },
        true,
      );
    }
  }
}
