# 重启 Windows 源码版 DSH；使用 Atelier 托管记录核验身份，不接管外部服务。
# 示例：.\scripts\restart-dsh.ps1；只检查：.\scripts\restart-dsh.ps1 -WhatIf
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$DshSource = 'E:\project\deepseek-harness',
    [string]$DataDir = "$PSScriptRoot\..\.runtime\default",
    # 已配置的 DSH 监听端口，仅用于占用检查；不修改 DSH 配置。
    [ValidateRange(1, 65535)][int]$WebPort = 3080,
    [ValidateRange(10, 300)][int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$atelierRoot = (Resolve-Path -LiteralPath "$PSScriptRoot\..").Path
$sourcePath = (Resolve-Path -LiteralPath $DshSource).Path
$dataPath = [IO.Path]::GetFullPath($DataDir)
$entryPath = Join-Path $atelierRoot 'plugin\lib\backend.mjs'
$recordPath = Join-Path $dataPath 'managed-process.json'
$pnpmPath = (Get-Command pnpm.cmd -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'apps\cli\src\bin.ts'))) {
    throw 'DSH 源码目录无效。'
}
if (-not (Test-Path -LiteralPath $entryPath)) { throw '插件尚未构建，请先执行 scripts/build.ps1 -NoRestart。' }

# 打开进程句柄后比较启动时间、可执行路径和完整命令行，防止 PID 复用误伤其他实例。
# 返回的句柄由调用方释放；目标已退出则返回空，身份不一致则抛出异常。
function Get-VerifiedProcess($Identity) {
    $process = Get-Process -Id ([int]$Identity.pid) -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    try {
        $null = $process.Handle
        $cim = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $process.Id)
        if ($process.HasExited -or $null -eq $cim) { $process.Dispose(); return $null }
        if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne $Identity.started -or
            $process.Path -ine $Identity.path -or $cim.CommandLine -cne $Identity.command) {
            throw "进程 $($Identity.pid) 身份不一致，拒绝停止。"
        }
        return $process
    } catch { $process.Dispose(); throw }
}

$hostProcess = $null
$backendProcess = $null
try {
    if (Test-Path -LiteralPath $recordPath) {
        $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        if ([IO.Path]::GetFullPath($record.dataDir) -ine $dataPath -or
            [IO.Path]::GetFullPath($record.entry) -ine $entryPath -or
            $record.process.command -notmatch '--parent-pipe' -or
            $record.parent.command -notmatch 'apps[\\/]cli[\\/](src[\\/]bin\.ts|lib[\\/]bin\.js).*web') {
            throw '托管记录不是当前源码插件的 DSH 实例，拒绝接管。'
        }
        $hostProcess = Get-VerifiedProcess $record.parent
        $backendProcess = Get-VerifiedProcess $record.process
    }
    $listeners = @(Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        if ($null -eq $hostProcess -or $listener.OwningProcess -ne $hostProcess.Id) {
            throw "端口 $WebPort 被未核验的进程占用，拒绝停止或重复启动。"
        }
    }
    if ($backendProcess -and -not $hostProcess) {
        throw '发现孤立后端。请先通过插件的身份核验清理流程处理，脚本不会强制结束它。'
    }
    if (-not $PSCmdlet.ShouldProcess("DSH $sourcePath，端口 $WebPort", '停止已核验实例并重新启动')) { return }

    if ($hostProcess) {
        Write-Host "停止已核验的 DSH，PID $($hostProcess.Id)..."
        # Windows 没有可移植的 SIGTERM。仅结束已核验 Host，后端通过专属父管道 EOF 有序退出。
        # 不使用 /T 杀树，以免打断后端 SQLite 提交和文件归档。
        Stop-Process -InputObject $hostProcess -Force
        if (-not $hostProcess.WaitForExit($TimeoutSeconds * 1000)) { throw 'DSH 退出超时。' }
        if ($backendProcess -and -not $backendProcess.WaitForExit($TimeoutSeconds * 1000)) {
            throw '后端未在期限内退出，已停止重启流程；不要删除数据库或锁文件。'
        }
    }
    $logDir = Join-Path $atelierRoot '.runtime'
    [IO.Directory]::CreateDirectory($logDir) | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdout = Join-Path $logDir "dsh-$stamp.stdout.log"
    $stderr = Join-Path $logDir "dsh-$stamp.stderr.log"
    $launch = Start-Process -FilePath $pnpmPath -ArgumentList @('dsh', 'web') -WorkingDirectory $sourcePath -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 500
        $output = Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue
        if ($output -match 'https?://(?:127\.0\.0\.1|localhost):\d+/\?token=[^\s]+') {
            $url = $Matches[0]
            # 就绪不仅看启动日志，还确认新托管进程记录与本机后端健康响应。
            if (Test-Path -LiteralPath $recordPath) {
                $current = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
                $probe = Get-VerifiedProcess $current.process
                if ($probe) {
                    try {
                        if ($current.process.command -match '--listen\s+(127\.0\.0\.1:\d+)') {
                            $health = Invoke-RestMethod -Uri "http://$($Matches[1])/health" -TimeoutSec 3
                            if ($health.runtime -eq 'node' -and $health.status -eq 'ok') {
                                Write-Host "DSH 与 Node 后端已就绪：$url"
                                Write-Host "日志：$stdout`n错误日志：$stderr"
                                return
                            }
                        }
                    } finally { $probe.Dispose() }
                }
            }
        }
        if ($launch.HasExited) { throw "启动进程已退出，请查看 $stderr" }
    } while ((Get-Date) -lt $deadline)
    throw "等待服务就绪超时。新进程可能仍在启动，请查看 $stdout 和 $stderr；勿重复启动。"
} finally {
    if ($hostProcess) { $hostProcess.Dispose() }
    if ($backendProcess) { $backendProcess.Dispose() }
}
