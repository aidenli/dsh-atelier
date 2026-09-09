# 更新记录

## 0.3.2：项目管理与新版 DSH 适配

- 适配 DSH 0.1.3-alpha.2，完善项目与任务分离及详情导航。
- API Key 加密存入 SQLite，主密钥由系统保护。
- 增加版本检查与更新命令浮层，设置改为 Tab，增强返回按钮。
- 整理 Windows/macOS 编译、重启与分发脚本。
- 21 项后端测试、7 项插件测试、类型检查、浏览器回归及 npm/GitHub 在线安装验证通过。
- 2026-09-09 发布 npm latest 和 GitHub dist；macOS 尚未原生验收。

## 0.3.1：Node 后端与完整源码

- 公开 frontend、backend、plugin、contracts、构建脚本及模块文档。
- 后端迁移为 TypeScript、Fastify 和 Node 内置 SQLite，安装包不再携带 Go 程序。
- 保留原数据库、任务恢复与插件业务接口；首次切换需停止旧 Go 实例。
- Windows 本地验收通过；Node 22.19 和 24.15 后端测试各 19 项通过，Host 测试 6 项通过。
- 2026-09-08 发布至 npm 和 GitHub dist 分支，两种官方 CLI 在线安装测试通过。
- Node 版本尚未在 macOS 原生验收，尚未上传新 Release 安装包。

以下为旧 Go 版本记录，不代表 Node 版本的跨平台验收结果。

## 0.3.0（已验收，待正式发布）

- Windows x64、macOS ARM64 和 Intel 独立预编译插件包。
- 托管进程身份保护及父 Host 退出后自动停止。
- 动作迁移支持按输出尺寸选择普通或 plus 实例。
- 全局素材复用、任务管理及主题跟随。

Windows、Apple Silicon Mac 和 Intel Mac 的原生构建与测试均通过，安装包已上传 Release 草稿，尚未正式公开。维护者公开后，用户可在 Releases 下载对应平台的 `.tgz`。
