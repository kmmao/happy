#!/bin/bash
# =============================================================================
# Happy + Claude Code 多用户 Linux 批量部署脚本
# =============================================================================
#
# 功能:
#   1. 随机生成指定数量的系统用户
#   2. 全局安装 Happy CLI
#   3. 预置 Claude Code 统一配置（共享代理）
#   4. 预置 Happy daemon systemd service
#   5. 生成用户密码清单
#
# 用法:
#   sudo ./deploy.sh              # 默认 5 个用户，前缀 happy
#   sudo ./deploy.sh 10           # 10 个用户
#   sudo ./deploy.sh 3 dev        # 3 个用户，前缀 dev
#
# 环境变量（可选，覆盖默认值）:
#   PROXY_HOST          代理地址       (默认: 127.0.0.1)
#   PROXY_PORT          代理端口       (默认: 8317)
#   PROXY_AUTH_TOKEN    代理认证 token (默认: quotio-local-A4DB6F36)
#   DEFAULT_MODEL       默认模型       (默认: claude-sonnet-4-6)
#   DEFAULT_OPUS        Opus 模型      (默认: claude-opus-4-6)
#   DEFAULT_SONNET      Sonnet 模型    (默认: claude-sonnet-4-6)
#   DEFAULT_HAIKU       Haiku 模型     (默认: claude-haiku-4-5-20251001)
#   HAPPY_SERVER_URL    Happy 服务地址 (默认: https://happyserve.xycloud.info)
#
# 示例:
#   PROXY_HOST=10.0.0.1 PROXY_PORT=9000 sudo -E ./deploy.sh 10
#
# 前提:
#   - root 或 sudo 权限
#   - Node.js >= 18 已安装
#   - 代理服务已在指定端口运行
# =============================================================================

set -euo pipefail

# ======================== 配置区域（按需修改） ========================

COUNT=${1:-5}
PREFIX=${2:-happy}
PASSWORD_LENGTH=16

# 共享代理配置（环境变量 > 默认值）
PROXY_HOST="${PROXY_HOST:-127.0.0.1}"
PROXY_PORT="${PROXY_PORT:-8317}"
PROXY_AUTH_TOKEN="${PROXY_AUTH_TOKEN:-quotio-local-A4DB6F36}"

# 默认模型（环境变量 > 默认值）
DEFAULT_MODEL="${DEFAULT_MODEL:-claude-sonnet-4-6}"
DEFAULT_OPUS="${DEFAULT_OPUS:-claude-opus-4-6}"
DEFAULT_SONNET="${DEFAULT_SONNET:-claude-sonnet-4-6}"
DEFAULT_HAIKU="${DEFAULT_HAIKU:-claude-haiku-4-5-20251001}"

# Happy Server 地址（环境变量 > 默认值）
HAPPY_SERVER_URL="${HAPPY_SERVER_URL:-https://happyserve.xycloud.info}"

# ======================== 颜色输出 ========================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ======================== 前置检查 ========================

if [ "$(id -u)" -ne 0 ]; then
    log_error "请用 root 或 sudo 运行此脚本"
    exit 1
fi

if ! command -v node &>/dev/null; then
    log_error "Node.js 未安装，请先安装 Node.js >= 18"
    exit 1
fi

NODE_VERSION=$(node -v | grep -oE '[0-9]+' | head -1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Node.js 版本太低: $(node -v)，需要 >= 18"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ======================== Step 1: 全局安装 Happy CLI ========================

log_info "Step 1/4: 安装 Happy CLI..."

if command -v happy &>/dev/null; then
    CURRENT_VERSION=$(happy --version 2>/dev/null || echo "unknown")
    log_ok "Happy CLI 已安装: $CURRENT_VERSION"
else
    npm install -g @kmmao/happy-coder
    log_ok "Happy CLI 安装完成"
fi

# 确保依赖工具存在
for cmd in jq openssl; do
    if ! command -v "$cmd" &>/dev/null; then
        log_info "安装 $cmd..."
        if command -v apt-get &>/dev/null; then
            apt-get install -y "$cmd" > /dev/null 2>&1
        elif command -v yum &>/dev/null; then
            yum install -y "$cmd" > /dev/null 2>&1
        fi
    fi
done

# ======================== Step 2: 创建共享配置模板 ========================

log_info "Step 2/4: 生成共享配置模板..."

# 共享 Claude Code 配置目录
SHARED_DIR="/etc/claude-team"
mkdir -p "$SHARED_DIR/rules"

# --- Claude Code settings.json（共享代理 + 模型） ---
cat > "$SHARED_DIR/settings.json" << EOF
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "${PROXY_AUTH_TOKEN}",
    "ANTHROPIC_BASE_URL": "http://${PROXY_HOST}:${PROXY_PORT}",
    "ANTHROPIC_MODEL": "${DEFAULT_MODEL}",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "${DEFAULT_OPUS}",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "${DEFAULT_SONNET}",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "${DEFAULT_HAIKU}"
  },
  "model": "${DEFAULT_MODEL}",
  "skipDangerousModePermissionPrompt": false
}
EOF

