# 全局 World Model UI 与结构重构方案

> **目的**：重立 World Model 的产品与技术重构锚点。本文档覆盖后续 UI 与结构重构方向，旧的 `docs/world/*` 文档作为参考材料，不再默认代表当前目标形态。
>
> **核心转向**：World Model 不是项目详情页里的一个 Tab，也不是“一个项目 = 一个世界”。整个 Happy 工作空间在当前阶段只承载一个主世界；项目、会话、任务、触发器、知识、Supervisor 结果都只是这个世界中的事件、节点、任务链或长期状态。World 本身需要预留外部世界接入点，未来可以把其他世界连接进来，形成 Universe / Multiverse 结构。

---

## 1. 当前判断

现有 World 文档的主线是：

> 用户是上帝，项目是世界，Agent 是居民。

这个隐喻适合解释早期方向，但会带来一个结构性问题：它把 World Model 绑定到了 Project 维度，最终很容易做成 `ProjectDetailView` 里的又一个复杂 Tab。

新的判断是：

> 用户是上帝，Happy 当前承载一个主世界，项目只是这个世界里的事件来源、地理标记、任务上下文或长期节点。

这意味着 World Model 不应该从某个项目进入，而应该从全局入口进入，并切换到一个独立的主界面。项目不再是世界边界，只是世界事件流里的一个维度。

---

## 2. 产品定位

### 2.1 World Model 是全局模式

World Model 应该像一个独立操作系统界面，而不是普通设置页、项目页或会话页。

进入后，用户看到的是：

- 当前整个工作宇宙正在发生什么
- 哪些 Agent 正在运行
- 哪些任务链正在推进
- 哪些项目只是这些任务链的上下文
- 哪些决策需要用户裁决
- 哪些知识、事件、风险和建议正在积累

用户不需要先选择项目。项目是过滤器，不是边界。

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
- 任务链视图
- 时间线/事件流
- Agent/角色/能力视图
- 裁决入口
- 全局命令输入
- 返回普通 Happy 模式的出口

### 3.2 只有少数路径能回到普通界面

从 World Shell 回到会话列表或项目页不应该是默认主路径，而是显式操作：

1. 点击「Exit World」或「回到 Happy」
2. 输入命令，例如 `/sessions`、`/projects`、`/settings`
3. 点击某个事件、任务或项目节点的「打开原始上下文」
4. 系统要求用户进入普通会话处理权限、认证或连接问题

### 3.3 项目是事件来源，不是世界边界

在 World 中，Project 应该被降级为事件来源和上下文标签：

- 一个 Task 可以关联 projectId，但任务链可以跨项目
- 一个事件可以来自某个 Project、Machine、Session、Trigger、Webhook 或 GitHub Issue
- 一个知识条目可以属于项目，也可以被提升为全局世界记忆
- 一个 Agent 可以工作在多个项目之间，而不是被项目锁死
- Project 不拥有 World，只是 World 事件流上的 source / context / location

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

### 4.1 新的顶层对象

```text
World
├── Identity        当前主世界身份，不绑定任何单个项目
├── Timeline        全局事件流
├── Chains          长任务链 / 多步目标 / 自动化流程
├── Agents          运行中的 Agent 与角色
├── Decisions       待裁决事项
├── Memory          全局知识、项目知识、判例
├── Signals         触发源：cron / webhook / GitHub / manual / file change
├── Sources         事件来源：Project / Machine / Session / external world
├── Bridges         外部世界接入点
├── Surfaces        可跳转回的普通 Happy 界面
└── Settings        世界模式配置
```

### 4.2 项目在 World 中的身份

Project 不再等价于 World，而是：

```text
ProjectContext
├── projectId
├── path
├── repoUrl
├── health
├── activeSessions
├── tasks
├── knowledge
├── supervisorRuns
└── recentEvents
```

它可以显示为：

- 地图上的区域
- 时间线事件的来源标签
- 任务链里的执行上下文
- Agent 当前所在工作区
- 搜索/过滤条件

### 4.3 Task Chain 替代早期 Goal

旧文档里的 `Goal` 不应立即作为数据库实体硬上。更贴近当前系统的抽象是 `Task Chain`：

```text
TaskChain
├── id
├── title
├── intent
├── status
├── projectRefs[]
├── taskRefs[]
├── sessionRefs[]
├── triggerRefs[]
├── knowledgeRefs[]
└── decisionRefs[]
```

