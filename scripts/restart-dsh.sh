#!/usr/bin/env bash
# macOS 重启入口；身份检查和等待统一由 Node 辅助实现。
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/internal/restart-macos.mjs" "$@"
