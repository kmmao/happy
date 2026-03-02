# Project Management Modules

本文档描述 `sharp-star` 分支开发的三大项目管理模块：Kanban、Ideation、Roadmap。

## 模块概览

| 模块 | 功能 | 数据存储 | 入口 |
|------|------|----------|------|
| **Kanban** | 任务看板（5 列） | UserKVStore `kanban:*` | `app/(app)/kanban/` |
| **Ideation** | 创意收集与管理 | UserKVStore `ideation:*` | `app/(app)/ideation/` |
| **Roadmap** | 里程碑 + 功能规划 | UserKVStore `roadmap:*` | `app/(app)/roadmap/` |

三个模块通过 **Project Tab** (`app/(app)/project.tsx`) 统一入口，使用 `ProjectSegmentControl` 切换。

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

### Store 文件

| Store | 文件 | KV 前缀 |
|-------|------|---------|
| `kanbanStore` | `sync/kanbanStore.ts` | `kanban:task:{id}` |
| `ideationStore` | `sync/ideationStore.ts` | `ideation:idea:{id}` |
| `roadmapStore` | `sync/roadmapStore.ts` | `roadmap:milestone:{id}`, `roadmap:feature:{id}` |

### 类型定义

| 文件 | 导出 |
|------|------|
| `sync/kanbanTypes.ts` | `KanbanTask`, `KanbanColumnId`, `KANBAN_COLUMNS` |
| `sync/ideationTypes.ts` | `IdeationIdea`, `IdeationStatus`, `IDEATION_STATUSES` |
| `sync/roadmapTypes.ts` | `RoadmapMilestone`, `RoadmapFeature`, `MilestoneStatus` |

## Kanban 模块

### 5 列看板

| 列 ID | 标签 | 说明 |
|--------|------|------|
| `backlog` | Backlog | 待规划 |
| `todo` | To Do | 待开始 |
| `in_progress` | In Progress | 进行中 |
| `review` | Review | 待审查 |
| `done` | Done | 已完成 |

### 核心功能

- **拖拽排序** — `react-native-reorderable-list`，通过 `sortOrder` 字段持久化
- **Session 关联** — Task 可关联多个 Claude Code session (`sessionIds[]`)
- **自动状态流转** — Session 结束时自动将 Task 移至 `done`
- **ActionSheet** — 长按 Task 弹出操作菜单（移动列、启动 Session、删除）
- **统计栏** — 显示总任务数、活跃 Session 数

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

## Ideation 模块

### 4 种状态

| 状态 | 说明 |
|------|------|
| `draft` | 草稿 |
| `active` | 活跃/待评估 |
| `converted` | 已转为 Task |
| `dismissed` | 已忽略 |

### 核心功能

- **Filter Bar** — 横向滚动状态筛选，带计数 badge
- **Convert to Task** — 一键转为 Kanban Task（幂等，重复调用返回已有 task）
- **Start Session** — 从 Idea 直接启动 Claude Code Session（自动 convert + spawn）
- **ActionSheet** — 状态切换、转换、删除

### Idea → Task 转换

```
IdeationIdea.convertToTask(ideaId)
  → 创建 KanbanTask (columnId: "todo")
  → idea.convertedTaskId = taskId
  → idea.status = "converted"
```

## Roadmap 模块

### 两级结构

```
Milestone (里程碑)
  └── Feature (功能项)
       └── status: planned | in_progress | completed | cancelled
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
- **Convert to Task** — Feature 可转为 Kanban Task（与 Ideation 对称）
- **Start Session** — 从 Feature 直接启动 Session

## 跨模块集成

### StartSessionSheet (共享组件)

`components/project/StartSessionSheet.tsx` — Idea/Feature 共享的 Session 启动弹窗：

1. 选择在线机器（radio list）
2. 输入工作目录
3. 预览/编辑 prompt
4. 启动 → auto-convert → spawn session → link to task → navigate

### 自动完成流程

Session 结束时（`sync.ts` 中的 `handleSessionEnded`）：
1. 检查 session 关联的 task
2. 如果 task 在 `in_progress`，自动移至 `done`
3. 无需用户手动更新

### 设计 Tokens

`constants/designTokens.ts` — 集中管理模块特有的语义色值：

```typescript
export const KANBAN_COLUMN_COLORS: Record<KanbanColumnId, string>
export const IDEATION_STATUS_COLORS: Record<IdeationStatus, string>
export const ROADMAP_STATUS_COLORS: Record<MilestoneStatus, string>
```

## 组件清单

### Kanban

| 组件 | 文件 |
|------|------|
| `KanbanViewWrapper` | `components/kanban/KanbanView.tsx` |
| `KanbanColumnSelector` | `components/kanban/KanbanColumnSelector.tsx` |
| `KanbanTaskCard` | `components/kanban/KanbanTaskCard.tsx` |
| `KanbanEmptyState` | `components/kanban/KanbanEmptyState.tsx` |
| `KanbanStatsBar` | `components/kanban/KanbanStatsBar.tsx` |
| `KanbanTaskActionSheet` | `components/kanban/KanbanTaskActionSheet.tsx` |

### Ideation

| 组件 | 文件 |
|------|------|
| `IdeationViewWrapper` | `components/ideation/IdeationView.tsx` |
| `IdeationFilterBar` | `components/ideation/IdeationFilterBar.tsx` |
| `IdeationIdeaCard` | `components/ideation/IdeationIdeaCard.tsx` |
| `IdeationEmptyState` | `components/ideation/IdeationEmptyState.tsx` |
| `IdeationActionSheet` | `components/ideation/IdeationActionSheet.tsx` |

### Roadmap

| 组件 | 文件 |
|------|------|
| `RoadmapViewWrapper` | `components/roadmap/RoadmapView.tsx` |
| `RoadmapMilestoneCard` | `components/roadmap/RoadmapMilestoneCard.tsx` |
| `RoadmapFeatureItem` | `components/roadmap/RoadmapFeatureItem.tsx` |
| `RoadmapProgressBar` | `components/roadmap/RoadmapProgressBar.tsx` |
| `RoadmapEmptyState` | `components/roadmap/RoadmapEmptyState.tsx` |

### 共享

| 组件 | 文件 |
|------|------|
| `ProjectView` | `components/project/ProjectView.tsx` |
| `ProjectSegmentControl` | `components/project/ProjectSegmentControl.tsx` |
| `StartSessionSheet` | `components/project/StartSessionSheet.tsx` |

## 页面路由

| 路由 | 文件 | 说明 |
|------|------|------|
| `/project` | `app/(app)/project.tsx` | 项目管理主页（3 Tab） |
| `/kanban/task/[id]` | `app/(app)/kanban/task/[id].tsx` | Task 详情 |
| `/ideation/idea/[id]` | `app/(app)/ideation/idea/[id].tsx` | Idea 详情 |
| `/roadmap/milestone/[id]` | `app/(app)/roadmap/milestone/[id].tsx` | Milestone 详情 |
| `/roadmap/feature/[id]` | `app/(app)/roadmap/feature/[id].tsx` | Feature 详情 |

## i18n

所有用户可见文本通过 `t('key')` 引用，翻译文件位于 `text/` 目录。
支持 11 种语言：默认(en)、zh-Hans、zh-Hant、ja、ru、pl、es、pt、it、ca、en。

新增的翻译 key 前缀：
- `kanban.*` — Kanban 相关
- `ideation.*` — Ideation 相关
- `roadmap.*` — Roadmap 相关
- `project.*` — 共享 Project Tab 相关
- `session.*` — Session 启动弹窗相关
