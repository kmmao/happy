# 全局 World Model UI 与结构重构方案

> **目的**：重立 World Model 的产品与技术重构锚点。本文档覆盖后续 UI 与结构重构方向，旧的 `docs/world/*` 文档作为参考材料，不再默认代表当前目标形态。
>
> **核心隐喻：The Matrix。**
>
> World Model 就是 Matrix——一个持续运行的世界。里面有无数程序（Agent）各司其职，有规则（Laws）约束一切行为，有代码（事件流）在背后流动。用户是 Neo——能看到代码、能改变规则、能在异常时介入。但大部分时候，世界自己运转，不需要 Neo 干预。
>
> 一切皆事件。项目不是容器、不是边界——只是事件流中的 source 标签。World 预留外部世界接入点，未来形成 Multiverse。

---

## 1. 当前判断

现有 World 文档的历史主线是：

> 旧隐喻：用户是上帝，项目是世界，Agent 是居民。

这个隐喻的问题：它把每个 Project 当作一个独立的小世界。就好像说"每栋楼都是一个独立的 Matrix"——但 Matrix 只有一个，楼只是 Matrix 中的一个地点。

旧隐喻导致的技术后果：

1. World Model 绑定到了 Project 维度，做成 `ProjectDetailView` 里的 Tab
2. Project 变成了独立领域对象（有模型、状态、生命周期），而不是事件流上的地点标签

新的判断是：

> **Happy 是 Matrix，用户是 Neo。** 世界持续运行，程序（Agent）各司其职，规则（Laws）约束一切。用户能看到代码（事件流）、改变规则、裁决异常——但大部分时候不需要干预。一切皆事件。项目不拥有事件，项目只是事件的 `source` 属性之一。

这意味着：

- World Model 不应从某个项目进入，而应从全局入口进入
- 系统中没有 `ProjectContext` 领域对象，只有 `WorldEvent.source.projectId`
- 项目列表只是对事件流按 `source.projectId` 做 facet 聚合的结果
- 一个任务链可以跨多个项目（多个 source），因为任务链是事件的聚合，不是项目的子实体

---

## 2. 产品定位

### 2.1 World Shell = Neo 的界面

World Shell 不是又一个设置页或项目详情页——它是**Neo 看 Matrix 的界面**。

Neo 进入 Matrix 后能看到什么？

- **代码在流动**（事件流）— 世界此刻正在发生什么
- **程序在运行**（Agents）— 哪些 Agent 正在工作
- **异常在闪烁**（Anomalies）— 有什么需要 Neo 处理
- **规则在生效**（Laws）— 世界按什么规则运转
- **意图在推进**（Intents）— Neo 关心的事情进展如何

Neo 不需要先"进入某个项目"。项目只是代码流中的一个过滤维度——就像 Neo 可以选择只看某个街区的代码，但他看到的始终是整个 Matrix。

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

### 3.1 进入 Matrix = 切换到完全不同的界面

当 Neo 进入 Matrix，他看到的不是"普通世界加了个滤镜"——而是一个**完全不同的感知模式**。

World Shell 同理。它不是在现有 App 上加一个 Tab，而是整屏切换为新界面：

- **状态栏**：世界运行状态（绿灯/黄灯/红灯）
- **代码流**：事件流视图（Matrix 的代码雨）
- **意图追踪**：当前推进中的任务（Neo 关心的事）
- **异常面板**：需要裁决的 Anomaly
- **规则编辑**：Laws / Narrative / Policy（修改 Source Code）
- **退出口**：回到普通 Happy（"回到现实世界"）

### 3.2 "回到现实"是显式操作

Neo 在 Matrix 里时，不会一不小心就弹回现实世界。退出需要明确意图：

1. 点击「Exit World」（= 拔掉管子，回到 Nebuchadnezzar）
2. 命令：`/sessions`、`/projects`、`/settings`
3. 点击某个事件的「打开原始上下文」（= 进入 Matrix 中的一个具体场景）
4. 系统强制退出（认证失败、连接断开 = Matrix 把你踢出来了）

