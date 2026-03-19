# Project Management Modules

本文档描述项目管理三大模块：Kanban、Ideation、Roadmap 的架构设计。

## 模块概览

| 模块 | 功能 | 数据存储 | 入口 | 作用域 |
|------|------|----------|------|--------|
| **Kanban** | 任务看板（5 列） | UserKVStore `kanban:*` | ProjectDetailView Tab | Per-Project |
| **Ideation** | 创意收集与管理 | UserKVStore `ideation:*` | ProjectDetailView Tab | Per-Project |
| **Roadmap** | 里程碑 + 功能规划 | UserKVStore `roadmap:*` | ProjectDetailView Tab | Per-Project |

三个模块作为 **ProjectDetailView** 的新 Tab 嵌入项目详情页，与现有 Sessions / Git / Health / Actions / Research 并列。

### 实施顺序

1. **Phase 1: Ideation** — 独立模块，无外部依赖
2. **Phase 2: Roadmap** — 独立模块，两级结构（Milestone → Feature）
3. **Phase 3: Kanban** — 拖拽看板（暂缓）
4. **Phase 4: 跨模块集成** — Idea/Feature → Task 转换，依赖 Kanban

## 架构设计

### 数据层

所有模块使用 **Zustand + UserKVStore** 模式，端到端加密存储：

```
Zustand Store (内存状态)
  ↕ load / save
UserKVStore (kvMutate / kvList)
  ↕ E2E 加密
Server (PostgreSQL)
```

每个 Store 遵循相同模式：
- `loadXxx()` — 从 KV 加载，带版本冲突合并
- `saveXxx()` — 写入 KV，乐观更新 + 版本递增
- `deleteXxx()` — KV 删除
- `useXxxHook()` — React 选择器 hooks

### KV Key 设计（Per-Project）

| Store | KV 前缀 |
|-------|---------|
| `kanbanStore` | `kanban:p:{projectId}:task:{id}` |
| `ideationStore` | `ideation:p:{projectId}:idea:{id}` |
| `roadmapStore` | `roadmap:p:{projectId}:milestone:{id}`, `roadmap:p:{projectId}:feature:{id}` |

### Store 文件

| Store | 文件 |
|-------|------|
| `kanbanStore` | `sync/kanbanStore.ts` |
| `ideationStore` | `sync/ideationStore.ts` |
| `roadmapStore` | `sync/roadmapStore.ts` |

### 类型定义

| 文件 | 导出 |
|------|------|
| `sync/kanbanTypes.ts` | `KanbanTask`, `KanbanColumnId`, `KANBAN_COLUMNS` |
| `sync/ideationTypes.ts` | `IdeationIdea`, `IdeationStatus`, `IdeationCategory`, `IDEATION_STATUSES` |
| `sync/roadmapTypes.ts` | `RoadmapMilestone`, `RoadmapFeature`, `MilestoneStatus`, `MoscowPriority` |

## Ideation 模块

### 数据结构

```typescript
type IdeationStatus = 'draft' | 'active' | 'converted' | 'dismissed';
type IdeationCategory = 'feature' | 'improvement' | 'bugfix' | 'refactor' | 'documentation' | 'other';

interface IdeationIdea {
    id: string;
    title: string;
    description: string;
    status: IdeationStatus;
    category: IdeationCategory;
    tags: string[];
    convertedTaskId: string | null;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
}
```

### 4 种状态

| 状态 | 说明 |
|------|------|
| `draft` | 草稿 |
| `active` | 活跃/待评估 |
| `converted` | 已转为 Task（Phase 4） |
| `dismissed` | 已忽略 |

### 核心功能

- **Filter Bar** — 横向滚动状态筛选，带计数 badge
- **Category 标签** — 6 种类别（Feature / Improvement / Bug Fix / Refactor / Documentation / Other）
- **ActionSheet** — 状态切换、删除
- **Convert to Task** — Phase 4 实现，一键转为 Kanban Task

### Store API

```typescript
// ideationStore.ts
interface IdeationStoreState {
    ideas: Record<string, IdeationIdea>;       // projectId:ideaId → Idea
    versions: Record<string, number>;           // KV key → version
    loading: Record<string, boolean>;           // projectId → loading

    loadIdeas(projectId: string): Promise<void>;
    saveIdea(projectId: string, idea: IdeationIdea): Promise<void>;
    deleteIdea(projectId: string, ideaId: string): Promise<void>;
    updateIdeaStatus(projectId: string, ideaId: string, status: IdeationStatus): Promise<void>;
}
```

## Roadmap 模块

### 两级结构

```
Milestone (里程碑)
  └── Feature (功能项)
       └── status: planned | in_progress | completed | cancelled
```

### 数据结构

```typescript
type MilestoneStatus = 'planning' | 'active' | 'completed' | 'on_hold';
type FeatureStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
type MoscowPriority = 'must_have' | 'should_have' | 'could_have' | 'wont_have';
type FeatureComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';

interface RoadmapMilestone {
    id: string;
    title: string;
    description: string;
    status: MilestoneStatus;
    targetDate: number | null;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
}

interface RoadmapFeature {
    id: string;
    milestoneId: string;
    title: string;
    description: string;
    status: FeatureStatus;
    moscow: MoscowPriority;
    complexity: FeatureComplexity;
    sortOrder: number;
    convertedTaskId: string | null;
    createdAt: number;
    updatedAt: number;
}
```

