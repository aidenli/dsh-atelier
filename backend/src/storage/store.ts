/** SQLite 实体存储：沿用 Go 的表结构，事务不得跨越异步操作。 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Event } from "../media/types.js";
const tables = new Set([
  "workflows",
  "assets",
  "plans",
  "tasks",
  "attempts",
  "projects",
]);
function table(name: string) {
  if (!tables.has(name)) throw new Error("非法实体表");
  return name;
}
export class Store {
  readonly dir: string;
  readonly db: DatabaseSync;
  private readonly lock: DatabaseSync;
  /** 打开目录并获得独占锁；另一个 Node 实例占用时立即失败，关闭连接由 OS 释放锁。 */
  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.lock = new DatabaseSync(resolve(this.dir, "node-service-lock.sqlite"));
    let opened: DatabaseSync | undefined;
    try {
      this.lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
      this.db = opened = new DatabaseSync(resolve(this.dir, "media.sqlite"));
      const version = this.db.prepare("PRAGMA user_version").get()!
        .user_version as number;
      if (version > 3) throw new Error(`不支持数据库版本 ${version}`);
      this.db
        .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS secrets(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,entity_id TEXT NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,notify INTEGER NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS event_notifications ON events(notify,delivered,seq);
        CREATE INDEX IF NOT EXISTS task_state ON tasks(json_extract(body,'$.state'));
        CREATE INDEX IF NOT EXISTS task_session ON tasks(json_extract(body,'$.sessionId'));
        `);
    } catch (error) {
      opened?.close();
      this.lock.close();
      throw error;
    }
  }
  /** 写事务要么完整提交，要么回滚；返回 Promise 属于调用错误，禁止提前提交。 */
  tx<T>(fn: () => T): T {
    if (fn.constructor.name === "AsyncFunction")
      throw new Error("事务中禁止异步操作");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      if (value && typeof (value as { then?: unknown }).then === "function")
        throw new Error("事务中禁止异步操作");
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /** 查询实体；不存在返回 undefined，存储或 JSON 错误直接抛出。 */
  get<T>(name: string, id: string): T | undefined {
    const row = this.db
      .prepare(`SELECT body FROM ${table(name)} WHERE id=?`)
      .get(id);
    return row ? (JSON.parse(row.body as string) as T) : undefined;
  }
  /** 获取必须存在的实体；不存在抛出业务错误。 */
  require<T>(name: string, id: string): T {
    const value = this.get<T>(name, id);
    if (!value) throw new Error("记录不存在");
    return value;
  }
  /** 单用户场景读取完整集合，过滤和排序交给业务层。 */
  list<T>(name: string): T[] {
    return this.db
      .prepare(`SELECT body FROM ${table(name)}`)
      .all()
      .map((row) => JSON.parse(row.body as string));
  }
  /** 调用方负责事务；表名白名单和绑定参数阻止动态 SQL 输入。 */
  put(name: string, id: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO ${table(name)}(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`,
      )
      .run(id, JSON.stringify(value));
  }
  /** 仅物理删除配置，素材历史使用业务层逻辑删除。 */
  delete(name: string, id: string): void {
    this.db.prepare(`DELETE FROM ${table(name)} WHERE id=?`).run(id);
  }
  /** 在实体事务中追加脱敏事件，通知标志与页面消费无关。 */
  event(
    session: string,
    entity: string,
    kind: string,
    message: string,
    notify = false,
  ): void {
    this.db
      .prepare(
        "INSERT INTO events(session_id,entity_id,kind,message,notify,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        session,
        entity,
        kind,
        message,
        Number(notify),
        new Date().toISOString(),
      );
  }
  /** 按递增游标读取最多两百条，通知模式只返回待确认事件。 */
  events(after: number, notifications = false): Event[] {
    return this.db
      .prepare(
        `SELECT * FROM events WHERE seq>? ${notifications ? "AND notify=1 AND delivered=0" : ""} ORDER BY seq LIMIT 200`,
      )
      .all(after)
      .map((r) => ({
        seq: Number(r.seq),
        sessionId: String(r.session_id),
        entityId: String(r.entity_id),
        kind: String(r.kind),
        message: String(r.message),
        notify: Boolean(r.notify),
        delivered: Boolean(r.delivered),
        createdAt: String(r.created_at),
      }));
  }
  /** Host 已持久化消息后确认投递，重复调用不产生额外事件。 */
  acknowledge(seq: number): void {
    this.db.prepare("UPDATE events SET delivered=1 WHERE seq=?").run(seq);
  }
  /** 调度器与 HTTP 都停止后才能释放锁，防止新旧实例交叉写入。 */
  close(): void {
    this.db.close();
    this.lock.close();
  }
}