# --- Claude Code config.json ---
cat > "$SHARED_DIR/config.json" << 'EOF'
{
  "primaryApiKey": "any"
}
EOF

# --- 团队 CLAUDE.md ---
cat > "$SHARED_DIR/CLAUDE.md" << 'EOF'
# Team Instructions

- Use Chinese (Simplified) for responses
- Do not use mock/fake data unless explicitly asked
- Follow TypeScript strict mode
- Use functional programming patterns, avoid classes
- All imports at file top, named exports preferred
EOF

# --- 团队规则 ---
cat > "$SHARED_DIR/rules/coding-style.md" << 'EOF'
# Coding Style

## Immutability
ALWAYS create new objects, NEVER mutate existing ones.

## File Organization
- 200-400 lines typical, 800 max
- Organize by feature/domain

## Code Quality
- Functions under 50 lines
- No deep nesting (>4 levels)
- No console.log statements
- No hardcoded values
EOF

cat > "$SHARED_DIR/rules/security.md" << 'EOF'
# Security

- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- SQL injection prevention (parameterized queries)
- Error messages must not leak sensitive data
EOF

cat > "$SHARED_DIR/rules/git-workflow.md" << 'EOF'
# Git Workflow

Commit format: <type>: <description>
Types: feat, fix, refactor, docs, test, chore, perf, ci
EOF

chmod -R 755 "$SHARED_DIR"
log_ok "共享配置已写入 $SHARED_DIR"

# ======================== Step 3: 创建用户 ========================

log_info "Step 3/4: 创建 ${COUNT} 个用户..."

CREDENTIALS_FILE="/root/happy-users-$(date +%Y%m%d-%H%M%S).csv"
echo "username,password,status" > "$CREDENTIALS_FILE"

for i in $(seq 1 "$COUNT"); do
    username="${PREFIX}$(printf '%02d' "$i")"

    echo ""
    log_info "--- [$i/$COUNT] 用户: $username ---"

    # 3a. 创建系统用户
    if id "$username" &>/dev/null; then
        log_warn "用户已存在，跳过创建"
        password="(existing)"
    else
        password=$(openssl rand -base64 $PASSWORD_LENGTH | tr -dc 'a-zA-Z0-9' | head -c $PASSWORD_LENGTH)
        useradd -m -s /bin/bash "$username"
        echo "${username}:${password}" | chpasswd
        log_ok "系统用户已创建"
    fi

    home=$(eval echo "~$username")

    # 3b. 配置 ~/.claude（Claude Code 配置）
    user_claude_dir="$home/.claude"
    sudo -u "$username" mkdir -p "$user_claude_dir/rules"

    # settings.json: 复制共享配置（用户可以后续个性化修改）
    cp "$SHARED_DIR/settings.json" "$user_claude_dir/settings.json"
    cp "$SHARED_DIR/config.json" "$user_claude_dir/config.json"

    # CLAUDE.md 和 rules: 用软链接指向共享配置（管理员改一处，全员生效）
    ln -sf "$SHARED_DIR/CLAUDE.md" "$user_claude_dir/CLAUDE.md"
    for rule_file in "$SHARED_DIR/rules/"*.md; do
        ln -sf "$rule_file" "$user_claude_dir/rules/$(basename "$rule_file")"
    done

    chown -R "$username":"$username" "$user_claude_dir"
    chmod 700 "$user_claude_dir"
    chmod 600 "$user_claude_dir/settings.json"
    chmod 600 "$user_claude_dir/config.json"
    log_ok "Claude Code 配置完成"

    # 3c. 配置 ~/.happy（Happy 配置）
    happy_dir="$home/.happy"
    sudo -u "$username" mkdir -p "$happy_dir/logs"
    chmod 700 "$happy_dir"

    # Happy settings.json（预置基本设置）
    machine_id=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')
    profile_id=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')
    now_ms=$(($(date +%s) * 1000))

    cat > "$happy_dir/settings.json" << HSEOF
{
  "schemaVersion": 2,
  "onboardingCompleted": false,
  "machineId": "${machine_id}",
  "daemonAutoStartWhenRunningHappy": true,
  "chromeMode": false,
  "activeProfileId": "${profile_id}",
  "profiles": [
    {
      "id": "${profile_id}",
      "name": "Shared Proxy",
      "description": "Team shared proxy profile",
      "anthropicConfig": {},
      "environmentVariables": [
        { "name": "ANTHROPIC_AUTH_TOKEN", "value": "${PROXY_AUTH_TOKEN}" },
        { "name": "ANTHROPIC_BASE_URL", "value": "http://${PROXY_HOST}:${PROXY_PORT}" },
        { "name": "ANTHROPIC_MODEL", "value": "${DEFAULT_MODEL}" }
      ],
      "compatibility": { "claude": true, "codex": true, "gemini": true },
      "defaultPermissionMode": "default",
      "isBuiltIn": false,
      "createdAt": ${now_ms},
      "updatedAt": ${now_ms},
      "version": "1.0.0"
    }
  ],
  "localEnvironmentVariables": {}
}
HSEOF

    chown -R "$username":"$username" "$happy_dir"
    chmod 600 "$happy_dir/settings.json"
    log_ok "Happy 配置完成"

    # 3d. 配置 systemd user service
    service_dir="$home/.config/systemd/user"
    sudo -u "$username" mkdir -p "$service_dir"

    cat > "$service_dir/happy-daemon.service" << 'SVCEOF'