World Shell 是沉浸式体验。普通 Happy 界面是"现实世界"——功能完整但看不到代码流。

### 3.3 项目是 Matrix 中的地点，不是独立程序

在 Matrix 里，"第五大道"不是一个程序——它只是一个地理坐标，方便定位事件发生在哪里。

Project 在 World 中同理：**它是事件的发生位置（source 标签），不是独立实体。**

以下行为产生的都是世界事件：

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

### 3.4 Multiverse：多个 Matrix 可以互联

黑客帝国里有多个版本的 Matrix，还有 Machine City 等外部系统。Happy World 同理——当前只有一个 Matrix，但未来可以与其他世界互联。

长期形态：

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

### 4.3 世界运行模式：The Matrix

**World Model 就是 Matrix。**

Matrix 不是一次性构建的产物——它是一个**持续运行的世界**。里面有无数程序各司其职，有规则约束一切，有代码在背后流动。大部分时候，世界自己运转，不需要任何人干预。

#### 概念映射

| The Matrix | Happy World Model |
|------------|-------------------|
| Matrix（母体） | World — 持续运行的工作世界 |
| Source Code（源代码） | Laws + Narrative — 世界的底层规则和方向 |
| The Architect（建筑师） | 规划者 — 设计世界运行方案（Opus，偶尔调用） |
| Agent Smith（特工） | 规则执行者 — 维护世界秩序（Supervisor） |
| Programs（程序） | Worker Agent — 各司其职的执行者（Haiku，大量并行） |
| The One（Neo） | 用户 — 能看到代码、改变规则、裁决异常 |
| Anomaly（异常） | 需要裁决的事件 — 世界规则无法自动处理的情况 |
| Reload（重载） | 重新规划 — 方向不对时重新分解 |
| Agents 自我复制 | 水平扩展 — 需要更多执行者时自动增加 |

#### 核心原则

**1. 世界永远在运行**

Matrix 不是"建完就停"的建筑——它是永远在跑的系统。Happy World 也一样：

- Agent 在持续监控、持续执行
- 触发器在持续监听信号
- Supervisor 在持续检查法则合规
- 事件在持续产生

用户不需要"启动"世界。世界一直在运行。用户只需要在必要时介入。

**2. 程序不需要理解世界**

Matrix 里的"程序"（门卫、列车员、餐厅老板）不需要知道 Matrix 的全貌。它们只需要执行自己的功能：

- 门卫：检查通行证 → 放行/拒绝
- 列车员：把人从 A 送到 B
- 餐厅老板：准备食物

同理，Worker Agent 不需要理解用户的战略目标。它只需要：
- 接收一个极简指令（"把这个函数从 A 文件移到 B 文件"）
- 执行
- 报告完成

**这意味着可以用最便宜的模型（Haiku）大规模并行执行。**

**3. 化复杂为简单**

Matrix 的运行看起来极其复杂——但分解到每个程序的层面，每个程序做的事情都极简。

一个复杂任务在 World 里的分解：

```text
用户意图："重构认证模块"（复杂）
  │
  ├── Architect 分解（一次性，Opus）：
  │   → 步骤 1: 列出所有认证相关文件
  │   → 步骤 2: 提取 token 逻辑到新模块
  │   → 步骤 3: 提取 session 逻辑到新模块
  │   → 步骤 4: 更新所有 import
  │   → 步骤 5: 跑测试
  │   → 步骤 6: 验收
  │
  └── 每个步骤都简单到 Haiku 能做
```

**4. 多层级自治（Agent 生态）**

Matrix 里有不同层级的程序：

```text
The Architect     → 设计世界规则（用户 + Opus，极少介入）
Agent Smith       → 执行规则、处理异常（Supervisor，定期运行）
Sentinels         → 巡逻、监控（Trigger/Cron，持续监听）
Programs          → 各司其职（Worker Haiku，大量并行）
```

在 Happy World 中：

