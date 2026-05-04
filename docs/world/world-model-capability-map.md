# 现有能力 → World Model 映射

_Created: 2026-04-06_
_Purpose: 盘点 Happy 已有的全部能力，映射到 World Model 概念，识别缺口_

## 能力全景图

```
触发源                    调度层                    执行层                   反馈层
─────────                ─────────                ─────────               ─────────
Cron ──────────┐                                                          ┌→ Inbox
Webhook ───────┤         Task Queue ──────┐                               ├→ Knowledge
GitHub Issue ──┤───→     AutomationScheduler ──→   CLI Daemon ──→ Agent ──┤  Base
手动操作 ──────┤         SupervisorLoop ───┘       ├─ 普通会话             ├→ Session
文件变更 ──────┘                                   ├─ 修复会话 (worktree)  │  Events
                                                   ├─ Agent Loop           └→ 推送通知
                                                   └─ AutoDream
```

---

## 按系统盘点

### 1. Task Queue（任务队列）

| 属性 | 详情 |
|------|------|
| 包 | happy-server, happy-cli, happy-wire |
| 关键文件 | `server/sources/app/api/routes/taskRoutes.ts`, `prisma/schema.prisma` |
| 成熟度 | ✅ 完全实现 |

能力清单：
- ✅ 任务 CRUD（创建、列表、取消、重试）
- ✅ 三级优先级（urgent > user > background）
- ✅ 任务分派到 CLI Daemon（ephemeral events）
- ✅ Skill 绑定（最多 10 个）
- ✅ 加密提示词（E2E）
- ✅ 触发来源追踪（manual / cron / webhook）

**World Model 映射** → **建筑师的工作队列**

缺口：
- ❌ 任务没有关联到"目标"（Goal）
- ❌ 没有任务间依赖关系
- ❌ 没有角色绑定（谁来执行）

---

### 2. Supervisor（监督者系统）

| 属性 | 详情 |
|------|------|
| 包 | happy-server, happy-cli |
| 关键文件 | `server/sources/modules/supervisor*.ts`, `cli/src/supervisor/` |
| 成熟度 | ✅ 高度完整 |

能力清单：
- ✅ 循环状态机（idle → analyzing → fixing → deciding）
- ✅ 健康评分机制
- ✅ 成本上限和迭代上限
- ✅ 自动批准（confidence ≥ threshold）
- ✅ Worktree 隔离修复
- ✅ 修复看门狗（5 分钟超时）
- ✅ 并发限制
- ✅ 日运行限制
- ✅ 研究模式

**World Model 映射** → **守卫 + 医生的职责合体**

缺口：
- ❌ 没有按"法则"检查，而是通用质量扫描
- ❌ 分析和修复没有角色分离（同一个 Supervisor 既发现又修复）
- ❌ 没有判例法引用（每次重新分析，不参考历史决策）

---

### 3. Agent Loop（自治循环）

| 属性 | 详情 |
|------|------|
| 包 | happy-cli |
| 关键文件 | `cli/src/automation/AgentLoop*.ts`, `AutomationScheduler.ts` |
| 成熟度 | 🟨 高度完整 |

能力清单：
- ✅ 定时执行（cron 或间隔）
- ✅ 文件观察触发
- ✅ GitHub 事件桥接
- ✅ CI/CD 动作桥接
- ✅ Webhook 桥接
- ✅ 记忆和反思
- ✅ 下游循环触发
- ✅ 通知通道
- ✅ 静默时段
- ✅ 每日运行限制

**World Model 映射** → **可配置为任意角色的 Agent 实例**

缺口：
- ❌ 没有"角色"概念，所有 Loop 是同质的
- ❌ 没有身份/职责/权限区分
- ❌ Loop 之间没有通信机制
- ❌ 没有关联到项目法则或目标

---

### 4. Trigger 系统（触发器）

| 属性 | 详情 |
|------|------|
| 包 | happy-server |
| 关键文件 | `server/sources/modules/triggerScheduleRunner.ts`, `server/sources/app/api/routes/webhookTriggerRoutes.ts` |
| 成熟度 | ✅ 完全实现 |

**4A. Cron 触发器 (TriggerSchedule)**
- ✅ Cron 表达式解析
- ✅ 心跳时检查到期任务（~5min throttle）
- ✅ 乐观锁防重复
- ✅ 防止并发执行

