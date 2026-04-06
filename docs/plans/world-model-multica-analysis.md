# Multica 竞品分析

_Created: 2026-04-06_
_Purpose: 分析 Multica 架构，提取可借鉴模式，明确差异化方向_

## 项目概况

| 维度 | 详情 |
|------|------|
| 仓库 | `github.com/multica-ai/multica` |
| Stars | 2043 |
| 技术栈 | Go (Chi + sqlc) + Next.js 16 + PostgreSQL 17 + pgvector |
| 许可证 | Apache 2.0 |
| 定位 | AI-native 任务管理平台（Linear 替代品） |

---

## 核心架构

### 1. 多态 Assignee —— Agent 与人平级

Multica 最核心的设计决策：Issue 的 assignee 是多态的（`assignee_type` + `assignee_id`）。

- Agent 出现在 assignee 下拉列表，和人类同级
- Agent 可以创建 Issue、发评论、更新状态
- 统一的 Activity Feed 中人类和 Agent 行为交错展示

**启示**：Agent 的"自主性"从数据模型层面就要是一等公民，不能只是执行器。

### 2. Daemon 三循环架构

Daemon 是整个系统的心脏，运行三个并发 goroutine：

| 循环 | 间隔 | 职责 |
|------|------|------|
| **Poll Loop** | 3s | 信号量控制并发（默认 20），Round-Robin 轮转 Runtime，Claim 任务 |
| **Heartbeat Loop** | 15s | 在线检测，接收服务端指令（Ping / Update） |
| **Config Watcher** | 5s | 监控配置文件修改时间戳，热加载 Workspace |

**对比 Happy**：Happy CLI Daemon 也有心跳 + 轮询，但没有显式的 Config Watcher 热加载。

### 3. 任务生命周期状态机

```
Enqueue → Claim → Dispatch → Start → Complete/Fail
```

三种触发入口：
- **Direct Assignment**：Issue 指派给 Agent → `EnqueueTaskForIssue`
- **Mention-based**：评论中 @Agent → `EnqueueTaskForMention`
- **Runtime Distribution**：`ClaimTaskForRuntime` 在共享 Runtime 的 Agent 之间分配

关键机制：
- `ClaimTask` 是原子操作，检查 `running >= agent.MaxConcurrentTasks`
- 5 秒轮询的取消检测（daemon 侧主动轮询 server）
- `ReconcileAgentStatus` 自动设置 "working" / "idle" 状态

### 4. 两阶段 Prompt 构建（最精妙的设计）

**Stage 1 — 最小化 Prompt**：
```
"You are running as a local coding agent for a Multica workspace."
+ Issue ID
+ "Run `multica issue get [IssueID] --output json` to fetch details"
```

**Stage 2 — 动态注入**：
通过 `InjectRuntimeConfig` 写入 `CLAUDE.md` 或 `AGENTS.md`，内容包含：
- Agent Identity（自定义指令）
- CLI 命令文档（multica 子命令用法）
- 可用仓库列表
- 工作流引导
- Skills 列表 + 安全护栏

**为什么聪明**：不把信息塞进 prompt，而是给 Agent 工具让它自己查。
- Prompt 保持精简，token 成本低
- Agent 按需获取信息，更像人类工作方式
- 更新指令不需要改代码，只改注入文件

**Happy 可借鉴**：当前 Happy 是直接转发用户输入 + 注入 Skills 内容。可以改为最小 prompt + 注入 CLAUDE.md + 暴露平台 CLI 工具给 Agent。

### 5. 执行环境隔离

每个任务创建独立目录结构：
```
{WorkspacesRoot}/{WorkspaceID}/{taskID_short}/
├── workdir/    # Agent 工作目录
├── output/     # 任务结果
└── logs/       # 执行日志
```

关键设计：
- **不预检出代码**：Agent 按需通过 `multica repo checkout` 获取代码（Git Worktree 模式）
- **Provider-specific 上下文注入**：Claude → `.claude/skills/`，Codex → `.config/opencode/skills/`
- **环境复用**：`Reuse()` 可复用已有工作目录，只刷新上下文文件

**Happy 已有**：Worktree 隔离在 Supervisor 修复中已实现。

### 6. Agent 执行后端（Plugin 模式）

统一接口：
```go
Execute(ctx, prompt, ExecOptions) → (*Session, error)
```

Session 提供两个 Channel：
- `Messages <-chan Message`：流式事件
- `Result <-chan Result`：最终结果

支持 Claude / Codex / OpenCode 三个 Provider。

消息流采用三级批处理：累积 → 500ms 定时 flush → 5s 超时上报。Tool Result 截断到 8192 字符。

### 7. Skills 系统