| 层级 | 角色 | 模型 | 频率 |
|------|------|------|------|
| Architect | 设计、规划、重大决策 | Opus | 极少（一次性分解） |
| Agent Smith | 监督、纠偏、规则执行 | Sonnet | 定期（Supervisor Loop） |
| Sentinel | 监控、触发、信号处理 | 系统级 | 持续（Cron/Webhook） |
| Program | 执行具体工作 | Haiku | 大量并行 |

**关键：只有 Architect 需要"理解力"。其他层级做的都是简单、重复、可大规模并行的工作。**

**5. 异常上升机制（Anomaly Escalation）**

Matrix 大部分时候自我运行。只有出现 Anomaly（规则无法处理的情况）时，才需要更高层级介入：

```text
Program 执行失败
  → Sentinel 检测到异常，尝试自动重试
  → 重试失败 → Agent Smith 介入判断（Sonnet 级决策）
  → Smith 解决不了 → 上报 Architect（Opus 级决策）
  → Architect 也无法自动处理 → 呈现给 Neo（用户裁决）
```

**99% 的异常在 Sentinel 和 Smith 层就解决了。用户只处理真正的 Anomaly。**

**6. 验证即现实**

Matrix 里"现实"就是代码运行的结果。同理，World 里"完成"就是验证通过：

- 测试全绿 = 这部分世界运行正常
- 类型检查通过 = 结构完整
- Supervisor 无报警 = 符合法则
- 用户确认 = Neo 认可

#### 在 World Shell 中的呈现

用户（Neo）进入 World Shell，看到的是**世界的运行状态**：

```text
🟢 World: Running
   Programs: 12 active, 3 idle
   Laws: 5 active, all green
   Anomalies: 1 pending (需要你的裁决)

   ┌─ Intent: "重构认证模块" ─────────────── 80% ─┐
   │  ✅ 分析完成  ✅ token 模块  ✅ session 模块  │
   │  🟡 集成测试 (running...)  ⬜ 验收            │
   └───────────────────────────────────────────────┘
```

用户不需要管每个 Program 在做什么。只需要看到：
- **世界在正常运行吗？**（绿灯 / 黄灯 / 红灯）
- **有没有需要我处理的异常？**（Anomaly 数量）
- **我关心的事情进展如何？**（Intent 进度条）

#### 实现映射（技术备注）

> 以下是 Matrix 概念到技术实现的映射：

| Matrix 概念 | 技术实现 | 说明 |
|------------|---------|------|
| Matrix 运行 | 事件流持续产生 | 系统始终在线 |
| Source Code | Laws + Narrative（Project.supervisorConfig） | 世界规则 |
| Architect 分解 | Planner Task（Opus） | 一次性意图分解 |
| Agent Smith | Supervisor Loop（Sonnet） | 定期规则检查 |
| Sentinel | TriggerSchedule / WebhookTrigger | 持续监听 |
| Program 执行 | Task Queue → CLI Daemon（Haiku） | 大量并行执行 |
| Neo 看代码 | Stream Mode（事件流列表） | 看到底层发生什么 |
| Neo 改规则 | Definition Panel（Laws 编辑） | 修改世界法则 |
| Neo 裁决 | Decision 事件内联操作 | 处理异常 |
| Anomaly | `decision.requested` 事件 | 需要用户介入 |
| Reload | `intent.decomposed`（重新规划） | 方向不对时重来 |

#### 事件流表达（技术备注）

| 世界运行 | 事件类型 |
|---------|---------|
| 新意图产生 | `intent.created` |
| Architect 分解意图 | `intent.decomposed` |
| Program 领取工作 | `step.assigned` |
| Program 执行中 | `step.started` |
| Program 完成 | `step.completed` |
| Program 异常 | `step.failed` |
| Sentinel 自动重试 | `step.retried` |
| Smith 介入 | `supervisor.action_found` |
| 上报 Neo | `decision.requested` |
| Neo 裁决 | `decision.resolved` |
| 意图达成 | `intent.completed` |
| 验证通过 | `intent.verified` |

#### 第一版边界

Phase 1 先让用户能**看到 Matrix 的运行状态**：