**4B. Webhook 触发器 (WebhookTrigger)**
- ✅ 公开端点 `/v1/triggers/:slug`
- ✅ Bearer token 验证（timing-safe）
- ✅ Payload 变量替换 `{{payload}}`
- ✅ 防枚举（统一返回 401）

**World Model 映射** → **世界的感知系统（法则检测的触发机制）**

缺口：
- ❌ 触发器和法则没有关联（触发什么完全手动配置）
- ❌ 没有"法则违规"类型的触发器

---

### 5. Webhook 系统（代码仓库集成）

| 属性 | 详情 |
|------|------|
| 包 | happy-server |
| 关键文件 | `server/sources/app/webhook/webhook*.ts` |
| 成熟度 | ✅ 完全实现 |

能力清单：
- ✅ GitHub / Gitea / GitLab 多平台
- ✅ 签名验证（HMAC SHA-256）
- ✅ 标签和作者过滤
- ✅ 去重处理（deliveryId）
- ✅ Issue / PR 事件解析

**World Model 映射** → **世界的外交通道（与外部世界的接口）**

缺口：无明显缺口，功能完善。

---

### 6. Knowledge Base（知识库）

| 属性 | 详情 |
|------|------|
| 包 | happy-server, happy-cli, happy-wire |
| 关键文件 | `server/sources/modules/knowledge*.ts`, `server/sources/app/api/routes/knowledgeRoutes.ts` |
| 成熟度 | 🟨 高度完整 |

能力清单：
- ✅ 条目 CRUD + 超级化（supersede）
- ✅ 5 种条目类型（discovery / decision / fix / convention / warning）
- ✅ 4 种分类（user / feedback / project / reference）
- ✅ 贡献者追踪（session / supervisor / user / auto-dream）
- ✅ 标签和过滤
- ✅ 关系图谱（related / contradicts / refines / combines）
- ✅ 衰减和归档（1h 周期）
- ✅ 自动合并（6h 周期）
- ✅ 访问计数追踪
- ✅ 固定条目（pinned）
- ✅ Knowledge → Skill 一键提炼
- ⏳ 语义嵌入搜索（pgvector，部分实现）

**World Model 映射** → **世界的记忆 + 判例法存储**

缺口：
- ❌ 没有"判例"类型（Decision 的结果写入）
- ❌ 没有法则关联（哪些知识是法则派生的）
- ❌ Agent 执行时不能主动查询知识库（只有被动注入）

---

### 7. Skills 系统（技能）

| 属性 | 详情 |
|------|------|
| 包 | happy-server, happy-app, happy-wire |
| 关键文件 | `server/sources/app/api/routes/skillRoutes.ts` |
| 成熟度 | ✅ 完全实现 |

能力清单：
- ✅ 全局和项目级别
- ✅ 指令模板管理
- ✅ 附件支持
- ✅ 从知识库派生
- ✅ 归档功能
- ✅ 注入到 Task（按顺序）

**World Model 映射** → **角色的技能证书**

缺口：
- ❌ 没有角色绑定（哪些技能属于哪个角色）
- ❌ 没有技能市场/外部导入（Multica 有 ClawHub + Skills.sh）

---

### 8. Inbox 系统（收件箱）

| 属性 | 详情 |
|------|------|
| 包 | happy-server, happy-app, happy-wire |
| 关键文件 | `server/sources/modules/inboxCreate.ts`, `server/sources/app/api/routes/inboxRoutes.ts` |
| 成熟度 | ✅ 完全实现 |

能力清单：
- ✅ 多分类（task / trigger / supervisor / session / knowledge / system）
- ✅ 严重度（info / warning / error）
- ✅ 多态引用（refType + refId）
- ✅ 1 小时内去重（groupKey）
- ✅ 推送通知集成
- ✅ 实时更新（ephemeral events）
- ✅ 深链接支持（referenceUrl）

**World Model 映射** → **上帝的通知面板 + 裁决入口**

缺口：
- ❌ 只有通知，没有"裁决"流程（不能在 Inbox 里做决策）
- ❌ 没有 Decision 类型的 InboxItem

---

### 9. Daemon 进程

