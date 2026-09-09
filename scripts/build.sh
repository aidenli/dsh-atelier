#!/usr/bin/env bash
# macOS 构建入口；仅构建 Node 后端、React 前端和 DSH 插件。
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
: "${DSH_SOURCE:?请设置 DSH_SOURCE 为已构建的 DSH 源码目录}"
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--no-restart" ) ]]; then
  echo '用法：bash scripts/build.sh [--no-restart]' >&2
  exit 1
fi
pnpm --dir backend install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
pnpm --dir backend build
pnpm --dir backend test
pnpm --dir frontend typecheck
node scripts/internal/build-plugin.mjs
node frontend/node_modules/typescript/bin/tsc -p plugin/tsconfig.json
node frontend/node_modules/typescript/bin/tsc -p plugin/tsconfig.client.json
node tests/scripts/test-plugin.mjs
if [[ "${1:-}" != '--no-restart' ]]; then bash "$SCRIPT_DIR/restart-dsh.sh"; fi
