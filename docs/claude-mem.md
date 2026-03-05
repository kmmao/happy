# claude-mem 跨会话记忆系统

claude-mem 是一个 Claude Code 插件，为 AI 提供跨会话的持久化记忆能力。它会自动观察开发过程中的关键事件（bugfix、feature、refactor 等），并存储为结构化的"观察记录"，在后续会话中提供上下文。

## 安装信息

| 字段 | 值 |
|------|-----|
| 插件来源 | `claude-mem@thedotmack` |
| 版本 | 10.5.2 |
| 安装路径 | `~/.claude/plugins/cache/thedotmack/claude-mem/10.5.2` |
| MCP 类型 | stdio（通过 `scripts/mcp-server.cjs` 启动） |

## 数据存储

所有数据存储在 `~/.claude-mem/` 目录下：

```
~/.claude-mem/
├── claude-mem.db           # 主数据库 (SQLite)
├── claude-mem.db-shm       # SQLite 共享内存
├── claude-mem.db-wal       # SQLite WAL 日志
├── chroma/                 # ChromaDB 向量数据库（语义搜索）
│   ├── chroma.sqlite3      # ChromaDB 元数据
│   └── <collection-id>/    # 向量索引文件
│       ├── data_level0.bin
│       ├── header.bin
│       ├── length.bin
│       └── link_lists.bin
├── settings.json           # 配置文件
├── logs/                   # 运行日志
├── observer-sessions/      # 观察者会话临时数据
└── worker.pid              # Worker 进程 PID
```

### SQLite 主库表结构

| 表名 | 用途 |
|------|------|
| `observations` | 核心记忆条目（bugfix、feature、refactor、discovery 等） |
| `observations_fts` | observations 的全文搜索索引 |
| `session_summaries` | 会话摘要 |
| `session_summaries_fts` | session_summaries 的全文搜索索引 |
| `sdk_sessions` | Claude Code SDK 会话记录 |
| `user_prompts` | 用户提示历史 |
| `user_prompts_fts` | user_prompts 的全文搜索索引 |
| `pending_messages` | 待处理消息队列 |
| `schema_versions` | 数据库版本管理 |

### observations 表字段

```sql
id                  -- 自增主键
memory_session_id   -- 关联的会话 ID
project             -- 项目名
type                -- 类型 (bugfix/feature/refactor/discovery/decision/change)
title               -- 标题
subtitle            -- 副标题
text                -- 原始文本
narrative           -- 叙述性描述
facts               -- 提取的事实
concepts            -- 概念标签 (how-it-works/why-it-exists/what-changed 等)
files_read          -- 读取的文件列表
files_modified      -- 修改的文件列表
prompt_number       -- 提示序号
discovery_tokens    -- 发现消耗的 token 数
content_hash        -- 内容哈希（去重用）
created_at          -- 创建时间
created_at_epoch    -- 创建时间戳
```

## 配置说明

配置文件位于 `~/.claude-mem/settings.json`，关键配置项：

| 配置项 | 当前值 | 说明 |
|--------|--------|------|
| `CLAUDE_MEM_MODEL` | `claude-haiku-4-5-20251001` | 用于观察分析的模型 |
| `CLAUDE_MEM_PROVIDER` | `claude` | AI 提供商 |
| `CLAUDE_MEM_CLAUDE_AUTH_METHOD` | `cli` | 认证方式（使用 Claude CLI 认证） |
| `CLAUDE_MEM_DATA_DIR` | `~/.claude-mem` | 数据存储目录 |
| `CLAUDE_MEM_WORKER_PORT` | `37777` | Worker 进程端口 |
| `CLAUDE_MEM_WORKER_HOST` | `127.0.0.1` | Worker 监听地址 |
| `CLAUDE_MEM_CONTEXT_OBSERVATIONS` | `50` | 上下文中包含的最大观察数 |
| `CLAUDE_MEM_CONTEXT_SESSION_COUNT` | `10` | 上下文中包含的会话数 |
| `CLAUDE_MEM_CHROMA_ENABLED` | `true` | 是否启用 ChromaDB 向量搜索 |
| `CLAUDE_MEM_CHROMA_MODE` | `local` | ChromaDB 模式（local/remote） |
| `CLAUDE_MEM_MODE` | `code` | 运行模式 |
| `CLAUDE_MEM_MAX_CONCURRENT_AGENTS` | `2` | 最大并发 agent 数 |