[Unit]
Description=Happy CLI Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env happy daemon start-sync
Restart=on-failure
RestartSec=5
Environment=HAPPY_VARIANT=stable

[Install]
WantedBy=default.target
SVCEOF

    chown -R "$username":"$username" "$home/.config"
    log_ok "systemd service 已配置"

    # 3e. 启用 linger
    loginctl enable-linger "$username" 2>/dev/null || log_warn "enable-linger 失败（可能需要 systemd >= 236）"

    # 记录
    echo "${username},${password},created" >> "$CREDENTIALS_FILE"
done

# ======================== Step 4: 汇总 ========================

echo ""
echo "================================================================="
log_ok "部署完成！"
echo "================================================================="
echo ""
echo "共享代理: http://${PROXY_HOST}:${PROXY_PORT}"
echo "默认模型: ${DEFAULT_MODEL}"
echo "共享配置: ${SHARED_DIR}/"
echo ""
echo "--- 用户列表 ---"
column -t -s, < "$CREDENTIALS_FILE"
echo ""
echo "密码文件: $CREDENTIALS_FILE"
echo ""
echo "--- 目录结构 ---"
echo ""
echo "  /etc/claude-team/              <- 管理员统一管理"
echo "  ├── settings.json              <- 代理地址、模型、token"
echo "  ├── config.json                <- API key 配置"
echo "  ├── CLAUDE.md                  <- 团队行为指令"
echo "  └── rules/                     <- 团队编码规范"
echo ""
echo "  ~/.claude/                     <- 每用户（软链接 + 个人覆盖）"
echo "  ├── settings.json              <- 复制自共享（可个性化）"
echo "  ├── config.json                <- 复制自共享（可个性化）"
echo "  ├── CLAUDE.md -> /etc/...      <- 软链接到共享"
echo "  └── rules/ -> /etc/...         <- 软链接到共享"
echo ""
echo "  ~/.happy/                      <- 每用户独立"
echo "  ├── settings.json              <- Happy Profile（含代理配置）"
echo "  ├── access.key                 <- 配对后生成"
echo "  └── daemon.state.json          <- daemon 启动后生成"
echo ""
echo "--- 下一步 ---"
echo ""
echo "  1. 确保代理服务在 ${PROXY_HOST}:${PROXY_PORT} 运行"
echo "  2. 将密码分发给每个用户"
echo "  3. 每个用户 SSH 登录后运行:"
echo ""
echo "     happy                           # 扫码配对"
echo "     systemctl --user start happy-daemon  # 启动 daemon"
echo ""
echo "  4. 管理员修改团队规范:"
echo "     vim /etc/claude-team/CLAUDE.md  # 所有用户即时生效"
echo ""
log_warn "请妥善保管密码文件，分发后立即删除！"
echo "     rm $CREDENTIALS_FILE"
echo ""
