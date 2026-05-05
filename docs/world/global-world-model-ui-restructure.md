# 全局 World Model UI 与结构重构方案

> **目的**：重立 World Model 的产品与技术重构锚点。本文档覆盖后续 UI 与结构重构方向，旧的 `docs/world/*` 文档作为参考材料，不再默认代表当前目标形态。
>
> **核心转向**：World 是唯一的一等公民。项目不是容器、不是边界、不是节点——项目的创建、变化、消亡本身就是世界事件流中的事件。会话、任务、触发器、知识、Supervisor 结果同理，它们都只是事件。World 本身需要预留外部世界接入点，未来可以把其他世界连接进来，形成 Universe / Multiverse 结构。

---

## 1. 当前判断

现有 World 文档的历史主线是：

> 历史隐喻：用户是上帝，项目是世界，Agent 是居民。

这个隐喻适合解释早期方向，但会带来两个结构性问题：

1. 它把 World Model 绑定到了 Project 维度，最终做成 `ProjectDetailView` 里的又一个复杂 Tab
2. 它暗示 Project 是一个独立领域对象（有自己的模型、状态、生命周期管理），而不是事件流上的标签

新的判断是：

> 用户是上帝，Happy 承载一个主世界。**一切皆事件**。项目的创建是事件，项目的健康变化是事件，项目的归档是事件。项目不拥有事件，项目只是事件的 `source` 属性之一。

这意味着：

- World Model 不应从某个项目进入，而应从全局入口进入
- 系统中没有 `ProjectContext` 领域对象，只有 `WorldEvent.source.projectId`
- 项目列表只是对事件流按 `source.projectId` 做 facet 聚合的结果
- 一个任务链可以跨多个项目（多个 source），因为任务链是事件的聚合，不是项目的子实体

---

## 2. 产品定位

### 2.1 World Model 是全局模式

World Model 应该像一个独立操作系统界面，而不是普通设置页、项目页或会话页。

进入后，用户看到的是：

- 当前整个工作宇宙正在发生什么（事件流）
- 哪些 Agent 正在产生事件
- 哪些任务链正在推进（事件的因果聚合）
- 哪些决策需要用户裁决（需要响应的事件）
- 哪些知识正在积累（事件产生的长期沉淀）

用户不需要先选择项目。项目只是事件流的一个过滤维度。

### 2.2 设置页只是入口，不是承载页

在当前 App 中，设置页已有类似 OpenClaw 的入口模式：

- `packages/happy-app/sources/components/SettingsView.tsx`
- `packages/happy-app/sources/app/(app)/settings/index.tsx`
- OpenClaw 当前通过 Feature flag 显示入口，然后 `router.push("/(app)/openclaw")`

World Model 可以采用类似入口，但产品层级更高：

- 设置页新增「World Model」模块
- 点击后进入 `/world` 或 `/(app)/world`
- 进入后整屏切换为新的 World Shell
- 底部 Tab / 项目列表 / 会话列表不再作为主导航出现
- 只在明确出口、命令、快捷入口或系统需要时回到会话列表/项目详情/设置

---

## 3. 交互原则

### 3.1 World Shell 独立于现有主界面

World Shell 是全新界面，不应该只是复用 `ProjectDetailView` 的 Tab。

它需要自己的：

- 顶层导航
- 世界状态栏
- 事件流视图
- 任务链视图
- 全局命令输入
- 裁决入口
- 返回普通 Happy 模式的出口

### 3.2 只有少数路径能回到普通界面

从 World Shell 回到会话列表或项目页不应该是默认主路径，而是显式操作：

1. 点击「Exit World」或「回到 Happy」
2. 输入命令，例如 `/sessions`、`/projects`、`/settings`
3. 点击某个事件的「打开原始上下文」（跳转到对应会话/项目详情）
4. 系统要求用户进入普通会话处理权限、认证或连接问题

### 3.3 项目是事件，不是实体

这是本文档最核心的原则。在 World 中：

**项目不存在为独立对象。** 以下行为产生的都是世界事件：

| 行为 | 事件类型 | source.projectId |
|------|----------|-----------------|
| 用户注册新项目 | `project.created` | 新项目 ID |
| 项目健康评分变化 | `project.health_changed` | 该项目 ID |
| 项目被归档/删除 | `project.archived` | 该项目 ID |
| 某个会话在项目下启动 | `session.started` | 该项目 ID |
| 一个任务在项目下排队 | `task.queued` | 该项目 ID |
| Supervisor 发现问题 | `supervisor.action_found` | 该项目 ID |

