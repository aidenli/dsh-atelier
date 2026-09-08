/** 首次迁移保护：旧 Go 的 flock 与 Node SQLite 锁不互通，必须独立排查旧实例。 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
/** 仅检查，不终止旧进程。无法获得身份信息时拒绝迁移，避免并行写入同一数据库。 */
export async function assertLegacyStopped(dir: string): Promise<void> {
  if (!existsSync(resolve(dir, "service.lock"))) return;
  if (process.platform === "win32") {
    const { stdout } = await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='atelier.exe'\" | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 15000 },
    );
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of processes) {
      // 旧程序允许相对 --data；不能可靠解析时采用保守拒绝，不猜测路径或按名称杀进程。
      if (!item.CommandLine)
        throw new Error("无法核验旧 Go 进程，请先正常停止旧服务");
      const args =
        String(item.CommandLine)
          .match(/(?:"[^"]*"|[^\s"])+/g)
          ?.map((v) => v.replace(/^"|"$/g, "")) || [];
      const at = args.indexOf("--data");
      const path = at >= 0 ? args[at + 1] : undefined;
      if (
        !path ||
        !/^(?:[a-z]:[\\/]|\\\\)/i.test(path) ||
        resolve(path).toLowerCase() === resolve(dir).toLowerCase()
      )
        throw new Error("旧 Go 后端可能仍使用此目录，请先正常停止旧服务");
    }
  } else if (process.platform === "darwin") {
    const { stdout } = await execute("/bin/ps", ["-axo", "comm=,args="], {
      timeout: 10000,
    });
    if (
      stdout
        .split("\n")
        .some((line) =>
          /(?:^|\/)atelier(?:\s|$)/.test(line.trim().split(/\s+/)[0] || ""),
        )
    )
      throw new Error("检测到旧 Go 后端，请先正常停止后再迁移");
  } else throw new Error("此平台尚不支持旧 Go 数据目录的迁移核验");
}
