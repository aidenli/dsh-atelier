# DSH Atelier

## 快速安装

npm 和 GitHub 均提供预构建版本，在 DSH 源码目录选择一种安装：

```powershell
# npm（推荐）
pnpm dsh plugin --profile web add dsh-atelier@0.3.1
# 或 GitHub
pnpm dsh plugin --profile web add github:aidenli/dsh-atelier#dist
pnpm dsh web
```

全局安装 DSH 时使用 `dsh` 替代 `pnpm dsh`。已有实例需正常重启；首次从 Go 迁移先停止旧后端并备份数据。完整说明见 [安装与发布](docs/安装与发布.md)。

通过 DSH 对话创建 Wan Animate2 动作迁移任务，独立 Node 服务负责持久化排队、平台调用、恢复和结果归档，React 工作台位于原生右侧详情列。素材齐全后直接入队，没有计划确认步骤。

当前兼容本机 DeepSeek Harness `0.1.3-alpha.1`、Cordis `4.0.2`，源码目录为 `E:\project\deepseek-harness`。DSH 接口尚未稳定，升级后应重新构建并执行集成测试。

## 目录

| 目录 | 职责 |
| --- | --- |
| `frontend` | React 页面、主题样式；不导入 Host 实现 |
| `backend` | 独立 TypeScript 项目；Fastify、内置 SQLite 和持久化调度 |
| `plugin` | DSH Host/Client 入口、Remote、模型工具、通知和进程托管 |
| `contracts` | OpenAPI 契约源及生成的浏览器公开类型 |
| `scripts` | 构建、安装、运行及测试脚本 |
| `docs` | 架构、运行过程和验收记录 |
| `.runtime` | 本机密钥、SQLite、素材、测试记录；禁止提交 |
| `backend/dist` | 后端独立编译输出；插件内置入口为 lib/backend.mjs |

## 构建与安装

公开源码仓库为 https://github.com/aidenli/dsh-atelier 。克隆后仓库根目录直接包含 frontend、backend 和 plugin。下面的绝对路径是维护者环境示例，请替换为自己的路径。

先准备兼容提交 `d347e703908d0406b7a7ef80e3a0e594d86b2215` 的 DSH 源码并按其说明完成构建，然后设置环境变量 `DSH_SOURCE` 指向该目录（PowerShell：`$env:DSH_SOURCE = '你的 DSH 源码绝对路径'`；macOS：`export DSH_SOURCE=/你的/DSH源码路径`）。在 Atelier 根目录分别执行 `pnpm --dir frontend install --frozen-lockfile`、`pnpm --dir backend install --frozen-lockfile`，再执行 `node scripts/pack-plugin.mjs` 即可生成通用 TGZ。macOS 尚未原生验收。

源码公开不代表自动授予开源许可；当前仓库 LICENSE 的源码授权范围尚待维护者选择和调整。

需要 Node `^22.19.0 || >=24.0.0`、pnpm，以及已安装依赖并构建过的 DSH 源码。无需 Go 工具链。

```powershell
cd E:\project\dsh-aiden\dsh-atelier\frontend
pnpm install
pnpm typecheck

cd ..\backend
pnpm install --frozen-lockfile
pnpm build
pnpm test

cd ..
node scripts/build-plugin.mjs
node scripts/test-plugin.mjs

cd E:\project\deepseek-harness
pnpm dsh plugin --profile web add E:/project/dsh-aiden/dsh-atelier/plugin
pnpm dsh web
```

前后端依赖独立安装，锁文件分别保存；公开字段修改后运行 `node scripts/generate-contracts.mjs`，构建检查契约一致性。

构建脚本在 `.runtime/typert-build-<目标>` 中创建临时 workspace，使用 DSH 官方生成器生成 `plugin/lib/typert.host.*` 和 `typert.remote-client.*`。浏览器显式挂载 Remote 契约。脚本只链接本机平台依赖，不修改 DSH 业务源码。

也可执行 `scripts/build.ps1` 完成构建及检查。首次从 Go 切换前正常停止旧 DSH，备份完整数据目录；不要同时运行新旧后端，也不要通过删除锁文件绕过检查。

### 发布完整插件包

```powershell
cd E:\project\dsh-aiden\dsh-atelier
.\scripts\pack-plugin.ps1
node scripts/test-package.mjs

cd E:\project\deepseek-harness
pnpm dsh plugin --profile web add E:/project/dsh-aiden/dsh-atelier/dist/dsh-atelier-0.3.0-universal.tgz
pnpm dsh web
```

