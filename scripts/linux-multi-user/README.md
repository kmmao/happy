# Linux 多用户部署工具

在一台 Linux 服务器上为多人部署 Happy + Claude Code，共享同一个 API 代理。

## 快速开始

```bash
# 1. 部署（创建 5 个用户，安装 Happy，预置配置）
sudo ./deploy.sh

# 2. 查看状态
sudo ./status.sh

# 3. 每个用户 SSH 登录后
happy                                    # 扫码配对
systemctl --user start happy-daemon      # 启动 daemon
```

## 脚本说明

| 脚本 | 用途 |
|------|------|
| `deploy.sh [数量] [前缀]` | 批量创建用户 + 安装配置 |
| `status.sh` | 查看所有用户的运行状态 |
| `update-proxy.sh` | 批量更新代理地址/token/模型 |
| `cleanup.sh [前缀] [数量]` | 删除批量创建的用户 |

## 配置架构

```
/etc/claude-team/              管理员统一管理（改一处全员生效）
├── settings.json              代理地址、模型、token
├── config.json                API key
├── CLAUDE.md                  团队行为指令
└── rules/*.md                 编码规范

~/.claude/                     每用户（软链接 + 可个性化）
├── settings.json              复制自共享（用户可覆盖）
├── CLAUDE.md -> /etc/...      软链接（跟随共享）
└── rules/ -> /etc/...         软链接（跟随共享）

~/.happy/                      每用户独立
├── settings.json              Happy Profile
├── access.key                 配对凭证（扫码后生成）
└── daemon.state.json          Daemon 状态
```

## 常用操作

```bash
# 更新代理地址
sudo ./update-proxy.sh --host 10.0.0.1 --port 8317

# 只改 token
sudo ./update-proxy.sh --token "new-token-here"

# 改默认模型
sudo ./update-proxy.sh --model "claude-opus-4-6"

# 修改团队规范（所有人即时生效）
sudo vim /etc/claude-team/CLAUDE.md

# 清理所有用户
sudo ./cleanup.sh
```