- Stream Mode = Neo 看到代码流动
- Definition Panel = Neo 能查看/修改世界规则
- Decision 卡片 = Neo 处理 Anomaly
- Intent 进度 = Neo 关心的事情在推进

Phase 4+ 再实现完整的多层自治：
- Architect 自动分解（Intent → Steps）
- Agent Smith 自动纠偏（Supervisor 自动修复）
- Program 大规模并行（Haiku 蚁群执行）
- Anomaly 逐层上升机制
├── description         用户的原始意图描述
├── orchestratorId      协调者（Planner Agent 或人类）
├── status              planning | executing | blocked | completed | failed
├── createdAt
└── steps[]             分解出的步骤树

Step（步骤，可嵌套）
├── stepId
├── intentId            所属意图
├── parentStepId?       父步骤（null = 顶层步骤）
├── title               "提取 token 刷新逻辑到独立模块"
├── assigneeId?         执行者（Agent ID 或 WorldMember ID）
├── status              pending | assigned | running | blocked | completed | failed
├── dependencies[]      前置步骤 ID（必须完成才能开始）
├── order               执行顺序（同层级内）
└── childSteps[]        子步骤（进一步分解）
```

#### 事件流表达

整个分解和执行过程通过事件流表达：

| 阶段 | 事件类型 | 含义 |
|------|----------|------|
| 创建意图 | `intent.created` | 用户或系统提出一个高层目标 |
| 分解 | `intent.decomposed` | 协调者把意图拆成步骤树 |
| 分配 | `step.assigned` | 某个步骤分配给某个 Agent |
| 开始执行 | `step.started` | Agent 开始处理该步骤 |
| 阻塞 | `step.blocked` | 步骤遇到阻塞（等待依赖/需要裁决） |
| 完成 | `step.completed` | 步骤完成，结果汇报给协调者 |
| 协调决策 | `orchestrator.decision` | 协调者根据进展决定下一步 |
| 重新分解 | `step.redecomposed` | 发现步骤太大，进一步拆分 |
| 意图完成 | `intent.completed` | 所有步骤完成，意图达成 |

#### 协调者（Orchestrator）

协调者是管理整个意图执行的角色。它可以是：

- **Planner Agent**：自动分解意图为步骤，分配给合适的 Agent
- **人类用户**：手动指定步骤和分配
- **Supervisor**：根据法则和叙事自动生成意图并分解

协调者的核心职责：

1. **分解**：把高层意图拆成可执行的步骤树
2. **分配**：根据 Agent 能力和负载分配步骤
3. **监控**：观察步骤执行进展，发现阻塞
4. **决策**：步骤失败时决定重试/跳过/重新分解
5. **汇报**：向用户报告整体进展和需要裁决的问题

#### 执行者（Worker Agent）— 蚁群模式

**核心设计原则：执行者不需要理解全局目标。**

就像现实世界的劳动分工——工人不需要理解整栋建筑的设计，只需要按图砌好自己负责的那面墙。这意味着：

- **步骤必须足够小**：小到任何基础模型（Haiku 级别）都能独立完成
- **步骤必须自包含**：包含所有执行所需的上下文，不需要执行者去"理解"为什么
- **大量廉价模型并行**：一个 Opus/Sonnet 做一次分解 → 100 个 Haiku 并行执行
- **执行者是无状态的**：完成一个步骤后，Agent 不保留状态，等待下一个分配
- **失败是便宜的**：一个 Haiku 失败了，协调者可以换一个重试，成本极低

```text
成本模型：
  1 次 Opus 分解 = 100 个小步骤
  100 个 Haiku 并行执行 ≈ 1 次 Opus 的成本
  总成本 ≈ 2 次 Opus，但产出 = 100 次独立工作
