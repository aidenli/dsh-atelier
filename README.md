# DSH Atelier

通过 DSH 对话完成动作迁移，配套素材库、任务管理和视频预览工作台。

本仓库仅分发预编译插件，不提供完整业务源码。请从 [Releases](https://github.com/aidenli/dsh-atelier/releases) 下载安装包，不要使用 GitHub 的 Download ZIP 或自动生成的 Source code 压缩包安装。

## 选择安装包

| 文件后缀 | 系统 |
|---|---|
| win32-x64.tgz | Windows x64 |
| darwin-arm64.tgz | Apple Silicon Mac |
| darwin-x64.tgz | Intel Mac |

与 DSH 使用的 Node 架构保持一致，可执行 `node -p "process.platform + '-' + process.arch"` 查看。

## 安装

兼容 DSH 提交：`d347e703908d0406b7a7ef80e3a0e594d86b2215`。在 DSH 源码目录运行，替换安装包路径：

```sh
pnpm dsh plugin --profile web add /path/to/dsh-atelier-0.3.0-darwin-arm64.tgz
pnpm dsh web
```

Windows 示例：`pnpm dsh plugin --profile web add "E:\Downloads\dsh-atelier-0.3.0-win32-x64.tgz"`。

安装端无需 Go，也不编译源码。在插件设置中配置 RunningHub 密钥。`/gd-transfer` 开启动作迁移工具；素材齐全后可创建任务。素材和密钥只存入本地运行目录。

## 升级与回退

停止 DSH，再安装目标版本对应平台的包，重新启动 DSH。不要删除本地数据目录。回退前备份数据库和素材，确认旧版本兼容数据库格式。

发布包默认数据目录为用户主目录下 `.dsh-atelier/default`。已有配置覆盖默认值，切换 URL 不迁移任务数据库。旧版未登记身份的 Go 进程需手动停止一次，新版托管服务随父 Host 退出。

## 校验与 Mac 限制

每个 Release 提供 SHA256SUMS.txt。Windows 使用 `Get-FileHash <安装包> -Algorithm SHA256`，Mac 使用 `shasum -a 256 <安装包>`，与公布结果逐项比对。

macOS 首版没有 Apple Developer ID 签名或公证。系统可能限制下载程序执行；先核对来源、校验值及具体系统提示，不建议全局关闭系统安全保护。CI 原生测试不代表所有下载和隔离属性场景均已验证。

任务和视频存在本地；公开仓库不提供托管生成服务。问题可提交到本仓库 Issues，请勿上传密钥、数据库或含私密素材的日志。
