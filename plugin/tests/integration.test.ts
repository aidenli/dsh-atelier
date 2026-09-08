/** 插件连接与通知生命周期测试，使用临时目录和模拟服务，不访问真实账户。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  reapManagedProcess,
  recordManagedProcess,
} from "../src/managed-process.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import { Backend } from "../src/backend.ts";
import { installNotifications } from "../src/notifications.ts";
import { readJSON } from "../../contracts/http.ts";
import { installTransferSkill } from "../src/skill.ts";
import { registerMediaTools } from "../src/tools.ts";

test("托管身份核验保护活跃 Host 和复用 PID，只清理已确认孤立进程", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-process-"));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
  });
  await once(child, "spawn");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await recordManagedProcess(dir, child.pid!);
  await assert.rejects(reapManagedProcess(dir, process.execPath), /另一个 DSH/);
  const path = join(dir, "managed-process.json");
  const record = JSON.parse(await readFile(path, "utf8"));
  await assert.rejects(
    reapManagedProcess(dir, process.execPath, join(dir, "backend.mjs")),
    /旧 Go/,
  );
  await recordManagedProcess(dir, child.pid!, join(dir, "backend.mjs"));
  await assert.rejects(
    reapManagedProcess(dir, process.execPath, join(dir, "wrong.mjs")),
    /不匹配/,
  );
  // 模拟旧记录中的 PID 被新进程复用：启动时间不符时不能杀进程。
  await writeFile(
    path,
    JSON.stringify({ ...record, process: { ...record.process, started: "0" } }),
  );
  await reapManagedProcess(dir, process.execPath);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  // 仅将测试进程标记为孤立；禁止操作真实运行的 Atelier 服务。
  await writeFile(
    path,
    JSON.stringify({
      ...record,
      parent: { ...record.parent, pid: 2147483647 },
    }),
  );
  const exited = once(child, "exit");
  await reapManagedProcess(dir, process.execPath);
  await exited;
});
import {
  renderSkillContent,
  type SkillDefinition,
} from "@deepseek-ai/dsh-skill";

test("素材查询全局可见，任务查询仍绑定当前会话", async () => {
  const registrations = new Map<string, { execute: Function }>();
  const paths: string[] = [];
  const assets = [{ id: "asset-shared", sessionId: "other", kind: "image" }];
  const context = {
    tools: {
      register: (tool: { name: string; execute: Function }) => {
        registrations.set(tool.name, tool);
        return () => registrations.delete(tool.name);
      },
    },
  };
  const backend = {
    request: async (_method: string, path: string) => {
      paths.push(path);
      return path === "/assets" ? assets : [];
    },
  };
  const dispose = registerMediaTools(
    context as unknown as Context,
    backend as unknown as Backend,
    "owner",
  );
  // 当前会话没有原生附件，也必须能解析其他会话导入的受管素材。
  const execution = {
    agent: { id: "owner", session: { snapshotEvents: () => [] } },
  };
  try {
    const result = await registrations
      .get("atelier_asset_list")!
      .execute({ payload: "{}" }, execution);
    assert.deepEqual(JSON.parse(result), assets);
    await registrations
      .get("atelier_task_list")!
      .execute({ payload: '{"sessionId":"other"}' }, execution);
    assert.deepEqual(paths, [
      "/assets",
      "/tasks?sessionId=owner&page=1&state=",
    ]);
  } finally {
    dispose();
  }
});

test("JSON 响应兼容纯文本 404、HTML、损坏 JSON 和正常数据", async () => {
  for (const body of ["404 page not found", "<html>失败</html>"])
    await assert.rejects(
      readJSON(new Response(body, { status: 404 })),
      /HTTP 404/,
    );
  await assert.rejects(readJSON(new Response("broken")), /格式异常/);
  await assert.rejects(
    readJSON(
      new Response('{"error":"不能删除其他会话的素材"}', { status: 400 }),
    ),
    /不能删除其他会话/,
  );
  assert.deepEqual(await readJSON(new Response('{"deleted":true}')), {
    deleted: true,
  });
});

test("Skill 只为加载者开放本轮工具，失败和历史正文不激活", async () => {
  const listeners = new Map<string, Function>();
  let skill!: SkillDefinition;
  const registrations = new Map<string, unknown>();
  const agent = {
    id: "owner",
    session: { header: { cwd: "test" } },
    ctx: {
      tools: {
        register: (tool: { name: string }) => {
          registrations.set(tool.name, tool);
          return () => registrations.delete(tool.name);
        },
      },
    },
  };
  let childMasked = false;
  const child = {
    id: "child",
    ctx: {
      tools: {
        restrict: () => {
          childMasked = true;
          return () => {
            childMasked = false;
          };
        },
      },
    },
  };
  const context = {
    skills: {
      get: async () => skill,
      register: (v: SkillDefinition) => {
        skill = v;
      },
    },
    tools: {
      schemas: (scope: unknown) =>
        scope === child && !childMasked
          ? [...registrations.keys()].map((name) => ({ name }))
          : [{ name: "skill" }],
    },
    systemPrompt: {
      assemble: async () => ({ tools: [...registrations.keys()] }),
    },
    agents: { get: () => agent },
    on: (name: string, fn: Function) => listeners.set(name, fn),
    effect: () => {},
  };
  installTransferSkill(context as unknown as Context, {} as Backend);
  assert.equal(registrations.size, 0);
  // 模拟真实顺序：先领取输入，再组装 schema，最后才会进入 pre-step。
  listeners.get("agent/inbox/claimed")!({
    agent,
    message: {
      source: { kind: "user" },
      content: [{ type: "text", text: "/gd-transfer 验收" }],
    },
  });
  const assembly = await listeners.get("system-prompt/assemble")!(
    { tools: [] },
    { agent },
    async () => ({ tools: [] }),
  );
  assert.equal(assembly.tools.length, 8, "首个请求必须已经包含工具");
  const tool = registrations.get("atelier_capabilities") as {
    execute(args: unknown, execution: unknown): Promise<unknown>;
  };
  await assert.rejects(
    tool.execute({ payload: "{}" }, { agent: child }),
    /需要会话上下文/,
  );
  await listeners.get("system-prompt/assemble")!(
    {},
    { agent: child },
    async () => ({}),
  );
  assert.equal(childMasked, true, "子 Agent 组装请求前必须屏蔽父回合工具");
  listeners.get("agent/disposed")!({ agent: child });
  assert.equal(childMasked, false);
  listeners.get("session/event")!({ id: "owner" }, { type: "turn/end" });
  assert.equal(registrations.size, 0);
  const execution = {
    name: "skill",
    agent,
    signal: new AbortController().signal,
  };
  listeners.get("tools/result")!(execution, { isError: true });
  listeners.get("tools/result")!(execution, {
    isError: false,
    value: { ...skill, provider: "other" },
  });
  assert.equal(registrations.size, 0);
  listeners.get("tools/result")!(execution, { isError: false, value: skill });
  assert.equal(registrations.size, 8);
  listeners.get("tools/result")!(execution, { isError: false, value: skill });
  assert.equal(registrations.size, 8);
  listeners.get("session/event")!({ id: "owner" }, { type: "turn/end" });
  assert.equal(registrations.size, 0);
  const blocks = [{ type: "text", text: renderSkillContent(skill) }];
  await listeners.get("agent/pre-step")!({ agent }, async () => ({
    kind: "enter",
    messages: [{ source: { kind: "user" }, content: blocks }],
  }));
  assert.equal(registrations.size, 0);
  await listeners.get("agent/pre-step")!({ agent }, async () => ({
    kind: "enter",
    messages: [
      {
        source: { kind: "skill-invocation", name: "gd-transfer" },
        content: blocks,
      },
    ],
  }));
  assert.equal(registrations.size, 8);
  listeners.get("agent/disposed")!({ agent });
  assert.equal(registrations.size, 0);
});

test("外部服务无需令牌、URL 持久化与路径限制", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined, "代理不应附加 API 令牌");
    res.setHeader("Content-Type", "application/json");
    res.end('{"status":"ok"}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const backend = new Backend({ dataDir: dir, mode: "external", backendUrl });
  await backend.initialize();
  assert.deepEqual(await backend.request("GET", "/health"), { status: "ok" });
  await assert.rejects(
    backend.request("POST", "/assets/import", { path: "not-allowed" }),
  );
  await assert.rejects(
    backend.connection({ mode: "managed", backendUrl: "https://example.com" }),
  );
  await backend.connection({ mode: "external", backendUrl });
  assert.equal(
    JSON.parse(await readFile(join(dir, "plugin.json"), "utf8")).backendUrl,
    backendUrl,
  );
  await backend.stop();
  assert.equal(
    (await fetch(backendUrl)).status,
    200,
    "外部服务不能被插件退出停止",
  );
});

test("通知重投递使用稳定 ID，持久化失败不得确认", async () => {
  const events: Array<{
    type: string;
    data: { id?: string; inserted?: Array<{ id: string }> };
  }> = [];
  let injected = 0;
  let acknowledgements = 0;
  let cleanup: (() => Promise<void>) | undefined;
  let failFlush = true;
  let finish!: () => void;
  const flushed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fakeContext = {
    agents: {
      get: () => ({
        session: { snapshotEvents: () => events },
        inject: (message: { id: string }) => {
          injected++;
          events.push({
            type: "agent/inbox/spliced",
            data: { inserted: [message] },
          });
        },
      }),
    },
    sessions: {
      flush: async () => {
        finish();
        if (failFlush) throw new Error("模拟持久化中断");
        return true;
      },
    },
    effect: (factory: () => () => Promise<void>) => {
      cleanup = factory();
    },
  };
  const fakeBackend = {
    request: async (method: string) => {
      if (method === "POST") {
        acknowledgements++;
        return {};
      }
      return [
        { seq: 1, sessionId: "test", entityId: "task-1", message: "批次完成" },
      ];
    },
  };
  installNotifications(
    fakeContext as unknown as Context,
    fakeBackend as unknown as Backend,
  );
  await flushed;
  await cleanup?.();
  assert.equal(injected, 1);
  assert.equal(acknowledgements, 0);
  // 模拟 Host 重启：新投递器从旧会话日志发现相同 ID，不会再次注入。
  failFlush = false;
  const acknowledged = new Promise<void>((resolve) => {
    fakeBackend.request = async (method: string) => {
      if (method === "POST") {
        acknowledgements++;
        resolve();
        return {};
      }
      return [
        { seq: 1, sessionId: "test", entityId: "task-1", message: "批次完成" },
      ];
    };
  });
  installNotifications(
    fakeContext as unknown as Context,
    fakeBackend as unknown as Backend,
  );
  await acknowledged;
  await cleanup?.();
  assert.equal(injected, 1);
  assert.equal(acknowledgements, 1);
});
