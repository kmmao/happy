#!/bin/bash
# =============================================================================
# 批量更新所有用户的代理配置
# =============================================================================
#
# 当代理地址、token 或模型发生变化时，一键更新所有用户。
#
# 用法:
#   sudo ./update-proxy.sh                                    # 交互式输入
#   sudo ./update-proxy.sh --host 10.0.0.1 --port 8317       # 指定参数
#   sudo ./update-proxy.sh --token "new-token"                # 只改 token
#   sudo ./update-proxy.sh --model "claude-sonnet-4-6"        # 只改模型
# =============================================================================

set -euo pipefail

# 解析参数
HOST=""
PORT=""
TOKEN=""
MODEL=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --host)  HOST="$2"; shift 2 ;;
        --port)  PORT="$2"; shift 2 ;;
        --token) TOKEN="$2"; shift 2 ;;
        --model) MODEL="$2"; shift 2 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

if [ "$(id -u)" -ne 0 ]; then
    echo "[ERROR] 请用 root 或 sudo 运行"
    exit 1
fi

if ! command -v jq &>/dev/null; then
    echo "[ERROR] 需要 jq，请先安装"
    exit 1
fi

SHARED_DIR="/etc/claude-team"
UPDATED=0

# 更新共享配置
if [ -f "$SHARED_DIR/settings.json" ]; then
    SHARED="$SHARED_DIR/settings.json"

    if [ -n "$HOST" ] || [ -n "$PORT" ]; then
        CURRENT_URL=$(jq -r '.env.ANTHROPIC_BASE_URL // ""' "$SHARED")
        CURRENT_HOST=$(echo "$CURRENT_URL" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' || echo "127.0.0.1")
        CURRENT_PORT=$(echo "$CURRENT_URL" | grep -oE '[0-9]+$' || echo "8317")
        NEW_HOST="${HOST:-$CURRENT_HOST}"
        NEW_PORT="${PORT:-$CURRENT_PORT}"
        jq --arg url "http://${NEW_HOST}:${NEW_PORT}" \
           '.env.ANTHROPIC_BASE_URL = $url' "$SHARED" > "${SHARED}.tmp"
        mv "${SHARED}.tmp" "$SHARED"
        echo "[OK] 共享配置: 代理地址 -> http://${NEW_HOST}:${NEW_PORT}"
    fi

    if [ -n "$TOKEN" ]; then
        jq --arg token "$TOKEN" \
           '.env.ANTHROPIC_AUTH_TOKEN = $token' "$SHARED" > "${SHARED}.tmp"
        mv "${SHARED}.tmp" "$SHARED"
        echo "[OK] 共享配置: Token 已更新"
    fi

    if [ -n "$MODEL" ]; then
        jq --arg model "$MODEL" \
           '.env.ANTHROPIC_MODEL = $model | .model = $model' "$SHARED" > "${SHARED}.tmp"
        mv "${SHARED}.tmp" "$SHARED"
        echo "[OK] 共享配置: 默认模型 -> $MODEL"
    fi
fi

# 更新每个用户
echo ""
echo "--- 更新用户配置 ---"

for home in /home/*/; do
    user=$(basename "$home")
    id "$user" &>/dev/null || continue

    claude_settings="$home/.claude/settings.json"
    happy_settings="$home/.happy/settings.json"

    [ -f "$claude_settings" ] || continue

    echo -n "  $user: "

    # 更新 ~/.claude/settings.json
    if [ -n "$HOST" ] || [ -n "$PORT" ]; then
        CURRENT_URL=$(jq -r '.env.ANTHROPIC_BASE_URL // ""' "$claude_settings")
        CURRENT_HOST=$(echo "$CURRENT_URL" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' || echo "127.0.0.1")
        CURRENT_PORT=$(echo "$CURRENT_URL" | grep -oE '[0-9]+$' || echo "8317")
        NEW_HOST="${HOST:-$CURRENT_HOST}"
        NEW_PORT="${PORT:-$CURRENT_PORT}"
        jq --arg url "http://${NEW_HOST}:${NEW_PORT}" \
           '.env.ANTHROPIC_BASE_URL = $url' "$claude_settings" > "${claude_settings}.tmp"
        mv "${claude_settings}.tmp" "$claude_settings"
        chown "$user":"$user" "$claude_settings"
    fi

    if [ -n "$TOKEN" ]; then
        jq --arg token "$TOKEN" \
           '.env.ANTHROPIC_AUTH_TOKEN = $token' "$claude_settings" > "${claude_settings}.tmp"
        mv "${claude_settings}.tmp" "$claude_settings"
        chown "$user":"$user" "$claude_settings"
    fi

    if [ -n "$MODEL" ]; then
        jq --arg model "$MODEL" \
           '.env.ANTHROPIC_MODEL = $model | .model = $model' "$claude_settings" > "${claude_settings}.tmp"
        mv "${claude_settings}.tmp" "$claude_settings"
        chown "$user":"$user" "$claude_settings"
    fi

    # 更新 ~/.happy/settings.json 中的 profile 环境变量
    if [ -f "$happy_settings" ]; then
        if [ -n "$HOST" ] || [ -n "$PORT" ]; then
            NEW_HOST="${HOST:-127.0.0.1}"
            NEW_PORT="${PORT:-8317}"
            jq --arg url "http://${NEW_HOST}:${NEW_PORT}" \
               '(.profiles[0].environmentVariables[] | select(.name == "ANTHROPIC_BASE_URL")).value = $url' \
               "$happy_settings" > "${happy_settings}.tmp"
            mv "${happy_settings}.tmp" "$happy_settings"
            chown "$user":"$user" "$happy_settings"
        fi

        if [ -n "$TOKEN" ]; then
            jq --arg token "$TOKEN" \
               '(.profiles[0].environmentVariables[] | select(.name == "ANTHROPIC_AUTH_TOKEN")).value = $token' \
               "$happy_settings" > "${happy_settings}.tmp"
            mv "${happy_settings}.tmp" "$happy_settings"
            chown "$user":"$user" "$happy_settings"
        fi

        if [ -n "$MODEL" ]; then
            jq --arg model "$MODEL" \
               '(.profiles[0].environmentVariables[] | select(.name == "ANTHROPIC_MODEL")).value = $model' \
               "$happy_settings" > "${happy_settings}.tmp"
            mv "${happy_settings}.tmp" "$happy_settings"
            chown "$user":"$user" "$happy_settings"
        fi
    fi

    UPDATED=$((UPDATED + 1))
    echo "OK"
done

echo ""
echo "[OK] 已更新 $UPDATED 个用户"
echo ""
echo "注意: 正在运行的 Claude Code session 不会立即生效"
echo "用户需要重启 daemon: systemctl --user restart happy-daemon"
