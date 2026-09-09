# DSH Atelier

通过 DSH 对话完成动作迁移，插件自动启动 Node 后端。

## 安装

在 DSH 源码目录选择一种方式：

```sh
pnpm dsh plugin --profile web add dsh-atelier@latest
# 或 GitHub 预构建版本
pnpm dsh plugin --profile web add github:aidenli/dsh-atelier#main
pnpm dsh web
```

## 本地编译部署

需要 Node 22.19 或 >=24、pnpm，以及已完成 `pnpm install`、`pnpm build` 的 DSH 源码。

Windows，在 Atelier 根目录执行：

```powershell
# 首次只编译，再注册源码插件
.\scripts\build.ps1 -DshSource E:\project\deepseek-harness -NoRestart
cd E:\project\deepseek-harness
pnpm dsh plugin --profile web add E:/project/dsh-aiden/dsh-atelier/plugin
pnpm dsh web
```

后续修改后，在 Atelier 根目录执行 `.\scripts\build.ps1` 即编译前后端、检查并重启 DSH。只重启用 `.\scripts\restart-dsh.ps1`。

macOS，在 Atelier 根目录执行（替换路径）：

```sh
export DSH_SOURCE=/你的路径/deepseek-harness
bash scripts/build.sh --no-restart
cd "$DSH_SOURCE"
pnpm dsh plugin --profile web add /你的路径/dsh-atelier/plugin
pnpm dsh web
```

后续在 Atelier 根目录执行 `bash scripts/build.sh` 编译并重启；只重启用 `bash scripts/restart-dsh.sh`。重启脚本针对默认 web profile 和源码插件数据目录。

保留 `.runtime/default` 中的数据库、素材及系统保护密钥文件。
