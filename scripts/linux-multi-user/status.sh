#!/bin/bash
# =============================================================================
# 查看所有用户的 Happy + Claude Code 状态
# =============================================================================

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "[ERROR] 请用 root 或 sudo 运行"
    exit 1
fi

echo "=== Happy 多用户状态 ==="
echo ""
printf "%-12s %-8s %-8s %-10s %-8s %-18s %-12s\n" \
    "USER" "PAIRED" "DAEMON" "PORT" "SESS" "MODEL" "MEM(MB)"
printf "%s\n" "---------------------------------------------------------------------------------"

TOTAL_USERS=0
TOTAL_PAIRED=0
TOTAL_RUNNING=0
TOTAL_SESSIONS=0
TOTAL_MEM=0

for home in /home/*/; do
    user=$(basename "$home")
    id "$user" &>/dev/null || continue

    TOTAL_USERS=$((TOTAL_USERS + 1))

    # 是否已配对
    if [ -f "${home}.happy/access.key" ]; then
        paired="YES"
        TOTAL_PAIRED=$((TOTAL_PAIRED + 1))
    else
        paired="NO"
    fi

    # Daemon 状态
    state_file="${home}.happy/daemon.state.json"
    daemon_status="-"
    port="-"
    sessions="-"
    mem="-"

    if [ -f "$state_file" ] && command -v jq &>/dev/null; then
        pid=$(jq -r '.pid // empty' "$state_file" 2>/dev/null)
        port=$(jq -r '.httpPort // empty' "$state_file" 2>/dev/null)

        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            daemon_status="PID:$pid"
            TOTAL_RUNNING=$((TOTAL_RUNNING + 1))

            # 查询活跃 session 数
            sess_count=$(curl -s --max-time 2 -X POST "http://127.0.0.1:${port}/list" 2>/dev/null \
                | jq '.children | length' 2>/dev/null || echo "?")
            sessions="$sess_count"
            if [[ "$sess_count" =~ ^[0-9]+$ ]]; then
                TOTAL_SESSIONS=$((TOTAL_SESSIONS + sess_count))
            fi

            # 内存使用（该用户所有 happy/claude/codex 进程）
            user_mem=$(ps -u "$user" -o rss= 2>/dev/null | awk '{sum+=$1} END {printf "%.0f", sum/1024}' || echo "?")
            mem="$user_mem"
            if [[ "$user_mem" =~ ^[0-9]+$ ]]; then
                TOTAL_MEM=$((TOTAL_MEM + user_mem))
            fi
        else
            daemon_status="DEAD"
            port="-"
        fi
    fi

    # 当前模型
    claude_settings="${home}.claude/settings.json"
    model="-"
    if [ -f "$claude_settings" ] && command -v jq &>/dev/null; then
        model=$(jq -r '.env.ANTHROPIC_MODEL // .model // "-"' "$claude_settings" 2>/dev/null | head -c 12)
    fi

    printf "%-12s %-8s %-8s %-10s %-8s %-18s %-12s\n" \
        "$user" "$paired" "$daemon_status" "$port" "$sessions" "$model" "$mem"
done

echo ""
echo "--- 汇总 ---"
echo "总用户: $TOTAL_USERS | 已配对: $TOTAL_PAIRED | Daemon 运行: $TOTAL_RUNNING | 活跃 Session: $TOTAL_SESSIONS | 总内存: ${TOTAL_MEM}MB"
echo ""

# 共享配置状态
SHARED_DIR="/etc/claude-team"
if [ -d "$SHARED_DIR" ]; then
    echo "--- 共享配置 ($SHARED_DIR) ---"
    if [ -f "$SHARED_DIR/settings.json" ] && command -v jq &>/dev/null; then
        proxy=$(jq -r '.env.ANTHROPIC_BASE_URL // "未配置"' "$SHARED_DIR/settings.json")
        model=$(jq -r '.env.ANTHROPIC_MODEL // "未配置"' "$SHARED_DIR/settings.json")
        echo "  代理: $proxy"
        echo "  模型: $model"
    fi
    echo "  规则: $(ls "$SHARED_DIR/rules/"*.md 2>/dev/null | wc -l | xargs) 个"
    echo ""
fi