注意：

- 上表所有行都是 `WorldEvent`，只是 `eventType` 和 `source` 不同
- `source.projectId` 是可选字段——有些事件（如系统级 cron、跨项目任务链决策）没有项目来源
- **没有 `ProjectContext` 对象**。项目的"状态"是对该 projectId 事件流的实时聚合
- 项目列表页实质上是 `SELECT DISTINCT source.projectId FROM world_events WHERE ...` 的 facet UI
- 一个任务链可以关联多个 projectId（跨项目工作流）

### 3.4 World 需要外部世界接入点

当前 Happy 先承载一个主世界，但 World 的结构不能封死。它需要预留外部世界接入点，允许未来把其他 Happy 实例、其他用户的 World、OpenClaw/第三方 Agent 世界、企业工作区或远程自治系统接入进来。

长期形态不是多个 Project 组成一个 World，而是：

```text
Universe
├── LocalWorld        当前 Happy 主世界
├── RemoteWorld[]     其他 Happy / 团队 / 组织世界
├── ExternalWorld[]   OpenClaw、GitHub、CI、云服务、第三方 Agent 网络
└── Bridges[]         世界之间的协议、权限、事件同步和裁决边界
```

因此第一版 World Shell 可以只显示 LocalWorld，但数据结构和命名应避免把 World 写死为单机、单用户或单项目空间。

---

## 4. 概念模型

### 4.1 唯一的一等公民：WorldEvent

World 的核心数据模型只有一个：**事件**。其他所有概念都是事件的聚合、投影或派生。

```text
WorldEvent
├── id
├── eventType           session.started | task.queued | supervisor.action_found | ...
├── title
├── summary
├── occurredAt
├── severity            info | warning | critical
├── source
│   ├── type            project | machine | session | trigger | agent | bridge | system
│   ├── projectId?      可选，只有关联项目时才有
│   ├── machineId?
│   ├── sessionId?
│   ├── agentId?
│   ├── triggerId?
│   └── worldId?        外部世界来源（Bridge 事件）
├── refs[]              关联的其他事件 ID
├── payload             事件特定数据（JSON）
└── chainId?            所属任务链（如果有）
```

关键设计决策：

- **`source.projectId` 是可选属性，不是必填字段**。这确保了系统级事件、跨项目事件不会被强制绑定到某个项目
- **没有 `ProjectContext` 对象**。项目的"活跃度"、"健康度"、"最近活动"全部通过对事件流的聚合查询得到
- **`eventType` 包含项目生命周期事件**（`project.created`、`project.health_changed`、`project.archived`），项目的存在本身就通过事件表达

### 4.2 项目不是模型，是查询

旧文档定义了 `ProjectContext` 领域对象。这个设计已被废弃。

项目在 World 中的"状态"通过以下聚合查询得到：

```text
"项目 X 的状态" = 
  SELECT * FROM world_events 
  WHERE source.projectId = X 
  ORDER BY occurredAt DESC
  
"项目 X 的健康度" = 
  最新的 eventType = 'project.health_changed' 
  WHERE source.projectId = X

"项目 X 的活跃会话" = 
  eventType IN ('session.started', 'session.completed')
  WHERE source.projectId = X
  GROUP BY payload.sessionId
  HAVING last_status != 'completed'

"所有活跃项目" =
  SELECT DISTINCT source.projectId 
  FROM world_events
  WHERE occurredAt > now() - interval '7 days'
  AND source.projectId IS NOT NULL
```

这意味着：

- 项目没有独立的 CRUD 操作——项目的"创建"就是一个 `project.created` 事件
- 项目的"删除"就是一个 `project.archived` 事件，之后不再产生新事件
- 项目的"配置变更"就是一个 `project.config_changed` 事件
- 项目列表只是对事件流的 facet 聚合

### 4.3 事件的聚合：TaskChain

分散事件可以被聚合成有因果关系的任务链。TaskChain 不是独立实体，而是事件的视图：

```text
TaskChain（事件聚合视图）
├── chainId
├── title
├── intent
├── status              derived from member events
├── memberEvents[]      按因果关系排列的事件 ID 列表
├── sourceProjectIds[]  涉及的项目（从 member events 的 source.projectId 聚合）
├── blockedBy?          阻塞事件 ID
└── nextSuggestion?     下一步建议
```

注意：

- `sourceProjectIds` 是复数——一个任务链可以跨多个项目
- TaskChain 的状态从成员事件中派生，不是独立维护的字段
- 早期可以不落库，先由现有 Task、SupervisorAction、SessionEvent 聚合生成

