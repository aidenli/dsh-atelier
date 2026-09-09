# GitHub 与 npm 分发

## 一键分发

先更新 `plugin/package.json` 版本号，创建 `docs/发布说明-版本.md`，完成 `gh auth login`、`npm login` 和 Git 作者配置。在项目根目录执行（Windows/macOS 共用）：

```sh
node scripts/publish.mjs --channel all
```

依次完成：凭据模式扫描、前后端构建与测试、打包验收、main 源码及预构建入口同步、GitHub 在线安装验证、npm 发布与安装验证、正式 GitHub Release 及 TGZ/SHA256 上传。不会重启正在使用的 DSH。npm 要求浏览器验证时按终端提示完成。

若部分步骤失败，保留原包，修复登录或网络后继续：

```sh
node scripts/publish.mjs --channel all --archive dist/dsh-atelier-0.3.2-universal.tgz
```

该方式重新验收原包，跳过已存在且内容一致的发布步骤；遇到不同内容的同版本或不完整 Release 则停止，禁止覆盖。main 已含同版本时不再同步本地后续源码修改，修改须增加版本。普通 `node scripts/publish.mjs` 仍只打包，不发布。

main 保存完整源码及根目录的预构建安装入口。通过 main 安装不执行编译；源码开发继续使用 plugin 目录。dist 为历史渠道。

## 准备

修改 plugin/package.json 版本号，更新发布说明。执行 `scripts/build.ps1 -NoRestart`（Windows）或 `bash scripts/build.sh --no-restart`（macOS），再执行 `node scripts/publish.mjs`，生成经过验收的 TGZ 与 SHA256。同版本不得覆盖，macOS 尚未原生验收。

## GitHub 主线

先通过 gh auth login 登录并配置 Git 作者身份，审查并同步源码到公开 main，再执行：

```sh
node scripts/publish.mjs --channel github --archive dist/dsh-atelier-0.3.2-universal.tgz
node tests/scripts/test-install.mjs github:aidenli/dsh-atelier#main
```

脚本将验收包白名单文件加入 main 根目录，不删除源码、不强推。后续同步源码须保留根目录 package.json、cordis.patch.yml、lib、skills 等安装入口，不可镜像删除。

用户安装：`pnpm dsh plugin --profile web add github:aidenli/dsh-atelier#main`。全局安装 DSH 时去掉 pnpm；固定版本可将 main 换成发行标签或提交 SHA。

## GitHub Release

推送分支不会创建 Release，须另行上传同一份验收包：

```sh
gh release create v0.3.2 dist/dsh-atelier-0.3.2-universal.tgz dist/dsh-atelier-0.3.2-universal.tgz.sha256 --repo aidenli/dsh-atelier --target main --title "Atelier 0.3.2" --notes-file docs/发布说明-0.3.2.md
```

此命令正式公开 Release。自动生成的 Source code 压缩包不是插件安装包，安装应选择 universal.tgz。

## npm

```sh
npm login --registry=https://registry.npmjs.org
node scripts/publish.mjs --channel npm --archive dist/dsh-atelier-0.3.2-universal.tgz
node tests/scripts/test-install.mjs dsh-atelier@0.3.2
```

完成浏览器验证，不把令牌写入仓库。用户执行 `pnpm dsh plugin --profile web add dsh-atelier@latest` 后重启 DSH。发布操作独立，失败时只补做失败项。升级前备份数据与系统保护密钥，旧代码不保证能读取升级后的数据库。