```

执行者的行为极其简单：

1. 从队列中领取一个步骤
2. 读取步骤描述和上下文
3. 执行（写一个函数 / 修一个 bug / 跑一个测试 / 写一段文档）
4. 汇报结果（成功 + 产出 / 失败 + 原因）
5. 回到队列等待下一个步骤

执行者不需要知道：
- 这个步骤属于哪个更大的目标
- 其他 Agent 在做什么
- 整体进度如何
- 为什么要做这件事

#### 并行与依赖

步骤之间可以有依赖关系，也可以并行执行：

```text
Intent: "重构认证模块"
├── Step 1: "分析现有认证流程" (Analyst Agent)
│   └── 完成后触发 Step 2 和 Step 3
├── Step 2: "提取 token 逻辑" (Coder Agent A)  ← 依赖 Step 1
├── Step 3: "提取 session 逻辑" (Coder Agent B) ← 依赖 Step 1
│   ├── Step 3.1: "迁移 session store"
│   └── Step 3.2: "更新 session 中间件"         ← 依赖 Step 3.1
├── Step 4: "集成测试" (Tester Agent)           ← 依赖 Step 2 + Step 3
└── Step 5: "代码审查 + 合并" (Reviewer Agent)  ← 依赖 Step 4
```

Step 2 和 Step 3 可以并行执行（不互相依赖），Step 4 必须等两者都完成。

#### 多层协调：小组组长模式

现实世界不是"一个总指挥 + 一万个工人"的二层结构。真实的协作是多层的：

```text
总指挥（CEO）         → 1 个 Opus，做一次战略分解
  ├── 部门经理 A      → 1 个 Sonnet，管理模块 A 的执行
  │   ├── 组长 A1    → 1 个 Haiku，管理 5 个具体步骤
  │   │   ├── 工人   → Haiku，执行单个步骤
  │   │   ├── 工人   → Haiku
  │   │   └── 工人   → Haiku
  │   └── 组长 A2    → 1 个 Haiku，管理另外 5 个步骤
  │       ├── 工人   → Haiku
  │       └── ...
  └── 部门经理 B      → 1 个 Sonnet，管理模块 B 的执行
      └── ...
```

**关键洞察：小组组长本身也可以是廉价模型。**

组长不需要理解全局战略，它只需要：
1. 接收上级分配的一组步骤
2. 按顺序/依赖关系派发给工人
3. 收集工人的完成报告
4. 处理简单的失败重试（不需要理解为什么失败，只需要重新分配）
5. 向上级汇报本组完成状态

这形成了一个**分形结构**——每一层的行为模式完全相同，只是作用域不同：

| 层级 | 模型 | 作用域 | 职责 |
|------|------|--------|------|
| 总指挥 | Opus | 整个 Intent | 战略分解，高层决策 |
| 部门经理 | Sonnet | 一个大模块 | 模块级分解，跨组协调 |
| 小组组长 | Haiku | 5-10 个步骤 | 派发、收集、简单重试 |
| 工人 | Haiku | 1 个步骤 | 执行，汇报 |

**为什么组长可以是 Haiku？**

组长的工作是**调度**，不是**创造**：

```text
组长的 prompt 模板（极其简单）：

你管理以下 5 个步骤，按顺序执行：
1. [步骤描述] — 状态: 待执行
2. [步骤描述] — 状态: 待执行
3. ...

规则：
- 把第一个"待执行"步骤分配出去
- 收到完成报告后标记为"已完成"，分配下一个
- 收到失败报告后重试一次，再失败则上报
- 所有步骤完成后向上级汇报
```

这个 prompt 不需要任何领域知识，Haiku 完全胜任。

**成本优化效果：**

```text
传统模式：1 个 Opus 管理 100 个步骤
  → Opus 上下文窗口被 100 个步骤状态占满
  → 每次调度决策都消耗 Opus tokens
  → 成本高，且 Opus 在做简单调度工作

蚁群模式：1 Opus + 5 Sonnet + 20 Haiku 组长 + 100 Haiku 工人
  → Opus 只做一次战略分解（1 次调用）
  → Sonnet 各管 20 个步骤（少量调用）
  → Haiku 组长各管 5 个步骤（廉价调用）
  → Haiku 工人各执行 1 个步骤（最廉价）
  → 总成本 ≈ 1 Opus + 5 Sonnet + 120 Haiku ≈ 传统模式的 1/3
  → 并行度远高于传统模式