### 4.4 事件的沉淀：Memory

事件流中的信息如果具有长期价值，会沉淀为 Memory（知识）。Memory 是事件的长期压缩：

```text
Memory（事件沉淀）
├── id
├── kind                fact | decision | convention | warning | reference
├── title
├── content
├── derivedFromEvents[] 来源事件 ID
├── sourceProjectIds[]  关联项目（可以为空 = 全局知识）
├── confidence
├── createdAt
└── expiresAt?
```

Memory 的 `sourceProjectIds` 是可选的复数字段——知识可以不属于任何项目（全局），也可以跨多个项目。

### 4.5 顶层对象总览

```text
World
├── EventStream         所有事件（唯一一等公民）
├── Chains              事件的因果聚合（TaskChain 视图）
├── Agents              运行中的 Agent（通过 agent.* 事件流表达）
├── Decisions           需要裁决的事件子集
├── Memory              事件的长期沉淀
├── Signals             触发源配置：cron / webhook / GitHub / manual / file change
├── Bridges             外部世界接入点
└── Settings            世界模式配置
```

注意这里没有 `Sources` 和 `Projects`——它们不是顶层对象，只是事件流的查询维度。

### 4.6 过渡策略：现有实体与事件模型的关系

现有系统中已实现的 Prisma 模型（`Project`、`Goal`、`Task`、`Decision`、`WorldMember`、`AgentRole`、`SupervisorAction`、`ProjectKnowledge`、`InboxItem` 等）**不废弃、不删除**。它们的定位是：

```text
底层实现层（继续存在）          World Shell 概念层（用户看到的）
─────────────────────          ──────────────────────────────
Project 表 + CRUD API    →     project.* 事件的数据源
Goal 表 + 状态机         →     task.* / chain.* 事件的数据源
Decision 表              →     decision.* 事件的数据源
WorldMember 表           →     agent.* 事件的数据源
SupervisorAction 表      →     supervisor.* 事件的数据源
ProjectKnowledge 表      →     memory.* 事件的数据源
InboxItem 表             →     decision.* 事件的数据源
Task 表                  →     task.* 事件的数据源
TriggerSchedule 表       →     trigger.* 事件的数据源
```

规则：

1. **底层表继续作为事件产生源** — 当 Goal 状态变化时，产生 `task.status_changed` 事件；当 Decision 被创建时，产生 `decision.requested` 事件
2. **World Shell 不直接暴露这些表的 CRUD** — 用户在 World Shell 中看到的是事件流，不是 Goal 列表或 Decision 列表
3. **现有项目详情页/机器详情页继续工作** — 它们作为"事件上下文详情"的深度诊断入口，从 World Shell 的事件详情跳转进入
4. **前端适配层做格式转换** — Phase 1-2 不改后端，只在前端把现有 API 返回的数据转换为统一 WorldEvent 格式
5. **Phase 5 才考虑是否需要真正的 WorldEvent 表** — 如果前端适配层稳定且性能够用，可能永远不需要新表

这确保了：
- 已实现的 Goal/Decision/WorldMember 等功能不受影响
- World Shell 的"一切皆事件"理念在概念层成立
- 不做大规模数据迁移或模型重构
- 渐进式过渡，任何阶段都可以暂停

### 4.7 Universe / Multiverse 预留模型

World 不是最终边界。World 应该能被 Universe 容纳，并通过 Bridge 与其他世界交换事件。

```text
WorldBridge
├── id
├── remoteWorldId
├── displayName
├── kind              happy | openclaw | github | ci | custom
├── trustLevel        read_only | delegated | bidirectional
├── eventScopes[]     允许同步的事件类型
├── taskScopes[]      允许委托的任务类型
├── memoryScopes[]    允许共享的知识范围
└── adjudicationMode  local_only | remote_allowed | shared
```

外部世界的事件进入本地事件流时，`source.type = "bridge"` + `source.worldId = remoteWorldId`。这样外部事件和本地事件在同一个流中，只是来源不同。

### 4.8 WorldBridge 最小接入协议

WorldBridge 的第一原则是：**先连接世界，再逐步开放能力**。外部世界接入不应默认获得任务执行权，也不应默认共享完整记忆。所有能力按 scope 显式授予。

#### A. Bridge 握手

