# GitHub 与 npm 分发

## 目录与入口

- main 保存完整源码；dist 分支只保存预构建插件。
- npm 与 GitHub dist 使用同一个已验收 TGZ，无安装期编译。
- scripts/build.ps1、build.sh：编译前后端、检查、重启；NoRestart/--no-restart 仅编译。
- scripts/restart-dsh.ps1、restart-dsh.sh：只重启；WhatIf/--dry-run 只核验。
- scripts/publish.mjs：准备产物或显式分发，Windows/macOS 共用。
- scripts/internal 是必需构建实现；tests/scripts 是回归与诊断，不是日常操作入口。

## 准备版本

1. 修改 plugin/package.json 版本号与 DSH peerDependencies，更新发布说明。当前远端已有 0.3.1，下一次必须增加版本，不能覆盖。
2. 设置 DSH_SOURCE，执行 build.ps1 -NoRestart 或 bash scripts/build.sh --no-restart。
3. 执行 `node scripts/publish.mjs`。默认 prepare：构建、白名单打包、校验、托管生命周期与本地 CLI 安装测试；不会访问远端发布接口。
4. 记录输出的 dist/dsh-atelier-版本-universal.tgz 及相邻 .sha256。下方示例用 0.3.2，必须与实际版本一致。

## GitHub 分发

先完成 `gh auth login`，并配置 Git 的 user.name、user.email。账号需要 aidenli/dsh-atelier 的写权限。

```sh
node scripts/publish.mjs --channel github --archive dist/dsh-atelier-0.3.2-universal.tgz
node tests/scripts/test-install.mjs github:aidenli/dsh-atelier#dist
```

脚本在临时目录克隆已有 dist 分支、替换受控产物并正常提交推送，不强推。与远端版本相同立即失败。失败时查看临时 clone，不反复覆盖。此命令不更新 main；更新源码应在公开仓库 checkout 中审查文件清单后正常提交，禁止直接推送父项目的私有历史或运行目录。

用户安装命令：`dsh plugin --profile web add github:aidenli/dsh-atelier#dist`。需要固定版本时用 dist 的提交 SHA 替代 dist。

## npm 分发

注册 npm 账号、验证邮箱并启用 2FA，然后执行：

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
node scripts/publish.mjs --channel npm --archive dist/dsh-atelier-0.3.2-universal.tgz
node tests/scripts/test-install.mjs dsh-atelier@0.3.2
```

按 npm 提示完成浏览器验证，不把令牌写入仓库。脚本直接发布指定 TGZ，不重新编译；npm 同版本不可重复发布。用户通过 `dsh plugin --profile web add dsh-atelier@0.3.2` 安装或切换版本，完成后重启 DSH。

GitHub 与 npm 独立执行，一方成功另一方失败时只补做失败的一方。升级前备份数据目录，回退代码不能保证旧版能读取新版数据库。macOS 脚本尚未原生验收，不应据此宣称跨平台验证通过。