### 观察类型与概念过滤

```
CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES: bugfix, feature, refactor, discovery, decision, change
CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS: how-it-works, why-it-exists, what-changed, problem-solution, gotcha, pattern, trade-off
```

## MCP 工具

claude-mem 提供以下 MCP 工具：

| 工具 | 用途 |
|------|------|
| `search` | 搜索记忆，返回索引和 ID |
| `timeline` | 获取某个记忆周围的上下文时间线 |
| `get_observations` | 根据 ID 获取完整的观察详情 |
| `smart_search` | 使用 tree-sitter AST 解析进行代码结构搜索 |
| `smart_outline` | 获取文件的结构化大纲 |
| `smart_unfold` | 展开折叠的代码区块 |

### 推荐使用流程（3 层工作流）

```
1. search(query)              → 获取索引和 ID（低 token 消耗）
2. timeline(anchor=ID)        → 获取感兴趣结果的上下文
3. get_observations([IDs])    → 仅获取过滤后的完整详情
```

## 数据迁移

### 迁移到新机器

```bash
# 1. 停止 worker 进程
kill $(cat ~/.claude-mem/worker.pid) 2>/dev/null

# 2. 打包数据（排除日志和 PID）
tar czf claude-mem-backup.tar.gz \
  --exclude='logs' \
  --exclude='worker.pid' \
  --exclude='observer-sessions' \
  -C ~ .claude-mem/

# 3. 传输到新机器
scp claude-mem-backup.tar.gz newserver:~/

# 4. 在新机器上解压
ssh newserver "tar xzf ~/claude-mem-backup.tar.gz -C ~"

# 5. 修改配置中的路径（如用户名不同）
# 编辑 ~/.claude-mem/settings.json 中的 CLAUDE_MEM_DATA_DIR
```

### 必须迁移的文件

- `claude-mem.db` + `claude-mem.db-shm` + `claude-mem.db-wal` — 主数据库
- `chroma/` — 向量索引（否则语义搜索失效，需要重建）
- `settings.json` — 配置文件

### 无需迁移的文件

- `logs/` — 运行日志
- `worker.pid` — 进程 PID（会自动生成）
- `observer-sessions/` — 临时数据

## ChromaDB 远程模式（多机共享）

### 架构说明

claude-mem 的数据分两层：

```
┌─────────────────────────────────────────────┐
│  claude-mem worker                          │
│  ├── SQLite 主库 (observations, summaries)  │  ← 始终本地，是数据源
│  └── ChromaMcpManager (MCP client)          │
│       └── 通过 stdio 启动 chroma-mcp       │
│            ├── local 模式: 直接读写本地文件  │
│            └── remote 模式: HTTP 连接远程    │
└─────────────────────────────────────────────┘
```

- **SQLite** 是真正的数据源，所有 observations、summaries、prompts 都存在这里
- **ChromaDB** 是语义搜索索引层，数据从 SQLite 同步过来，用于向量化搜索
- 搜索流程：ChromaDB 语义匹配 → 拿到 SQLite ID → 从 SQLite 获取完整数据

### local 模式（当前使用）

```bash
# 底层命令
uvx chroma-mcp --client-type persistent --data-dir ~/.claude-mem/chroma
```

ChromaDB 以 `persistent` 模式直接读写 `~/.claude-mem/chroma/` 目录，无需额外服务。

### remote 模式

```bash
# 底层命令
uvx chroma-mcp --client-type http --host <host> --port <port> [--ssl] [--api-key <key>]
```

连接到远程 ChromaDB HTTP 服务器，多台机器可指向同一实例共享语义搜索。

### 切换到远程模式

**第 1 步：部署 ChromaDB 服务器**