```text
BridgeHandshake
├── protocolVersion
├── localWorldId
├── remoteWorldId
├── remoteDisplayName
├── remoteKind        happy | openclaw | github | ci | custom
├── supportedFlows[]  events | tasks | memory | adjudication
├── requestedScopes[]
├── grantedScopes[]
├── trustLevel
└── createdAt
```

#### B. 事件同步 flow

最安全的第一类接入能力。外部事件进入本地事件流时结构：

```text
WorldEvent（来自 Bridge）
├── eventType           bridge.event_received
├── source.type         bridge
├── source.worldId      remoteWorldId
├── payload
│   ├── remoteEventId
│   ├── remoteEventType
│   ├── title
│   ├── summary
│   └── severity
└── refs[]
```

第一版只需要接收事件并进入 Timeline，不执行任何动作。

#### C. 任务委托 flow

任务委托是高风险能力，必须晚于事件同步开放。

```text
BridgeTaskRequest
├── id
├── bridgeId
├── sourceWorldId
├── title
├── intent
├── constraints[]
├── requiredCapabilities[]
├── proposedDeadline
└── approvalMode     manual | policy_allowed
```

默认规则：

- 外部世界只能提出 task request，不能直接创建本地 Task
- 本地 World 将请求显示为 Decision 事件
- 用户或本地 policy 批准后，才产生本地 task.queued 事件
- 执行结果只按 granted scope 回传摘要事件

#### D. 记忆共享 flow

```text
BridgeMemoryExchange
├── id
├── bridgeId
├── direction        import | export
├── memoryKind       fact | decision | convention | warning | reference
├── title
├── summary
├── sensitivity      public | workspace | private
└── expiresAt
```

默认规则：

- 只共享摘要，不共享原始事件全文
- `private` 记忆不得自动 export
- 跨世界导入的记忆必须带 sourceWorldId
- 过期时间必须显式存在

#### E. 裁决请求 flow

```text
BridgeAdjudicationRequest
├── id
├── bridgeId
├── sourceWorldId
├── question
├── options[]
├── recommendation
├── riskLevel        low | medium | high
└── responseMode     local_only | share_summary | share_full_decision
```

#### F. Trust Level

| trustLevel | 含义 | 默认允许 |
|---|---|---|
| `read_only` | 只接收外部世界事件 | events import |
| `delegated` | 可请求本地执行任务 | events import + task request |
| `bidirectional` | 双向事件、任务、记忆和裁决协作 | 仍需逐 scope 授权 |

#### G. 第一版实现边界

第一版只需要为协议留位置，不需要完整实现。推荐最小落点：

1. WorldEvent schema 支持 `source.type = "bridge"` + `source.worldId`
2. Timeline 事件可以来自任何 source type，包括外部世界
3. TaskChain memberEvents 支持 bridge 事件
4. Memory 支持 remote source 标记
5. 不做外部任务执行，不做双向同步，不做自动裁决

---

## 5. UI 信息架构

### 5.1 Settings 入口

位置：`SettingsView` 的 Features 分组或单独 World 分组。

建议入口：

```text
Settings
└── World Model
    ├── subtitle: Enter the global agentic workspace
    └── onPress: router.push("/(app)/world")
```

是否受 Feature flag 控制需要单独决策。建议第一版放在 experiments 或 dev flag 后面。

### 5.2 World Shell 主界面

建议路径：

```text
packages/happy-app/sources/app/(app)/world/index.tsx
packages/happy-app/sources/components/world/WorldShell.tsx
```

主界面结构：

```text
WorldShell
├── Header
│   ├── world identity（名称 + 图标，点击展开 Definition Panel）
│   ├── world status（事件流健康度）
│   ├── active agents count
│   ├── pending decisions count
│   └── exit button
├── World Definition Panel（Header 展开，覆盖式侧拉或全屏面板）
│   ├── Identity: 世界名称、定位描述
│   ├── Narrative: 当前阶段叙事（可编辑，修改产生 world.narrative_updated 事件）
│   ├── Laws: 法则列表（增删改 + 启用/禁用，变更产生 world.law_* 事件）
│   └── Policy: 自治策略（supervisorMode、并发限制、裁决规则）
├── Command Bar
│   └── ask / command / filter
├── Primary Canvas
│   ├── Stream Mode（默认）
│   ├── Chain Mode
│   ├── Density Mode
│   └── Agent Mode
└── Inspector
    ├── selected event detail
    ├── selected chain detail
    └── event context（可跳转到原始会话/项目详情）
```

### 5.3 世界定义（World Definition）

World Definition Panel 是用户行使"上帝权力"的地方。它承载三种核心操作：