早期可以不落库，先由现有 Task、SupervisorAction、SessionEvent、InboxItem 聚合生成。

后续如果需要长期规划，再判断是否引入真正的 `Goal` 表。

### 4.4 Universe / Multiverse 预留模型

World 不是最终边界。World 应该能被 Universe 容纳，并通过 Bridge 与其他世界交换事件、任务、知识和裁决请求。

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

第一版不实现 `WorldBridge`，但命名和 UI 结构要给它留位置：

- World Shell 里可以有 `Sources` / `Bridges` 概念
- Timeline 事件来源不能只假设 Project
- TaskChain 的 refs 应允许 external source
- Memory 不能只分 global/project，未来还要支持 remote world memory

### 4.5 WorldBridge 最小接入协议

WorldBridge 的第一原则是：**先连接世界，再逐步开放能力**。外部世界接入不应该默认获得任务执行权，也不应该默认共享完整记忆。所有能力都必须按 scope 显式授予。

#### A. Bridge 握手

外部世界接入时，双方至少交换：

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

握手只建立关系，不代表允许执行任务。`requestedScopes` 是对方想要的能力，`grantedScopes` 是本地用户实际批准的能力。

#### B. 事件同步 flow

事件是最安全的第一类接入能力。最小事件结构：

```text
BridgeEvent
├── id
├── bridgeId
├── remoteEventId
├── sourceWorldId
├── sourceType       project | session | task | trigger | agent | external
├── eventType
├── title
├── summary
├── occurredAt
├── severity         info | warning | critical
├── refs[]
└── payloadDigest
```

第一版只需要接收事件并进入 Timeline，不执行任何动作。`payloadDigest` 用于展示和去重，原始 payload 是否保存应由 scope 决定。

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
├── targetContextRefs[]
├── proposedDeadline
└── approvalMode     manual | policy_allowed
```

默认规则：

- 外部世界只能提出 task request，不能直接创建本地 Task
- 本地 World 将请求显示为 Decision / Pending Action
- 用户或本地 policy 批准后，才转换为本地 TaskChain / Task
- 执行结果只按 granted scope 回传摘要或事件，不默认回传完整会话内容

#### D. 记忆共享 flow

记忆共享必须最小化，不能把本地知识库整体暴露给外部世界。

```text
BridgeMemoryExchange
├── id
├── bridgeId
├── direction        import | export
├── memoryKind       fact | decision | convention | warning | reference
├── title
├── summary
├── sourceRefs[]
├── sensitivity      public | workspace | private
└── expiresAt
```

默认规则：

- 只共享摘要，不共享原始会话全文
- `private` 记忆不得自动 export
- 跨世界导入的记忆必须带 sourceWorldId，避免污染本地判例
- 过期时间必须显式存在，避免外部记忆永久驻留

#### E. 裁决请求 flow

裁决请求允许外部世界向本地用户请求判断，但不能绕过本地用户。

```text
BridgeAdjudicationRequest
├── id
├── bridgeId
├── sourceWorldId
├── question
├── options[]
├── recommendation
├── riskLevel        low | medium | high
├── contextRefs[]
└── responseMode     local_only | share_summary | share_full_decision
```

默认规则：

- 外部裁决请求进入本地 World 的 Decisions 区域
- 本地用户可选择不回答、只本地记录、或回传摘要
- 高风险请求不能自动裁决
- 裁决结果如果写入本地 Memory，必须标记 remote source

#### F. Trust Level

`trustLevel` 决定默认能力上限：

| trustLevel | 含义 | 默认允许 |
|---|---|---|
| `read_only` | 只接收外部世界事件 | events import |
| `delegated` | 可请求本地执行任务 | events import + task request |
| `bidirectional` | 双向事件、任务、记忆和裁决协作 | 仍需逐 scope 授权 |

即使是 `bidirectional`，也不表示无限权限。它只是允许出现双向 flows，每个 flow 仍受 scope、policy 和用户裁决限制。

#### G. 第一版实现边界

第一版只需要为协议留位置，不需要完整实现。推荐最小落点：

1. UI 命名预留：`Sources` / `Bridges`
2. Timeline event model 支持 `sourceWorldId` / `sourceType`
3. TaskChain refs 支持 external refs
4. Memory model 文档上支持 remote source
5. 不做外部任务执行，不做双向同步，不做自动裁决

这样不会把第一版拖成联邦系统，但后续不会被单世界、单项目、单实例假设卡死。

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

是否受 Feature flag 控制需要单独决策。建议第一版放在 experiments 或 dev flag 后面，避免半成品暴露给普通用户。

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
│   ├── world status
│   ├── active agents count
│   ├── pending decisions count
│   └── exit button
├── Command Bar
│   └── ask / command / filter
├── Primary Canvas
│   ├── Timeline Mode
│   ├── Chain Mode
│   ├── Map Mode
│   └── Agent Mode
└── Inspector
    ├── selected event
    ├── selected chain
    ├── selected project context
    └── selected agent
```