- CRUD API 管理
- 支持附带文件（`SkillFile`，有目录遍历防护）
- 多对多关联到 Agent（`SetAgentSkills`）
- 支持从外部导入：ClawHub 和 Skills.sh（GitHub raw 下载）
- 写入 Agent 工作目录的 `.claude/skills/` 下

**Happy 已有**：Skills 系统完整实现，且支持从 Knowledge Base 派生。

### 8. Inbox 系统

- InboxItem 支持类型、严重度、关联 Issue
- 批量操作：全部已读、归档全部、归档已完成 Issue 的项
- Issue 级别分组归档

**Happy 已有**：Inbox 系统完整实现，功能类似。

---

## Happy vs Multica 对比矩阵

### Happy 领先的领域

| 维度 | Happy | Multica | 差距 |
|------|-------|---------|------|
| **E2E 加密** | AES-256-GCM / NaCl secretbox 全链路 | 完全没有，明文传输 | 巨大 |
| **知识库深度** | 病历系统 + 语义检索 + 衰减归档 + 关系图谱 + 生命周期 | 基础 pgvector | 巨大 |
| **Knowledge→Skill** | 一键提炼按钮 | 无 | 领先 |
| **Supervisor 循环** | 状态机 + 健康评分 + 成本管理 + 修复看门狗 | 无独立 Supervisor | 领先 |
| **Agent Loop** | 通用自治循环 + 多桥接（File/CI/Webhook） | 无 | 领先 |
| **AutoDream** | 自动知识整理 | 无 | 独有 |

### Multica 领先的领域

| 维度 | Multica | Happy | 差距 |
|------|---------|-------|------|
| **Agent 角色模型** | 具名 Agent + 身份 + 多态 Assignee | 同质化 Session | 关键差距 |
| **两阶段 Prompt** | 最小 prompt + CLAUDE.md 注入 + 平台 CLI | 直接转发 + Skills 注入 | 值得借鉴 |
| **多 Provider** | Claude / Codex / OpenCode，统一接口 | Claude / Codex / Gemini | 基本持平 |
| **技能市场** | ClawHub + Skills.sh 导入 | 无外部导入 | 生态差距 |
| **Issue 管理** | 完整的 Issue CRUD + 指派 | 无 | 需要决策是否要做 |
| **Config 热加载** | 监控文件变更，无需重启 | 需要重启 daemon | 小优化 |

### 两者都有的领域

| 维度 | 状态 |
|------|------|
| Task Queue | 基本等价 |
| Webhook 集成 | 基本等价（Happy 支持更多 provider） |
| Cron 调度 | 基本等价 |
| Skills 管理 | 基本等价 |
| Inbox 通知 | 基本等价 |
| Worktree 隔离 | 基本等价 |
| 实时通信 | 基本等价（Happy 用 Socket.IO，Multica 用 gorilla/websocket） |

---

## 可直接借鉴的模式

### 1. 两阶段 Prompt（高优先级）

改造 Task/Supervisor/AgentLoop 的 prompt 策略：
- Stage 1：极简 prompt（身份 + 任务 ID + "用以下命令获取详情"）
- Stage 2：注入 CLAUDE.md 到工作目录（叙事 + 法则 + 角色指令 + 可用工具）

收益：token 成本降低、Agent 按需获取信息、指令更新无需改代码。

### 2. Agent 身份（高优先级）

给 AgentLoop 加 role/identity 字段，不同角色有不同的：
- Skills 绑定
- Prompt 前缀（性格/职责描述）
- 权限范围
- 并发上限

### 3. Agent 反向操作能力（中优先级）

让执行中的 Agent 能通过 CLI/API 反向操作平台：
- 查询知识库
- 创建/更新任务
- 发送 Inbox 通知
- 查询其他 Agent 状态

### 4. Config 热加载（低优先级）

Daemon 监控配置文件变更，无需重启即可加载新的 AgentLoop 定义。

---

## 明确不借鉴的

| 模式 | 原因 |
|------|------|
| Issue 管理系统 | Happy 不做项目管理工具，这是 Multica 的定位 |
| 多态 Assignee | Happy 的模式不需要人和 Agent 在同一个 Issue 系统里共存 |
| bypassPermissions | 安全风险太大，Happy 保持权限控制 |
| 无加密传输 | Happy 的 E2E 加密是核心优势，绝不放弃 |

---

## 总结

Multica 在"Agent 角色定位"和"任务管理 UX"上做得好（Linear 替代品定位精准），但在底层基础设施（加密、知识管理）上远不如 Happy。

**Happy 需要从 Multica 学的不是功能，是思维方式**：把 Agent 从"执行我的命令"变成"在我定义的规则下自主工作"。这个转变的关键不在于加更多功能，而在于加一个**顶层概念模型**（World Model）把现有功能统一起来。