#### 立法（Laws）

世界法则是 Agent 必须遵守的持续性约束。法则列表可增删改，每条法则包含：

```text
Law
├── id
├── category        quality | security | performance | architecture | custom
├── description     法则描述（如"测试覆盖率必须 ≥ 80%"）
├── severity        warning | error | critical
├── enabled         是否启用
└── createdAt
```

法则的变更本身也是事件（`world.law_created`、`world.law_updated`、`world.law_disabled`），出现在 Stream Mode 中。

#### 叙事（Narrative）

叙事是世界的当前方向和阶段目标。用户编辑叙事 = 告诉 Agent "现在我们在做什么"。

叙事变更产生 `world.narrative_updated` 事件。Supervisor 分析时读取最新叙事作为上下文。

#### 策略（Policy）

世界策略定义 Agent 的自治程度：

| 策略 | 含义 |
|------|------|
| `disabled` | Agent 不主动行动 |
| `suggest` | Agent 只建议，等用户确认 |
| `semi-auto` | 低风险自动执行，高风险请求裁决 |
| `auto` | 完全自治，只在极端情况请求裁决 |

策略变更产生 `world.policy_updated` 事件。

#### 与事件模型的关系

World Definition 的当前状态是事件的投影：

- "当前法则列表" = 所有 `world.law_*` 事件的最终状态
- "当前叙事" = 最新 `world.narrative_updated` 事件的 payload
- "当前策略" = 最新 `world.policy_updated` 事件的 payload

但在 Phase 1-2，这些数据仍从现有 `Project.supervisorConfig`（narrative + laws）和 `Project.supervisorMode`（policy）读取，前端适配层做格式转换。

#### 第一版数据来源

| 定义项 | 现有数据源 | 备注 |
|--------|-----------|------|
| Identity | 新增（目前不存在） | 第一版可硬编码或用账户名 |
| Narrative | `Project.supervisorConfig` 内的 narrative 字段 | 加密存储，需解密 |
| Laws | `Project.supervisorConfig` 内的 laws 字段 | 加密存储，需解密 |
| Policy | `Project.supervisorMode` | plaintext |

注意：现有 narrative/laws 是**项目级**的（每个项目有自己的）。World Shell 需要决定是聚合所有项目的法则，还是提供一个"全局世界法则"（当前不存在）。建议第一版先展示所有项目的法则合集，后续再考虑真正的全局法则。

### 5.4 四个核心视图

#### A. Stream Mode（事件流，默认视图）

全局事件流——World 的核心呈现。每条都是 `WorldEvent`：

- `session.started` — Agent 开始工作
- `session.completed` — Agent 完成工作
- `task.queued` / `task.running` / `task.completed` / `task.failed` — 任务生命周期
- `supervisor.action_found` / `supervisor.action_approved` — 自治治理
- `project.created` / `project.health_changed` / `project.archived` — 项目生命周期
- `memory.created` / `memory.merged` / `memory.archived` — 知识生命周期
- `trigger.fired` — 触发器激活
- `decision.requested` / `decision.resolved` — 裁决
- `bridge.event_received` — 外部世界事件

过滤维度：

- 按 `source.projectId` 过滤 = 看某个项目的事件
- 按 `source.machineId` 过滤 = 看某台机器的事件
- 按 `eventType` 前缀过滤 = 只看某类事件（如 `task.*`）
- 按 `severity` 过滤 = 只看警告/严重事件
- 按 `chainId` 过滤 = 看某个任务链的全部事件

第一版数据源可来自现有：

- Session events → `session.*`
- Task status → `task.*`
- Supervisor actions → `supervisor.*`
- Inbox items → `decision.*`
- Knowledge entries → `memory.*`

#### B. Chain Mode（任务链视图）

展示通过因果关系聚合的事件链：

- 当前推进中的任务链
- 每条链包含哪些事件
- 阻塞点在哪里（哪个事件卡住了）
- 下一步建议
- 链涉及的 projectIds（作为标签显示，不是主要组织维度）

#### C. Density Mode（事件密度视图，替代旧 Map Mode）

**不再以项目为节点。** 改为事件密度可视化：

- 热区 = 事件密集的 source 组合（某个项目最近产生大量事件 = 热区变大）
- 冷区 = 长时间无事件的 source
- 流向 = 事件之间的因果关系（refs）
- Agent 位置 = Agent 当前正在哪个 source 上下文产生事件

项目在这个视图中的呈现：

