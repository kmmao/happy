#!/bin/bash
# =============================================================================
# 清理：删除批量创建的用户
# =============================================================================
#
# 用法:
#   sudo ./cleanup.sh              # 删除所有 happy01-99 用户
#   sudo ./cleanup.sh dev          # 删除所有 dev01-99 用户
#   sudo ./cleanup.sh happy 3      # 只删除 happy01-03
# =============================================================================

set -euo pipefail

PREFIX=${1:-happy}
COUNT=${2:-99}

if [ "$(id -u)" -ne 0 ]; then
    echo "[ERROR] 请用 root 或 sudo 运行"
    exit 1
fi

echo "=== 即将删除以下用户 ==="
TARGETS=()
for i in $(seq 1 "$COUNT"); do
    username="${PREFIX}$(printf '%02d' "$i")"
    if id "$username" &>/dev/null; then
        TARGETS+=("$username")
        echo "  - $username ($(eval echo ~$username))"
    fi
done

if [ ${#TARGETS[@]} -eq 0 ]; then
    echo "没有找到匹配的用户"
    exit 0
fi

echo ""
read -p "确认删除 ${#TARGETS[@]} 个用户及其主目录？(yes/NO): " confirm
if [ "$confirm" != "yes" ]; then
    echo "已取消"
    exit 0
fi

for username in "${TARGETS[@]}"; do
    echo -n "  删除 $username... "

    # 停止 daemon
    home=$(eval echo "~$username")
    state_file="$home/.happy/daemon.state.json"
    if [ -f "$state_file" ] && command -v jq &>/dev/null; then
        pid=$(jq -r '.pid // empty' "$state_file" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    fi

    # 禁用 linger
    loginctl disable-linger "$username" 2>/dev/null || true

    # 删除用户及主目录
    userdel -r "$username" 2>/dev/null || true
    echo "OK"
done

echo ""
echo "[OK] 已删除 ${#TARGETS[@]} 个用户"
