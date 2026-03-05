# MCP 服务器与插件

本文档记录 Happy 项目开发环境中使用的 MCP (Model Context Protocol) 服务器和 Claude Code 插件。

## 已安装插件一览

| 插件 | 来源 | 版本 | 安装范围 | 说明 |
|------|------|------|----------|------|
| context7 | claude-plugins-official | 205b6e0b3036 | user | 第三方库文档查询 |
| claude-mem | thedotmack | 10.5.2 | user | 跨会话持久化记忆 |
| everything-claude-code | everything-claude-code | 1.4.1 | user | 工作流 skills 集合 |
| frontend-design | claude-plugins-official | 205b6e0b3036 | user | 前端设计审查 |

## context7 — 第三方库文档查询

查询任意第三方库的最新文档和代码示例，避免 AI 使用过时的 API。

### MCP 配置

```json
{
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  }
}
```

### 提供的工具

| 工具 | 用途 |
|------|------|
| `resolve-library-id` | 根据库名搜索获取 context7 兼容的 library ID |
| `query-docs` | 使用 library ID 查询该库的文档和代码示例 |

### 使用方式

```
1. resolve-library-id("react-native")  → 获取 library ID
2. query-docs(libraryId, query)        → 查询具体 API 文档
```

### 在 CLAUDE.md 中的约定

当需要查询第三方库用法时，必须先调用 `resolve-library-id` 再调用 `query-docs`。

---

## claude-mem — 跨会话记忆

为 AI 提供跨会话的持久化记忆能力，自动观察开发过程中的关键事件。

### MCP 配置

```json
{
  "mcp-search": {
    "type": "stdio",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.cjs"
  }
}
```

### 提供的工具

| 工具 | 用途 |
|------|------|
| `search` | 搜索记忆索引 |
| `timeline` | 获取时间线上下文 |
| `get_observations` | 获取记忆详情 |
| `smart_search` | AST 结构化代码搜索 |
| `smart_outline` | 文件结构大纲 |
| `smart_unfold` | 展开折叠代码 |

### 数据存储

所有数据在 `~/.claude-mem/`，详见 [claude-mem.md](./claude-mem.md)。

---

## everything-claude-code — 工作流 Skills 集合

提供大量预定义的 skills（可通过 `/skill-name` 调用），覆盖开发工作流各环节。

### 安装路径

```
~/.claude/plugins/cache/everything-claude-code/everything-claude-code/1.4.1/
```

### 主要 Skills 分类

| 类别 | Skills | 用途 |
|------|--------|------|
| 规划 | `plan` | 需求分析和实施规划 |
| TDD | `tdd`, `tdd-workflow` | 测试驱动开发 |
| 代码审查 | `go-review`, `python-review` | 语言级代码审查 |
| 安全 | `security-review`, `security-scan` | 安全审查和扫描 |
| 前端 | `frontend-patterns`, `e2e-testing` | 前端开发模式和测试 |
| 后端 | `backend-patterns`, `api-design` | 后端架构和 API 设计 |
| 数据库 | `database-migrations`, `postgres-patterns` | 数据库迁移和优化 |
| DevOps | `deployment-patterns`, `docker-patterns` | 部署和容器化 |
| 学习 | `continuous-learning`, `evolve` | 自动学习模式提取 |

### 在 CLAUDE.md 中的约定

- 新功能开发：必须先调用 `plan` skill
- Bug 修复：必须调用 `tdd` skill
- 代码完成后：调用 code-reviewer agent

---

## frontend-design — 前端设计审查

提供前端界面设计审查能力，辅助创建高质量的 UI。

### 安装路径

```
~/.claude/plugins/cache/claude-plugins-official/frontend-design/205b6e0b3036/
```

### 提供的 Skills

| Skill | 用途 |
|-------|------|
| `frontend-design` | 审查 UI 设计，提出优化建议 |

---

## 项目级 MCP 配置

Happy 项目当前没有项目级 `.mcp.json` 配置。所有 MCP 服务器均通过用户级插件系统管理（`~/.claude/plugins/installed_plugins.json`）。

### 全局 MCP Servers（settings.json）

当前 `~/.claude/settings.json` 中的 `mcpServers` 为空。所有 MCP 服务器由插件自动注册。

## 添加新的 MCP 服务器

### 方式一：通过插件市场安装

```bash
# 在 Claude Code 中
/install <plugin-name>
```

### 方式二：手动配置

在 `~/.claude/settings.json` 的 `mcpServers` 中添加：

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": {}
    }
  }
}
```

### 方式三：项目级配置

在项目根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "project-specific-server": {
      "command": "npx",
      "args": ["-y", "some-mcp-package"]
    }
  }
}
```

## 迁移到新机器

### 需要迁移的内容

1. **插件配置**：`~/.claude/plugins/installed_plugins.json`
2. **全局设置**：`~/.claude/settings.json`（含 MCP 服务器配置）
3. **claude-mem 数据**：`~/.claude-mem/`（详见 [claude-mem.md](./claude-mem.md)）
4. **插件缓存**（可选）：`~/.claude/plugins/cache/`（不迁移也会自动重新下载）

### 迁移脚本

```bash
# 在旧机器上打包
tar czf claude-config-backup.tar.gz \
  ~/.claude/settings.json \
  ~/.claude/plugins/installed_plugins.json \
  ~/.claude/rules/ \
  ~/.claude/agents/ \
  ~/.claude/CLAUDE.md \
  ~/.claude-mem/

# 传输并解压
scp claude-config-backup.tar.gz newserver:~/
ssh newserver "tar xzf ~/claude-config-backup.tar.gz -C /"

# 在新机器上重启 Claude Code，插件会自动重新下载
```
