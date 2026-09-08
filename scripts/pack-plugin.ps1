# 打包前由 prepack 编译前后端；只通过 package.json 的 files 白名单收集发布文件。
# 发布包不包含本机数据、令牌或 RunningHub 密钥，安装端不需要 Go 工具链。
param([string]$DshSource = "$PSScriptRoot\..\..\..\deepseek-harness", [string]$Target = 'universal')
$ErrorActionPreference = 'Stop'
$atelierRoot = (Resolve-Path "$PSScriptRoot\..").Path
$env:DSH_SOURCE = $DshSource
[System.IO.Directory]::CreateDirectory((Join-Path $atelierRoot 'dist')) | Out-Null
Push-Location $atelierRoot
try {
    node scripts/pack-plugin.mjs --target $Target
    if ($LASTEXITCODE -ne 0) { throw '插件打包失败' }
} finally { Pop-Location }
