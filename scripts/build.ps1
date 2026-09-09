# 完整构建入口；前后端依赖、类型检查和测试分别执行，任何一步失败立即停止。
param([string]$DshSource = 'E:\project\deepseek-harness', [switch]$NoRestart)
$ErrorActionPreference = 'Stop'
$atelierRoot = (Resolve-Path "$PSScriptRoot\..").Path
$env:DSH_SOURCE = $DshSource
Push-Location (Join-Path $atelierRoot 'backend')
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败' }
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw '后端构建失败' }
    pnpm test
    if ($LASTEXITCODE -ne 0) { throw '后端测试失败' }
} finally { Pop-Location }
Push-Location (Join-Path $atelierRoot 'frontend')
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败' }
    pnpm typecheck
    if ($LASTEXITCODE -ne 0) { throw '前端类型检查失败' }
} finally { Pop-Location }
Push-Location $atelierRoot
try {
    node scripts/internal/build-plugin.mjs
    if ($LASTEXITCODE -ne 0) { throw 'DSH 插件构建失败' }
    & .\frontend\node_modules\.bin\tsc.cmd -p plugin/tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw 'Host 类型检查失败' }
    & .\frontend\node_modules\.bin\tsc.cmd -p plugin/tsconfig.client.json
    if ($LASTEXITCODE -ne 0) { throw 'Client 类型检查失败' }
    node tests/scripts/test-plugin.mjs
    if ($LASTEXITCODE -ne 0) { throw '插件测试失败' }
} finally { Pop-Location }
if (-not $NoRestart) { & "$PSScriptRoot\restart-dsh.ps1" -DshSource $DshSource }