| 属性 | 详情 |
|------|------|
| 包 | happy-cli |
| 关键文件 | `cli/src/daemon/run.ts`, `cli/src/daemon/controlServer.ts` |
| 成熟度 | ✅ 完全实现 |

能力清单：
- ✅ 心跳机制
- ✅ 任务分派和状态报告
- ✅ 会话跟踪（TrackedSessionRegistry）
- ✅ 工作树隔离和清理
- ✅ 自动化作业队列
- ✅ 修复并发限制
- ✅ 会话恢复

**World Model 映射** → **世界的物理引擎（让一切运转的底层）**

缺口：
- ❌ 没有 Config 热加载（Multica 有）
- ❌ 没有 Agent 状态可视化（idle / working / blocked）

---

### 10. 事件路由（Event Router）

| 属性 | 详情 |
|------|------|
| 包 | happy-server |
| 关键文件 | `server/sources/app/events/eventRouter.ts` |
| 成熟度 | ✅ 完全实现 |

能力清单：
- ✅ 持久事件（new-message, update-session, task-status-changed 等）
- ✅ 临时事件（task-trigger, supervisor-trigger, inbox-new-item 等）
- ✅ 三种范围（session-scoped, user-scoped, machine-scoped）

**World Model 映射** → **世界的信息总线**

缺口：
- ❌ 没有 Agent-to-Agent 事件通道
- ❌ 事件没有法则/目标上下文

---

## 缺口汇总

### 核心缺口（必须新建）

| 缺口 | 影响 | 优先级 |
|------|------|--------|
| **法则系统 (Laws)** | 没有声明式约束，Supervisor 只做通用扫描 | P0 |
| **角色系统 (Roles)** | 所有 Agent 同质化，无法分工协作 | P0 |
| **裁决机制 (Decisions)** | Agent 要么自作主张，要么完全不做 | P1 |
| **目标系统 (Goals)** | 没有从高层目标到任务的自动分解 | P2 |
| **Agent 间通信** | Agent 之间完全隔离，无法协作 | P2 |

### 增强缺口（在现有系统上扩展）

| 缺口 | 现有系统 | 需要的扩展 | 优先级 |
|------|---------|-----------|--------|
| Supervisor 按法则检查 | Supervisor 通用扫描 | 注入 laws 到分析 prompt | P0 |
| Agent 反向查询知识库 | Knowledge Base 被动注入 | 暴露为 Agent 可调用的 tool | P1 |
| 任务关联目标 | Task Queue | 加 goalId 字段 | P2 |
| 任务关联角色 | Task Queue | 加 role 字段 | P1 |
| Inbox 裁决流程 | Inbox 通知 | 加 Decision 类型 + 操作按钮 | P1 |
| 判例法写入 | Knowledge Base | 加 precedent 条目类型 | P1 |
| Agent 状态可视化 | Daemon 内部状态 | 暴露到 App 显示 | P1 |
| Config 热加载 | Daemon 需重启 | 文件监控 + 动态加载 | P2 |

---

## 现有系统 → World Model 完整映射表

```
World Model 概念          现有系统                 改造方式
──────────────           ────────                 ────────
World (世界)             Project                  加 narrative + laws 字段
Laws (法则)              无                       新建 ProjectLaw 模型
Narrative (叙事)         无                       Project.narrative 字段
Goals (目标)             无                       新建 Goal 模型
Agent Roles (角色)       无                       AgentLoop 加 role 字段 / 新建 AgentRole
Guardian (守卫)          Supervisor (安全类)       角色化改造
Builder (建筑师)         Task 执行者               角色化改造
Healer (医生)            Supervisor (修复类)       角色化改造
Chronicler (史官)        Knowledge 生命周期        角色化改造
Planner (规划者)         无                       新增角色
Messenger (信使)         无                       新增角色（Phase 4+）
Adjudication (裁决)      无                       新建 Decision 模型 + Inbox 扩展
Precedent (判例法)       Knowledge Base            加条目类型
World Memory (记忆)      Knowledge Base            已有，扩展判例
World History (历史)     SessionEvent + Inbox      已有，扩展时间线视图
World Perception (感知)  Trigger + Webhook         已有，关联法则
World Engine (引擎)      Daemon + EventRouter      已有
```