### 5.3 四个核心视图

#### A. Timeline Mode

全局事件流：

- session started/completed
- task queued/running/completed/failed
- supervisor action found/approved/fixed
- knowledge created/merged/archived
- trigger fired
- webhook received
- user decision made
- agent asked for input

第一版数据源可来自：

- Session events
- Task status
- Supervisor actions
- Inbox items
- Knowledge entries

#### B. Chain Mode

长任务链视图，用于替代早期 Goal UI。

展示：

- 当前推进中的任务链
- 每条链包含哪些 Task / Session / SupervisorAction
- 阻塞点在哪里
- 下一步建议是什么
- 涉及哪些项目

#### C. Map Mode

世界地图视图。

展示：

- Project 作为节点
- Machine 作为运行环境节点
- Agent/Session 作为移动中的执行者
- Knowledge/Skill 作为资源节点
- Trigger/Webhook 作为信号源

第一版可以不用复杂图谱，先用分组卡片或轻量网络图。

#### D. Agent Mode

展示所有活跃 Agent 与自动化：

- 当前会话 Agent
- Background Task
- Supervisor Loop
- Cron/Webhook 触发的执行
- Auto/semiauto 修复流程

---

## 6. 当前代码映射

### 6.1 App 现有入口

- `packages/happy-app/sources/components/SettingsView.tsx`：新增 World Model 设置入口
- `packages/happy-app/sources/app/(app)/settings/index.tsx`：设置页 wrapper
- `packages/happy-app/sources/app/(app)/project/[id].tsx`：当前项目详情入口，不应继续作为 World 主入口
- `packages/happy-app/sources/components/project/ProjectDetailView.tsx`：当前项目 tabs，可被 World Shell 反向跳转使用

### 6.2 可复用的项目页能力

- `ProjectSupervisorTab.tsx`：Supervisor 运行状态、Loop、分析入口
- `ProjectHealthTab.tsx`：健康趋势、成本、运行历史
- `ProjectActionsTab.tsx`：Supervisor Actions，可映射为 World Events / Decisions
- `ProjectResearchTab.tsx`：研究事件来源
- `ProjectKnowledgeTab.tsx`：项目记忆
- `ProjectActionTraceTab.tsx`：会话工具调用轨迹
- `ProjectConfigTab.tsx`：项目配置

这些组件不应直接塞进 World Shell，而应提炼出数据 hooks 和 presentation pieces。

### 6.3 机器页能力

- `packages/happy-app/sources/app/(app)/machine/[id]/tasks.tsx`：Task Kanban
- `packages/happy-app/sources/app/(app)/machine/[id]/triggers.tsx`：Cron/Webhook 管理
- `packages/happy-app/sources/sync/apiTasks.ts`：Task API
- `packages/happy-app/sources/sync/apiTriggerSchedules.ts`：Cron Trigger API
- `packages/happy-app/sources/sync/apiWebhookTriggers.ts`：Webhook Trigger API

这些能力需要被世界模式重新组织为全局任务链和信号源，而不是机器详情里的二级功能。

### 6.4 Server 现有能力

- `Task`：任务队列
- `SupervisorRun` / `SupervisorLoop` / `SupervisorAction`：自治治理
- `Skill`：能力模板
- `ProjectKnowledge`：记忆
- `TriggerSchedule` / `WebhookTrigger`：信号源
- `InboxItem`：通知/待办

第一版 World Shell 应优先聚合这些现有能力，不要先造 `Goal/Decision/WorldMember` 大模型。

---

## 7. 重构分期

### Phase 0：文档与命名收束

目标：让团队先停止把 World Model 当作 Project Tab。

任务：

- 新文档作为 World UI 与结构重构主锚点
- 旧文档标记为参考/历史/能力盘点
- 明确当前不直接实现 `Goal/Decision/WorldMember/AgentRole`
- 明确 World 是全局模式，Project 是上下文节点

