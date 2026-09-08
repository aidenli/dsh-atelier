# 跨平台构建与 GitHub 发布操作说明

> 历史方案，已停止使用：后端已改为 Node，原三平台 Go 打包与跨仓库发布脚本已移除。用户已删除私有仓库，现有公开仓库 dsh-atelier 改为承载完整源码。下文仅保留历史记录，不作为当前安装指南；请以 README 为准。

本文面向项目维护者。初始发布版本为 **0.3.0**，公开仓库只分发预编译产物，源码不公开。

## 1. 仓库与本地目录

| 用途 | GitHub | 本地 |
|---|---|---|
| 私有源码、内部文档和 CI | https://github.com/aidenli/dsh-aiden | `E:\project\dsh-aiden` |
| 公开安装说明和 Release | https://github.com/aidenli/dsh-atelier | `E:\project\dsh-atelier-public` |

两个仓库历史独立。不要为私有仓库增加指向公开仓库的 remote 后直接推送，也不要同步私有 Git 历史。公开仓库不承担完整源码构建。

`frontend`、`backend`、`plugin`、`contracts` 和 `scripts` 继续同级。构建时把前端及 Host 产物组装进安装包，用户无需获取这些源码。

私有根目录 `.gitignore` 排除依赖、运行目录、视频、图片、数据库、日志、密钥文件和构建产物。私有并不意味着应该提交凭据。提交前执行：

```powershell
git status --short
git add .
node dsh-atelier/scripts/scan-secrets.mjs
git diff --cached --stat
```

扫描只报告文件和行号，不打印疑似密钥；它不能替代人工检查。若已将密钥推送，应撤销密钥并清理历史，不能只在新提交中删掉。

## 2. 工具版本及 GitHub 登录

固定版本：Go `1.25.0`、Node `24.15.0`、pnpm `11.7.0`；DSH 固定提交：

```text
d347e703908d0406b7a7ef80e3a0e594d86b2215
```

GitHub CLI 已通过 winget 安装。新终端可以直接运行 `gh`；旧终端若找不到命令，可使用 `C:\Program Files\GitHub CLI\gh.exe`。

```powershell
winget install --id GitHub.cli --exact
gh auth login --hostname github.com --git-protocol https --web
gh auth refresh --hostname github.com --scopes workflow
gh auth setup-git
gh auth status
```

按照终端提示完成浏览器设备授权，不在聊天、源码或文档中保存令牌。`workflow` 权限用于推送 `.github/workflows` 文件。设备代码会过期，过期后重新运行登录命令。

本机 Git 原有代理指向不可达的本地服务，首次推送使用了单次代理覆盖：

```powershell
git -c http.proxy= -c https.proxy= push -u origin main
```

该命令不修改全局代理配置；网络已正常时使用普通 `git push`。

## 3. 配置自动发布凭据

日常登录凭据与跨仓库自动发布凭据分开。Actions 内置 GITHUB_TOKEN 不直接承担向另一个仓库发布的职责。

1. 打开 https://github.com/settings/personal-access-tokens/new 创建细粒度令牌。
2. Resource owner 选择 `aidenli`；Repository access 选择 Only select repositories，只选 **dsh-atelier**。
3. Repository permissions 中把 **Contents** 设为 **Read and write**，其余不额外授权；设置适当有效期并记录到期时间。
4. 到 https://github.com/aidenli/dsh-aiden/settings/secrets/actions/new 添加 repository secret，名称精确为 **RELEASE_TOKEN**，值填刚生成的令牌。
5. 只核对 Secret 名称，不把值复制到聊天中。令牌到期后在相同 Secret 下更新。

缺少 Secret 不影响三平台编译测试，但最后上传草稿会明确失败。若在失败后补好 Secret，可以重跑失败的发布 job，不需要重新生成付费媒体任务。

## 4. 本地构建

本地 DSH 源码位于 `E:\project\deepseek-harness`。云端会检出固定提交，绝不依赖这一本地路径或 settings 的未提交修改。

```powershell
cd E:\project\dsh-aiden\dsh-atelier\frontend
pnpm install --frozen-lockfile
cd ..
$env:DSH_SOURCE = 'E:\project\deepseek-harness'
node scripts/pack-plugin.mjs --target win32-x64
node scripts/pack-plugin.mjs --target darwin-arm64
node scripts/pack-plugin.mjs --target darwin-x64
```

Go 使用 CGO_ENABLED=0。依赖现代纯 Go SQLite，Windows 可以交叉编译 Mach-O 文件，但不能在 Windows 上执行 Mac 程序。

打包脚本执行构建，之后在 `.runtime/packages` 的独立目录按白名单收集文件。后端中间产物位于 `.runtime/binaries/<目标>/`，不会把 Mac 程序写到 Windows 的运行程序路径。

本地源码模式从上述目标目录启动后端；安装包模式从包内 `bin` 启动。首次从旧源码路径迁移时，旧身份记录路径若不匹配，会拒绝自动接管；确认旧进程已停止后再移除过期 `managed-process.json`，不要直接删除数据库。