```bash
# Docker 方式（推荐）
docker run -d \
  --name chromadb \
  -p 8000:8000 \
  -v chroma-data:/chroma/chroma \
  -e CHROMA_SERVER_AUTH_CREDENTIALS="your-api-key" \
  -e CHROMA_SERVER_AUTH_PROVIDER="chromadb.auth.token_authn.TokenAuthenticationServerProvider" \
  chromadb/chroma:latest
```

**第 2 步：修改配置**

编辑 `~/.claude-mem/settings.json`：

```json
{
  "CLAUDE_MEM_CHROMA_MODE": "remote",
  "CLAUDE_MEM_CHROMA_HOST": "your-server-ip-or-domain",
  "CLAUDE_MEM_CHROMA_PORT": "8000",
  "CLAUDE_MEM_CHROMA_SSL": "false",
  "CLAUDE_MEM_CHROMA_API_KEY": "your-api-key",
  "CLAUDE_MEM_CHROMA_TENANT": "default_tenant",
  "CLAUDE_MEM_CHROMA_DATABASE": "default_database"
}
```

**第 3 步：重启 worker 触发数据回填**

切换模式后远程 ChromaDB 是空的。重启 claude-mem worker 会自动执行 `backfillAllProjects()`，将 SQLite 中所有 observations、summaries、prompts 同步到远程 ChromaDB。

回填逻辑是增量的（smart backfill）：先查询远程已有的 ID，只同步缺失的数据。

### ChromaDB 远程模式配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `CLAUDE_MEM_CHROMA_MODE` | `local` | `local`=本地文件 / `remote`=HTTP 远程 |
| `CLAUDE_MEM_CHROMA_HOST` | `127.0.0.1` | 远程服务器地址 |
| `CLAUDE_MEM_CHROMA_PORT` | `8000` | 远程服务器端口 |
| `CLAUDE_MEM_CHROMA_SSL` | `false` | 是否启用 SSL/TLS |
| `CLAUDE_MEM_CHROMA_API_KEY` | 空 | API Key 认证（可选） |
| `CLAUDE_MEM_CHROMA_TENANT` | `default_tenant` | ChromaDB 多租户 tenant |
| `CLAUDE_MEM_CHROMA_DATABASE` | `default_database` | ChromaDB database 名称 |

### 远程模式的限制

| 方面 | 说明 |
|------|------|
| **SQLite 始终本地** | 主数据库不走远程，每台机器独立维护 |
| **ChromaDB 仅做语义搜索** | 是 SQLite 的索引层，不是数据源 |
| **多机可共享向量搜索** | 多台机器指向同一远程 ChromaDB 即可 |
| **多机不共享主数据** | 每台机器的 observations 独立 |
| **90 天搜索窗口** | 搜索结果默认只返回近 90 天的记忆 |
| **自动回填** | worker 启动时自动补齐缺失数据 |
| **连接断开自动重连** | 10 秒 backoff 后自动重连，30 秒连接超时 |
| **企业代理兼容** | macOS 自动检测 Zscaler 证书并合并到 SSL bundle |

### 多机完整同步方案

远程 ChromaDB 只共享语义搜索能力。如果需要多台机器共享完整记忆数据：

**方案 A：rsync 同步 SQLite + 远程 ChromaDB**

```bash
# 定期从主机同步 SQLite 到从机
rsync -avz ~/.claude-mem/claude-mem.db* remote-host:~/.claude-mem/

# 所有机器配置相同的远程 ChromaDB
```

- 优点：简单直接
- 缺点：SQLite 不支持并发写入，需单向同步

**方案 B：各机独立 + 定期合并**

```bash
# 导出某台机器的 observations
sqlite3 ~/.claude-mem/claude-mem.db ".dump observations" > obs-machine-a.sql

# 在另一台机器导入（需处理 ID 冲突）
sqlite3 ~/.claude-mem/claude-mem.db < obs-machine-a.sql
```

- 优点：无冲突风险
- 缺点：需要手动操作，ID 冲突需处理

**方案 C：Syncthing 双向同步**

使用 Syncthing 同步 `~/.claude-mem/` 目录，利用 SQLite WAL 模式减少冲突。

- 优点：自动化
- 缺点：极端情况下 SQLite 可能损坏，建议配合定期备份
