# Windows 构建入口；仅构建 Node 后端、React 前端和 DSH 插件。
param([string]$DshSource = 'E:\project\deepseek-harness', [switch]$NoRestart)
$ErrorActionPreference = 'Stop'
$atelierRoot = (Resolve-Path "$PSScriptRoot\..").Path
pnpm --dir (Join-Path $atelierRoot 'backend') install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败' }
pnpm --dir (Join-Path $atelierRoot 'frontend') install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败' }
pnpm --dir (Join-Path $atelierRoot 'backend') build
if ($LASTEXITCODE -ne 0) { throw 'Node 后端构建失败' }
pnpm --dir (Join-Path $atelierRoot 'backend') test
if ($LASTEXITCODE -ne 0) { throw 'Node 后端测试失败' }
pnpm --dir (Join-Path $atelierRoot 'frontend') typecheck
if ($LASTEXITCODE -ne 0) { throw '前端类型检查失败' }
Push-Location $atelierRoot
try {
    node scripts/internal/build-plugin.mjs
    if ($LASTEXITCODE -ne 0) { throw 'DSH 插件构建失败' }
    node frontend/node_modules/typescript/bin/tsc -p plugin/tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw 'Host 类型检查失败' }
    node frontend/node_modules/typescript/bin/tsc -p plugin/tsconfig.client.json
    if ($LASTEXITCODE -ne 0) { throw 'Client 类型检查失败' }
    node tests/scripts/test-plugin.mjs
    if ($LASTEXITCODE -ne 0) { throw '插件测试失败' }
} finally { Pop-Location }
if (-not $NoRestart) { & "$PSScriptRoot\restart-dsh.ps1" -DshSource $DshSource }
