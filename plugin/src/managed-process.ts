/** 托管进程身份核验：Windows 使用 CIM，macOS 使用系统 ps，不按进程名或端口批量结束。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const execute = promisify(execFile);
interface Identity {
  pid: number;
  started: string;
  path: string;
  command: string;
}
interface Record {
  entry?: string;
  platform?: string;
  process: Identity;
  parent: Identity;
  dataDir: string;
}

/** 在一个 PowerShell 调用内打开进程句柄、比对身份再停止，防止旧 PID 误伤新进程。 */
async function inspect(
  pid: number,
  expected?: Identity,
): Promise<Identity | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("托管进程 PID 无效");
  if (process.platform === "darwin") return inspectMac(pid, expected);
  if (process.platform !== "win32")
    throw new Error("不支持此系统的托管进程核验");
  const script = `
$ErrorActionPreference = 'Stop'
$p = Get-Process -Id ([int]$env:ATELIER_PROCESS_PID) -ErrorAction SilentlyContinue
if ($null -eq $p) { Write-Output 'null'; exit }
try {
  $handle = $p.Handle
  $c = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $p.Id)
  if ($p.HasExited -or $null -eq $c) { Write-Output 'null'; exit }
  $identity = @{pid=$p.Id; started=$p.StartTime.ToUniversalTime().Ticks.ToString(); path=$p.Path; command=$c.CommandLine}
  if ($env:ATELIER_PROCESS_EXPECTED) {
    $e = $env:ATELIER_PROCESS_EXPECTED | ConvertFrom-Json
    if ($identity.started -ne $e.started -or $identity.path -ne $e.path -or $identity.command -cne $e.command) { throw '进程身份已经变化，拒绝停止' }
    Stop-Process -InputObject $p -Force
    if (-not $p.WaitForExit(20000)) { throw '等待旧进程退出超时' }
  }
  $identity | ConvertTo-Json -Compress
} finally { $p.Dispose() }
`;
  const { stdout } = await execute(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      timeout: 30_000,
      env: {
        ...process.env,
        ATELIER_PROCESS_PID: String(pid),
        ATELIER_PROCESS_EXPECTED: expected ? JSON.stringify(expected) : "",
      },
    },
  );
  return JSON.parse(stdout.trim());
}

/** macOS ps 使用固定语言和不截断输出；任何读取失败均不猜测身份。 */
async function inspectMac(
  pid: number,
  expected?: Identity,
): Promise<Identity | null> {
  const field = async (name: string) => {
    try {
      const { stdout } = await execute(
        "/bin/ps",
        ["-ww", "-p", String(pid), "-o", `${name}=`],
        { env: { ...process.env, LC_ALL: "C" }, timeout: 5000 },
      );
      return stdout.trim();
    } catch (error) {
      if ((error as { code?: number }).code === 1) return "";
      throw error;
    }
  };
  const started = await field("lstart");
  if (!started || (await field("stat")).startsWith("Z")) return null;
  const identity = {
    pid,
    started,
    path: await field("comm"),
    command: await field("command"),
  };
  if (
    !identity.path ||
    !identity.command ||
    (await field("lstart")) !== started
  )
    throw new Error("进程身份读取期间发生变化，拒绝接管");
  if (expected) {
    if (JSON.stringify(identity) !== JSON.stringify(expected))
      throw new Error("进程身份已经变化，拒绝停止");
    // 发信号前重读完整身份；无法确认时不发送信号。仅停止已确认孤立的本插件进程。
    const latest = await inspectMac(pid);
    if (!latest || JSON.stringify(latest) !== JSON.stringify(identity))
      throw new Error("进程身份已经变化，拒绝停止");
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 100; i++) {
      const current = await inspectMac(pid);
      if (!current || current.started !== started) return identity;
      await delay(200);
    }
    throw new Error("旧后端未在 20 秒内退出，请人工检查；未强制结束不确定进程");
  }
  return identity;
}

const recordPath = (dir: string) => resolve(dir, "managed-process.json");

/** 清理身份匹配的孤立进程；原 Host 仍存活时拒绝接管，外部服务不调用此方法。 */
export async function reapManagedProcess(
  dataDir: string,
  binary: string,
  entry?: string,
): Promise<void> {
  let record: Record;
  try {
    record = JSON.parse(await readFile(recordPath(dataDir), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("托管进程记录损坏，请检查 managed-process.json");
  }
  const current = await inspect(record.process.pid);
  // 旧 Go 记录只在原进程已退出时移除；迁移时不主动结束仍在执行的旧服务。
  const alive =
    current &&
    current.started === record.process.started &&
    current.path === record.process.path &&
    current.command === record.process.command;
  if (!record.entry && entry && alive)
    throw new Error("旧 Go 后端仍在运行，请先正常停止旧 DSH 再切换 Node 后端");
  if (!alive && record.dataDir === dataDir) {
    await rm(recordPath(dataDir), { force: true });
    return;
  }
  if (
    (entry !== undefined && record.entry !== entry) ||
    (record.platform !== undefined && record.platform !== process.platform) ||
    record.dataDir !== dataDir ||
    (process.platform === "win32"
      ? resolve(record.process.path).toLowerCase() !==
        resolve(binary).toLowerCase()
      : resolve(record.process.path) !== resolve(binary))
  )
    throw new Error("托管进程记录与当前目录或程序不匹配，拒绝接管");
  if (
    current &&
    current.started === record.process.started &&
    current.path === record.process.path &&
    current.command === record.process.command
  ) {
    const parent = await inspect(record.parent.pid);
    if (parent && parent.started === record.parent.started)
      throw new Error("此数据目录的托管后端仍由另一个 DSH 实例管理");
    await inspect(current.pid, record.process);
  }
  // 记录过期或 PID 已复用时只删除记录，不接触当前进程。
  await rm(recordPath(dataDir), { force: true });
}

/** 保存系统读取的实际启动身份，数据目录通过记录绑定，命令行比较防止错误接管。 */
export async function recordManagedProcess(
  dataDir: string,
  pid: number,
  entry?: string,
): Promise<void> {
  const child = await inspect(pid);
  const parent = await inspect(process.pid);
  if (!child || !parent) throw new Error("托管后端在登记前退出");
  const path = recordPath(dataDir);
  await writeFile(
    path + ".tmp",
    JSON.stringify({
      platform: process.platform,
      process: child,
      parent,
      dataDir,
      entry,
    }),
    { mode: 0o600 },
  );
  await rename(path + ".tmp", path);
}
