/** 持久化事件投递：先注入 DSH 日志并 flush，成功后才确认后端事件。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { MessageId, freezeMessage } from "@deepseek-ai/dsh-llm";
import type { Backend } from "./backend.ts";

interface Notice {
  seq: number;
  sessionId: string;
  message: string;
  entityId: string;
}

/**
 * installNotifications 开启根级串行投递，不唤醒空闲模型。
 * @param ctx 根级插件上下文，提供 agents 与 sessions。
 * @param backend 与页面、工具共用的后端连接。
 */
export function installNotifications(ctx: Context, backend: Backend): void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let active: Promise<void> = Promise.resolve();
  const pending = new Set<string>();
  async function deliver(): Promise<void> {
    let cursor = 0;
    // 分页扫描防止前 200 条都属于关闭会话时，后续可投递会话永远饥饿。
    while (!stopped) {
      const events = (await backend.request(
        "GET",
        `/events?notifications=1&after=${cursor}`,
      )) as Notice[];
      if (!events.length) return;
      for (const event of events) {
        cursor = event.seq;
        if (stopped) return;
        const agent = ctx.agents.get(SessionId(event.sessionId));
        if (!agent) continue;
        const id = MessageId(`atelier-event-${event.seq}-${event.entityId}`);
        // 若上次在 DSH flush 成功后、后端 ack 前退出，稳定消息 ID 可从历史中去重。
        const exists = agent.session
          .snapshotEvents()
          .some(
            (entry) =>
              (entry.type === "agent/inbox/spliced" &&
                entry.data.inserted.some((message) => message.id === id)) ||
              (entry.type === "user/message" && entry.data.id === id),
          );
        if (!exists && !pending.has(id)) {
          agent.inject(
            freezeMessage({
              id,
              role: "user",
              content: [{ type: "text", text: event.message }],
              source: { kind: "plugin", plugin: "atelier" },
            }),
          );
          pending.add(id);
        }
        // 没有持久化监听器时不确认投递；事件留在后端，稍后恢复。
        if (await ctx.sessions.flush(agent.session)) {
          await backend.request("POST", `/events/${event.seq}/ack`);
          pending.delete(id);
        }
      }
      if (events.length < 200) return;
    }
  }
  function tick(): void {
    active = deliver()
      .catch(() => {
        /* 后端或会话暂不可用时保留未确认事件，下一轮重试。 */
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 2000);
      });
  }
  ctx.effect(() => {
    tick();
    return async () => {
      stopped = true;
      clearTimeout(timer);
      await active;
    };
  }, "atelier: 持久化会话通知");
}
