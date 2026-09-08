# 安装到既有 web profile，不覆盖用户原来的 patch 或 settings 源码修改。
param([string]$DshSource = 'E:\project\deepseek-harness', [string]$Profile = 'web')
$ErrorActionPreference = 'Stop'
$pluginPath = (Resolve-Path "$PSScriptRoot\..\plugin").Path
Push-Location $DshSource
try {
    pnpm dsh plugin --profile $Profile add $pluginPath
    if ($LASTEXITCODE -ne 0) { throw '插件安装失败' }
} finally { Pop-Location }
