# World Model 功能指南

> 本文档面向开发者和高级用户，说明世界模型（World Model）子系统的各项功能、配置方式及影响范围。

---

## 目录

1. [概念总览](#1-概念总览)
2. [核心概念](#2-核心概念)
3. [功能模块详解](#3-功能模块详解)
   - 3.1 [世界宪法（Narrative + Laws）](#31-世界宪法-narrative--laws)
   - 3.2 [角色系统（Agent Roles）](#32-角色系统-agent-roles)
   - 3.3 [目标系统（Goals）](#33-目标系统-goals)
   - 3.4 [目标健康度（Goal Health）](#34-目标健康度-goal-health)
   - 3.5 [建议系统（World Suggestions）](#35-建议系统-world-suggestions)
   - 3.6 [自动接受（Auto-Accept）](#36-自动接受-auto-accept)
   - 3.7 [裁决系统（Decisions）](#37-裁决系统-decisions)
   - 3.8 [Agent 消息（Agent Messages）](#38-agent-消息-agent-messages)
   - 3.9 [自治统计（Autonomy Stats）](#39-自治统计-autonomy-stats)
   - 3.10 [团队协作（WorldMember）](#310-团队协作-worldmember)
   - 3.11 [Decision 智能路由](#311-decision-智能路由)
   - 3.12 [审计日志（WorldAuditLog）](#312-审计日志-worldauditlog)
   - 3.13 [Agent 升级路径](#313-agent-升级路径)
4. [CLI 如何上报 AgentMessage](#4-cli-如何上报-agentmessage)
5. [Goal 分解与 Task 调度](#5-goal-分解与-task-调度)
6. [App 界面入口](#6-app-界面入口)
7. [数据模型与影响范围](#7-数据模型与影响范围)
8. [API 端点一览](#8-api-端点一览)
9. [配置参数](#9-配置参数)
10. [数据流向图](#10-数据流向图)
11. [常见问题](#11-常见问题)

---

## 1. 概念总览

世界模型是 Happy 的「上帝视角」层：用户作为**立法者**为项目设定叙事、规则和角色，Agent 在这套框架内自主执行任务、提出建议、请求裁决。

```
用户（立法者）
  ↓  设定叙事 / 规则 / 角色
世界宪法
  ↓  注入
Supervisor 提示词
  ↓  驱动
Agent 执行 → 产出建议 / 消息 / 裁决请求
  ↓  汇聚
App 世界 Tab（总览 / 目标 / 角色）
  ↓  用户审阅 & 决策
```

---

## 2. 核心概念

| 概念 | 说明 |
|------|------|
| **Narrative（叙事）** | 项目的愿景文本，注入 Supervisor 提示词，影响 Agent 行为方向 |
| **Laws（规则）** | JSON 数组，每条规则有类别、描述、严重级别、启用开关 |
| **Agent Role（角色）** | 为 Agent 分配的职责身份，影响目标分解和任务调度时的角色归属 |
| **WorldMember（团队成员）** | 项目的人类参与者，拥有角色绑定、并发容量、专长标签、权限和通知偏好 |
| **Goal（目标）** | 用户或系统创建的可分层目标，由 Planner Agent 分解为 Task |
| **World Suggestion（建议）** | 系统基于现状生成的「下一步行动」提案，需用户或系统接受/驳回 |
| **Decision（裁决）** | Agent 遭遇不确定时上报给用户的决策请求 |
| **Agent Message（消息）** | Agent 之间的协作消息（冲突、移交、依赖阻塞等） |

---

## 3. 功能模块详解

### 3.1 世界宪法（Narrative + Laws）

**存储位置：** `Project.narrative`（字符串）、`Project.laws`（JSON 数组）

**作用：**
- Narrative 描述项目愿景，写入 Supervisor 系统提示词
- Laws 是行为约束规则，优先级影响 Agent 决策边界

**规则结构：**
```json
{
  "id": "law_xxx",
  "category": "quality",
  "description": "所有代码变更必须有对应测试",
  "enabled": true,
  "severity": "critical"
}
```

**severity 值：** `critical` | `warning` | `info`

**App 入口：** 项目详情 → 世界 Tab → 点击世界宪法卡片 → `/project/[id]/world-laws`

**生成方式：** 点击「自动生成」或「自定义提示词」调用 `POST /v1/projects/:id/world/generate`

**影响范围：**
- `worldConstitutionGenerator.ts`：生成逻辑
- Supervisor 提示词构建（系统提示词注入）
- `lawCount`：显示在世界概览 Dashboard 中

---

### 3.2 角色系统（Agent Roles）

**存储位置：** `AgentRole` 表

**内置类型（type 字段）：**
| 类型 | 职责 |
|------|------|
| `guardian` | 守卫者，关注安全与质量 |
| `builder` | 建造者，专注功能开发 |
| `healer` | 修复者，处理 Bug 和回归 |
| `chronicler` | 记录者，维护文档 |
| `planner` | 规划者，负责目标分解 |
| `messenger` | 信使，Agent 间协调 |
| `custom` | 自定义 |

**关键字段：**
- `description`：角色行为指令，注入提示词
- `duties`：职责列表（JSON 数组）
- `skillIds`：绑定的 Skill ID 列表
- `maxConcurrency`：**已废弃**（@deprecated）。并发容量已迁移到 WorldMember.maxConcurrency，按人而非按角色控制
- `enabled`：是否启用

**影响范围：**
- 目标分解时 Planner 按角色分配 Task 的 `roleType`，然后 `taskAssignMember` 自动将任务分配给绑定了该角色的最闲成员
- `roleCollaboration.ts`：生成协作摘要（协作 Tab 数据）
- World Dashboard 中的角色统计数字
- Agent 消息的 `fromRole` / `toRole` 关联

**App 入口：** 项目 → 世界 Tab → 角色卡片 → WorldRolesTab

---

### 3.3 目标系统（Goals）

**存储位置：** `Goal` 表

**状态流转：**
```
planning → in_progress → completed
                      ↘ blocked → in_progress（人工解除后）
                               ↘ cancelled
```

**层级（layer 字段）：**
- `strategic`：根目标且有子目标（最高层）
- `operational`：中间层（有父也有子，或根目标但有任务）
- `execution`：叶节点（有父但无子目标）

层级由 `classifyGoalLayer()` 函数自动计算，无需手动设置。

**关键字段：**
- `machineId`：任务调度到哪台机器执行
- `plannerTaskId`：负责分解此目标的 Task ID
- `blockedSince`：进入 blocked 状态的时间点（用于健康度计算）
- `healthScore`：0-100，由 `goalHealthEngine` 计算
- `layer`：目标层级

**App 入口：** 项目 → 目标 Tab → WorldGoalsTab

**影响范围：**
- `goalRoutes.ts`：CRUD + 分解 + 取消 + 重规划
- `goalHealthEngine.ts`：健康度计算
- `worldSuggestionGenerate.ts`：建议生成时读取目标状态
- Supervisor 提示词（目标摘要注入）

---

### 3.4 目标健康度（Goal Health）

**触发时机：** `worldSuggestionGenerate.ts` 收集建议事实时，调用 `refreshGoalHealthScores()` 批量更新所有活跃目标的 `healthScore` 和 `layer`。

**检测信号：**

| 信号 | 条件 | 默认严重级别 |
|------|------|------------|
| `stale_in_progress` | `in_progress` 目标 48h 无任务更新 | warning；96h → critical |
| `blocked_aging` | `blocked` 状态超 24h | warning；72h → critical |
| `repeated_failure` | 失败任务 ≥ 3 个 | critical |
| `all_tasks_terminal_with_failures` | 所有任务终态且有失败 | critical |
| `narrative_deviation` | 目标进展与叙事矛盾（需传入 narrative） | warning |

**评分规则（`score` 字段）：**
- 无信号：100 分
- 每个 warning 扣 15 分
- 每个 critical 扣 30 分
- 最低 0 分

**阈值含义：**
- ≥ 70：healthy（绿色）
- 30-69：warning（黄色）
- < 30：critical（红色）

**Dashboard 显示：**
- `avgHealthScore`：所有有得分目标的均值
- `criticalCount` / `warningCount` / `healthyCount`
- 按层级（strategic / operational / execution）分类统计

---

### 3.5 建议系统（World Suggestions）

**存储位置：** `WorldSuggestion` 表

**建议类型（type 字段）：**
| 类型 | 说明 | accept 创建的实体 |
|------|------|-----------------|
| `suggested_goal` | 建议创建新目标 | `Goal` |
| `suggested_task` | 建议创建新任务 | `Task`（直接调度） |
| `suggested_skill` | 建议从此次任务提炼 Skill | `Skill` |
| `suggested_decision` | 需要用户做决策 | `Decision` |

**分桶（bucket 字段）：**
| Bucket | 含义 |
|--------|------|
| `next_step` | 系统建议的下一步行动（无需人工，可自动接受） |
| `needs_decision` | 需要用户决策 |
| `needs_human_input` | 需要人工介入（有 Agent 消息证据或 requiresHuman=true） |

**状态流转：**
```
open → processing → accepted
                 ↘ dismissed
     ↘ expired（过期）
     ↘ suspended（暂停）
```

**去重（dedupeKey）：** 相同 dedupeKey 的建议不会重复生成，避免刷屏。

**生成触发：**
- 用户手动点击「刷新建议」→ `POST /v1/projects/:id/world/suggestions/refresh`
- 系统自动（Supervisor Loop 完成后触发）

**建议生成逻辑（`worldSuggestionGenerate.ts`）：**
1. `collectSuggestionFacts`：查询目标、任务、Decisions、AgentMessages 等现状
2. `refreshGoalHealthScores`：更新目标健康度
3. `buildSuggestionCandidates`：生成候选（含健康度建议）
4. 去重 + 写入 DB

---

### 3.6 自动接受（Auto-Accept）

**配置入口：** 项目 → Supervisor 设置 → 世界自治模式

**自治级别（supervisorMode）：**
| 级别 | 说明 |
|------|------|
| `disabled` | 不自动接受，所有建议需人工处理 |
| `suggest` | 只展示建议，不自动接受 |
| `semi-auto` | 自动接受安全的 `suggested_task`（单步任务） |
| `auto` | 自动接受扩展集（含 `suggested_goal` + `stale_goal_attention` 类健康建议） |

**限制参数（存储在 Project.supervisorConfig 的 worldAutonomy 字段）：**
- `maxAutoAcceptsPerDay`：每日最大自动接受数（null = 不限）
- `maxConcurrentAutoTasks`：最大并发自动任务数（null = 不限）

**自动接受检查链（`worldSuggestionAutoAccept.ts`）：**
1. 检查 supervisorMode 是否启用
2. 检查 type 是否在 `autoAcceptTypes` 列表中
3. 检查每日配额（`quota_exhausted`）
4. 检查并发数（已在运行中的自动任务）
5. 检查 `already_acted`（已处理过）
6. 调用 `worldSuggestionAccept` 创建实体

**结果记录（写入 WorldSuggestion）：**
- `acceptSource`：`human`（人工）或 `system_auto`（自动）
- `acceptAudit`：`{ rule: string, checks: CheckResult[] }` — 逐步审计链
- `autoAcceptStatus`：`skipped`（跳过）或 `failed`（失败）
- `autoAcceptReasonCode`：跳过/失败原因
- `autoAcceptFailureDetail`：失败细节

**App 中的显示：** SuggestionCard 上会展示徽章（已自动接受 / 已跳过 / 失败原因）

---

### 3.7 裁决系统（Decisions）

**存储位置：** `Decision` 表

**状态：** `pending` | `decided` | `expired` | `auto_resolved`

**创建来源：**
- Agent 执行中遇到不确定情况，调用接口创建
- 建议系统 accept `suggested_decision` 时创建

**Decision 等待机制（Task↔Decision 联动）：**

当 Agent 通过 `decision_request` 消息请求裁决时：
1. 服务端自动创建 Decision（pending）
2. 按 `sessionId` 找到运行中的 Task，将其状态更新为 `waiting_decision`，记录 `waitingDecisionId`
3. 释放该角色的并发槽位，允许队列中的下一个任务被派发
4. 用户在 App 中裁决后（`decisionAdjudicate`）：
   - 找到所有 `waitingDecisionId = decisionId` 的暂停任务
   - 为每个暂停任务创建**延续任务**（原始 prompt + 裁决结果）
   - 取消原始暂停任务
   - 检查并发槽位后派发延续任务（超限则排队）

```
Agent 执行中 → decision_request → Task 暂停 (waiting_decision) → 释放并发槽
    ↓
用户裁决 → 创建延续 Task (原始 prompt + 裁决结果) → 并发检查 → 派发或排队
```

**Task 状态 `waiting_decision`：**
- 不属于终态（completed/failed/cancelled）
- 不在进度序列中（queued→dispatching→running），因此可从任何非终态转入，也可转出到任何状态
- CLI 侧：Task 实际上仍在运行（CLI 不感知 Server 的 waiting_decision 状态），Server 只是在语义上标记为暂停

**影响范围：**
- World Dashboard 中 `decisions.pending` 计数
- `decisions.recentDecided` 最近 5 条已决列表
- Autonomy Score 计算（已决定 vs 待定 vs 过期）
- AgentMessage 的 `decisionId` 关联（冲突升级为裁决时）
- Task 的 `waitingDecisionId` 关联（暂停等待裁决时）

---

### 3.8 Agent 消息（Agent Messages）

**存储位置：** `AgentMessage` 表

**消息类型（msgType）：**
| 类型 | 说明 |
|------|------|
| `request` | Agent 请求人工介入或其他角色协助 |
| `report` | Agent 上报进度或结果 |
| `conflict` | 角色间冲突（可升级为 Decision） |
| `law_suggestion` | Agent 建议添加新规则 |
| `handoff` | 任务移交 |
| `dependency_blocked` | 等待依赖 |
| `review_request` | 请求代码/输出审查 |

**优先级（priority）：** `urgent` | `normal` | `low`

**影响范围：**
- World Dashboard `agentMessages` 30 天统计
- WorldGoalsTab：目标被 Agent 消息阻塞时展示 Blocker 摘要
- Suggestion 生成：有未解决消息的目标会被标记为 `needs_human_input`
- 协作 Tab（RoleCollaborationSection）

---

### 3.9 自治统计（Autonomy Stats）

**API：** `GET /v1/projects/:id/world/autonomy-stats`

**Autonomy Score 计算（`autonomyScore.ts`）：**
- 最近 30 天的 Decision 统计
- 公式：`score = (decided + autoResolved) / total * 100`（近似）

**数据展示（AutonomyStatusSection 组件）：**
- 自治分数（0-100%）：< 50 红色，< 80 黄色，≥ 80 绿色
- 30 天内已决定 / 自动解决 / 待定 / 过期数量

**影响范围：**
- GovernanceDashboard：显示自治策略并允许修改
- World Dashboard 汇总卡片

### 3.10 团队协作（WorldMember）

**存储位置：** `WorldMember` 表

**角色层级与权限：**
| 角色 | API 访问（requireRole） | decisionScope 默认 | notifyLevel 默认 |
|------|:---:|:---:|:---:|
| `owner` | 全部操作 | all | all |
| `admin` | 管理操作（CRUD 成员/角色） | all | all |
| `member` | 基础操作（读取、提交意见） | assigned | assigned |
| `observer` | 只读 | none | critical |

> **实际强制执行的权限**：`role`（API 入口 `requireRole` 鉴权）、`decisionScope`（Decision 路由和意见提交校验）、`notifyLevel`（Inbox 通知过滤）。`lawAuthority` 和 `goalAuthority` 存储在数据库中但未被任何业务逻辑检查，按角色自动设置默认值。

**关键字段：**
- `maxConcurrency`：此成员最多同时执行的任务数（默认 3）
- `assignedRoleIds`：JSON 数组，绑定的 AgentRole ID 列表（决定此成员可以执行哪些角色的任务）
- `expertise`：专长标签（用于 Decision 路由和 Agent 升级匹配）
- `decisionScope`：决策范围（all / assigned / none），**服务端强制执行**——路由时排除 `none`，提交意见时校验权限
- `notifyLevel`：通知级别（all / critical / assigned / none），**服务端强制执行**——`inboxNotifyMembers` 按此字段过滤通知接收者
- `availability`：可用性（active / away / delegate）
- `delegateTo`：委托给哪个成员（Decision 路由和 Task 分配均追踪委托链，最多 3 跳）
- `lawAuthority` / `goalAuthority`：按角色自动设置默认值，**服务端未强制执行**，UI 不再单独展示

**删除成员的级联清理：** 删除 WorldMember 时，在事务内自动清除所有悬挂引用：
- `Task.assignedMemberId` → null
- `Decision.assignedTo` → null
- `WorldMember.delegateTo`（指向被删除成员的委托链）→ null
- `AgentMessage.toMemberId` → null

**零配置兼容：** 无 WorldMember 记录时，项目 owner 自动获得 implicit owner 全权限（maxConcurrency=10），单用户场景完全不受影响。

**App 入口：** 项目 → 成员 Tab → WorldMembersTab

### 3.11 Decision 智能路由

Decision 创建时自动路由到最合适的成员：

```
Decision 创建 → extractTags(question, context)
  → matchExpertise(tags, member.expertise) 按专长评分
  → 过滤 availability=active + decisionScope≠none
  → 选出最佳匹配者 → assignedTo
  → 超时 12h 未处理 → 自动转交下一候选人
```

**App 中的显示：** Decision 详情页显示 "Assigned" 徽章和 opinions 数量。

### 3.12 审计日志（WorldAuditLog）

**存储位置：** `WorldAuditLog` 表

记录谁在什么时间修改了世界模型的哪个部分：
- `action`：操作类型（law.create / narrative.update / role.create / role.update / role.delete / decision.adjudicate / decision.reassign / member.add 等）
- `entityType`：实体类型（law / narrative / role / decision / member）
- `before` / `after`：变更前后的 JSON 快照

**API：** `GET /v1/projects/:id/audit-log`（支持 entityType 过滤和分页）

### 3.13 Agent 升级路径

Agent 遇到问题时可升级到具体人类成员（而非广播给所有人）：

| 升级类型 | 路由目标 |
|---------|---------|
| `technical` | 按 expertise 标签匹配最佳成员 |
| `process` | 找 admin 或 owner |
| `permission` | 找 owner |

**API：** `POST /v1/projects/:id/agent-messages/escalate`

---

## 4. CLI 如何上报 AgentMessage

Agent 消息的生产方是运行在用户机器上的 **Supervisor Session（Claude/Gemini/Codex）**，通过直接调用服务端 HTTP API 写入，而非经过 Socket 中转。

### 4.1 认证机制

Supervisor Session 启动时，CLI daemon 会将以下两个环境变量注入进程：

| 环境变量 | 内容 |
|---------|------|
| `HAPPY_SUPERVISOR_SERVER_URL` | 服务端地址（如 `https://server.example.com`） |
| `HAPPY_SUPERVISOR_AUTH_TOKEN` | 用户的 Bearer Token（与 App 登录使用的同一 token） |

服务端 `authenticate` 中间件通过 `Authorization: Bearer <token>` 头验证身份，解析出 `userId` 后授权请求。

**关键**：不存在独立的 Supervisor 专属密钥，Agent 以用户身份操作，拥有与该用户完全相同的权限范围。

### 4.2 Prompt 注入机制

`buildSupervisorPrompt.ts` 在构建系统提示词时，会根据项目配置向 Agent 注入三段 curl 指令模板：

#### 1）Decision Reporting（决策上报）

当 Agent 遇到无法自行判断的决策时，先查询是否有判例：

```bash
curl -s "${HAPPY_SUPERVISOR_SERVER_URL}/v1/projects/${projectId}/decisions/match" \
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \
  -d '{"question":"...","precedentKey":"<category-key>"}'
```

若无判例，再上报新决策（**不等待响应，继续执行**）：

```bash
curl -s -X POST "${HAPPY_SUPERVISOR_SERVER_URL}/v1/projects/${projectId}/decisions" \
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"...","options":[...],"precedentKey":"..."}'
```

#### 2）Law Evolution（规则演化）— 仅当项目有现有 Laws 时注入

当 Agent 发现未被现有规则覆盖的重复模式时，可建议新规则：

```bash
curl -s -X POST "${HAPPY_SUPERVISOR_SERVER_URL}/v1/projects/${projectId}/agent-messages" \
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fromRole":"guardian","msgType":"law_suggestion","content":"{\"category\":\"...\",\"description\":\"...\",\"severity\":\"...\"}"}'
```

#### 3）Agent Communication（角色间通信）

当需要向其他角色报告或标记冲突时：

```bash
curl -s -X POST "${HAPPY_SUPERVISOR_SERVER_URL}/v1/projects/${projectId}/agent-messages" \
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fromRole":"<your-role>","toRole":"<target-role>","msgType":"request|report|conflict","content":"..."}'
```

### 4.3 可用字段说明

`POST /v1/projects/:id/agent-messages` 请求体：

| 字段 | 必填 | 说明 |
|------|------|------|
| `fromRole` | ✓ | 发送方角色名（与 AgentRole.name 对应，或自定义） |
| `toRole` | 否 | 接收方角色名；`null` 表示广播 |
| `msgType` | ✓ | 见下表 |
| `content` | ✓ | 消息内容（最长 10000 字符） |
| `sessionId` | 否 | 关联的会话 ID |
| `relatedGoalId` | 否 | 关联目标 ID |
| `relatedTaskId` | 否 | 关联任务 ID |
| `priority` | 否 | `urgent` / `normal`（默认）/ `low` |

`msgType` 完整枚举：

| 值 | 含义 | 服务端副作用 |
|----|------|------------|
| `request` | 请求协助 | 无 |
| `report` | 上报结果 | 无 |
| `conflict` | 角色间冲突 | 自动创建 Decision + InboxItem（severity: warning） |
| `law_suggestion` | 建议新规则 | 自动创建 Decision + InboxItem（severity: info） |
| `decision_request` | 请求用户决策 | 自动创建 Decision + 暂停运行中 Task（`waiting_decision`）+ 释放并发槽 |
| `handoff` | 任务移交 | 无 |
| `dependency_blocked` | 等待依赖 | 创建 InboxItem（severity: warning） |
| `review_request` | 请求审查 | 创建 InboxItem（severity: info） |

### 4.4 服务端处理流程

```
POST /v1/projects/:id/agent-messages
        ↓
认证（Bearer Token → userId）
        ↓
验证项目归属（projectId 属于该 userId）
        ↓
写入 AgentMessage 记录
        ↓
发送 ephemeral 事件 → App 实时收到通知（buildAgentMessageEphemeral）
        ↓
根据 msgType 触发副作用：
  conflict / law_suggestion / decision_request
    → decisionCreate() 创建 Decision（含 precedentKey）
    → 更新 agentMessage.decisionId
  decision_request 额外：
    → 按 sessionId 找到运行中 Task → 更新为 waiting_decision + waitingDecisionId
    → 释放并发槽 → dispatchQueuedTasksForMember()
  conflict / law_suggestion / dependency_blocked / review_request
    → inboxCreate() 写入收件箱（用户 App 内收件箱 Tab 可见）
        ↓
返回 201 { message: AgentMessageSummary }
```

### 4.5 注意事项

- Agent 调用这些 API 是**即发即忘**，不阻塞 Supervisor 分析流程
- `conflict` 消息会被 GoalBlockerSummary 分析器捕获，当目标处于 blocked 状态时在目标卡片上展示 Blocker 信息
- 同一 `fromRole:toRole` 组合的 `conflict` 消息共享同一 `precedentKey`，避免为同类冲突重复创建 Decision
- AgentMessage 在建议生成时会被读取：有未解决消息的目标会生成 `needs_human_input` 类型的 WorldSuggestion

---

## 5. Goal 分解与 Task 调度

目标分解是 World Model 的执行引擎：用户在 App 创建 Goal 后，系统会自动派遣 Planner Agent 分析代码库并拆解为可执行 Task，再由多个执行 Session 并行完成。

### 5.1 全局流程概览

```
用户在 App 创建 Goal
        ↓
goalCreate() — 写入 DB，计算初始 layer
        ↓（autoDecompose=true 或手动触发分解）
dispatchPlannerTask() — 构建 Planner 提示词，创建分解 Task
        ↓（Socket ephemeral 事件推送到目标机器）
CLI TaskRunner — 启动只读 Planner Session（Claude）
        ↓（Planner 分析代码库后 POST 计划）
POST /v1/projects/:id/goals/:goalId/plan-result
        ↓
服务端创建执行 Task（注入角色+基线+分支策略前缀）
        ↓（批量调度到 CLI）
各执行 Session 并行运行
        ↓（每个 Task 完成/失败后）
goalProgressUpdate() — 递归更新目标状态 + 父目标
        ↓
App 通过 ephemeral 事件实时接收进度
```

### 5.2 目标创建与触发分解

**创建入口：** App → 目标 Tab → 创建目标 → `POST /v1/projects/:id/goals`

`goalCreate()` 执行顺序：
1. 写入 `Goal` 记录，初始 `status: "planning"`
2. 调用 `classifyGoalLayer()` 计算初始层级（`strategic` / `operational` / `execution`）
3. 若请求体包含 `autoDecompose: true`，立即调用 `dispatchPlannerTask()`

**手动触发分解：** `POST /v1/projects/:id/goals/:goalId/decompose`
- 要求目标处于 `planning` 或 `blocked` 状态
- 更新 `plannerTaskId` 字段关联分解 Task

### 5.3 Planner Task 调度机制

`dispatchPlannerTask()` 执行以下步骤：

1. **加载上下文**：读取项目 narrative、laws、所有启用的 AgentRole、绑定的 Skills
2. **构建提示词**：`buildPlannerPrompt()` 将以下内容注入 Planner 系统提示词：
   - 世界宪法（Narrative + 按 severity 排序的 Laws）
   - 角色名册（roleType、description、duties）
   - 目标描述与 `goalId`
   - 如何 POST 计划结果的 curl 指令模板（含认证 Token）
3. **创建 Task 记录**：写入 DB，`status: "dispatching"`，`taskType: "planner"`
4. **发送 ephemeral 事件**：`buildTaskTriggerEphemeral` 路由到目标 `machineId` 的 CLI

**Planner Agent 需调用的 curl 模板（注入到 Planner 提示词）：**

```bash
curl -X POST "${HAPPY_TASK_SERVER_URL}/v1/projects/${projectId}/goals/${goalId}/plan-result" \
  -H "Authorization: Bearer ${HAPPY_TASK_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "title": "实现登录 API",
        "description": "...",
        "roleType": "builder",
        "estimatedMinutes": 30
      }
    ]
  }'
```

**认证说明：**

| 环境变量 | 内容 | 用途 |
|---------|------|------|
| `HAPPY_TASK_SERVER_URL` | 服务端地址 | Task Session 访问服务端 |
| `HAPPY_TASK_AUTH_TOKEN` | 用户 Bearer Token | Task 提交 plan-result / 上报进度 |

> `HAPPY_TASK_AUTH_TOKEN` 与 `HAPPY_SUPERVISOR_AUTH_TOKEN` 是同一类型的 token，只是变量名不同——Planner/Executor Task Session 与 Supervisor Session 是独立进程，各自持有独立注入的环境变量。

### 5.4 Planner Session 执行

CLI 收到 `taskTriggerEphemeral` 后，`TaskRunner` 启动只读 Planner Session：

```
TaskRunner
  ↓
spawn Claude Session（read-only 模式）
  ↓ 注入环境变量：
    HAPPY_TASK_SERVER_URL      # 服务端地址
    HAPPY_TASK_AUTH_TOKEN      # 用户 Bearer Token（plan-result 认证）
    HAPPY_TASK_RESULT_TOKEN    # 任务完成上报 token
    HAPPY_TASK_REPORT_URL      # 进度上报 URL
  ↓
Planner 分析代码库
  ↓
POST plan-result（按 curl 模板）
```

Planner Session 关键约束：
- **只读模式**：只读取代码库，不创建或修改文件
- **即发即忘**：POST plan-result 后立即完成，服务端异步处理
- **超时保障**：若 10 分钟内未收到 plan-result，`applyPlanningTimeoutFallback()` 将目标标记为 `blocked`

### 5.5 plan-result 处理

`POST /v1/projects/:id/goals/:goalId/plan-result` 处理流程：

1. 验证 `plannerTaskId` 匹配（防重放）
2. 为每个 task 创建执行 Task 记录，**在描述前自动注入三段前缀：**
   - **worldBaseline**：当前世界宪法摘要（narrative + 重要 laws）
   - **roleIdentity**：该 Task 分配角色的身份指令（`roleType` 对应 AgentRole.description）
   - **branchPolicy**：分支策略提示（需在独立分支工作、完成后提 PR）
3. **成员分配与并发检查**：对每个任务，`taskAssignMember` 根据 `roleType` 找到绑定了该角色的最闲成员（WorldMember），写入 `assignedMemberId`。若最佳候选成员的 `availability` 为 `delegate`，则追踪 `delegateTo` 委托链（最多 3 跳），将任务分配给委托目标。然后检查该成员的 `maxConcurrency`，若活跃任务数已达上限，任务状态设为 `queued`。无显式成员时回退到 implicit owner（maxConcurrency=10）。
4. 对通过并发检查的任务发送 `buildTaskTriggerEphemeral` → CLI 启动执行 Session；排队任务等待槽位释放后自动派发
5. Goal 状态更新为 `in_progress`
6. 调用 `goalProgressUpdate()` 触发初始进度计算

### 5.6 目标进度递归更新（goalProgressUpdate）

每当一个 Task 状态变更（完成/失败/取消），触发 `goalProgressUpdate()`，并调用 `dispatchQueuedTasksForMember()` 尝试填充释放的并发槽位。

**状态推导规则（从 Task 终态集合推导 Goal 状态）：**

| Task 终态组合 | Goal 状态 |
|-------------|----------|
| 全部 `completed` | `completed` |
| 全部 `cancelled` | `cancelled` |
| 所有 Task 都已终态，但有 `failed` | `blocked` |
| 有任意 Task 处于 `running` | `in_progress` |
| 其他（仍有 pending/dispatching） | 保持 `in_progress` |

**副作用（状态之外的字段更新）：**

| 字段 | 变更时机 |
|------|---------|
| `blockedSince` | 进入 `blocked` 时设为当前时间；离开 `blocked` 时清空 |
| `layer` | 每次调用后重新计算（`classifyGoalLayer()`） |
| 父目标 | 递归向上更新，最多 5 层 |

**App 实时更新：** 每次更新后发送 `buildGoalProgressEphemeral` ephemeral 事件，WorldGoalsTab 实时刷新目标卡片。

### 5.7 规划超时保障

`applyPlanningTimeoutFallback()` 在定期任务中检查：
- 若 Goal 处于 `planning` 状态超过 **10 分钟**（plannerTask 未返回结果）
- 将 Goal 状态设为 `blocked`，记录 `blockedSince`
- 下次建议刷新时，`blocked_aging` 信号触发 `needs_human_input` 建议

### 5.8 重新规划（Replan）

当目标执行偏差过大或长期 `blocked` 时，用户可以触发「重新规划」，抛弃当前所有进行中任务，从零开始重新分解。

**触发入口：** App 目标详情页 → 重新规划按钮 → `POST /v1/projects/:id/goals/:goalId/replan`

**前置校验：**
- 目标处于 `completed` 或 `cancelled` 状态时拒绝（已终态不可重新规划）
- 其余所有状态（`planning` / `in_progress` / `blocked`）均允许

**执行步骤：**

```
POST /v1/projects/:id/goals/:goalId/replan
        ↓
1. 批量取消该目标下所有活跃 Task
   status in (dispatching, queued, running) → cancelled
        ↓
2. 重置 Goal 字段
   status       → "planning"
   progress     → 0
   plannerTaskId → null
   blockedSince  → null
        ↓
3. 调用 goalDecompose() → dispatchPlannerTask()
   （与初次分解完全相同，创建新 Planner Task 并路由到 CLI）
        ↓
4. 发送 buildGoalProgressEphemeral 事件
   App 实时收到 status="planning", progress=0
        ↓
返回 { replanned: true, goalId, plannerTaskId }
```

**注意事项：**

| 要点 | 说明 |
|------|------|
| 已完成的 Task 不受影响 | 只取消 `dispatching / queued / running` 状态的 Task；`completed` Task 保留在历史记录中 |
| 子目标不自动重置 | Replan 只影响当前目标层的 Task，子目标需单独重新规划 |
| 与 decompose 的区别 | `/decompose` 不取消现有任务，仅再次触发分解（适合首次分解失败）；`/replan` 先清除活跃任务再分解（适合执行偏差后完全重来） |
| 分解后续流程 | Replan 触发的 Planner 分解流程与初次分解完全相同（见 5.3 - 5.6 节） |

---

## 6. App 界面入口

### 6.1 项目 → 世界 Tab（WorldOverviewTab）

显示内容：
- 宪法入口（点击跳转 world-laws 页）
- 自治分数 Dashboard
- AutonomyStatusSection（自治状态细节）
- GovernanceDashboard（自治策略配置）
- AuditLogSection（最近 50 条建议审计）
- RoleCollaborationSection（角色协作摘要）
- 建议分桶展示（next_step / needs_decision / needs_human_input）
- 目标概览（active / completed / blocked）
- 目标健康度汇总

### 6.2 项目 → 目标 Tab（WorldGoalsTab）

显示内容：
- 目标列表（支持 all / blocked / active / done / unhealthy 过滤）
- 每个目标的 GoalCard：状态、进度、健康分、Blocker 摘要、最近 Session 链接
- 创建新目标按钮（GoalCreateSheet）

### 6.3 项目 → 角色 Tab（WorldRolesTab）

显示内容：
- 已启用角色列表
- 角色类型、描述、职责、绑定 Skills、绑定成员数
- 角色编辑表单内可 toggle 绑定/解绑成员

### 6.4 项目 → 成员 Tab（WorldMembersTab）

显示内容：
- 团队成员列表（角色徽章、已绑定 AgentRole 名称标签、专长标签、可用性状态灯、非 owner 卡片上的删除按钮）
- 成员编辑表单：权限级别（owner/admin/member/observer）、绑定 Agent 角色（多选芯片）、专长标签、决策范围（decisionScope）、maxConcurrency 选择器（1/2/3/5/10）、通知级别、可用性

### 6.5 其他相关页面

| 页面路径 | 说明 |
|---------|------|
| `/project/[id]/world-laws` | 世界宪法详情与编辑 |
| `/project/[id]/goal/[goalId]` | 目标详情（任务列表、子目标、裁决） |
| `/decision/[id]` | 裁决详情与选项 |
| `/project/[id]/supervisor-settings` | Supervisor 配置（含世界自治模式） |

---

## 7. 数据模型与影响范围

### 核心表关系

```
Project
├── narrative / laws / supervisorMode / supervisorConfig
├── AgentRole[]             ← 纯模板（maxConcurrency @deprecated）
├── WorldMember[]           ← 团队成员（maxConcurrency + assignedRoleIds）
├── WorldAuditLog[]         ← 审计日志
├── Goal[]
│   ├── Goal[] (subGoals)
│   ├── Task[]  (assignedMemberId → WorldMember, roleType → AgentRole.type)
│   │   └── waitingDecisionId → Decision (暂停等待裁决)
│   ├── Decision[]  (assignedTo → WorldMember)
│   └── healthScore / layer / blockedSince
├── AgentMessage[]  (toMemberId → WorldMember)
│   └── relatedGoalId / relatedTaskId / decisionId
└── WorldSuggestion[]
    ├── type / bucket / status
    ├── relatedGoalId / relatedTaskId
    └── acceptAudit / autoAcceptStatus / autoAcceptReasonCode
```

### 修改 Project.narrative / laws 的影响

| 影响点 | 说明 |
|--------|------|
| Supervisor 提示词 | 下次 Agent 循环时生效 |
| worldSuggestionGenerate | 建议生成时会读取叙事做偏差检测 |
| worldConstitutionGenerator | 生成时可基于现有叙事更新 |

### 修改 Goal.status 的影响

| 影响点 | 说明 |
|--------|------|
| `blockedSince` 字段 | `→ blocked` 时记录时间，`← blocked` 时清空 |
| `goalHealthEngine` | 下次刷新建议时重新计算 healthScore |
| Dashboard `goals` 计数 | 实时反映 |

### 修改 WorldSuggestion 的影响

| 操作 | 影响 |
|------|------|
| accept | 创建 Goal / Task / Skill / Decision；更新 `acceptSource`、`actedAt` |
| dismiss | 更新 status → dismissed |
| veto | 标记为 dismissed + 记录否决人 |
| auto-accept | 同 accept，额外写入 `acceptAudit`、`autoAcceptStatus` |

---

## 8. API 端点一览

### World Dashboard

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/projects/:id/world/dashboard` | 汇总数据（自治分、角色数、目标统计、建议统计、健康度） |
| GET | `/v1/projects/:id/world/collaboration` | 角色协作摘要 |
| POST | `/v1/projects/:id/world/generate` | 自动生成叙事/规则/角色 |

### World Suggestions

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/projects/:id/world/suggestions` | 查询建议列表（支持 status / bucket / goalId 过滤） |
| POST | `/v1/projects/:id/world/suggestions/refresh` | 触发建议生成 |
| POST | `/v1/projects/:id/world/suggestions/:id/accept` | 接受建议 |
| POST | `/v1/projects/:id/world/suggestions/:id/dismiss` | 驳回建议 |
| POST | `/v1/projects/:id/world/veto/:id` | 否决建议 |
| PATCH | `/v1/projects/:id/world/policy` | 更新自治策略（supervisorMode + 限制参数） |
| GET | `/v1/projects/:id/world/audit-log` | 建议审计日志 |
| GET | `/v1/projects/:id/world/autonomy-stats` | 自治统计数据 |

### Goals

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/projects/:id/goals` | 目标列表 |
| POST | `/v1/projects/:id/goals` | 创建目标 |
| GET | `/v1/projects/:id/goals/:goalId` | 目标详情 |
| PATCH | `/v1/projects/:id/goals/:goalId` | 更新目标 |
| DELETE | `/v1/projects/:id/goals/:goalId` | 删除目标 |
| POST | `/v1/projects/:id/goals/:goalId/decompose` | 触发 Planner 分解目标 |
| POST | `/v1/projects/:id/goals/:goalId/cancel` | 取消目标 |
| POST | `/v1/projects/:id/goals/:goalId/replan` | 重新规划目标 |

### Agent Messages

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/projects/:id/agent-messages` | 查询消息（支持状态/类型/目标过滤） |
| POST | `/v1/projects/:id/agent-messages` | CLI/Agent 上报消息 |
| PATCH | `/v1/projects/:id/agent-messages/:msgId` | 更新消息状态 |

### Team Members

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/projects/:id/members` | 成员列表 |
| POST | `/v1/projects/:id/members` | 添加成员（admin+ 权限） |
| PATCH | `/v1/projects/:id/members/:memberId` | 更新成员（角色/专长/容量/通知） |
| DELETE | `/v1/projects/:id/members/:memberId` | 移除成员（owner 不可移除） |
| GET | `/v1/projects/:id/members/me` | 当前用户有效权限 |
| GET | `/v1/projects/:id/member-stats` | 成员活跃度统计 |

### Audit & Escalation

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/projects/:id/audit-log` | 审计日志（支持 entityType 过滤） |
| POST | `/v1/projects/:id/decisions/:id/opinion` | 提交成员意见（多人投票） |
| POST | `/v1/projects/:id/decisions/:id/reassign` | 手动转交 Decision |
| POST | `/v1/projects/:id/agent-messages/escalate` | Agent 升级到人类成员 |

---

## 9. 配置参数

### Project 表中的世界模型字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `narrative` | String? | null | 项目叙事文本 |
| `laws` | String? | null | 规则 JSON 数组 |
| `supervisorMode` | String? | null | 自治级别：disabled / suggest / semi-auto / auto |
| `supervisorConfig` | String? | null | JSON：worldAutonomy.maxAutoAcceptsPerDay、maxConcurrentAutoTasks |

### 目标健康度时间阈值（`worldConstants.ts`）

| 常量 | 值 | 说明 |
|------|------|------|
| `STALE_IN_PROGRESS_WARN` | 48h | in_progress 无更新 → warning |
| `STALE_IN_PROGRESS_CRITICAL` | 96h | in_progress 无更新 → critical |
| `BLOCKED_AGING_WARN` | 24h | blocked 超时 → warning |
| `BLOCKED_AGING_CRITICAL` | 72h | blocked 超时 → critical |
| `REPEATED_FAILURE_THRESHOLD` | 3 | 失败任务数触发 critical |

---

## 10. 数据流向图

### 建议生成与自动接受流程

```
Supervisor Loop 完成
        ↓
worldSuggestionGenerate.collectSuggestionFacts
  - 查询目标状态
  - 查询 AgentMessage（未解决）
  - 查询 Decision（pending）
  - refreshGoalHealthScores → 更新 Goal.healthScore + Goal.layer
        ↓
buildSuggestionCandidates
  - 每个目标生成候选（health、blocker、stale）
  - AgentMessage 生成候选
        ↓
去重（dedupeKey）→ 写入 WorldSuggestion
        ↓
worldSuggestionAutoAccept（针对每条新 open 建议）
  - 检查 supervisorMode
  - 检查 type 是否在 autoAcceptTypes
  - 检查配额 / 并发
  - 通过则自动 accept → 创建实体
  - 写入 acceptAudit + autoAcceptStatus
        ↓
Wire 事件推送 → App 实时更新建议列表
```

### Goal 分解与 Task 调度流程

```
App: POST /goals  (autoDecompose=true)  或  POST /goals/:id/decompose  或  POST /goals/:id/replan
        ↓
goalCreate() / goalDecompose()
  ├── [replan 专属] 批量取消活跃 Task (dispatching/queued/running → cancelled)
  ├── [replan 专属] 重置 Goal: status=planning, progress=0, plannerTaskId=null, blockedSince=null
  └── dispatchPlannerTask()
        ├── 加载 narrative / laws / AgentRole[] / Skills[]
        ├── buildPlannerPrompt() — 注入世界宪法 + 角色名册 + curl 模板
        ├── 创建 Task 记录 (status=dispatching, taskType=planner)
        └── buildTaskTriggerEphemeral → Server Socket → CLI (machineId 路由)
        ↓
CLI TaskRunner
  └── spawn Planner Session (read-only)
        ├── 注入: HAPPY_TASK_SERVER_URL / HAPPY_TASK_AUTH_TOKEN
        │         HAPPY_TASK_RESULT_TOKEN / HAPPY_TASK_REPORT_URL
        └── Planner 分析代码库
              ↓
        POST /goals/:goalId/plan-result
        ↓
服务端 plan-result 处理
  ├── 为每个 task 注入前缀：worldBaseline + roleIdentity + branchPolicy
  ├── 批量创建执行 Task 记录
  │   └── 每个 task 由 taskAssignMember 分配给最闲成员，按成员 maxConcurrency 检查
  │       ├── 有槽位 → status=dispatching, 发送 ephemeral
  │       └── 无槽位 → status=queued, 等待释放
  ├── Goal.status → in_progress
  └── goalProgressUpdate()
        ↓
[执行 Session 运行中]
  ├── 每个 Task 完成 / 失败 / 取消
  │     ↓
  │   goalProgressUpdate()  （递归，最多 5 层父目标）
  │     ├── 推导 Goal.status（completed / blocked / in_progress / cancelled）
  │     ├── 更新 blockedSince / layer
  │     └── dispatchQueuedTasksForMember() → 填充空出的并发槽
  │
  └── Agent 发送 decision_request
        ↓
      Task → waiting_decision + waitingDecisionId
      dispatchQueuedTasksForMember() → 释放的槽位派发排队任务
        ↓
      用户裁决 (decisionAdjudicate)
        ├── 创建延续 Task (原始 prompt + 裁决结果)
        ├── 取消原暂停 Task
        └── 并发检查 → 派发或排队

[超时保障]
  若 10 min 内 Planner 未返回 plan-result
  applyPlanningTimeoutFallback() → Goal.status = blocked
```

### App 世界 Tab 数据加载

```
切换到世界 Tab (isActive=true)
        ↓
并行 fetch：
  ├── GET /world/dashboard
  ├── GET /world/suggestions?status=open
  ├── GET /world/suggestions?status=accepted
  ├── GET /world/autonomy-stats  （失败不阻塞）
  ├── GET /world/collaboration    （失败不阻塞）
  └── GET /world/audit-log        （失败不阻塞）
        ↓
渲染各 Section 组件
        ↓
监听 sync.onWorldSuggestionUpdated
  - 有新状态变更 → 局部刷新或重新 fetch
```

---

## 11. 常见问题

**Q: 世界 Tab 一直转圈圈（无法加载）**

通常是数据库缺少新字段（migration 未应用）。排查步骤：
1. 检查 Docker server 日志：`docker logs happy-server-1 --tail 50`
2. 对比 `prisma migrate diff` 输出是否为空
3. 如有差异，执行 `prisma db execute --file migration.sql` 后重启服务

**Q: 建议一直不刷新**

- 检查 Supervisor Loop 是否在运行（Automation Tab）
- 也可手动点击「刷新建议」按钮触发
- 检查 `WorldSuggestion` 表中是否有 `dedupeKey` 冲突导致建议被去重

**Q: auto-accept 不生效**

1. 确认 `supervisorMode` 已设为 `semi-auto` 或 `auto`
2. 检查建议类型是否在 `autoAcceptTypes` 中（默认只有 `suggested_task`）
3. 检查每日配额（`maxAutoAcceptsPerDay`）和并发限制（`maxConcurrentAutoTasks`）
4. 查看建议卡片上的 `autoAcceptStatus`：`skipped` 附带原因码

**Q: 目标健康度什么时候更新**

`healthScore` 在每次「刷新建议」时批量重新计算，不是实时的。若目标状态刚变为 blocked，需下次刷新建议后才能看到更新的健康度。

**Q: maxConcurrency 如何工作**

并发容量现在绑定在 **WorldMember**（人）上，而非 AgentRole（角色模板）。每个成员有独立的 `maxConcurrency`（默认 3），控制该成员同时可执行的任务数。AgentRole 上的 `maxConcurrency` 字段已标记为 @deprecated，不再用于调度。

调度流程：
1. Planner 返回 `suggestedRole`（如 "builder"）
2. `taskAssignMember` 找到绑定了该角色的所有成员，选最闲的
3. 若最佳成员的 `availability` 为 `delegate`，追踪 `delegateTo` 委托链（最多 3 跳）分配给委托目标
4. 检查该成员的 `maxConcurrency`，超限则排队
5. 任务完成后 `dispatchQueuedTasksForMember` 自动派发队列中的下一个任务

单人场景（无 WorldMember 记录）：自动回退到 implicit owner（maxConcurrency=10），行为与之前完全相同。

**Q: decision_request 如何暂停任务**

当 Agent 发送 `decision_request` 消息时，服务端按 `sessionId` 找到运行中的 Task，将其标记为 `waiting_decision` 并记录 `waitingDecisionId`。这释放了该角色的一个并发槽位。用户裁决后，服务端创建延续任务（注入裁决结果到原始 prompt），取消原暂停任务，并按并发规则派发或排队。注意：CLI 侧 Task 仍在运行（CLI 不感知 `waiting_decision`），服务端只是在语义上标记暂停。

**Q: 修改叙事/规则后何时生效**

修改立即持久化。下次 Supervisor Loop 启动时会读取最新值注入提示词，当前正在运行的 Loop 不受影响。

**Q: replan 和 decompose 有什么区别，应该用哪个？**

| 场景 | 推荐操作 |
|------|---------|
| 首次分解失败（Planner 超时或未返回结果） | `/decompose` — 不取消现有任务，仅重新触发 Planner |
| 任务执行偏差、方向跑偏，需完全重来 | `/replan` — 先取消所有活跃任务，再从零分解 |
| 目标长期 blocked，想换思路重新拆解 | `/replan` — 同上 |

**Q: replan 后，之前已完成的 Task 还在吗？**

在。`/replan` 只取消 `dispatching / queued / running` 状态的任务，`completed` 和 `failed` 状态的历史任务记录不受影响，可在目标详情页查看。新 Planner 分解出的 Task 会叠加在历史记录上。

**Q: replan 后目标状态变成什么？**

立即变为 `planning`，`progress` 归零，`blockedSince` 清空。Planner Agent 返回 plan-result 后，目标自动转为 `in_progress`，App 会通过 ephemeral 事件实时收到状态变更。

**Q: 子目标在 replan 时会一起重置吗？**

不会。`/replan` 只影响当前目标层的 Task，子目标保持原有状态。如果子目标也需要重新规划，需在子目标详情页单独触发 replan。

**Q: replan 时 Planner 会接收到什么上下文？**

与首次分解相同：当前世界宪法（Narrative + Laws）、所有启用角色的名册与 Skills、目标描述。注意——历史失败 Task 的内容**不会**自动注入 Planner 提示词，Planner 等同于从零开始分析。如果需要让 Planner 了解历史失败原因，建议在目标描述中手动补充。
