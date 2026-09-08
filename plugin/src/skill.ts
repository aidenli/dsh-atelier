/** 技能加载与工具授权仅绑定本次 Agent 回合，后台调度不依赖此授权。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import {
  renderSkillContent,
  type SkillDefinition,
} from "@deepseek-ai/dsh-skill";
import { readFileSync } from "node:fs";
import type { Backend } from "./backend.ts";
import { registerMediaTools } from "./tools.ts";

/** 原生用户注入与模型 skill 调用共用同一技能正文，历史文本本身不是授权依据。 */
export function installTransferSkill(ctx: Context, backend: Backend): void {
  const content = readFileSync(
    new URL("../skills/gd-transfer/SKILL.md", import.meta.url),
    "utf8",
  ).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const skill: SkillDefinition = {
    name: "gd-transfer",
    provider: "atelier",
    source: "bundled",
    description:
      "动作迁移：人物图与参考视频生成 Wan Animate2 视频，查询、取消及重试 Atelier 任务。",
    content,
    invocation: { userInvocable: true, modelInvocable: true },
  };
  ctx.skills.register(skill);
  const active = new Map<Agent, () => void>();
  const inheritedMasks = new Map<Agent, () => void>();
  const pending = new Set<Agent>();
  const deactivate = (agent: Agent) => {
    active.get(agent)?.();
    active.delete(agent);
  };
  const activate = (agent: Agent) => {
    if (active.has(agent)) return;
    inheritedMasks.get(agent)?.();
    inheritedMasks.delete(agent);
    active.set(agent, registerMediaTools(agent.ctx, backend, agent.id));
  };
  // inbox 领取发生在提示词组装之前；pre-step 已经晚于工具 schema 快照。
  ctx.on("agent/inbox/claimed", ({ agent, message }) => {
    if (
      message.source.kind === "user" &&
      message.content.some(
        (block) =>
          block.type === "text" &&
          /(^|\s)\/gd-transfer(?=\s|$)/.test(block.text),
      )
    )
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
        signal: context.signal,
      });
      // 同名第三方技能不能获得授权；还必须允许用户调用且原生 skill 工具可见。
      if (
        !context.signal?.aborted &&
        loaded?.provider === skill.provider &&
        loaded.content === content &&
        loaded.invocation?.userInvocable !== false &&
        ctx.tools.schemas(agent).some((tool) => tool.name === "skill")
      ) {
        changed = !active.has(agent);
        activate(agent);
      }
    }
    if (!active.has(agent) && !inheritedMasks.has(agent)) {
      const names = ctx.tools
        .schemas(agent)
        .map((tool) => tool.name)
        .filter((name) => name.startsWith("atelier_"));
      if (names.length) {
        inheritedMasks.set(agent, agent.ctx.tools.restrict({ deny: names }));
        changed = true;
      }
    }
    // 变更后完整重建一次，同时更新普通工具和 PTC SDK；标记已消费，递归不会重复授权。
    return changed ? ctx.systemPrompt.assemble(context) : next();
  });
  const explicit = (
    agent: Agent,
    source: unknown,
    blocks: readonly { type: string; text?: string }[],
  ) => {
    if (
      !source ||
      typeof source !== "object" ||
      !("kind" in source) ||
      source.kind !== "skill-invocation" ||
      !("name" in source) ||
      source.name !== skill.name
    )
      return;
    // 必须是本插件的完整加载结果，不能只匹配正文里的 /gd-transfer 字符串。
    if (
      blocks.some(
        (block) =>
          block.type === "text" && block.text === renderSkillContent(skill),
      )
    )
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
    if (
      execution.name !== "skill" ||
      !execution.agent ||
      execution.signal.aborted ||
      result.isError
    )
      return;
    const value = result.value as Partial<SkillDefinition> | undefined;
    if (
      value?.name === skill.name &&
      value.provider === skill.provider &&
      value.content === content
    )
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
    "atelier: 撤销回合工具授权",
  );
}