- 不是固定的"节点"——而是根据事件密度动态变化的热区
- 一个长期无事件的项目自然消失（不浪费视觉空间）
- 一个频繁产生事件的项目自然变大（引起注意）
- 跨项目任务链表现为连接两个热区的流向线

第一版可以用分组卡片 + 事件计数来简化实现，不需要复杂可视化。

#### D. Agent Mode（Agent 活动视图）

展示所有活跃 Agent 的事件产出：

- 每个 Agent 当前在产生什么类型的事件
- Agent 的事件产出速率
- 哪些 Agent 卡住了（长时间无新事件）
- Agent 之间的协作关系（通过共同 chainId 表达）

---

## 6. 当前代码映射

### 6.1 App 现有入口

- `packages/happy-app/sources/components/SettingsView.tsx`：新增 World Model 设置入口
- `packages/happy-app/sources/app/(app)/settings/index.tsx`：设置页 wrapper
- `packages/happy-app/sources/app/(app)/project/[id].tsx`：当前项目详情入口——未来只作为"事件上下文详情"的跳转目标
- `packages/happy-app/sources/components/project/ProjectDetailView.tsx`：保留为事件上下文的详细诊断工具

### 6.2 可映射为 WorldEvent 的现有数据

| 现有实体 | 映射为 eventType | source.type |
|----------|-----------------|-------------|
| Task status change | `task.*` | project / machine |
| SupervisorAction | `supervisor.*` | project |
| SupervisorRun/Loop | `supervisor.loop_*` | project |
| InboxItem | `decision.*` | project / system |
| ProjectKnowledge | `memory.*` | project |
| Session lifecycle | `session.*` | project / machine |
| TriggerSchedule fire | `trigger.fired` | machine |
| WebhookTrigger fire | `trigger.fired` | machine / external |

### 6.3 机器页能力

- `packages/happy-app/sources/app/(app)/machine/[id]/tasks.tsx`：Task Kanban
- `packages/happy-app/sources/app/(app)/machine/[id]/triggers.tsx`：Cron/Webhook 管理
- `packages/happy-app/sources/sync/apiTasks.ts`：Task API
- `packages/happy-app/sources/sync/apiTriggerSchedules.ts`：Cron Trigger API
- `packages/happy-app/sources/sync/apiWebhookTriggers.ts`：Webhook Trigger API

这些能力产生的状态变化都应该表达为 WorldEvent，而不是独立的 CRUD 操作。

### 6.4 Server 现有能力

- `Task`：任务队列 → `task.*` 事件
- `SupervisorRun` / `SupervisorLoop` / `SupervisorAction`：自治治理 → `supervisor.*` 事件
- `Skill`：能力模板 → `skill.*` 事件（创建/使用）
- `ProjectKnowledge`：记忆 → `memory.*` 事件
- `TriggerSchedule` / `WebhookTrigger`：信号源 → `trigger.*` 事件
- `InboxItem`：通知/待办 → `decision.*` 事件

第一版 World Shell 应优先把这些现有状态变化统一映射为事件流，而不是新造领域模型。

---

## 7. 重构分期

### Phase 0：文档与命名收束（当前阶段）

目标：确立"一切皆事件"的共识，停止把项目当作一等公民。

任务：

- 本文档作为 World UI 与结构重构主锚点
- 旧文档标记为参考/历史/能力盘点
- 明确废弃 `ProjectContext` 独立领域对象
- 明确 World 只有一个一等公民：WorldEvent
- 明确项目只是事件的 source 属性

### Phase 1：WorldEvent 适配层 + 空壳 Shell

目标：建立产品骨架和事件统一层。

任务：

- 设置页新增 World Model 入口
- 新增 `/(app)/world` route
- 新增 `components/world/WorldShell.tsx`
- 建立 `WorldEvent` 前端适配层：把现有 Task/Supervisor/Session/Inbox/Knowledge 状态变化转换为统一事件格式
- 增加 Exit World 返回普通 Happy 的机制
- Stream Mode 显示统一事件流（数据来自现有 API，前端做格式转换）

### Phase 2：事件流成为真实数据源

目标：让 World Shell 看到真实活动，且体验优于分散的项目详情页。

任务：

- Server 提供 `/v1/world/events` 统一事件 API（或前端本地聚合）
- Stream Mode 支持实时更新（WebSocket 推送新事件）
- Chain Mode 初版（基于 taskId / chainId 聚合）
- 过滤维度实现（按 projectId / machineId / eventType / severity）
- Decisions 区域：需要用户裁决的事件子集

### Phase 3：旧入口降级