`scripts/pack-plugin.ps1` 是 Node 打包命令的 Windows 包装器。`--skip-build` 仅用于已确认中间产物是当前源码的本地排查，正式发布不使用。

产物目录示例：

```text
dist/
  dsh-atelier-0.3.0-win32-x64.tgz
  dsh-atelier-0.3.0-win32-x64.tgz.sha256
  dsh-atelier-0.3.0-darwin-arm64.tgz
  dsh-atelier-0.3.0-darwin-arm64.tgz.sha256
  dsh-atelier-0.3.0-darwin-x64.tgz
  dsh-atelier-0.3.0-darwin-x64.tgz.sha256
```

## 5. 本地验收

在 `backend` 目录运行 `go test ./...`。在 `dsh-atelier` 目录运行：

```powershell
node frontend/node_modules/typescript/bin/tsc -p frontend/tsconfig.json
node frontend/node_modules/typescript/bin/tsc -p plugin/tsconfig.json
node frontend/node_modules/typescript/bin/tsc -p plugin/tsconfig.client.json
node scripts/test-plugin.mjs
node scripts/test-frontend.mjs
node scripts/test-package.mjs
node scripts/test-dsh-clean.mjs
node scripts/test-install.mjs
node scripts/check-archive.mjs dist/dsh-atelier-0.3.0-win32-x64.tgz win32-x64
```

Playwright 缺浏览器时，在 frontend 目录运行 `pnpm exec playwright install chromium`。

`test-package` 和 `test-dsh-clean` 默认运行当前平台包。后者使用隔离 DSH_HOME、独立数据目录和空闲端口，不读取既有测试会话，不触碰当前运行的 DSH。测试日志可能包含临时 DSH 访问令牌，留在已忽略的 `.runtime`，不要原样公开。

`test-install` 额外通过官方 CLI 在临时 profile 执行真正的 `dsh plugin add`，核验 pnpm 依赖解析、bundle 登记和无安装期构建脚本。该补充安装检查已在本地 Windows 通过。

`check-archive` 可在 Windows 上检查所有目标：文件白名单、清单 os/cpu、Windows PE/Mac Mach-O 架构、Mac 执行位和 SHA256。它不宣称完成 Mac 原生运行验收。

## 6. 在线构建与查看进度

入口：https://github.com/aidenli/dsh-aiden/actions

- **Windows checks**：推送 main 或 PR 时运行 Go、前端类型和浏览器回归。
- **Build release draft**：手动触发，三平台各自检出固定版本 DSH、安装依赖、构建和执行原生测试，全部通过才进入上传步骤。

```powershell
gh workflow run release.yml --repo aidenli/dsh-aiden
gh run list --repo aidenli/dsh-aiden --workflow release.yml --limit 5
gh run view <运行ID> --repo aidenli/dsh-aiden
gh run view <运行ID> --repo aidenli/dsh-aiden --log-failed
```

执行器为 windows-2025、macos-15（ARM64）、macos-15-intel。流水线会检查 Node 实际架构，避免标签改变后打错包。私有仓库消耗 Actions 套餐额度；超额费用以 GitHub Billing 为准。

下载单次运行的中间产物：

```powershell
gh run download <运行ID> --repo aidenli/dsh-aiden --dir .runtime/downloads
```

中间产物保留 7 天，正式分发使用 Release 附件。构建失败不会发布不完整平台集合。首次运行链接及最终结果见本文末尾的实施记录。

## 7. 发布草稿与正式公开

私有 `plugin/package.json` 的版本号决定包名和 Release 标签。三平台通过后，工作流校验恰好三个包及其校验文件，并上传公开仓库草稿，包含三个 tgz 和汇总 SHA256SUMS.txt。

草稿入口：https://github.com/aidenli/dsh-atelier/releases

核对版本、三个平台文件、SHA256 和 macOS 限制说明。只有维护者明确决定公开时，才在网页点击 **Publish release**。本次实施不自动公开草稿。

相同版本若已有 Release（包括草稿），自动发布报错，不能无声覆盖。若首次发布部分上传失败，先核对已有草稿和附件再人工处理；修改版本或删除明确失败的草稿后重跑，不能把正式版本当临时文件覆盖。

公开仓库自动生成的 Source code.zip 仅是安装文档，不能当插件包安装。

## 8. 用户安装、升级和回退

正式公开后支持直接在线安装。例如 Windows：

```powershell
pnpm dsh plugin --profile web add https://github.com/aidenli/dsh-atelier/releases/download/v0.3.0/dsh-atelier-0.3.0-win32-x64.tgz
```

Mac 对应替换为 darwin-arm64 或 darwin-x64。DSH 将在线 tarball 参数交给 pnpm；草稿期间公开下载链接不可用，需使用附件本地路径。公开发布备注不再包含私有构建链接，内部构建追溯保留在本文中。

用户先执行 `node -p "process.platform + '-' + process.arch"`，选择与 DSH 的 Node 进程一致的包。Apple Silicon 使用原生 ARM64 Node 时选 darwin-arm64；Intel 选 darwin-x64。

Windows 在 DSH 源码目录：