### Milestone 状态

| 状态 | 说明 |
|------|------|
| `planning` | 规划中 |
| `active` | 进行中 |
| `completed` | 已完成 |
| `on_hold` | 暂停 |

### 核心功能

- **可折叠卡片** — Milestone 卡片点击展开/收起 Feature 列表
- **进度条** — 基于 Feature 完成数/总数计算
- **目标日期** — Milestone 可设置 targetDate
- **MoSCoW 优先级** — Must/Should/Could/Won't
- **复杂度标签** — Trivial/Simple/Moderate/Complex/Very Complex
- **Convert to Task** — Phase 4 实现

### Store API

```typescript
// roadmapStore.ts
interface RoadmapStoreState {
    milestones: Record<string, RoadmapMilestone>;   // projectId:milestoneId → Milestone
    features: Record<string, RoadmapFeature>;       // projectId:featureId → Feature
    milestoneVersions: Record<string, number>;
    featureVersions: Record<string, number>;
    loading: Record<string, boolean>;

    loadRoadmap(projectId: string): Promise<void>;
    saveMilestone(projectId: string, milestone: RoadmapMilestone): Promise<void>;
    deleteMilestone(projectId: string, milestoneId: string): Promise<void>;
    saveFeature(projectId: string, feature: RoadmapFeature): Promise<void>;
    deleteFeature(projectId: string, featureId: string): Promise<void>;
}
```

## Kanban 模块（Phase 3，暂缓）

### 5 列看板

| 列 ID | 标签 | 说明 |
|--------|------|------|
| `backlog` | Backlog | 待规划 |
| `todo` | To Do | 待开始 |
| `in_progress` | In Progress | 进行中 |
| `review` | Review | 待审查 |
| `done` | Done | 已完成 |

### Task 数据结构

```typescript
interface KanbanTask {
    id: string;
    title: string;
    description: string;
    columnId: KanbanColumnId;
    sortOrder: number;
    sessionIds: string[];
    machineId: string | null;
    directory: string;
    sessionPrompt: string;
    createdAt: number;
    updatedAt: number;
}
```

## 入口：ProjectDetailView

ProjectDetailView 现有 5 个 Tab + 新增 2 个：

| Tab | Key | 组件 | 状态 |
|-----|-----|------|------|
| Sessions | `sessions` | `ProjectSessionsTab` | 已实现 |
| Git | `git` | `ProjectGitTab` | 已实现 |
| Health | `health` | `ProjectHealthTab` | 已实现 |
| Actions | `actions` | `ProjectActionsTab` | 已实现 |
| Research | `research` | `ProjectResearchTab` | 已实现 |
| **Ideas** | `ideas` | `ProjectIdeasTab` | **Phase 1** |
| **Roadmap** | `roadmap` | `ProjectRoadmapTab` | **Phase 2** |

Tab 栏变为 7 个 tab，使用 ScrollView 横向滚动适配小屏。

## 组件清单

### Ideation（Phase 1）

| 组件 | 文件 |
|------|------|
| `ProjectIdeasTab` | `components/ideation/ProjectIdeasTab.tsx` |
| `IdeationFilterBar` | `components/ideation/IdeationFilterBar.tsx` |
| `IdeationIdeaCard` | `components/ideation/IdeationIdeaCard.tsx` |
| `IdeationEmptyState` | `components/ideation/IdeationEmptyState.tsx` |
| `IdeationActionSheet` | `components/ideation/IdeationActionSheet.tsx` |

### Roadmap（Phase 2）

| 组件 | 文件 |
|------|------|
| `ProjectRoadmapTab` | `components/roadmap/ProjectRoadmapTab.tsx` |
| `RoadmapMilestoneCard` | `components/roadmap/RoadmapMilestoneCard.tsx` |
| `RoadmapFeatureItem` | `components/roadmap/RoadmapFeatureItem.tsx` |
| `RoadmapProgressBar` | `components/roadmap/RoadmapProgressBar.tsx` |
| `RoadmapEmptyState` | `components/roadmap/RoadmapEmptyState.tsx` |

## 页面路由

| 路由 | 文件 | 说明 |
|------|------|------|
| `/ideation/idea/[id]` | `app/(app)/ideation/idea/[id].tsx` | Idea 详情/编辑 |
| `/ideation/new` | `app/(app)/ideation/new.tsx` | 新建 Idea |
| `/roadmap/milestone/[id]` | `app/(app)/roadmap/milestone/[id].tsx` | Milestone 详情 |
| `/roadmap/feature/[id]` | `app/(app)/roadmap/feature/[id].tsx` | Feature 详情/编辑 |
| `/roadmap/new-milestone` | `app/(app)/roadmap/new-milestone.tsx` | 新建 Milestone |
| `/roadmap/new-feature` | `app/(app)/roadmap/new-feature.tsx` | 新建 Feature |

## i18n

翻译 key 已就绪（`ideation.*`, `roadmap.*`, `project.segments.*`），11 种语言全部已有。

## 无需 Server 端改动

所有数据通过现有 UserKVStore API（`/v1/kv/*`）存取，无需新增数据库表、API 端点或 Socket.IO 事件。