目标：World Shell 成为首选工作入口，旧项目/机器详情页降级为"事件上下文详情"。

任务：

- 项目列表变为事件流的 facet 过滤结果
- 点击项目不再进入"项目详情页"，而是进入 World Shell + 自动过滤 `source.projectId = X`
- 旧 ProjectDetailView 保留为深度诊断工具，只从 World Shell 的事件详情跳转进入
- 机器详情同理

### Phase 4：事件因果与裁决

目标：把分散事件聚合成可操作长链，建立裁决闭环。

任务：

- TaskChain 聚合规则稳定化
- Decision 事件的响应/解决工作流
- Chain Mode 支持拖拽重排、手动关联事件
- 暂不落库 `Decision` 表，先复用现有 InboxItem 机制产生 `decision.*` 事件

### Phase 5：真正的 WorldEvent 后端

只有当前四个条件满足时才进入：

1. World Shell 已经成为主要入口
2. 前端适配层的格式转换已经稳定
3. 事件聚合规则已验证
4. 现有 API 的拼接方式已经成为性能瓶颈

届时再考虑：

- `WorldEvent` Prisma 模型（真正的事件表）
- 事件持久化 + 事件溯源架构
- `TaskChain` 持久化
- `WorldBridge` / 外部世界接入
- Universe 协议

---

## 8. 反模式

### 不要给项目定义独立领域对象

`ProjectContext`、`ProjectState`、`ProjectHealth` 这类独立模型会把项目重新提升为一等公民。项目的一切状态都应该通过事件聚合得到。

### 不要把 World 做成 ProjectDetailView 的又一个 Tab

这会违背全局模式的核心。

### 不要一开始新增所有旧文档里的模型

`Goal / Decision / WorldMember / AgentRole` 听起来完整，但当前代码没有这些实体。直接补会制造大量半成品。先用事件流表达，稳定后再考虑是否需要专门的持久模型。

### 不要复刻 OpenClaw 的 Canvas 外观而忽略 Happy 的真实数据

OpenClaw 可以作为参考，但 World Shell 必须围绕 Happy 真实的 Task、Session、Supervisor、Knowledge、Trigger 数据工作——这些数据的统一表达形式就是事件。

### 不要把"返回会话列表"放成主要导航

World Mode 的体验应该是沉浸式的。普通 Happy 界面是 fallback，不是主界面。

### 不要让事件的 source.projectId 成为必填字段

这会把项目重新变成边界。系统级事件、跨项目事件、Bridge 事件都不应被强制绑定到某个项目。

---

## 9. 第一版可交付范围

最小可用版本应包含：

1. 设置页 World Model 入口
2. 独立 World Shell route
3. 顶部状态栏：世界身份 + 事件速率 + 待裁决数 + 活跃 Agent 数
4. World Definition Panel（Header 展开）：显示/编辑 Narrative + Laws + Policy
5. Stream Mode：统一事件流（前端适配层转换现有 API 数据）
6. 过滤：按 projectId / machineId / eventType 过滤
7. Exit World：回到普通 Happy

不包含：

- 新 Prisma 模型（WorldEvent 表）
- 新 wire schema
- 完整 Goal/Decision/Member 系统
- 复杂可视化（Density Mode）
- 外部世界接入
- 自动跨项目 Agent 编排

---

## 10. 后续设计问题

1. World 入口是否默认显示，还是放在 experiments / dev flag 后？
2. World Shell 是否替代当前 App 首屏，还是先只从 Settings 进入？
3. Command Bar 是否第一版就支持 slash command？
4. 事件流聚合是在 App 本地完成（前端适配层），还是 Server 提供 `/v1/world/events`？
5. TaskChain 聚合是纯前端还是 server-side？
6. 第一版是否需要在 UI 里露出 Bridges 概念，还是只在事件 schema 预留？
7. World Shell 是否需要独立 i18n namespace：`world.*`？
8. Stream Mode 的实时更新用现有 Socket.IO 通道还是新建 channel？

---

## 11. 推荐第一刀

先做入口、空壳、世界定义面板和事件适配层，不动数据库。

### 目标 UI 布局

