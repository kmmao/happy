# 架构方案：Project 一等公民 + Supervisor Agent

> 设计日期：2026-03-15
> 状态：Draft - 待用户确认
> 版本：v2（含 UI 导航重构 + 督查者产品设计）

---

## 目录

1. [现状问题](#1-现状问题)
2. [UI 导航重构：方案 D](#2-ui-导航重构方案-d)
3. [Prisma Schema 变更](#3-prisma-schema-变更)
4. [Supervisor 配置模型](#4-supervisor-配置模型)
5. [Supervisor 监督维度](#5-supervisor-监督维度)
6. [Supervisor 运行流程](#6-supervisor-运行流程)
7. [Supervisor 行动决策逻辑](#7-supervisor-行动决策逻辑)
8. [API 设计](#8-api-设计)
9. [App 端变更](#9-app-端变更)
10. [Daemon 端变更](#10-daemon-端变更)
11. [数据迁移策略](#11-数据迁移策略)
12. [分阶段实施计划](#12-分阶段实施计划)
13. [业务场景](#13-业务场景)
14. [安全考量](#14-安全考量)
15. [关键 Trade-off](#15-关键-trade-off)

---

## 1. 现状问题

### 数据层
- **没有 Project 表**：项目是 App 端纯内存概念（`projectManager.ts`），用 `machineId:path` 分组会话
- 删除所有会话 = 项目消失，无法做项目级配置
- Supervisor Agent 需要一个稳定的项目实体来挂靠

### UI 层
- 底部 TabBar：`[ Inbox ] [ Sessions ] [ Project ] [ OpenClaw ] [ Settings ]`
- 现有 **Project Tab 是半成品**（Kanban + Ideas + Roadmap），功能无用，确认可全部删除
- Sessions Tab 中 `ActiveSessionsGroup` 已按 `machineId:path` 分组，但分组只是 section header，没有"点进去"的能力
- Git 功能（Issues/PRs/Changes）挂在 `session/[id]/git.tsx` 下，必须先进会话才能看 Git

### 核心矛盾
用户心智模型是 **"项目 → 会话"** 的包含关系，但 UI 入口是 **"会话列表"**，项目没有自己的详情页。

---

## 2. UI 导航重构：方案 D

### 2.1 方案评选

| 方案 | 描述 | 结论 |
|------|------|------|
| A: 替换 Project Tab 为项目列表 | Projects Tab + Sessions Tab 各自独立 | 数据重叠，用户困惑用哪个 Tab |
| B: 合并 Sessions + Project | 把 Sessions 改造为项目维度视图 | 对现有用户冲击太大，历史会话无处安放 |
| C: Sessions 顶部加 pills | 水平滚动过滤按钮 | 过滤 ≠ 导航，是 UX 反模式 |
| **D: 双视角互补（推荐）** | Projects = 管理台，Sessions = 操作台 | 职责分明，零冲突 |

### 2.2 底部 TabBar 结构

```
[ Inbox ] [ Sessions ] [ Projects ] [ OpenClaw ] [ Settings ]
                           ↑
                     替换废弃的看板
```

两个 Tab 的定位完全不同：

| Tab | 定位 | 解决什么问题 |
|-----|------|------------|
| **Sessions** | 操作台 | "我现在要跟哪个 AI 对话" — 快速找会话、发消息 |
| **Projects** | 管理台 | "我的项目状态怎么样" — 看 Git、Health、督查者 |

### 2.3 Projects Tab — 项目列表

```
+-----------------------------------------+
|  Projects                            +  |
|                                         |
|  +-------------------------------------+|
|  | * happy-coder                       ||
|  |   MacBook Pro  ~/dev/happy          ||
|  |   main  +2 -0   3 sessions         ||
|  |   [5 issues]  [2 PRs]              ||
|  +-------------------------------------+|
|                                         |
|  +-------------------------------------+|
|  | * client-app                        ||
|  |   Linux  /srv/client-app            ||
|  |   develop  +0 -3   1 session       ||
|  +-------------------------------------+|
|                                         |
|  + - - - - - - - - - - - - - - - - - - +|
|  | o api-gateway  (offline)            ||
|  + - - - - - - - - - - - - - - - - - - +|
+-----------------------------------------+
```

- 每张卡片 = 一个项目（`machineId + path` 唯一标识）
- 显示：项目名、机器、路径、Git 分支/同步状态、活跃会话数、Issue/PR 计数
- 在线/离线用实心/空心圆点 + 透明度区分
- 点击卡片 → 项目详情页

### 2.4 项目详情页

```
+-----------------------------------------+
|  <- happy-coder                      G  |
|     MacBook Pro  main                   |
|-----------------------------------------|
|  [ Sessions ] [ Git ] [ Health ]        |
|-----------------------------------------|
|                                         |
|  Sessions 视图:                         |
|  +-------------------------------------+|
|  | Session 1                   * busy  ||
|  | "Fix login bug"          3.2k tok   ||
|  |-------------------------------------||
|  | Session 2                 o idle    ||
|  | "Refactor auth"          1.1k tok   ||
|  |-------------------------------------||
|  | > Archived (3)                      ||
|  +-------------------------------------+|
|                                         |
|  +-------------------------------------+|
|  |          + New Session              ||
|  +-------------------------------------+|
+-----------------------------------------+

Git 视图（复用现有 GitTabBar 子组件）:
  Changes | History | Branches | Issues | PRs

Health 视图（督查者集成点）:
  健康度仪表盘 + 运行历史 + 审批队列
```

### 2.5 Sessions Tab — 完全不变

现有 `ActiveSessionsGroup` 按项目分组 + 历史按日期分组，不需要任何改动。

### 2.6 导航流程

```
                          +-------------+
                          |   TabBar    |
                          +------+------+
                     +-----------+-----------+
                     |           |           |
               +-----v-----+ +--v------+ +--v------+
               |  Sessions  | | Projects| | Others  |
               |  (全局     | | (项目   | |         |
               |   时间线)  | |  列表)  | |         |
               +-----+------+ +--+------+ +---------+
                     |           |
                     |     点击项目卡片
                     |           |
                     |    +------v----------+
                     |    |  项目详情页       |
                     |    | [Sessions][Git]  |
                     |    | [Health]         |
                     |    +--+----+----+----+
                     |       |    |    |
                     |   Sessions Git  Health
                     |   (该项目) (复用) (督查者)
                     |       |
                点击会话 <---+
                     |
               +-----v------+
               | Session     |
               | Detail      |
               | (聊天界面)   |
               +-------------+
```

操作路径：
- 快速回到活跃会话：Sessions → 点会话（**1 tap，不变**）
- 查看项目 Git 状态：Projects → 点项目 → Git tab（**2 taps**）
- 查看项目所有会话：Projects → 点项目（**1 tap**）
- 管理督查者：Projects → 点项目 → Health tab（**2 taps**）

### 2.7 特殊状态处理

| 状态 | 处理 |
|------|------|
| 0 个项目 | 空状态引导："Run `happy` in terminal to connect" |
| 1 个项目 | 正常显示列表（一张卡），不自动穿透 |
| 项目离线 | 卡片半透明 + 空心圆点，仍可查看历史会话 |
| 历史会话 | 项目详情 Sessions tab 中显示，默认折叠为 "Archived (N)" |

### 2.8 需要删除的代码（清理半成品）

```
components/kanban/           # 整个目录（12 个文件）
components/ideation/         # 整个目录
components/roadmap/          # 整个目录
components/project/ProjectSegmentControl.tsx  # 旧的 board/ideas/roadmap 切换
components/project/designTokens.ts
sync/kanbanStore.ts
sync/kanbanTypes.ts
app/(app)/kanban/            # 相关路由
app/(app)/ideation/          # 相关路由
app/(app)/roadmap/           # 相关路由
```

### 2.9 需要新建的文件

```
components/project/
  ProjectListView.tsx        # 项目列表页（替换原 ProjectView）
  ProjectCard.tsx            # 项目卡片组件
  ProjectDetailView.tsx      # 项目详情页（SegmentControl）
  ProjectSessionsTab.tsx     # 详情内的会话列表
  ProjectGitTab.tsx          # 详情内的 Git（复用现有组件）
  ProjectHealthTab.tsx       # 详情内的 Health（督查者入口）

hooks/
  useProjects.ts             # 从 projectManager 推导项目列表

app/(app)/project/
  [id].tsx                   # 项目详情页路由
```

### 2.10 需要修改的文件

```
components/MainView.tsx      # 替换 ProjectView 为 ProjectListView
components/TabBar.tsx        # 更新 Tab 标签（Project → Projects）
```

---

## 3. Prisma Schema 变更

> 注意：Phase 1（UI 重构）不需要数据库改动，数据来源仍是内存 projectManager。
> Phase 2 才引入以下 schema。

### 3.1 新增 Project 表

```prisma
model Project {
    id              String    @id @default(cuid())
    accountId       String
    account         Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)

    // 物理位置标识
    machineId       String
    path            String

    // 可选逻辑关联
    repoUrl         String?   // 标准化 git remote URL

    // 用户自定义元数据（加密）
    metadata        String?   // Encrypted JSON: { displayName?, color?, notes? }
    metadataVersion Int       @default(0)

    // 督查者配置（加密）
    supervisorConfig        String?
    supervisorConfigVersion Int       @default(0)

    // 生命周期
    archived        Boolean   @default(false)
    createdAt       DateTime  @default(now())
    updatedAt       DateTime  @updatedAt

    // 关联
    sessions            Session[]
    supervisorRuns      SupervisorRun[]

    @@unique([accountId, machineId, path])
    @@index([accountId])
    @@index([accountId, archived])
    @@index([accountId, repoUrl])
}
```

### 3.2 新增 SupervisorRun 表

```prisma
model SupervisorRun {
    id              String    @id @default(cuid())
    projectId       String
    project         Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
    accountId       String

    trigger         String    // "scheduled" | "manual" | "event"
    status          String    @default("pending")  // pending | running | completed | failed | cancelled

    // 加密的报告
    report          String?
    reportVersion   Int       @default(0)

    actionsCount    Int       @default(0)
    issuesCreated   Int       @default(0)
    sessionId       String?
    errorMessage    String?

    createdAt       DateTime  @default(now())
    updatedAt       DateTime  @updatedAt
    completedAt     DateTime?

    @@index([projectId])
    @@index([accountId, status])
    @@index([projectId, createdAt(sort: Desc)])
}
```

### 3.3 Session 表变更

```prisma
model Session {
    // ... 现有字段 ...
    projectId       String?
    project         Project?  @relation(fields: [projectId], references: [id], onDelete: SetNull)

    @@index([projectId])
}
```

### 3.4 Account 表变更

```prisma
model Account {
    // ... 现有关联 ...
    Project             Project[]
}
```

---

## 4. Supervisor 配置模型

存储在 `Project.supervisorConfig`，E2E 加密。

```typescript
interface SupervisorConfig {
  mode: 'disabled' | 'suggest' | 'semi-auto' | 'auto';

  schedule: {
    enabled: boolean;
    intervalHours: number;      // 默认 24
    preferredTimeUtc?: string;  // "HH:MM"
  };

  analysis: {
    codeQuality: boolean;
    dependencies: boolean;
    todos: boolean;
    techDebt: boolean;
    security: boolean;
  };

  constraints: {
    maxIssuesPerRun: number;          // 默认 3
    maxConcurrentSessions: number;    // 默认 1
    requireApprovalForPR: boolean;    // 默认 true
    allowedLabels: string[];          // 默认 ["auto-fix", "supervisor"]
    blockedPaths: string[];           // 默认 [".env*", "*.key", "*.pem"]
  };

  notifications: {
    onAnalysisComplete: boolean;
    onIssueCreated: boolean;
    onPRCreated: boolean;
    onError: boolean;
  };
}
```

---

## 5. Supervisor 监督维度

### MVP 维度（Phase 2 首批）

| 维度 | 检查方法 | 自动修复率 |
|------|---------|-----------|
| **安全** | `yarn audit` + secret 扫描 + 输入校验检查 | 高（升级依赖） |
| **依赖健康** | `yarn outdated` + CVE 检查 + deprecated 检测 | 高（版本升级） |
| **架构一致性** | 对照 CLAUDE.md 约定检查缩进/命名/i18n/禁用 API | 高（格式修复） |

### 后续维度（Phase 5 逐步加入）

| 维度 | 检查方法 | 严重程度示例 |
|------|---------|------------|
| 技术债 | grep TODO/FIXME + 统计 ts-ignore + git blame 判断年龄 | CRITICAL: ts-ignore 掩盖类型错误 |
| 代码质量 | eslint 复杂度 + jscpd 重复检测 + knip 死代码 | HIGH: 圈复杂度 > 15 |
| 测试覆盖 | vitest --coverage + 关键路径识别 | CRITICAL: 加密模块无测试 |
| 文档 | 路径引用校验 + 文档 vs 代码时间戳对比 | HIGH: CLAUDE.md 与代码矛盾 |
| 性能 | Prisma N+1 检测 + bundle size 分析 | HIGH: 循环内 findFirst |

### 严重程度分级

| 等级 | 触发的行动 | 示例 |
|------|-----------|------|
| **CRITICAL** | 立即创建 Issue + 推送通知 | CVE >= 7.0、硬编码 secret |
| **HIGH** | 创建 Issue，打包到周报 | major 版本落后 >= 2、deprecated 包 |
| **MEDIUM** | 仅记录报告，同类 >= 5 个升级为 HIGH | 缩进错误、缺少 i18n |
| **LOW** | 仅记录，供按需查看 | patch 落后、命名偏好 |

### 健康分计算

简单规则，不搞复杂加权：
- 每个维度 100 分
- CRITICAL 扣 20、HIGH 扣 10、MEDIUM 扣 3、LOW 扣 1
- 最低 0 分
- 总分 = 各维度等权平均

---

## 6. Supervisor 运行流程

### 6.1 触发方式

| 方式 | 触发者 | 适用场景 |
|------|--------|---------|
| 手动 | 用户在 App 点击"立即扫描" | 随时检查 |
| 定时 | Server 通过 Machine heartbeat 检查到期任务 | 日常巡检 |
| 事件 | GitHub Webhook 收到 push/PR 事件 | 增量检查 |

### 6.2 执行阶段

```
Phase 1: 环境采集（~5s）
  读取 CLAUDE.md、package.json、git diff

Phase 2: 维度扫描（~30s-2min，并行）
  按配置维度执行检查工具
  Push 触发 → 只扫 git diff 变更文件（增量，10-15s）
  定时触发 → 全量扫描（1-2min）

Phase 3: AI 综合分析（~15s）
  去重关联 → 优先级排序 → 趋势分析 → 修复建议
```

### 6.3 报告结构

```typescript
interface SupervisorReport {
  summary: {
    healthScore: number;             // 0-100
    trend: 'improving' | 'stable' | 'degrading';
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    topIssues: string[];             // 最值得关注的 3-5 个发现
  };
  dimensions: Record<string, {
    score: number;
    trend: 'up' | 'stable' | 'down';
    findings: Finding[];
  }>;
  suggestedActions: Action[];
}

interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  dimension: string;
  title: string;
  description: string;
  file?: string;
  line?: number;
  suggestedFix?: string;
  autoFixable: boolean;
}

interface Action {
  type: 'create-issue' | 'create-pr' | 'notify' | 'update-doc';
  title: string;
  description: string;
  findings: string[];                // 关联 Finding IDs
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
  autoExecutable: boolean;
}
```

报告数据存为 **Artifact**（复用 E2E 加密基础设施），SupervisorRun 表只存索引信息。

---

## 7. Supervisor 行动决策逻辑

### 7.1 创建 Issue 的标准

| 创建 Issue | 不创建 Issue |
|-----------|-------------|
| CRITICAL 级别的任何发现 | LOW 级别的发现 |
| HIGH 级别且可执行的修复 | 重复出现但已有 open Issue 的问题 |
| 同类 MEDIUM 问题积累 >= 5 个 | 纯信息性的观察 |
| 趋势恶化的维度（连续 3 次下降） | 用户标记为"忽略"的技术债 |

### 7.2 三种运行模式

| 操作 | suggest | semi-auto | auto |
|------|---------|-----------|------|
| 分析代码 | Yes | Yes | Yes |
| 生成报告 | Yes | Yes | Yes |
| 创建 GitHub Issue | No | Yes (supervisor 标签) | Yes (auto-fix 标签) |
| 触发 auto-fix | No | No (需用户加标签) | Yes |
| Review/Merge PR | **No (永远)** | **No (永远)** | **No (永远)** |

PR 合并永远需要人类确认，这是**硬编码约束**，不是配置项。

### 7.3 Issue 执行结果跟踪

每次 Supervisor 运行时回查上次的 Issue：
- Finding 消失 → 自动关闭 Issue + 添加验证评论
- Finding 仍在 → 更新 Issue 评论（"第 N 次检测到"）
- Finding 恶化 → 升级 Issue 优先级 + 通知用户

---

## 8. API 设计

### 8.1 Project CRUD

```
GET    /v1/projects                     # 列出所有项目
POST   /v1/projects                     # 创建项目
GET    /v1/projects/:id                 # 项目详情
PATCH  /v1/projects/:id                 # 更新项目
DELETE /v1/projects/:id                 # 删除项目
POST   /v1/projects/resolve             # 按 machineId + path 查找/创建
GET    /v1/projects/:id/sessions        # 项目会话列表
```

### 8.2 Supervisor

```
POST   /v1/projects/:id/supervisor/run           # 手动触发
GET    /v1/projects/:id/supervisor/runs           # 运行历史
GET    /v1/projects/:id/supervisor/runs/:runId    # 运行详情
POST   /v1/projects/:id/supervisor/cancel/:runId  # 取消运行
```

### 8.3 新增 Event 类型

```typescript
// Ephemeral Events
| { type: "supervisor-trigger"; projectId: string; runId: string; ... }
| { type: "supervisor-status"; runId: string; status: string; ... }

// Update Events
| { type: "new-project"; projectId: string; ... }
| { type: "update-project"; projectId: string; ... }
```

---

## 9. App 端变更

### 9.1 projectManager.ts 改造

Phase 1: 保持内存模式，增加项目列表 hook
Phase 2: 改为混合模式（本地 Map 缓存 + 服务端 Project 同步）

### 9.2 UI 页面总览

**项目体系（替换废弃看板）：**
- `ProjectListView.tsx` — 项目列表（Projects Tab 主页）
- `ProjectCard.tsx` — 项目卡片组件
- `ProjectDetailView.tsx` — 项目详情页（SegmentControl: Sessions/Git/Health）
- `ProjectSessionsTab.tsx` — 项目内会话列表
- `ProjectGitTab.tsx` — 项目 Git 视图（复用现有 Git 组件）
- `ProjectHealthTab.tsx` — 督查者入口

**督查者体系（Health Tab 内）：**

```
Health Tab
  +-- 健康度仪表盘（默认视图）
  |     总分 + 各维度条形图 + 趋势箭头
  |     CRITICAL/HIGH 计数
  |     [ 立即扫描 ] [ 运行历史 ]
  |
  +-- 维度详情（点击某维度）
  |     折叠 Section: CRITICAL 默认展开
  |     Finding 卡片: 彩色左边框 + 描述 + [批准修复]
  |
  +-- 待审批行动
  |     审批卡片: 修复计划 + [批准] [跳过] [忽略此类]
  |     批准后: 实时进度 + [查看会话]
  |
  +-- 运行历史
  |     卡片列表: 日期 + 触发方式 + 总分变化 + 行动数
  |
  +-- 设置（gear icon）
        扫描频率 / 维度开关 / 自动化 / 通知
```

### 9.3 健康度仪表盘设计

```
+------------------------------------------+
|  +------------------------------------+  |
|  |       总分  82 / 100               |  |
|  |   ================----             |  |
|  |      ^ +3 较上次                   |  |
|  +------------------------------------+  |
|                                          |
|  ! 1 Critical   /!\ 3 High              |
|                                          |
|  安全         ==========-   95           |
|  架构一致性   =========-    90           |
|  依赖健康     =========-    88           |
|  文档         ======----    78           |
|  代码质量     =====-----    75           |
|  测试覆盖     =====-----    73           |
|  技术债       =====-----    62  v        |
|                                          |
|  最后扫描: 2 小时前  耗时 45s            |
|                                          |
|  [ 立即扫描 ]    [ 运行历史 -> ]         |
+------------------------------------------+
```

- 进度条颜色：绿 > 80 / 黄 60-80 / 红 < 60
- 下降维度用红色箭头标注
- 复用 `ItemGroup` 组件做维度列表

### 9.4 审批流程设计

```
+------------------------------------------+
|  待审批  (2)                              |
|                                          |
|  +--------------------------------------+|
|  | [!] 升级 jsonwebtoken                ||
|  |     CRITICAL  修改 2 文件             ||
|  |     预计 <1 分钟                      ||
|  |                                      ||
|  |  修复计划:                            ||
|  |  1. yarn upgrade                     ||
|  |  2. 适配 API 签名                    ||
|  |  3. 运行测试                          ||
|  |  4. 创建 PR                           ||
|  |                                      ||
|  |  [ 批准 ] [ 跳过 ] [ 忽略此类 ]       ||
|  +--------------------------------------+|
+------------------------------------------+

批准后:
+--------------------------------------+
| 修复中: 升级 jsonwebtoken             |
|                                      |
| ========--------  70%                |
|                                      |
| [v] 升级依赖                         |
| [v] 适配 API 变更                    |
| [~] 运行测试...                      |
| [ ] 创建 PR                          |
|                                      |
| [ 查看实时会话 ]                      |
+--------------------------------------+
```

### 9.5 设置页设计

复用 `ItemGroup` + `Item` + `Switch` 模式：

```
+------------------------------------------+
|  <- Supervisor 设置                       |
|                                          |
|  -- 扫描频率 --                           |
|  定时扫描             [ 每周  v ]         |
|  Push 触发               [ ON ]          |
|  PR 触发                 [ ON ]          |
|                                          |
|  -- 扫描维度 --                           |
|  安全                    [ ON ]          |
|  依赖健康                [ ON ]          |
|  架构一致性              [ ON ]          |
|  技术债                  [ ON ]          |
|  代码质量               [ OFF ]          |
|  测试覆盖               [ OFF ]          |
|  (注: 需要运行测试，耗时较长)              |
|                                          |
|  -- 自动化 --                             |
|  自动创建 Issue          [ ON ]          |
|  修复需要审批            [ ON ]          |
|  每次最多创建 Issue       [ 3 ]          |
|                                          |
|  -- 通知 --                               |
|  Critical 即时推送       [ ON ]          |
|  周报摘要                [ ON ]          |
+------------------------------------------+
```

---

## 10. Daemon 端变更

新增 `src/supervisor/` 目录：

```
src/supervisor/
  handleSupervisorTrigger.ts    # 处理 supervisor-trigger 事件
  buildSupervisorPrompt.ts      # 生成分析 prompt
  supervisorActions.ts          # 分析完成后的动作处理
```

处理逻辑与 `handleWebhookTrigger.ts` 高度相似：
1. 收到 supervisor-trigger → 生成 prompt → spawn session → 汇报状态

Supervisor session 以**只读模式**运行，prompt 明确禁止修改文件。

---

## 11. 数据迁移策略

**必须从 App 端发起**（Session.metadata 是加密的，Server 无法读取）：

1. App 更新后首次同步 → 检测 Project 表为空
2. 从本地 projectManager 提取所有 `machineId + path` 组合
3. 批量调用 `POST /v1/projects` 创建
4. 对每个 session 设置 projectId

---

## 12. 分阶段实施计划

### Phase 1: UI 重构 — Project 一等公民（纯前端）

**不需要数据库改动**，数据来源仍是内存 `projectManager`。

- [ ] 删除废弃代码（kanban/ideation/roadmap 全部目录 + 相关 store/路由）
- [ ] 新建 `ProjectListView` 替换 `ProjectView`
- [ ] 新建 `ProjectCard` 组件
- [ ] 新建 `ProjectDetailView`（SegmentControl: Sessions/Git/Health）
- [ ] 新建 `ProjectSessionsTab`（项目内会话列表 + archived 折叠）
- [ ] 新建 `ProjectGitTab`（复用现有 Git 组件，从项目维度获取数据）
- [ ] 新建 `ProjectHealthTab`（占位，显示"Coming Soon"）
- [ ] 修改 `MainView.tsx` + `TabBar.tsx`
- [ ] 移除 `showProjectTab` 设置开关，Projects Tab 默认显示
- [ ] 新建 `useProjects.ts` hook

### Phase 2: Project 持久化 + Supervisor 基础

- [ ] Prisma schema 变更（Project 表、SupervisorRun 表、Session.projectId）
- [ ] Server: projectRoutes.ts (CRUD + resolve)
- [ ] Server: session 创建时自动关联 project
- [ ] App: projectManager 改为混合模式（内存 + 服务端同步）
- [ ] App: 数据迁移逻辑（首次同步自动创建 Project）
- [ ] App: 项目重命名、归档功能
- [ ] Server: supervisorRoutes.ts
- [ ] CLI: src/supervisor/ 目录（handler + prompt builder）
- [ ] App: Health Tab 实现（仪表盘 + 手动触发 + suggest 模式）

### Phase 3: Supervisor semi-auto + 审批

- [ ] CLI: supervisorActions.ts（自动创建 Issue）
- [ ] App: semi-auto 模式配置
- [ ] App: 审批 UI（批准/跳过/忽略）
- [ ] App: 修复进度追踪
- [ ] 通知集成（push notification）

### Phase 4: Supervisor auto + 定时调度

- [ ] Server: 利用 Machine heartbeat 检查到期任务触发
- [ ] CLI: auto 模式（直接加 auto-fix 标签）
- [ ] App: auto 模式配置 + 安全警告
- [ ] App: 调度配置 UI
- [ ] 每日运行上限（Server 硬限制）

### Phase 5: 高级功能（持续迭代）

- [ ] 跨机器项目关联（repoUrl 匹配）
- [ ] 增量扫描（Push 触发只扫 git diff）
- [ ] 运行报告趋势图
- [ ] 自定义分析规则 / 自定义 prompt
- [ ] 成本追踪（token 消耗统计）
- [ ] 更多维度：技术债、代码质量、测试覆盖、文档、性能

---

## 13. 业务场景

### 场景 1: 安全漏洞紧急发现
- 触发：每日定时扫描
- 发现：`jsonwebtoken` 有 CVSS 9.1 漏洞
- 用户：收到推送通知，App 中看到红色告警卡片
- 操作：点"批准修复" → Claude Code 自动升级 + 适配 + 创建 PR
- 结果：用户 Review diff → 一键合并

### 场景 2: CLAUDE.md 约定违规
- 触发：Push 触发增量扫描
- 发现：Server 文件 2 空格缩进（应 4 空格）+ 硬编码字符串未 i18n
- 用户：App 显示 "2 处约定违规"
- 操作：批准修复 → 自动修正缩进 + 添加 i18n key（9 种语言）
- 结果：修复 commit 自动提交

### 场景 3: 技术债持续恶化
- 触发：周度扫描
- 发现：TODO 从 3 增到 11，controlServer.ts 复杂度从 12 到 18
- 用户：健康度"技术债"从 78 分降到 62 分，趋势箭头向下
- 操作：Supervisor 创建聚合 Issue
- 结果：排入下个 sprint

### 场景 4: 依赖渐进式升级
- 触发：月度扫描
- 发现：12 个过期依赖，分三组（直接升级/少量适配/大改）
- 用户：一键批准第一组 7 个安全升级
- 结果：自动 upgrade + 测试 + PR

### 场景 5: N+1 查询发现
- 触发：Push 触发
- 发现：新增 `feedGet.ts` 循环内调用 `findUnique`
- 操作：批准修复 → 重构为单次 `findMany` + `include`
- 结果：自动验证测试通过

---

## 14. 安全考量

1. **Supervisor session 只读**：prompt 明确禁止修改文件，可配合 `--permission-mode`
2. **PR 审批永远需要人类**：硬编码约束，不是配置项
3. **速率限制**：`maxIssuesPerRun` + 每日运行上限（Server 硬限制）
4. **操作审计**：所有 SupervisorRun 记录保留（触发方式、结果、Issue 数量）
5. **blockedPaths**：注入 prompt + auto-fix session 约束
6. **加密配置**：SupervisorConfig 加密存储，执行时通过 ephemeral 事件传递
7. **auto 模式二次确认**：启用时弹出安全警告
8. **成本保护**：token 消耗超阈值自动暂停

---

## 15. 关键 Trade-off

| 决策 | 选择 | 原因 |
|------|------|------|
| UI 导航方案 | 方案 D：双视角互补 | Sessions=操作台, Projects=管理台，职责分明 |
| 原 Project Tab | 全部删除（Kanban/Ideas/Roadmap） | 用户确认无用，减少维护负担 |
| Projects Tab 默认显示 | 是，移除 showProjectTab 开关 | 核心功能不应藏在设置里 |
| Phase 1 是否需要 DB | 不需要，纯 UI 重构 | 先验证产品形态再投入持久化 |
| Project 存储位置（Phase 2） | Server 端 DB 表 | 需被 Session 外键引用，Server 需按项目做调度查询 |
| Supervisor 执行方式 | 独立 Claude Code Session | 复用现有基础设施，在 App 中完全可观察 |
| 代码修改方式 | 通过 Issue -> auto-fix 间接执行 | Supervisor 是"分析决策"角色，不是"执行"角色 |
| 定时调度 | 利用 Machine heartbeat 检查 | 避免自建 cron 基础设施 |
| 数据迁移 | App 端发起 | 尊重 E2E 加密，Server 无法解密 metadata |
| repoUrl 定位 | 可选属性，非主键 | 同 repo 多 checkout 不适合用 repoUrl 做唯一标识 |
| 报告存储 | Artifact（加密） | 复用现有 E2E 加密基础设施 |
| 健康分算法 | 简单扣分制 | 用户关心趋势方向，不关心算法精度 |
| MVP 维度 | 安全 + 依赖 + 架构一致性 | 最容易自动化、闭环体验最好 |
