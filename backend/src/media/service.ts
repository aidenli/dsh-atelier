/** 业务命令共用事务边界；页面和模型工具不得直接修改任务状态。 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../storage/store.js";
import { Secrets } from "../storage/secrets.js";
import type { Project } from "../../../contracts/generated.js";
import {
  now,
  terminal,
  type Asset,
  type Attempt,
  type BatchRequest,
  type Config,
  type Parameters,
  type Plan,
  type Task,
  type Workflow,
} from "./types.js";
/** 稳定摘要用于幂等请求与账户比对，不能恢复密钥。 */
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** 使用系统随机源生成实体 ID，随机源异常不降级为可重复值。 */
export const id = (prefix: string) => prefix + randomBytes(16).toString("hex");
/** 验证工作流业务参数；不支持的实例类型、尺寸或负帧数直接拒绝。 */
export function validateParams(p: Parameters): void {
  if (!p || !["", "default", "plus"].includes(p.instanceType || ""))
    throw new Error("instanceType 仅支持 default 或 plus");
  for (const v of [p.width, p.height])
    if (!Number.isInteger(v) || v < 64 || v > 4096 || v % 8)
      throw new Error("尺寸必须是 64..4096 内的 8 的倍数");
  for (const v of [p.frames, p.skip])
    if (!Number.isSafeInteger(v) || v < 0)
      throw new Error("帧数必须是非负整数");
}
function validateWorkflow(w: Workflow): void {
  if (!w.remoteId) throw new Error("缺少远端工作流 ID");
  for (const k of ["width", "height", "frames", "skip", "image", "video"])
    if (!w.mapping?.[k]?.nodeId || !w.mapping[k].fieldName)
      throw new Error(`缺少节点映射 ${k}`);
}
/** 初次启动预置六个 Wan 节点；现有数据库配置不覆盖。 */
export function defaultWorkflow(): Workflow {
  return {
    id: "wan-animate2",
    name: "Wan Animate2",
    remoteId: "2096817694862565378",
    revision: 1,
    enabled: true,
    defaults: { width: 480, height: 848, frames: 0, skip: 0 },
    mapping: Object.fromEntries(
      [
        ["width", "709", "value"],
        ["height", "712", "value"],
        ["frames", "746", "value"],
        ["skip", "747", "value"],
        ["image", "189", "image"],
        ["video", "604", "video"],
      ].map(([key, nodeId, fieldName]) => [key, { nodeId, fieldName }]),
    ),
    createdAt: now(),
    updatedAt: now(),
  };
}
/** Go encoding/json 按结构体字段顺序编码并转义 HTML；保留原幂等键，升级后重放不会重复入队。 */
export function fingerprint(request: BatchRequest): string {
  const specs = request.tasks.map((s) => ({
    title: s.title || "",
    workflowId: s.workflowId || "",
    imageId: s.imageId || "",
    videoId: s.videoId || "",
    ...(s.parameters
      ? {
          parameters: {
            ...(s.parameters.instanceType
              ? { instanceType: s.parameters.instanceType }
              : {}),
            width: s.parameters.width ?? 0,
            height: s.parameters.height ?? 0,
            frames: s.parameters.frames ?? 0,
            skip: s.parameters.skip ?? 0,
          },
        }
      : {}),
  }));
  return hash(
    JSON.stringify(specs).replace(
      /[<>&\u2028\u2029]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    ),
  );
}
export class Service {
  private config: Config;
  wake = () => {};
  constructor(readonly store: Store) {
    const path = resolve(store.dir, "config.json");
    this.config = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { baseUrl: "https://www.runninghub.cn" };
    // 先验证密文持久化再移除旧明文；中断重启可重复迁移，不能先删除唯一凭据。
    const secrets = new Secrets(store);
    const saved = secrets.read();
    if (this.config.apiKey) {
      if (!saved) secrets.write(this.config.apiKey);
      writeFileSync(
        path + ".tmp",
        JSON.stringify({ baseUrl: this.config.baseUrl }, null, 2),
        { mode: 0o600 },
      );
      renameSync(path + ".tmp", path);
    }
    delete this.config.apiKey;
    if (!store.get("workflows", "wan-animate2"))
      store.tx(() => store.put("workflows", "wan-animate2", defaultWorkflow()));
    // v3 将批次项目拆为独立作品；事务同时保存双向归属和版本，崩溃后整体回滚。
    store.tx(() => {
      for (const plan of store.list<Plan>("plans")) this.ensureProject(plan);
      store.db.exec("PRAGMA user_version=3");
    });
  }
  /** 每项输入是一个作品；稳定项目 ID 只用于旧数据补齐，已有多任务项目不拆分。 */
  private ensureProject(plan: Plan): void {
    for (const taskId of plan.taskIds) {
      const task = this.store.require<Task>("tasks", taskId);
      if (task.projectId && this.store.get("projects", task.projectId))
        continue;
      const projectId = "project-" + hash(task.id).slice(0, 32);
      const project: Project = {
        id: projectId,
        type: "motion-transfer",
        title: task.title,
        sessionId: task.sessionId,
        taskIds: [task.id],
        createdAt: task.createdAt,
      };
      task.projectId = projectId;
      this.store.put("projects", projectId, project);
      this.store.put("tasks", task.id, task);
    }
    // 仅移除旧实现中与批次同 ID 的项目，不改变历史执行记录与事件序号。
    this.store.delete("projects", plan.id);
  }
  /** 项目全局可见，任务列表仍以数据库保存的归属为准。 */
  projects(): Project[] {
    return this.store
      .list<Project>("projects")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  /** 读取项目实体；未知 ID 抛出业务错误。 */
  project(key: string): Project {
    return this.store.require<Project>("projects", key);
  }
  /** 状态与完成数从任务实时聚合，避免取消、重试后项目摘要失真。 */
  projectSummary(project: Project) {
    const tasks = project.taskIds.map((key) => this.task(key));
    const state =
      tasks.find((t) => !terminal(t.state))?.state ||
      (tasks.some((t) => t.state === "submission_unknown")
        ? "submission_unknown"
        : tasks.some((t) => t.state === "failed")
          ? "failed"
          : tasks.every((t) => t.state === "succeeded")
            ? "succeeded"
            : "cancelled");
    return {
      ...project,
      state,
      completed: tasks.filter((t) => t.state === "succeeded").length,
      totalTasks: tasks.length,
      imageId: tasks[0]?.imageId || "",
    };
  }
  /** 返回仅供后端使用的副本，HTTP 必须另行脱敏。 */
  getConfig(): Config {
    return { ...this.config, apiKey: new Secrets(this.store).read() };
  }
  /** 原子替换配置后才更新内存；空密钥保留原值，不返回浏览器。 */
  saveConfig(value: Config): void {
    const u = new URL(value.baseUrl);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw new Error("RunningHub 地址无效");
    const next = {
      baseUrl: value.baseUrl.replace(/\/+$/, ""),
    };
    const path = resolve(this.store.dir, "config.json");
    if (value.apiKey?.trim())
      new Secrets(this.store).write(value.apiKey.trim());
    writeFileSync(path + ".tmp", JSON.stringify(next, null, 2), {
      mode: 0o600,
    });
    renameSync(path + ".tmp", path);
    this.config = next;
    this.wake();
  }
  /** 返回全部持久化工作流，包含禁用项。 */
  workflows(): Workflow[] {
    return this.store.list("workflows");
  }
  /** 按修订版本保存配置；版本冲突拒绝覆盖，不改变任务快照。 */
  saveWorkflow(w: Workflow): void {
    if (!w.id) w.id = id("wf-");
    if (!w.name || w.name.length > 120) throw new Error("工作流名称无效");
    validateParams(w.defaults);
    if (w.enabled) validateWorkflow(w);
    this.store.tx(() => {
      const old = this.store.get<Workflow>("workflows", w.id);
      if (old && old.revision !== w.revision)
        throw new Error("工作流已修改，请重新加载");
      const next = {
        ...w,
        revision: (old?.revision || 0) + 1,
        createdAt: old?.createdAt || now(),
        updatedAt: now(),
      };
      this.store.put("workflows", w.id, next);
      this.store.event("", w.id, "workflow", "工作流已更新");
    });
  }
  /** 删除定义并写事件，保留历史快照。 */
  deleteWorkflow(key: string): void {
    this.store.tx(() => {
      this.store.delete("workflows", key);
      this.store.event("", key, "workflow", "工作流已删除");
    });
  }
  /** 空会话查询全局可见素材，按实际时间倒序。 */
  assets(session = ""): Asset[] {
    return this.store
      .list<Asset>("assets")
      .filter((a) => !a.deletedAt && (!session || a.sessionId === session))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  /** 批量逻辑删除；任意项无效整体回滚，历史文件保留。 */
  deleteAssets(session: string, ids: string[]): void {
    if (!Array.isArray(ids) || !ids.length || ids.length > 200)
      throw new Error("请选择 1..200 个素材");
    this.store.tx(() => {
      for (const key of ids) {
        const a = this.store.require<Asset>("assets", key);
        if (session && a.sessionId !== session)
          throw new Error("不能删除其他会话的素材");
        if (a.deletedAt) continue;
        a.deletedAt = now();
        this.store.put("assets", key, a);
        this.store.event(a.sessionId, key, "asset", "素材已从素材库移除");
      }
    });
  }
  /** 返回内部快照，公开 API 须隐藏平台上传名与结果地址。 */
  tasks(): Task[] {
    return this.store.list("tasks");
  }
  /** 非空 owner 校验模型会话归属，管理页面可省略。 */
  task(key: string, owner = ""): Task {
    const t = this.store.require<Task>("tasks", key);
    if (owner && owner !== t.sessionId) throw new Error("任务属于其他会话");
    return t;
  }
  /** 按尝试编号返回历史，不覆盖前次生成尝试。 */
  attempts(key: string): Attempt[] {
    return this.store
      .list<Attempt>("attempts")
      .filter((a) => a.taskId === key)
      .sort((a, b) => a.number - b.number);
  }
  /**
   * 把一批用户输入转换为本地计划、项目和任务。
   *
   * 这里故意只做同步数据库操作：素材存在性、素材类型、工作流快照、
   * 稳定请求幂等键和任务初始事件必须在同一事务中完成。RunningHub 容量
   * 查询属于网络操作，不能放进事务，也不能阻止本地入队；调度器之后再
   * 根据最新容量决定何时提交远端任务。重复 requestId 只返回原计划，
   * 因而模型重试或页面重复点击不会产生第二组付费任务。
   */
  admit(r: BatchRequest): Plan {
    if (
      typeof r?.sessionId !== "string" ||
      !r.sessionId ||
      typeof r.requestId !== "string" ||
      !r.requestId ||
      r.requestId.length > 200 ||
      !Array.isArray(r.tasks) ||
      r.tasks.length < 1 ||
      r.tasks.length > 100
    )
      throw new Error("需要会话、稳定请求 ID 和 1..100 项任务");
    const digest = fingerprint(r),
      key = "plan-" + hash(r.sessionId + "\x00" + r.requestId).slice(0, 32);
    const plan = this.store.tx(() => {
      const old = this.store.get<Plan>("plans", key);
      if (old) {
        if (old.fingerprint !== digest)
          throw new Error("请求 ID 已用于不同输入");
        return old;
      }
      const stamp = now();
      const plan: Plan = {
        id: key,
        sessionId: r.sessionId,
        requestId: r.requestId,
        fingerprint: digest,
        taskIds: [],
        createdAt: stamp,
      };
      for (const spec of r.tasks) {
        const w = this.store.require<Workflow>("workflows", spec.workflowId);
        if (!w.enabled) throw new Error("工作流已停用");
        validateWorkflow(w);
        const image = this.store.require<Asset>("assets", spec.imageId),
          video = this.store.require<Asset>("assets", spec.videoId);
        if (
          image.deletedAt ||
          video.deletedAt ||
          image.kind !== "image" ||
          video.kind !== "video"
        )
          throw new Error("素材已删除或不符合图片、视频角色");
        const p = spec.parameters
          ? {
              ...spec.parameters,
              width: spec.parameters.width ?? 0,
              height: spec.parameters.height ?? 0,
              frames: spec.parameters.frames ?? 0,
              skip: spec.parameters.skip ?? 0,
            }
          : w.defaults;
        validateParams(p);
        const title = spec.title?.trim() || "Wan Animate2 动作迁移";
        if (Buffer.byteLength(title) > 300) throw new Error("任务标题过长");
        const t: Task = {
          id: id("task-"),
          planId: key,
          sessionId: r.sessionId,
          title,
          imageId: image.id,
          platform: "runninghub",
          videoId: video.id,
          workflow: w,
          parameters: p,
          state: "queued",
          remoteState: "",
          remoteId: "",
          attempt: 1,
          revision: 1,
          cancelRequested: false,
          error: "",
          errorKind: "",
          failures: 0,
          nextRunAt: stamp,
          createdAt: stamp,
          updatedAt: stamp,
          outputIds: [],
          accountHash: "",
          providerUrl: "",
        };
        this.store.put("tasks", t.id, t);
        plan.taskIds.push(t.id);
        this.store.event(t.sessionId, t.id, "task", "已加入本地队列");
      }
      this.store.put("plans", key, plan);
      this.ensureProject(plan);
      this.store.event(
        plan.sessionId,
        plan.id,
        "project",
        "动作迁移项目已创建",
      );
      return plan;
    });
    this.wake();
    return plan;
  }
  /**
   * 在一个同步事务内应用一次任务状态变化。
   *
   * 调度器在网络操作前后都会重新读取任务，因此取消按钮在网络请求期间
   * 写入的 cancelRequested 不会被旧快照覆盖。attempts 与 tasks 同事务更新，
   * 事件也在同一事务追加。revision/updatedAt 即使没有可观察状态变化也会
   * 更新，但事件只记录真正影响页面、恢复或人工处理的字段，避免轮询制造
   * 重复事件。
   */
  update(key: string, fn: (task: Task) => void): void {
    this.store.tx(() => {
      const t = this.task(key),
        previous = {
          state: t.state,
          remoteState: t.remoteState,
          remoteId: t.remoteId,
          error: t.error,
          errorKind: t.errorKind,
          cancelRequested: t.cancelRequested,
          outputIds: [...t.outputIds],
        };
      fn(t);
      t.updatedAt = now();
      t.revision++;
      this.store.put("tasks", key, t);
      if (!["queued", "uploading"].includes(t.state)) {
        const aid = `${key}-${t.attempt}`,
          old = this.store.get<Attempt>("attempts", aid);
        this.store.put("attempts", aid, {
          id: aid,
          taskId: key,
          number: t.attempt,
          state: t.state,
          remoteId: t.remoteId,
          error: t.error,
          createdAt: old?.createdAt || t.createdAt,
          updatedAt: t.updatedAt,
        });
      }
      // 调度器每次轮询都会调用 update，但轮询本身不是用户可观察的事件。
      // 只有真正影响任务展示、恢复或操作结果的字段发生变化时才追加事件，
      // 否则一个远端任务在等待几十分钟时会产生数百条完全相同的事件。
      const changed =
        previous.state !== t.state ||
        previous.remoteState !== t.remoteState ||
        previous.remoteId !== t.remoteId ||
        previous.error !== t.error ||
        previous.errorKind !== t.errorKind ||
        previous.cancelRequested !== t.cancelRequested ||
        JSON.stringify(previous.outputIds) !== JSON.stringify(t.outputIds);
      const terminalChanged = previous.state !== t.state && terminal(t.state);
      if (!changed) return;
      this.store.event(
        t.sessionId,
        key,
        "task",
        `${t.title}: ${t.state}${t.error ? " — " + t.error : ""}`,
        terminalChanged && ["failed", "submission_unknown"].includes(t.state),
      );
      if (!terminalChanged) return;
      const plan = this.store.require<Plan>("plans", t.planId),
        counts: Record<string, number> = {};
      for (const tid of plan.taskIds) {
        const item = this.task(tid);
        if (!terminal(item.state)) return;
        counts[item.state] = (counts[item.state] || 0) + 1;
      }
      this.store.event(
        t.sessionId,
        plan.id,
        "batch",
        `批次 ${plan.id} 已结束：成功 ${counts.succeeded || 0}，失败 ${counts.failed || 0}，取消 ${counts.cancelled || 0}，待核对 ${counts.submission_unknown || 0}。`,
        true,
      );
    });
  }
  /** 先保存取消意图；仅尚未提交的本地等待任务直接取消。 */
  cancel(key: string, owner = ""): void {
    this.task(key, owner);
    this.update(key, (t) => {
      if (terminal(t.state)) throw new Error("任务已结束或需要核对");
      t.cancelRequested = true;
      t.nextRunAt = now();
      if (t.state === "queued") t.state = "cancelled";
    });
    this.wake();
  }
  /** 仅当前失败版本允许人工重试；旧 revision 和双击均拒绝。 */
  retry(key: string, owner: string, revision: number): void {
    this.task(key, owner);
    this.update(key, (t) => {
      if (t.state !== "failed" || t.revision !== revision)
        throw new Error("只能重试当前版本的失败任务");
      Object.assign(t, {
        state: "queued",
        attempt: t.attempt + 1,
        remoteId: "",
        remoteState: "",
        accountHash: "",
        providerUrl: "",
        cancelRequested: false,
        error: "",
        errorKind: "",
        failures: 0,
        outputIds: [],
        nextRunAt: now(),
      });
      delete t.results;
      delete t.uploads;
    });
    this.wake();
  }
  /** 人工绑定核对后的远端 ID，恢复查询而非重新创建。 */
  reconcile(key: string, remoteId: string): void {
    if (!remoteId || remoteId.length > 100) throw new Error("需要远端任务 ID");
    this.update(key, (t) => {
      if (t.state !== "submission_unknown")
        throw new Error("任务不处于待核对状态");
      t.remoteId = remoteId;
      t.state = "remote_pending";
      t.error = "";
      t.nextRunAt = now();
    });
    this.wake();
  }
}