```

**事件流表达：**

多层协调在事件流中的表达：

| 事件 | 含义 |
|------|------|
| `orchestrator.delegated` | 上级把一组步骤委托给下级组长 |
| `orchestrator.group_started` | 组长开始管理自己的步骤组 |
| `orchestrator.step_dispatched` | 组长把步骤派发给工人 |
| `orchestrator.step_retried` | 组长决定重试失败步骤 |
| `orchestrator.group_completed` | 组长向上级报告本组全部完成 |
| `orchestrator.escalated` | 组长遇到无法处理的问题，上报给上级 |

**升级（Escalation）机制：**

当某一层无法处理问题时，向上升级：

```text
工人执行失败
  → 组长重试一次
  → 再次失败 → 组长上报给部门经理
  → 部门经理判断：重新分解 / 换策略 / 上报总指挥
  → 总指挥判断：重新规划 / 请求用户裁决
```

每次升级产生 `orchestrator.escalated` 事件，在 World Shell 中高亮显示。用户只在最终升级到顶层时才需要介入。

#### 与现有系统的映射

| 新概念 | 现有实现 | 适配方式 |
|--------|---------|---------|
| Intent | Goal（概念层） | 前端生成，不落库 |
| Step | Task（任务队列） | 每个 Step 对应一个 Task |
| Orchestrator | Planner Task + Supervisor | 复用现有分解逻辑 |
| Worker | CLI Daemon Agent | 复用现有任务执行 |
| Dependencies | Task 间无依赖字段 | Phase 1 前端管理，Phase 4+ 考虑后端 |

#### 第一版边界

Phase 1 不实现完整的 Intent 分解系统。先在 Chain Mode 中可视化现有 Task 的父子/关联关系：

- 用 Task 的 `goalId`（如果有）或时间/项目关联来推断步骤树
- 协调者角色先由用户手动承担（通过创建 Task 并指定依赖）
- 并行执行复用现有 Task Queue 的并发机制

Phase 4+ 再考虑：
- Intent 表（持久化意图和步骤树）
- 自动分解 API
- 依赖字段（Task 间的前置关系）
- 协调者 Agent 自动编排

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

World Definition Panel 是 Neo 修改 Matrix 源代码的地方。它承载三种核心操作：

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

#### B. Chain Mode（协同执行视图）

展示 Intent 的层级分解和并行执行状态——像项目经理看甘特图：

```text
┌─────────────────────────────────────────────────────────────┐
│ Intent: "重构认证模块"                    🟡 executing       │
│ Orchestrator: Planner Agent              Progress: 3/5      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ✅ Step 1: 分析现有认证流程              Analyst Agent      │
│ ├── ✅ Step 2: 提取 token 逻辑          Coder Agent A      │
│ ├── 🟡 Step 3: 提取 session 逻辑       Coder Agent B      │
│ │   ├── ✅ Step 3.1: 迁移 session store                    │
│ │   └── 🟡 Step 3.2: 更新 session 中间件 ← running        │
│ ├── ⏳ Step 4: 集成测试                  待分配             │
│ └── ⏳ Step 5: 代码审查 + 合并           待分配             │
│                                                              │
│ [阻塞: 无]  [下一步: Step 3.2 完成后触发 Step 4]           │
└─────────────────────────────────────────────────────────────┘
```

核心展示：

- **Intent 卡片**：顶层意图 + 整体进度 + 协调者
- **步骤树**：缩进展示层级关系，每个步骤显示状态 + 执行者
- **依赖线**：哪些步骤在等待哪些前置完成
- **并行指示**：同层级的步骤可以并行执行
- **阻塞高亮**：被阻塞的步骤标红，显示阻塞原因
- **协调者决策点**：协调者需要做决定的地方（如步骤失败后是否重试）

交互操作：

- 点击 Intent → 展开/折叠步骤树
- 点击 Step → Inspector 显示该步骤的事件详情
- 拖拽 Step → 手动调整执行顺序或重新分配
- 点击「+」→ 手动添加步骤或进一步分解
- 点击「重新分解」→ 让协调者重新规划剩余步骤

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
