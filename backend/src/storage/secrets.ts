/** 系统保护随机主密钥；子进程仅通过 stdin/stdout 传输秘密，不使用环境变量或命令行参数。 */
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Store } from "./store.js";

/** 所有底层错误统一脱敏，禁止把包含 stdin/stdout 的子进程异常返回客户端。 */
function command(file: string, args: string[], input?: string): string {
  const result = spawnSync(file, args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "系统密钥存储不可用，请检查当前系统账号与凭据权限；原密钥未覆盖",
    );
  return result.stdout.trim();
}

/** 获取目录独立的主密钥；已有密文时禁止因系统密钥丢失而自动生成替代值。 */
function masterKey(dir: string, existing: boolean): Buffer {
  if (process.platform === "win32") {
    const path = resolve(dir, "master-key.dpapi");
    const present = existsSync(path);
    if (!present && existing)
      throw new Error(
        "系统主密钥文件丢失，无法解密 API Key；请恢复原账号的密钥文件",
      );
    const mode = present ? "Unprotect" : "Protect";
    const input = present
      ? readFileSync(path, "utf8")
      : randomBytes(32).toString("base64");
    const output = command(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $v=[Security.Cryptography.ProtectedData]::${mode}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($v))`,
      ],
      input,
    );
    if (present) return Buffer.from(output, "base64");
    writeFileSync(path + ".tmp", output, { mode: 0o600 });
    renameSync(path + ".tmp", path);
    return Buffer.from(input, "base64");
  }
  if (process.platform === "darwin") {
    const account = createHash("sha256").update(resolve(dir)).digest("hex");
    const args = [
      "find-generic-password",
      "-s",
      "dsh-atelier.master.v1",
      "-a",
      account,
      "-w",
    ];
    const found = spawnSync("/usr/bin/security", args, {
      encoding: "utf8",
      timeout: 15000,
    });
    if (found.status === 0) return Buffer.from(found.stdout.trim(), "hex");
    if (existing || found.status !== 44)
      throw new Error(
        "Keychain 主密钥不可用，请解锁或恢复原系统钥匙串；原密钥未覆盖",
      );
    const key = randomBytes(32);
    // security 交互模式从私有管道读取命令，主密钥不会出现在 ps 的参数列表中。
    command(
      "/usr/bin/security",
      ["-i"],
      `add-generic-password -s dsh-atelier.master.v1 -a ${account} -w ${key.toString("hex")}\n`,
    );
    const saved = Buffer.from(command("/usr/bin/security", args), "hex");
    if (!saved.equals(key)) throw new Error("Keychain 主密钥保存校验失败");
    return key;
  }
  throw new Error("加密凭据仅支持 Windows 和 macOS");
}

/** AES-GCM 密文独立保存；每次写入随机 nonce，认证标签同时验证内容完整性。 */
export class Secrets {
  constructor(private readonly store: Store) {}
  read(): string {
    const row = this.store.db
      .prepare("SELECT body FROM secrets WHERE id='runninghub'")
      .get();
    if (!row) return "";
    const key = masterKey(this.store.dir, true);
    try {
      const value = JSON.parse(String(row.body));
      if (value.version !== 1 || key.length !== 32) throw new Error();
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(value.nonce, "base64"),
      );
      cipher.setAAD(Buffer.from("atelier:runninghub:v1"));
      cipher.setAuthTag(Buffer.from(value.tag, "base64"));
      return Buffer.concat([
        cipher.update(Buffer.from(value.data, "base64")),
        cipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("API Key 解密失败，密文或主密钥不匹配；原数据未覆盖");
    } finally {
      key.fill(0);
    }
  }
  write(secret: string): void {
    const existing = Boolean(
      this.store.db
        .prepare("SELECT id FROM secrets WHERE id='runninghub'")
        .get(),
    );
    if (existing) this.read();
    const key = masterKey(this.store.dir, existing);
    try {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from("atelier:runninghub:v1"));
      const data = Buffer.concat([
        cipher.update(secret, "utf8"),
        cipher.final(),
      ]);
      const body = JSON.stringify({
        version: 1,
        nonce: nonce.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      });
      this.store.tx(() =>
        this.store.db
          .prepare(
            "INSERT INTO secrets(id,body) VALUES('runninghub',?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
          )
          .run(body),
      );
      if (this.read() !== secret) throw new Error("API Key 保存校验失败");
    } finally {
      key.fill(0);
    }
  }
}