```powershell
Get-FileHash 'E:\Downloads\dsh-atelier-0.3.0-win32-x64.tgz' -Algorithm SHA256
pnpm dsh plugin --profile web add 'E:\Downloads\dsh-atelier-0.3.0-win32-x64.tgz'
pnpm dsh web
```

Mac 在 DSH 源码目录：

```sh
shasum -a 256 ~/Downloads/dsh-atelier-0.3.0-darwin-arm64.tgz
pnpm dsh plugin --profile web add ~/Downloads/dsh-atelier-0.3.0-darwin-arm64.tgz
pnpm dsh web
```

Intel Mac 把 arm64 替换为 x64。安装不执行源码构建，也不要求 Go。第一次进入插件设置配置 RunningHub 密钥。

升级前停止 DSH 并备份数据库和素材，再安装新包、启动。回退使用旧版对应平台包，先确认旧版兼容数据库；不能保证未来迁移后的数据库都能降级。

安装包默认数据目录为用户主目录 `.dsh-atelier/default`，源码默认 `.runtime/default`。显式 dataDir 优先；切换后端 URL 不迁移数据库。不要因升级删除运行目录。

## 9. macOS 与进程生命周期

Windows 用系统 CIM 核对进程身份；macOS 用固定语言、完整宽度的系统 ps 读取身份，发信号前复核。不确定时拒绝停止。两者都会保护仍由活跃 Host 管理的实例，外部模式不接管。

DSH 和 Go 通过专属 stdin 管道关联。父 Host 被强制结束后管道关闭，Go 停止调度并退出；远端任务仍可能继续，下次从持久化 ID 查询。此过程不自动重试失败生成。

首版 Mac 无 Developer ID 签名或公证，发布测试不包含所有浏览器下载隔离属性和 Gatekeeper 场景。执行受阻时先检查架构、执行权限、来源和校验值，不提供全局关闭系统安全保护的脚本。

## 10. 后续维护

修改版本号后同步公开 CHANGELOG，并更新示例中的版本。DSH 升级时同步流水线固定提交、peerDependencies 和兼容说明；必须重新验收 Remote 契约、页面入口和进程生命周期。

新依赖写入精确版本并提交 pnpm-lock.yaml。Node、Go、pnpm 或 runner 版本升级单独验证，避免将上游 main 的变化悄悄混进正式包。

### 实施记录

- GitHub 账号：aidenli；私有和公开仓库均已创建，公开仓库仅有分发文档。
- 首次三平台运行：https://github.com/aidenli/dsh-aiden/actions/runs/34202783633 。此为初次验证运行，不等同于最终发布验收。
- 本地三个目标已编译并通过包结构、架构、权限和哈希检查；Windows 原生生命周期、前端回归和干净 DSH 加载已通过。
- 本机工具实际为 Go 1.25.11、Node 24.15.0、pnpm 11.25.0；正式云端产物使用前述固定版本，不以本地产物替代发布产物。
- 首轮两个 Mac 原生 job 通过；Windows 的 Git Bash tar 盘符兼容问题已修复为统一 Node tar 库。
- 第二轮完整验收：https://github.com/aidenli/dsh-aiden/actions/runs/34204096472 ，包含干净 DSH 加载检查，构建源码提交 `b520852`。
- `RELEASE_TOKEN` 已由用户在 GitHub 配置，仅检查 Secret 名称，不读取凭据值。
- 第二轮三个原生 job 与 draft job 全部成功；Windows 日常检查亦通过。未调用真实 RunningHub 生成接口，未停止用户原有 DSH。
- 草稿地址：https://github.com/aidenli/dsh-atelier/releases/tag/untagged-e299f2caf8da52f9a15c 。标签为 v0.3.0，`isDraft=true`，尚未正式公开。
- 草稿含三个 `.tgz` 和 SHA256SUMS.txt。已将云端产物下载至本地 `.runtime/cloud-release/34204096472`，重新校验后同步到 `dist`，替换本地交叉编译的同名测试包。
- 文档与补充 CLI 安装测试的后续提交不改变本次已验收的发布实现；发布实现对应 `b520852bef98bcec63f5e8b0840ebf0ddf0928ee`。

### 最终附件核对

| 平台 | 字节数 | SHA256 |
|---|---:|---|
| Windows x64 | 18882877 | `e649b05af01c6a44f28a1599bf5fe9f275263f2fe8a569b3d0f28f27e0a3ce5f` |
| Mac ARM64 | 18416717 | `8515b812b0cc53a316509732f1f6498f21ff5d7892a40d82318fa5d78aa6dfc0` |
| Mac Intel | 19471671 | `c466fc82fe69cb1f69117f354146515c835ed3760c06b1a5766635f6b345734a` |

以上值与 GitHub Release 附件 digest 一致。包内带第三方许可原文，未带源码 source map、密钥或运行数据。

完成状态：**本地构建通过；云端三平台验收通过；草稿已上传**。按约定保留草稿，不自动转为正式发布。仍由维护者检查发布说明并决定公开；Mac 签名、公证和下载隔离场景不在本次完成范围。
