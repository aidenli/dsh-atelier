/** 流式素材归档：先验证完整文件，再原子改名，最后登记 SQLite。 */
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  rm,
  stat,
  open,
  rename,
  realpath,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, basename, join } from "node:path";
import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Service, id, hash } from "./service.js";
import { now, type Asset, type Task } from "./types.js";
export const maxFileBytes = 30 * 1024 * 1024;
/** 只检查受支持格式的文件头，不承诺时长、实际分辨率或可解码性。 */
export function detect(
  head: Buffer,
  size: number,
): { kind: string; mime: string; ext: string } {
  if (
    head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { kind: "image", mime: "image/png", ext: ".png" };
  if (head[0] === 255 && head[1] === 216 && head[2] === 255)
    return { kind: "image", mime: "image/jpeg", ext: ".jpg" };
  if (
    head.toString("ascii", 0, 4) === "RIFF" &&
    head.toString("ascii", 8, 12) === "WEBP"
  )
    return { kind: "image", mime: "image/webp", ext: ".webp" };
  if (head.length >= 16 && head.toString("ascii", 4, 8) === "ftyp") {
    const length = head.readUInt32BE(0);
    if (length >= 16 && length % 4 === 0 && length <= size) {
      const brands = head.toString("ascii", 8, Math.min(length, head.length));
      if (brands.startsWith("qt  "))
        return { kind: "video", mime: "video/quicktime", ext: ".mov" };
      if (brands.includes("mp4"))
        return { kind: "video", mime: "video/mp4", ext: ".mp4" };
    }
  }
  if (
    head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    head.includes(Buffer.from("webm"))
  )
    return { kind: "video", mime: "video/webm", ext: ".webm" };
  throw new Error("不支持的文件内容（PNG/JPEG/WebP/MP4/WebM/QuickTime）");
}
export class Files {
  constructor(readonly service: Service) {}
  /** 获得服务独占权后才清理自身临时文件；原子改名后的孤立输出保留以供恢复。 */
  async initialize(): Promise<void> {
    const dir = resolve(this.service.store.dir, "files");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(dir, { withFileTypes: true }))
      if (entry.isFile() && entry.name.startsWith(".incoming-"))
        await rm(resolve(dir, entry.name));
  }
  async asset(
    key: string,
    owner = "",
  ): Promise<{ asset: Asset; path: string }> {
    const asset = this.service.store.require<Asset>("assets", key);
    if (owner && asset.sessionId !== owner) throw new Error("素材属于其他会话");
    const root = this.service.store.dir,
      path = resolve(root, asset.path),
      rel = relative(root, path);
    if (isAbsolute(asset.path) || rel.startsWith("..") || isAbsolute(rel))
      throw new Error("非法素材路径");
    const actual = await realpath(path),
      actualRel = relative(await realpath(root), actual);
    if (actualRel.startsWith("..") || isAbsolute(actualRel))
      throw new Error("素材路径越界");
    const info = await stat(path);
    if (!info.isFile() || info.size !== asset.size)
      throw new Error("素材文件缺失或长度不一致");
    return { asset, path };
  }
  async importReference(
    session: string,
    path: string,
    sourceId = "",
    name = "",
  ): Promise<Asset> {
    const key = sourceId
      ? "asset-" + hash(session + "\x00" + sourceId).slice(0, 32)
      : id("asset-");
    if (sourceId)
      try {
        return (await this.asset(key, session)).asset;
      } catch {
        /* 已丢失的文件可从明确提供的路径重新导入。 */
      }
    if (!isAbsolute(path) || (await stat(path)).isFile() === false)
      throw new Error("需要普通文件的绝对路径");
    return this.importAs(
      key,
      session,
      name || basename(path),
      createReadStream(path),
    );
  }
  import(session: string, name: string, stream: Readable): Promise<Asset> {
    return this.importAs(id("asset-"), session, name, stream);
  }
  importOutput(
    task: Task,
    index: number,
    stream: Readable,
    expected?: number,
  ): Promise<Asset> {
    return this.importAs(
      `output-${task.id}-${task.attempt}-${index}`,
      task.sessionId,
      `${task.title}-${index + 1}.mp4`,
      stream,
      expected,
    );
  }
  /** expected 校验必须发生在改名前；失败仅清理本次临时文件，历史归档不删除。 */
  async importAs(
    key: string,
    session: string,
    name: string,
    stream: Readable,
    expected?: number,
  ): Promise<Asset> {
    if (!session) throw new Error("需要来源会话");
    const dir = resolve(this.service.store.dir, "files");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = resolve(dir, id(".incoming-"));
    let size = 0;
    const digest = createHash("sha256");
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > maxFileBytes) return done(new Error("文件超过 512 MiB"));
        digest.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        stream,
        counter,
        createWriteStream(tmp, { flags: "wx", mode: 0o600 }),
      );
      if (
        !size ||
        (expected !== undefined && expected >= 0 && size !== expected)
      )
        throw new Error("文件为空或下载不完整");
      const file = await open(tmp, "r+");
      let head: Buffer;
      try {
        const buf = Buffer.alloc(512),
          read = await file.read(buf, 0, 512, 0);
        head = buf.subarray(0, read.bytesRead);
        await file.sync();
      } finally {
        await file.close();
      }
      const format = detect(head, size);
      if (key.startsWith("output-") && format.kind !== "video")
        throw new Error("工作流输出不是视频");
      const path = join("files", key + format.ext);
      await rename(tmp, resolve(this.service.store.dir, path));
      const asset: Asset = {
        id: key,
        sessionId: session,
        name: basename(name.replace(/\\/g, "/")),
        kind: format.kind,
        mime: format.mime,
        size,
        sha256: digest.digest("hex"),
        path,
        createdAt: now(),
      };
      this.service.store.tx(() => {
        this.service.store.put("assets", key, asset);
        this.service.store.event(session, key, "asset", "素材已保存");
      });
      return asset;
    } finally {
      await rm(tmp, { force: true });
    }
  }
}
