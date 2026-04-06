# World Model 实施路线图

_Created: 2026-04-06_
_Status: 规划阶段_

## 原则

1. **不砍现有功能**：所有已实现的系统继续工作，World Model 是顶层概念层
2. **渐进式改造**：每个 Phase 独立可用，不依赖后续 Phase
3. **最小改动优先**：优先通过加字段、改 prompt 实现，而不是重写系统
4. **验证驱动**：每个 Phase 结束时，用一个真实项目验证效果

---

## Phase 0：世界宪法

_预计工作量：1-2 天_
_前置条件：无_

### 目标

让每个项目有自己的"叙事"和"法则"，Supervisor 分析时按法则检查。

### 改动清单

**Server（Prisma Schema）**：
```prisma
model Project {
  // 现有字段不变...
  narrative    Bytes?     // 加密：项目愿景/叙事描述
  laws         Bytes?     // 加密：JSON 数组，每条法则包含 {id, category, description, enabled, severity}
}
```

**Server（API）**：
- `PATCH /v3/projects/:id` 扩展支持 `narrative` 和 `laws` 字段
- 新增 `GET /v3/projects/:id/laws` 返回法则列表

**CLI（Supervisor prompt 注入）**：
- `buildSupervisorPrompt.ts`：在分析 prompt 前注入 `narrative + laws`
- prompt 模板增加："以下是该项目的法则，请按这些法则检查项目状态，并报告违规项"

**App（UI）**：
- 项目详情页增加"叙事"编辑区域（富文本 or 纯文本）
- 项目详情页增加"法则"管理（列表 + 增删改 + 启用/禁用）

### 验证标准

- [ ] 给一个项目设定法则："测试覆盖率 ≥ 80%"
- [ ] 运行 Supervisor 分析，报告中引用该法则
- [ ] 修改法则后，下一次分析反映变化

---

## Phase 1：角色系统

_预计工作量：3-5 天_
_前置条件：Phase 0_

### 目标

Agent Loop 有角色身份，不同角色有不同的技能、职责和行为模式。

### 改动清单

**Server（Prisma Schema）**：
```prisma
model AgentRole {
  id           String   @id @default(cuid())
  accountId    String
  projectId    String
  
  name         String                          // "守卫"、"医生" 等
  type         String                          // guardian | builder | healer | chronicler | planner | custom
  description  Bytes                           // 加密：角色描述和行为指令
  duties       Bytes                           // 加密：JSON 数组，职责清单
  skillIds     Json     @default("[]")         // 绑定的 Skill ID 列表
  
  maxConcurrency  Int   @default(1)            // 并发上限
  enabled      Boolean  @default(true)
  
  // 触发配置
  triggerMode  String   @default("scheduled")  // scheduled | event | manual
  cronExpr     String?                         // 定时触发
  eventTypes   Json     @default("[]")         // 事件触发类型列表
  
  project      Project  @relation(...)
  account      Account  @relation(...)
  
  @@unique([accountId, projectId, name])
}
```

**CLI（Agent Loop 改造）**：
- AgentLoop 增加 `roleId` 字段
- 启动 Loop 时，拉取角色配置（description + duties + skills）
- 注入角色身份到 prompt 前缀："你是 [项目名] 的 [角色名]，你的职责是……"

**App（UI）**：
- 项目详情页增加"角色管理"tab
- 每个角色显示：名称、类型、状态（idle/working/blocked）、绑定技能、触发配置
- 预设角色模板（守卫、医生、史官等）可一键创建

### 与现有系统的关系

- **不替换 Supervisor**：Supervisor 可以被配置为"守卫"角色或"医生"角色
- **不替换 Agent Loop**：Agent Loop 获得角色身份，行为由角色配置决定
- **不替换 Task Queue**：Task 可以指定目标角色，由该角色的 Agent 执行

### 验证标准

- [ ] 创建一个"守卫"角色，绑定安全相关 Skills
- [ ] 创建一个"医生"角色，绑定修复相关 Skills
- [ ] 两个角色在同一个项目并行运行，各自只做自己职责内的事
- [ ] App 上能看到每个角色的当前状态

---

## Phase 2：裁决机制

_预计工作量：3-5 天_
_前置条件：Phase 1_

### 目标

Agent 遇到不确定决策时，上报给用户裁决；裁决结果自动成为知识库判例。

### 改动清单

**Server（Prisma Schema）**：
```prisma
model Decision {
  id           String   @id @default(cuid())
  accountId    String
  projectId    String
  
  agentRole    String                          // 发起角色
  sessionId    String?                         // 关联会话
  
  question     Bytes                           // 加密：问题描述
  context      Bytes?                          // 加密：上下文信息
  options      Bytes                           // 加密：JSON 数组 [{id, description, pros, cons}]
  
  status       String   @default("pending")    // pending | decided | expired | auto_resolved
  chosenOption String?                         // 选中的选项 ID
  rationale    Bytes?                          // 加密：决策理由
  
  // 判例法
  knowledgeId  String?                         // 生成的知识条目 ID
  precedentKey String?                         // 判例分类 key（用于匹配同类问题）
  
  expiresAt    DateTime?                       // 超时自动过期
  decidedAt    DateTime?
  
  project      Project  @relation(...)
  account      Account  @relation(...)
}
```

**Server（逻辑）**：
- Decision 创建时，自动创建高优先级 InboxItem（category: `decision`）
- Decision 裁决后，自动创建 Knowledge 条目（entryType: `decision`，category: `precedent`）
- Agent 发起新 Decision 前，先查询知识库是否有匹配的判例（precedentKey）

**CLI（Agent prompt 扩展）**：
- Agent 的可用工具增加：`report_decision(question, options)` → 暂停当前任务，等待裁决
- Agent 收到裁决结果后继续执行

