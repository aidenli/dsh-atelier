# 启动独立后端；API 无需令牌，RunningHub 密钥由后端配置读取。
param([string]$DataDir = "$PSScriptRoot\..\.runtime\default", [string]$Listen = "127.0.0.1:8787")
$ErrorActionPreference = 'Stop'
$atelierRoot = (Resolve-Path "$PSScriptRoot\..").Path
$dataPath = [System.IO.Path]::GetFullPath($DataDir)
[System.IO.Directory]::CreateDirectory($dataPath) | Out-Null
# Windows 的 Unix mode 不限制 ACL；显式移除继承，仅保留当前用户完整控制。
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $dataPath /inheritance:r /grant:r "${account}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw '运行目录权限设置失败' }
$entry = Join-Path $atelierRoot 'plugin\lib\backend.mjs'
if (-not (Test-Path -LiteralPath $entry)) { throw '请先执行 node scripts/build-plugin.mjs' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $nodePath -ArgumentList @("`"$entry`"", '--data', "`"$dataPath`"", '--listen', $Listen) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'backend.stdout.log') -RedirectStandardError (Join-Path $dataPath 'backend.stderr.log') -PassThru | Select-Object Id
