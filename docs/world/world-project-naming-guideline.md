# Project 与 World 命名边界规范

_Created: 2026-04-07_  
_Status: 全局 World 命名边界生效中_

> **当前主锚点**：本文已按 [全局 World Model UI 与结构重构方案](./global-world-model-ui-restructure.md) 更新。早期 “World belongs to Project / 世界是项目的人格” 的项目级隐喻已废弃。当前方向是：**一切皆事件**。Project 不是独立领域对象，项目的创建、变化、消亡都只是 WorldEvent，`source.projectId` 是事件的可选属性。底层 `Project` 表继续存在作为技术承载和事件数据源，但在 World Shell 概念层不作为一等公民暴露。

## 目标

在引入全局 World Model 后，统一「技术实现」与「业务语义」的命名策略，避免把旧项目级 World 隐喻继续写进新代码。

## 决策标准

- **技术归属 / 基础承载层**：使用 `project`
- **全局世界 / 用户心智层 / 跨项目工作模式**：使用 `world`
- **外部世界接入 / 多世界关系**：使用 `bridge`、`remoteWorld`、`universe`

一句话：**Project 是事件的 source 属性，不是独立实体**。`source.projectId` 是 WorldEvent 的可选字段；World 是唯一一等公民；底层 `Project` 表作为技术承载继续存在但概念层不暴露。

## 保留 `project` 的范围（技术承载层）

- 数据库主模型与关联键（如 `Project`, `projectId`）
- 主资源路由（如 `/projects/:id/...`）
- 核心同步实体与权限归属链路
- 与仓库路径、机器目录、项目配置强绑定的内部实现
- 已发布 API、CLI 参数和数据迁移成本极高的底层标识符

## 优先使用 `world` 的范围（用户心智层）

- 全局 World 入口、World Shell、World 模式内的用户可见文案
- 世界时间线、任务链、事件流、Agent 状态、裁决、记忆、信号源
- 任何跨项目聚合视图或不以单个 Project 为边界的功能
- 对外展示层可读字段（必要时加别名，不破坏底层字段）

## 使用 `bridge` / `remoteWorld` / `universe` 的范围

- 外部世界接入点：`WorldBridge`
- 远程 Happy / 团队 / OpenClaw / 第三方 Agent 世界：`RemoteWorld`
- 多世界容器或关系图：`Universe`
- 跨世界事件、任务、记忆、裁决同步：`BridgeEvent`、`BridgeTaskRequest`、`BridgeMemoryExchange`、`BridgeAdjudicationRequest`

不要把外部世界接入命名为 `projectIntegration`。它不是项目集成，而是世界之间的连接。

## 迁移策略

1. **先入口与文案后模型**：先建立全局 World 入口和 World Shell，再评估是否需要新增 World/Bridge 数据模型。
2. **保持底层兼容**：底层继续使用 `Project` / `projectId` 表示仓库路径和技术承载对象，避免一次性迁移。
3. **按风险分层推进**：
   - L1（低风险）：UI 文案、帮助文档、提示文案
   - L2（中风险）：API 响应别名、前端类型别名、聚合 view model
   - L3（高风险）：数据库字段/路由主资源重命名（默认不做）
4. **新 World 域从新命名开始**：如果未来引入 `WorldEvent`、`TaskChain`、`WorldBridge`，不要沿用 `ProjectWorld*` 这类折中命名。

## 本规范的执行要求

- 新增 World 相关功能时，先判断是「技术承载层」还是「全局世界层」，再定命名。
- 代码评审时，命名一致性作为必查项。
- 若出现歧义，按“用户是否直接在 World 模式感知该术语”优先判断：
  - 用户在 World Shell 直接感知：优先 `world`
  - 只是仓库路径、项目配置、底层关联键：优先 `project`
  - 指向外部世界或跨世界协议：优先 `bridge` / `remoteWorld`

## 长期定位（终态）

**一切皆事件。项目的创建、变化、消亡都是 WorldEvent；`source.projectId` 是可选属性，不是必填字段。**

- **用户心智层全局世界化**：World Shell、帮助文档、提示文案、Agent 指令全部使用 `world` 语义。
- **技术承载层继续 Project**：数据库、API 路由、CLI flag、同步实体在不迁移时继续使用 `project`。
- **跨世界层预留 Bridge/Universe**：外部世界接入不走 Project 命名，而走 WorldBridge / RemoteWorld / Universe。
- **这不是简单重命名，而是边界重立**：Project 负责定位代码和配置，World 负责组织事件、任务链、Agent、记忆和裁决。

### 为什么不做完全替换

1. **Project 是客观技术承载，World 是全局工作空间**：Project 仍然表示仓库、路径、机器上下文和权限归属；World 不应被降级为 Project 的别名。
2. **全量重命名的代价远大于收益**：影响数十张表、所有外键、所有已发布 API 与 CLI 参数，破坏向后兼容。
3. **分层是自然的**：底层容器用 `project`，全局体验用 `world`，跨世界连接用 `bridge`，三者共存而非互相替代。

### 未来演进方向

- 如果后续需要跨 Happy 实例、OpenClaw、第三方 Agent 网络或企业工作区连接，新增 `WorldBridge` / `RemoteWorld` / `Universe` 相关模型。
- 如果后续需要长期任务链持久化，优先考虑 `TaskChain`，不要回到单项目 `Goal` 作为默认边界。

## 组件/文件命名规则

组件名和文件名跟随其**所属功能域**，而非数据源：

- 全局 World 模式组件使用 `World` 前缀（如 `WorldShell`、`WorldTimeline`、`WorldCommandBar`）
- 跨世界接入组件使用 `WorldBridge` / `RemoteWorld` 前缀（如 `WorldBridgeList`、`RemoteWorldCard`）
- 项目管理功能组件使用 `Project` 前缀（如 `ProjectDetailView`、`ProjectProfileCard`）
- Props 中传递 `project` 对象是正常的（数据源来自承载层），不需要重命名为 `world`
- 旧项目级 World 组件名（如 `WorldGoalsTab`、`WorldRolesTab`）仅作为历史参考；新实现不要默认沿用 ProjectDetail tab 形态
- 路由文件路径：全局 World 使用 `world/*`；项目详情仍使用 `project/[id]/*`

## 防漂移规则

1. **同一能力的多入口模板必须复用同一文案源**，避免手动模板 vs 一键生成措辞不一致。
2. **世界域词汇表**（timeline → 世界时间线、chains → 任务链、sources → 事件来源、bridges → 世界桥接、memory → 世界记忆、decisions → 世界裁决）在 i18n 中保持统一。
3. **PR checklist 必查项**：World Shell / 全局世界模式文案不得把 Project 当成边界；承载层代码不得为了迎合 UI 语义盲目重命名 `projectId`。
