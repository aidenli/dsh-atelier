/** 迁移回归使用隔离 SQLite 和模拟 HTTP 平台，绝不读取用户配置或发起付费任务。 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import { Store } from "../src/storage/store.js";
import { Service, hash } from "../src/media/service.js";
import { Files } from "../src/media/files.js";
import { Runner } from "../src/scheduler/runner.js";
import { Client, RemoteError, retryDelay } from "../src/runninghub/client.js";
import { router } from "../src/httpapi/router.js";
import type { BatchRequest, Task } from "../src/media/types.js";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(24),
]);
test(
  "Windows 密钥迁移、随机密文和主密钥丢失保护",
  { skip: process.platform !== "win32" },
  async () => {
    const f = await fixture();
    try {
      const secret = "migration-test-secret";
      await writeFile(
        join(f.dir, "config.json"),
        JSON.stringify({
          baseUrl: "https://www.runninghub.cn",
          apiKey: secret,
        }),
      );
      const service = new Service(f.store);
      assert.equal(service.getConfig().apiKey, secret);
      assert.ok(
        !(await readFile(join(f.dir, "config.json"), "utf8")).includes(secret),
      );
      const first = String(
        f.store.db.prepare("SELECT body FROM secrets").get()!.body,
      );
      assert.ok(!first.includes(secret));
      service.saveConfig({
        baseUrl: "https://www.runninghub.cn",
        apiKey: secret,
      });
      const second = String(
        f.store.db.prepare("SELECT body FROM secrets").get()!.body,
      );
      assert.notEqual(first, second);
      const damaged = JSON.parse(second);
      damaged.tag = Buffer.alloc(16).toString("base64");
      f.store.db
        .prepare("UPDATE secrets SET body=?")
        .run(JSON.stringify(damaged));
      assert.throws(() => service.getConfig(), /解密失败/);
      f.store.db.prepare("UPDATE secrets SET body=?").run(second);
      await rm(join(f.dir, "master-key.dpapi"));
      assert.throws(
        () =>
          service.saveConfig({
            baseUrl: "https://www.runninghub.cn",
            apiKey: "replacement",
          }),
        /主密钥文件丢失/,
      );
      assert.equal(
        f.store.db.prepare("SELECT body FROM secrets").get()!.body,
        second,
      );
    } finally {
      await f.close();
    }
  },
);
const mp4 = Buffer.from(
  "00000018667479706d703432000000006d70343269736f6d000000086d646174",
  "hex",
);
test("项目与任务分离：批量归属、幂等、历史补齐不改变远端任务", async () => {
  const f = await fixture();
  try {
    f.request.tasks.push({ ...f.request.tasks[0], title: "第二段" });
    f.request.tasks.push({ ...f.request.tasks[0], title: "第三段" });
    const plan = f.service.admit(f.request);
    assert.equal(f.service.projects().length, 3);
    const projectId = f.service.task(plan.taskIds[0]).projectId!;
    assert.deepEqual(f.service.project(projectId).taskIds, [plan.taskIds[0]]);
    assert.equal(plan.taskIds.length, 3);
    assert.equal(f.service.admit(f.request).id, plan.id);
    assert.equal(f.service.projects().length, 3);
    f.service.update(plan.taskIds[0], (task) => {
      task.remoteId = "existing-remote";
      task.state = "remote_pending";
    });
    for (const p of f.service.projects()) f.store.delete("projects", p.id);
    for (const t of f.service.tasks()) {
      delete t.projectId;
      f.store.put("tasks", t.id, t);
    }
    f.store.put("projects", plan.id, { id: plan.id, taskIds: plan.taskIds });
    const eventsBefore = f.store.events(0);
    const restored = new Service(f.store);
    assert.equal(restored.projects().length, 3);
    assert.equal(f.store.get("projects", plan.id), undefined);
    assert.deepEqual(f.store.events(0), eventsBefore);
    assert.equal(new Service(f.store).projects().length, 3);
    assert.equal(restored.task(plan.taskIds[0]).remoteId, "existing-remote");
    const app = await router(restored, f.files);
    try {
      const response = await app.inject({
        method: "GET",
        url: `/projects/${projectId}`,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().tasks.length, 1);
      assert.equal(response.json().project.state, "remote_pending");
      assert.equal(
        (
          await app.inject({ method: "GET", url: "/projects?type=other" })
        ).json().total,
        0,
      );
      restored.update(plan.taskIds[0], (t) => {
        t.state = "failed";
      });
      restored.retry(
        plan.taskIds[0],
        "chat",
        restored.task(plan.taskIds[0]).revision,
      );
      assert.equal(restored.task(plan.taskIds[0]).projectId, projectId);
      assert.equal(restored.projects().length, 3);
      for (let i = 0; i < 20; i++)
        restored.admit({
          ...f.request,
          requestId: `page-${i}`,
          tasks: [f.request.tasks[0]],
        });
      const second = (
        await app.inject({
          method: "GET",
          url: "/projects?type=motion-transfer&page=2",
        })
      ).json();
      assert.equal(second.total, 23);
      assert.equal(second.items.length, 3);
      assert.equal(second.page, 2);
      assert.equal(response.json().tasks[0].uploads, undefined);
    } finally {
      await app.close();
    }
  } finally {
    await f.close();
  }
});
test("OpenAPI 中每个公开路由都在 Node 服务注册", async () => {
  const f = await fixture(),
    app = await router(f.service, f.files);
  try {
    const spec = JSON.parse(
      await readFile(
        new URL("../../../../contracts/openapi.json", import.meta.url),
        "utf8",
      ),
    );
    for (const [url, methods] of Object.entries(spec.paths))
      for (const method of Object.keys(methods as object))
        assert.ok(
          app.hasRoute({
            method: method.toUpperCase() as never,
            url: url.replace(/\{(\w+)\}/g, ":$1"),
          }),
          `${method} ${url}`,
        );
  } finally {
    await app.close();
    await f.close();
  }
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "atelier-node-test-"));
  const store = new Store(dir),
    service = new Service(store),
    files = new Files(service);
  await files.initialize();
  const image = await files.import("source", "image.png", Readable.from(png)),
    video = await files.import("source", "video.mp4", Readable.from(mp4));
  const request: BatchRequest = {
    sessionId: "chat",
    requestId: "request",
    tasks: [
      {
        title: "动作迁移",
        workflowId: "wan-animate2",
        imageId: image.id,
        videoId: video.id,
      },
    ],
  };
  const runner = new Runner(service, files);
  return {
    dir,
    store,
    service,
    files,
    image,
    video,
    request,
    runner,
    close: async () => {
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function platform() {
  const state = {
    capacity: 1,
    uploads: 0,
    creates: 0,
    queries: 0,
    cancels: 0,
    mode: "ok",
    status: "RUNNING",
    payload: {} as any,
  };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    res.setHeader("Content-Type", "application/json");
    let body: unknown = { code: 0, data: {} };
    if (req.url === "/openapi/v2/media/upload/binary") {
      state.uploads++;
      body = { code: 0, data: { fileName: "uploaded-" + state.uploads } };
    }
    if (req.url === "/openapi/v2/queue/status")
      body = {
        code: 0,
        data: {
          concurrentLimit: state.capacity,
          runningCount: "0",
          queuedCount: "0",
        },
      };
    if (req.url === "/task/openapi/create") {
      state.creates++;
      state.payload = JSON.parse(raw.toString());
      if (state.mode === "disconnect") {
        req.socket.destroy();
        return;
      }
      if (state.mode === "broken") {
        res.end("not-json");
        return;
      }
      body =
        state.mode === "capacity"
          ? { code: 1, msg: "TASK_QUEUE_MAXED" }
          : state.mode === "business"
            ? { code: 99, msg: "private provider error" }
            : { code: 0, data: { taskId: "remote-1" } };
    }
    if (req.url === "/openapi/v2/query") {
      state.queries++;
      if (state.mode === "query-timeout") {
        req.socket.destroy();
        return;
      }
      body = {
        status: state.status,
        results:
          state.status === "SUCCESS"
            ? [{ url: "https://media.invalid/output", outputType: "mp4" }]
            : [],
        errorCode: "INVALID",
      };
    }
    if (req.url === "/task/openapi/cancel") state.cancels++;
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  return {
    state,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeAllConnections();
      }),
  };
}
test("幂等入队、参数冲突和跨会话命令隔离", async () => {
  const f = await fixture();
  try {
    const first = f.service.admit(f.request);
    assert.deepEqual(f.service.admit(f.request), first);
    assert.equal(f.service.tasks().length, 1);
    assert.throws(
      () =>
        f.service.admit({
          ...f.request,
          tasks: [{ ...f.request.tasks[0], title: "修改" }],
        }),
      /不同输入/,
    );
    assert.throws(
      () => f.service.cancel(first.taskIds[0], "other"),
      /其他会话/,
    );
    f.service.cancel(first.taskIds[0], "chat");
    assert.equal(f.service.task(first.taskIds[0]).state, "cancelled");
  } finally {
    await f.close();
  }
});
test("批次任意项校验失败时全部回滚", async () => {
  const f = await fixture();
  try {
    assert.throws(() =>
      f.service.admit({
        ...f.request,
        tasks: [
          ...f.request.tasks,
          { ...f.request.tasks[0], imageId: "missing" },
        ],
      }),
    );
    assert.equal(f.service.tasks().length, 0);
    assert.equal(f.store.list("plans").length, 0);
  } finally {
    await f.close();
  }
});
test("逻辑删除原子回滚、历史文件仍可访问", async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.service.deleteAssets("", [f.image.id, "missing"]));
    assert.equal(f.service.assets().length, 2);
    f.service.deleteAssets("", [f.image.id]);
    f.service.deleteAssets("", [f.image.id]);
    assert.equal(f.service.assets().length, 1);
    assert.equal((await f.files.asset(f.image.id)).asset.size, png.length);
  } finally {
    await f.close();
  }
});
test("工作流快照不随配置修改，版本冲突拒绝覆盖", async () => {
  const f = await fixture();
  try {
    const plan = f.service.admit(f.request),
      w = f.service.workflows()[0];
    f.service.saveWorkflow({ ...w, name: "新名称" });
    assert.throws(() => f.service.saveWorkflow(w));
    assert.equal(f.service.task(plan.taskIds[0]).workflow.name, "Wan Animate2");
  } finally {
    await f.close();
  }
});
test("SQLite 独占连接防止第二实例，异常事务不留下部分实体", async () => {
  const f = await fixture();
  try {
    assert.throws(() => new Store(f.dir));
    assert.throws(() =>
      f.store.tx(() => {
        f.store.put("plans", "bad", {});
        throw new Error("crash");
      }),
    );
    assert.equal(f.store.get("plans", "bad"), undefined);
  } finally {
    await f.close();
  }
});
test("满载时上传继续，容量恢复后只提交一次", async () => {
  const f = await fixture(),
    p = await platform();
  try {
    f.service.saveConfig({ baseUrl: p.url, apiKey: "test-only" });
    p.state.capacity = 0;
    const key = f.service.admit(f.request).taskIds[0];
    await f.runner.step(new AbortController().signal);
    assert.equal(p.state.uploads, 2);
    assert.equal(p.state.creates, 0);
    assert.equal(f.service.task(key).state, "queued");
    p.state.capacity = 3;
    f.service.update(key, (t) => {
      t.nextRunAt = "2000-01-01T00:00:00Z";
    });
    await f.runner.step(new AbortController().signal);
    assert.equal(p.state.uploads, 2);
    assert.equal(p.state.creates, 1);
    assert.equal(f.service.task(key).remoteId, "remote-1");
    assert.equal(p.state.payload.instanceType, undefined);
    assert.equal(p.state.payload.nodeInfoList.length, 6);
  } finally {
    await p.close();
    await f.close();
  }
});
for (const mode of ["disconnect", "broken"])
  test(`创建 ${mode} 进入未知提交，重启不重发`, async () => {
    const f = await fixture(),
      p = await platform();
    try {
      f.service.saveConfig({ baseUrl: p.url, apiKey: "test-only" });
      p.state.mode = mode;
      const key = f.service.admit(f.request).taskIds[0];
      await f.runner.step(new AbortController().signal);
      assert.equal(f.service.task(key).state, "submission_unknown");
      f.runner.recover();
      await f.runner.step(new AbortController().signal);
      assert.equal(p.state.creates, 1);
      f.service.reconcile(key, "known-id");
      p.state.mode = "ok";
      await f.runner.step(new AbortController().signal);
      assert.equal(p.state.creates, 1);
      assert.equal(p.state.queries, 1);
    } finally {
      await p.close();
      await f.close();
    }
  });
test("竞争拒绝回本地等待，明确业务失败不自动重试", async () => {
  const f = await fixture(),
    p = await platform();
  try {
    f.service.saveConfig({ baseUrl: p.url, apiKey: "test-only" });
    p.state.mode = "capacity";
    const key = f.service.admit(f.request).taskIds[0];
    await f.runner.step(new AbortController().signal);
    assert.equal(f.service.task(key).state, "queued");
    p.state.mode = "business";
    f.service.update(key, (t) => {
      t.nextRunAt = "2000-01-01T00:00:00Z";
    });
    await f.runner.step(new AbortController().signal);
    assert.equal(f.service.task(key).state, "failed");
    await f.runner.step(new AbortController().signal);
    assert.equal(p.state.creates, 2);
    const revision = f.service.task(key).revision;
    f.service.retry(key, "chat", revision);
    assert.throws(() => f.service.retry(key, "chat", revision));
    assert.equal(f.service.task(key).attempt, 2);
  } finally {
    await p.close();
    await f.close();
  }
});
test("查询网络失败保留远端 ID，取消须核对状态，迟到成功仍归档", async () => {
  const f = await fixture(),
    p = await platform();
  try {
    f.service.saveConfig({ baseUrl: p.url, apiKey: "test-only" });
    const key = f.service.admit(f.request).taskIds[0];
    await f.runner.step(new AbortController().signal);
    p.state.mode = "query-timeout";
    f.service.update(key, (t) => {
      t.nextRunAt = "2000-01-01T00:00:00Z";
    });
    await f.runner.step(new AbortController().signal);
    assert.equal(f.service.task(key).remoteId, "remote-1");
    assert.equal(f.service.task(key).errorKind, "network");
    p.state.mode = "ok";
    f.service.cancel(key, "chat");
    await f.runner.step(new AbortController().signal);
    assert.equal(f.service.task(key).state, "cancel_requested");
    assert.equal(p.state.cancels, 1);
    p.state.status = "SUCCESS";
    f.service.update(key, (t) => {
      t.nextRunAt = "2000-01-01T00:00:00Z";
    });
    await f.runner.step(new AbortController().signal);
    assert.equal(f.service.task(key).state, "downloading");
    assert.equal(f.service.task(key).cancelRequested, true);
    assert.equal(p.state.creates, 1);
  } finally {
    await p.close();
    await f.close();
  }
});
test("恢复 uploading 和 submitting，不把已知远端任务退回创建", async () => {
  const f = await fixture();
  try {
    const keys = f.service.admit({
      ...f.request,
      tasks: [f.request.tasks[0], f.request.tasks[0], f.request.tasks[0]],
    }).taskIds;
    f.service.update(keys[0], (t) => {
      t.state = "uploading";
    });
    f.service.update(keys[1], (t) => {
      t.state = "submitting";
    });
    f.service.update(keys[2], (t) => {
      t.state = "submitting";
      t.remoteId = "known";
    });
    f.runner.recover();
    assert.deepEqual(
      keys.map((k) => f.service.task(k).state),
      ["queued", "submission_unknown", "remote_pending"],
    );
  } finally {
    await f.close();
  }
});
test("归档截断不登记，稳定输出 ID 支持改名后崩溃恢复", async () => {
  const f = await fixture();
  try {
    const key = f.service.admit(f.request).taskIds[0],
      task = f.service.task(key);
    await assert.rejects(
      f.files.importOutput(task, 0, Readable.from(mp4), mp4.length + 1),
      /不完整/,
    );
    assert.equal(f.store.get("assets", `output-${key}-1-0`), undefined);
    const first = await f.files.importOutput(
      task,
      0,
      Readable.from(mp4),
      mp4.length,
    );
    f.store.tx(() => f.store.delete("assets", first.id));
    const second = await f.files.importOutput(
      task,
      0,
      Readable.from(mp4),
      mp4.length,
    );
    assert.equal(first.id, second.id);
    assert.equal(first.sha256, second.sha256);
    await assert.rejects(
      f.files.importOutput(task, 1, Readable.from(png)),
      /不是视频/,
    );
  } finally {
    await f.close();
  }
});
test("HTTP 兼容、上传字段顺序、Range/HEAD、删除、分页与脱敏", async () => {
  const f = await fixture();
  const app = await router(f.service, f.files);
  try {
    assert.equal((await app.inject("/health")).json().runtime, "node");
    const range = await app.inject({
      url: `/assets/${f.video.id}/file`,
      headers: { range: "bytes=0-7" },
    });
    assert.equal(range.statusCode, 206);
    assert.equal(range.rawPayload.length, 8);
    assert.equal(range.headers["content-range"], `bytes 0-7/${mp4.length}`);
    assert.equal(
      (await app.inject({ method: "HEAD", url: `/assets/${f.video.id}/file` }))
        .rawPayload.length,
      0,
    );
    assert.equal(
      (
        await app.inject({
          url: `/assets/${f.video.id}/file`,
          headers: { range: "bytes=999-" },
        })
      ).statusCode,
      416,
    );
    const boundary = "test-upload";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\nchat\r\n--${boundary}--\r\n`,
      ),
    ]);
    const upload = await app.inject({
      method: "POST",
      url: "/assets",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    assert.equal(upload.statusCode, 200, upload.body);
    assert.equal(upload.json().sessionId, "chat");
    const key = f.service.admit(f.request).taskIds[0];
    f.service.update(key, (t) => {
      t.accountHash = "private";
      t.uploads = {
        image: "private",
        video: "private",
        accountHash: "private",
        providerUrl: "private",
      };
    });
    const details = (await app.inject("/tasks/" + key)).json();
    assert.equal(details.task.uploads, undefined);
    assert.equal(details.task.accountHash, "");
    assert.equal(
      (await app.inject("/tasks?pageSize=1")).json().items.length,
      1,
    );
    const deleted = await app.inject({
      method: "DELETE",
      url: "/assets",
      payload: { ids: [f.image.id] },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(
      (await app.inject(`/assets/${f.image.id}/file`)).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/tasks",
          headers: { "content-type": "application/json" },
          payload: "bad",
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
    await f.close();
  }
});
test("完成事件持久化并可补投递，确认不推进页面游标", async () => {
  const f = await fixture();
  try {
    const key = f.service.admit(f.request).taskIds[0];
    f.service.cancel(key);
    const pending = f.store.events(0, true);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, "batch");
    f.store.acknowledge(pending[0].seq);
    assert.equal(f.store.events(0, true).length, 0);
    assert.ok(f.store.events(0).some((e) => e.seq === pending[0].seq));
  } finally {
    await f.close();
  }
});
test("按尺寸自动选择 plus，明确 default 优先，Retry-After 可恢复", async () => {
  const f = await fixture(),
    p = await platform();
  try {
    const key = f.service.admit(f.request).taskIds[0],
      t = f.service.task(key),
      c = new Client({ baseUrl: p.url, apiKey: "test-only" });
    t.parameters = { width: 720, height: 1280, frames: 81, skip: 0 };
    await c.create(t, "i", "v");
    assert.equal(p.state.payload.instanceType, "plus");
    t.parameters.instanceType = "default";
    await c.create(t, "i", "v");
    assert.equal(p.state.payload.instanceType, undefined);
    assert.equal(retryDelay("60"), 60000);
  } finally {
    await p.close();
    await f.close();
  }
});
test("读取 Go 实际生成的 v1 数据，旧请求重放不新增任务，历史删除文件和事件保留", async () => {
  const legacy = JSON.parse(
    await readFile(
      new URL("../../../test/fixtures/go-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const dir = await mkdtemp(join(tmpdir(), "atelier-upgrade-"));
  let store = new Store(dir);
  try {
    store.tx(() => {
      for (const [table, rows] of Object.entries(legacy.rows))
        for (const row of rows as any[]) store.put(table, row.id, row);
      for (const e of legacy.events)
        store.db
          .prepare(
            "INSERT INTO events(seq,session_id,entity_id,kind,message,notify,delivered,created_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            e.seq,
            e.sessionId,
            e.entityId,
            e.kind,
            e.message,
            Number(e.notify),
            Number(e.delivered),
            e.createdAt,
          );
    });
    for (const [path, content] of Object.entries(legacy.files)) {
      const file = join(dir, ...path.split(/[\\/]/));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(content as string, "base64"));
    }
    store.close();
    store = new Store(dir);
    const service = new Service(store),
      files = new Files(service);
    const plan = service.admit(legacy.request);
    assert.equal(plan.id, legacy.planId);
    assert.equal(service.tasks().length, 1);
    assert.equal(service.task(plan.taskIds[0]).remoteId, "existing-remote");
    assert.equal(service.assets().length, 1);
    assert.equal(
      (await files.asset(legacy.request.tasks[0].imageId)).asset.kind,
      "image",
    );
    assert.equal(store.events(0).length, legacy.events.length);
    new Runner(service, files).recover();
    assert.equal(service.task(plan.taskIds[0]).remoteId, "existing-remote");
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("下载中断只重试下载，迟到成功全部归档后才结束", async (context) => {
  const f = await fixture();
  try {
    const key = f.service.admit(f.request).taskIds[0];
    f.service.saveConfig({
      baseUrl: "https://unused.invalid",
      apiKey: "test-only",
    });
    f.service.update(key, (t) => {
      t.state = "downloading";
      t.remoteId = "existing";
      t.cancelRequested = true;
      t.results = [{ url: "https://media.invalid/output", outputType: "mp4" }];
    });
    let calls = 0;
    context.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(mp4, {
        headers: {
          "Content-Length": String(calls === 1 ? mp4.length + 1 : mp4.length),
        },
      });
    });
    await f.runner.step(new AbortController().signal);
    assert.equal(f.service.task(key).state, "downloading");
    assert.equal(f.service.task(key).remoteId, "existing");
    f.service.update(key, (t) => {
      t.nextRunAt = "2000-01-01T00:00:00Z";
    });
    await f.runner.step(new AbortController().signal);
    const t = f.service.task(key);
    assert.equal(t.state, "succeeded");
    assert.equal(t.cancelRequested, true);
    assert.equal(t.outputIds.length, 1);
    assert.equal(calls, 2);
  } finally {
    await f.close();
  }
});
test("输出地址过期只查询原任务，下载 Retry-After 延迟持久化", async (context) => {
  const f = await fixture();
  try {
    const key = f.service.admit(f.request).taskIds[0];
    f.service.saveConfig({
      baseUrl: "https://unused.invalid",
      apiKey: "test-only",
    });
    f.service.update(key, (t) => {
      t.state = "downloading";
      t.remoteId = "existing";
      t.results = [{ url: "https://media.invalid/output", outputType: "mp4" }];
    });
    context.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response("", { status: 429, headers: { "Retry-After": "120" } }),
    );
    await f.runner.step(new AbortController().signal);
    assert.ok(Date.parse(f.service.task(key).nextRunAt) > Date.now() + 110000);
    context.mock.restoreAll();
    context.mock.method(
      globalThis,
      "fetch",
      async () => new Response("", { status: 403 }),
    );
    f.service.update(key, (t) => {
      t.nextRunAt = "2000-01-01T00:00:00Z";
    });
    await f.runner.step(new AbortController().signal);
    assert.equal(f.service.task(key).state, "remote_pending");
    assert.equal(f.service.task(key).remoteId, "existing");
  } finally {
    await f.close();
  }
});