0.3.1 通用包已通过 npm 和 GitHub dist 分支分发。包内包含 React、Host、契约和预编译 `lib/backend.mjs`，无原生程序、无安装期构建。用户只需已有 DSH。macOS 尚未原生验收。

## 使用

进入已创建的 DSH 会话，点击标题栏的 Atelier 图标。右侧工作台提供任务、素材、工作流与设置。点击退出按钮恢复原生详情。视口不超过 960px 时收起插件列并隐藏入口，保持聊天可用。

在素材库上传人物图和参考视频，点击卡片的“使用”。素材以原生引用加入草稿，不会发送。随后输入动作迁移要求并发送；模型加载 `/gd-transfer` 后查询素材，必要字段齐全时创建任务。也可以提供本机文件绝对路径导入。

工作流固定 30 fps，正常默认 480×848、读取全部帧、跳过 0 帧。测试请求单独使用 81 帧。工作流节点配置变化不会影响已经入队的任务。

素材上传不受 RunningHub 生成并发限制。即使生成名额已满，也会先上传素材；平台文件名保存到任务内部快照，等待和重启时复用。并发限制只在创建工作流任务前检查。本地文件传输当前仍串行执行。

模型查询素材时，会将当前会话已发送消息中的原生媒体附件同步到同一素材库；附件归属从会话日志校验，重复查询使用稳定素材身份。只有 `assetId` 可以创建任务。

## 服务配置

DSH 设置 → 插件 → Atelier，或右侧工作台的齿轮按钮，可配置 `backendUrl`、托管/外部模式和 RunningHub 密钥。读取配置时只返回 `hasApiKey`，不会回填密钥。

生成并发不设本地固定上限。每次创建前查询平台，按 `concurrentLimit - runningCount - queuedCount` 决定是否有空闲名额；满载约两秒后重查。平台额度与其他客户端用量变化自动生效，旧配置中的 concurrency 被忽略。这里是轮询和提交前查询，不是平台推送；文件传输或网络故障可能延后检查。

默认后端 URL 为 `http://127.0.0.1:8787`。Host 使用自身 `process.execPath` 启动包内 `lib/backend.mjs`。身份核验绑定 PID、启动时间、Node 路径、入口与数据目录；只清理已确认孤立的 Node 实例。旧 Go 实例仍活跃时拒绝迁移。专属 stdin EOF 触发有序退出；外部模式只连接，不接管进程。修改 URL 不迁移原数据库。

独立启动后端：

```powershell
cd E:\project\dsh-aiden\dsh-atelier
.\scripts\start-backend.ps1
```

源码安装沿用项目 `.runtime/default`；通过发布包新安装时默认使用用户目录 `~/.dsh-atelier/default`，独立于插件安装目录，升级不会覆盖数据。每个 DSH profile 必须配置不同 `dataDir` 和监听端口，以隔离数据库和素材。从源码安装切换到发布包时，可显式设置 `dataDir` 指向原目录以继续使用现有任务；不自动迁移数据库。需要自定义时，在对应 profile 的插件 patch 中填写配置：

```yaml
- id: atelier
  config:
    backendUrl: http://127.0.0.1:8787
    mode: managed
    dataDir: E:/project/dsh-aiden/dsh-atelier/.runtime/web
```

默认使用包内 JavaScript；`binaryPath` 已停用，开发部署可用 `backendEntry` 指定预编译入口。

Atelier API 当前不做请求鉴权，不需要 Authorization、tokenFile 或 ATELIER_TOKEN。RunningHub 密钥仅用于后端访问平台的上传、容量、创建、查询及取消接口，不用于 Atelier API 验证。旧 service.token 文件不再读取。Windows 独立启动脚本仍会设置运行目录 ACL。

详细说明见 [模块与运行逻辑](docs/模块与运行逻辑.md)、[SQLite 表设计](docs/SQLite表设计.md)、[接口说明](docs/接口说明.md)、[Node 迁移与验收记录](docs/Node后端迁移记录.md)。

动作迁移使用 `/gd-transfer` 按回合加载工具，界面通过 DSH 主题服务实时跟随明暗。

旧双仓库发布流程已停用，[历史操作说明](docs/跨平台构建与GitHub发布操作说明.md) 仅保留首次发布记录。新的安装与发布方式在迁移验收后另行讨论。