**App（UI）**：
- Inbox 中 Decision 类型显示为卡片：问题 + 选项列表 + 每个选项的利弊
- 点击选项 → 确认 → 可选填理由
- 裁决后显示"已生成判例"链接

### 判例法流程

```
Agent 遇到不确定问题
  ↓
检查知识库是否有匹配判例 (precedentKey)
  ├─ 有 → 直接引用判例，按判例执行
  └─ 无 → 创建 Decision，等待裁决
           ↓
         用户裁决
           ↓
         生成判例（Knowledge 条目）
           ↓
         下次同类问题 → 命中判例 → 不再上报
```

### 验证标准

- [ ] Agent 遇到两种修复方案时，自动上报 Decision
- [ ] 在 App 中裁决后，Agent 继续执行
- [ ] 裁决结果写入 Knowledge Base
- [ ] 再次遇到同类问题时，Agent 自动引用判例

---

## Phase 3：目标引擎

_预计工作量：5-7 天_
_前置条件：Phase 2_

### 目标

用户设定高层目标，系统自动分解为任务并分配给合适的角色。

### 改动清单

**Server（Prisma Schema）**：
```prisma
model Goal {
  id           String   @id @default(cuid())
  accountId    String
  projectId    String
  
  title        Bytes                           // 加密：目标标题
  description  Bytes?                          // 加密：详细描述
  
  status       String   @default("planning")   // planning | in_progress | blocked | completed | cancelled
  progress     Int      @default(0)            // 0-100
  
  priority     String   @default("normal")     // urgent | normal | low
  deadline     DateTime?
  
  // 分解
  parentGoalId String?                         // 支持目标嵌套
  taskIds      Json     @default("[]")         // 关联的 Task ID 列表
  decisionIds  Json     @default("[]")         // 关联的 Decision ID 列表
  
  createdBy    String                          // user | planner_agent
  
  project      Project  @relation(...)
  account      Account  @relation(...)
}
```

**Server（逻辑）**：
- Goal 创建后，触发"规划者"角色 Agent
- 规划者 Agent 分析目标 → 生成任务树 → 分配角色
- 任务完成时，自动更新 Goal 进度
- 所有任务完成时，Goal 状态变为 completed

**CLI（规划者 Agent）**：
- 专用 prompt 模板：分析目标 → 列出子任务 → 评估每个任务的角色和优先级
- 输出结构化的任务清单（JSON）
- 对不确定的拆分方案，上报 Decision

**App（UI）**：
- 项目详情页增加"目标"tab
- 目标视图：标题 + 进度条 + 子任务列表 + 关联决策
- 新建目标：输入标题和描述，系统自动分解

### 验证标准

- [ ] 创建目标"实现 OAuth2 登录"
- [ ] 规划者自动分解为 3-5 个子任务
- [ ] 子任务自动分配给合适的角色
- [ ] 任务完成后目标进度自动更新

---

## Phase 4：世界自治

_预计工作量：7-10 天_
_前置条件：Phase 3_

### 目标

判例积累到一定程度后，世界基本自治运行。上帝只需偶尔裁决和调整叙事。

### 改动清单

**自治度指标**：
```
autonomy_score = 1 - (decisions_pending / decisions_total_30d)
```
- 100% = 完全自治（30 天内无待裁决事项）
- 0% = 完全依赖人类

**Agent 间通信**：
- 新增 `AgentMessage` 模型（from_role, to_role, content, type）
- 类型：request（请求协助）、report（报告结果）、conflict（冲突上报）
- 信使角色负责协调冲突

**法则自动进化**：
- 守卫角色可以建议新法则（基于发现的模式）
- 建议的法则进入 Decision 流程，由用户确认
- 确认后自动生效

**Dashboard**：
- 世界概览：自治度、健康度、活跃角色、待裁决数
- 时间线：所有事件按时间排列
- 目标进度：所有目标的当前状态

### 验证标准

- [ ] 自治度指标准确反映裁决需求的变化趋势
- [ ] Agent 之间能协调工作（如建筑师请求守卫审查）
- [ ] 守卫能基于经验建议新法则
- [ ] Dashboard 一目了然展示世界状态

---

## 关键设计决策

### Q: 法则用自然语言还是结构化定义？

**决策：初期用自然语言 + 分类标签。**

理由：结构化法则（如 `coverage >= 80`）需要编写检测逻辑，每种法则都不同。自然语言法则直接注入 Supervisor prompt，让 LLM 理解和检查，开发成本几乎为零。

```json
{
  "id": "law-001",
  "category": "quality",
  "description": "所有模块的测试覆盖率不低于 80%",
  "severity": "high",
  "enabled": true
}
```

### Q: 角色是新模型还是 AgentLoop 的属性？

**决策：新建 AgentRole 模型，AgentLoop 引用 roleId。**

理由：一个角色可能对应多个 AgentLoop 实例（不同触发方式），角色配置需要独立管理。

### Q: 裁决超时怎么处理？

**决策：裁决默认 24h 超时，超时后 Agent 跳过该任务，标记为 blocked。**

理由：不能让 Agent 无限等待。超时的 Decision 保留在 Inbox 中，用户可以后续裁决。

### Q: 目标分解用 LLM 还是规则引擎？

**决策：用 LLM（规划者 Agent）。**

理由：目标的语义太多样，规则引擎无法覆盖。LLM 分解后输出结构化 JSON，系统处理结构化结果。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [world-model-vision.md](./world-model-vision.md) | 顶层设计和概念模型 |
| [world-model-multica-analysis.md](./world-model-multica-analysis.md) | Multica 竞品分析 |
| [world-model-capability-map.md](./world-model-capability-map.md) | 现有能力盘点和缺口分析 |
| **本文** | 分阶段实施路线图 |