### Phase 1：新增 World 入口与空壳 Shell

目标：建立产品骨架。

任务：

- 设置页新增 World Model 入口
- 新增 `/(app)/world` route
- 新增 `components/world/WorldShell.tsx`
- 增加 Exit World 返回普通 Happy 的机制
- 暂时显示聚合占位卡片，不做复杂数据重构

### Phase 2：聚合现有事件流

目标：让 World Shell 看到真实活动。

数据源：

- Tasks
- Supervisor Actions
- Supervisor Runs/Loops
- Inbox
- Knowledge entries
- Session events

输出：

- Timeline Mode
- Pending Decisions/Actions 区域
- Active Chains 初版

### Phase 3：项目从主界面降级为上下文节点

目标：World Shell 可以跨项目工作。

任务：

- Project 作为 filter/context chip
- 支持按项目筛选 timeline / chains / agents
- 点击 project node 才跳回 `ProjectDetailView`
- 项目页保留为详细诊断页，不再承担世界主入口

### Phase 4：任务链与裁决机制

目标：把分散事件聚合成可操作长链。

任务：

- 设计 TaskChain 聚合规则
- 将 SupervisorAction 中需要用户确认的部分映射成 Decision-like UI
- 暂不急着落库 `Decision`，先复用现有 action approval / inbox 机制
- 如果聚合规则稳定，再考虑 wire/server schema

### Phase 5：真正的 World domain

只有当前四个条件满足时才进入：

1. World Shell 已经成为主要入口
2. 用户能在里面稳定完成跨项目任务管理
3. TaskChain 聚合规则稳定
4. SupervisorAction / Inbox 已无法表达裁决需求

届时再考虑：

- `WorldEvent`
- `TaskChain`
- `Decision`
- `WorldAgent`
- `WorldBridge` / `RemoteWorld` / `Universe`

---

## 8. 反模式

### 不要把 World 做成 ProjectDetailView 的又一个 Tab

这会违背全局模式的核心。

### 不要一开始新增所有旧文档里的模型

`Goal / Decision / WorldMember / AgentRole` 听起来完整，但当前代码没有这些实体。直接补会制造大量半成品。

### 不要复刻 OpenClaw 的 Canvas 外观而忽略 Happy 的真实数据

OpenClaw 可以作为参考，但 World Shell 必须围绕 Happy 真实的 Task、Session、Supervisor、Knowledge、Trigger 数据工作。

### 不要把“返回会话列表”放成主要导航

World Mode 的体验应该是沉浸式的。普通 Happy 界面是 fallback，不是主界面。

---

## 9. 第一版可交付范围

最小可用版本应包含：

1. 设置页 World Model 入口
2. 独立 World Shell route
3. 顶部状态栏：活跃任务、待处理动作、运行中 Agent/Loop
4. Timeline：聚合最近 Tasks / Supervisor Actions / Inbox / Knowledge
5. Project 只是事件来源和上下文，不再作为世界边界
6. Exit World：回到普通 Happy

不包含：

- 新 Prisma 模型
- 新 wire schema
- 完整 Goal/Decision/Member 系统
- 复杂 3D/Canvas 地图
- 自动跨项目 Agent 编排

---

## 10. 后续设计问题

这些问题需要在实现前继续定：

1. World 入口是否默认显示，还是放在 experiments / dev flag 后？
2. World Shell 是否替代当前 App 首屏，还是先只从 Settings 进入？
3. Command Bar 是否第一版就支持 slash command？
4. Timeline 聚合是在 App 本地完成，还是 Server 提供 `/v1/world/events`？
5. TaskChain 是否先纯前端聚合，还是直接 server-side 聚合？
6. 第一版是否需要在 UI 里露出 Bridges / Sources 概念，还是只在内部数据结构预留？
7. 外部世界接入的最小协议是什么：事件同步、任务委托、知识共享，还是裁决请求？
8. World Shell 是否需要独立 i18n namespace：`world.*`？

---

## 11. 推荐第一刀

先做入口和空壳，不动数据库：

```text
SettingsView
  → World Model Item
  → /(app)/world
  → WorldShell
      → Timeline placeholder backed by existing APIs
      → Exit World
```

这一步的价值不是功能完整，而是把产品结构从“项目详情页功能”纠正为“全局 World 模式”。只要这个壳立住，后续 Task、Supervisor、Knowledge、Trigger 都能逐步被吸进来。