```text
┌─────────────────────────────────────────────────────────────────┐
│  Header                                                          │
│  [🌍 世界名称 ▼]  [12/s 事件]  [⚡3 Agent]  [⚠️2 待裁]  [← Exit] │
│         ↓ 点击展开                                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ World Definition Panel                                       │ │
│  │ Narrative: "当前阶段：重构 sync 模块，确保离线优先..."         │ │
│  │ Laws: [测试覆盖≥80%] [无硬编码密钥] [PR 必须 review] ...     │ │
│  │ Policy: semi-auto ▾                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Filter Chips                                                    │
│  [ All ] [ happy-app ] [ happy-cli ] [ task.* ] [ ⚠️ warning+ ] │
├─────────────────────────────────────────────────────────────────┤
│  Stream Mode (事件流列表，时间倒序)                               │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 14:32  task.completed                                        │ │
│  │ "Fix auth token refresh" 完成                                 │ │
│  │ 📍 happy-cli  🤖 claude-agent-1                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 14:28  supervisor.action_found              ⚠️ warning       │ │
│  │ "测试覆盖率低于 80%（违反法则 #1）"                           │ │
│  │ 📍 happy-server                                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 14:25  session.started                                       │ │
│  │ "重构 sync 模块" 开始                                         │ │
│  │ 📍 happy-app  🖥️ MacBook-Pro                                │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 14:20  decision.requested                   🔴 critical      │ │
│  │ "是否合并 breaking change 到 main？"                          │ │
│  │ 📍 happy-wire  [批准] [拒绝] [稍后]                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 14:15  memory.created                                        │ │
│  │ "发现 messageCache 需要 LRU 淘汰策略"                         │ │
│  │ 📍 happy-app                                                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ... (pull-to-refresh / 滚动加载更多)                             │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  View Tabs (后续版本预留)                                         │
│  [ Stream ✓ ] [ Chains ] [ Density ] [ Agents ]                  │
└─────────────────────────────────────────────────────────────────┘
```

### 入口路径

```text
Settings 页
  → "World Model" 卡片（Feature flag 控制可见性）
  → router.push("/(app)/world")
  → WorldShell 全屏界面
```

### 用户操作映射

| 用户意图 | 操作位置 | 产生的事件 |
|---------|---------|-----------|
| 立法（定义规则） | Definition Panel → Laws 编辑 | `world.law_created/updated/disabled` |
| 叙事（设定方向） | Definition Panel → Narrative 编辑 | `world.narrative_updated` |
| 调整策略 | Definition Panel → Policy 下拉 | `world.policy_updated` |
| 观察世界 | Stream Mode 浏览 | —（只读） |
| 裁决 | 事件卡片内联 [批准/拒绝] | `decision.resolved` |
| 深入某事件 | 点击卡片展开 Inspector | —（跳转到原始上下文） |
| 过滤视角 | Filter Chips 切换 | —（纯前端过滤） |
| 退出世界 | Header → Exit | —（返回普通 Happy） |

### 数据流（Phase 1，前端适配层）

```text
现有 API                        前端适配层                    World Shell UI
─────────────                   ──────────                   ────────────────
GET /v3/tasks                →  转为 task.* 事件           → Stream Mode 列表
GET /v3/supervisor-actions   →  转为 supervisor.* 事件     → Stream Mode 列表
GET /v3/inbox                →  转为 decision.* 事件       → Stream Mode 列表 + 内联裁决
GET /v3/knowledge            →  转为 memory.* 事件         → Stream Mode 列表
GET /v3/sessions (recent)    →  转为 session.* 事件        → Stream Mode 列表
GET /v3/projects/:id config  →  读取 narrative/laws/mode   → Definition Panel
PATCH /v3/projects/:id       ←  保存 narrative/laws/mode   ← Definition Panel 编辑
```

### 交互细节

- **Filter Chips**：多选，AND 逻辑。选 `[happy-app] + [task.*]` = 只看 happy-app 项目的 task 事件
- **事件卡片**：最小信息密度 = 时间 + eventType badge + 标题 + source 标签 + severity 指示器
- **裁决卡片**：额外显示 [批准] [拒绝] [稍后] 按钮，点击后产生 `decision.resolved` 事件并刷新列表
- **Definition Panel**：覆盖式展开（不是导航跳转），编辑完点击收起，回到 Stream Mode
- **实时更新**：第一版用 pull-to-refresh，Phase 2 接 WebSocket

### 这一步的价值

1. 把产品结构从"项目详情页功能"纠正为"全局事件流 + 世界定义"模式
2. 用户的三种核心操作（立法 / 叙事 / 裁决）都有明确入口
3. 验证"一切皆事件"的统一模型是否能覆盖现有数据
4. 为后续 TaskChain、Bridge、实时推送建立统一的事件基础
5. 不改数据库、不改 wire schema、不改现有 API——只在前端做格式转换和 UI 组装
