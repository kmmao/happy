# Happy ↔ openai/codex 主要分叉点决策登记

## Status

- Drafted on 2026-04-21
- Purpose: PR-1C deliverable
- Related docs:
  - `docs/archive/plans/codex-upstream-alignment-roadmap.md`
  - `docs/archive/plans/codex-upstream-alignment-matrix.md`

## Scope

这份文档不是“所有差异清单”，而是**当前最容易导致实现阶段反复扯皮的主要分叉点决策账本**。  
只有满足以下任一条件的差异，才应该进入本登记：

- 明显偏离上游 `openai/codex` 默认行为
- 已经影响 UI / metadata / docs / 自动化策略
- 后续多个 PR 都会碰到
- 若不先表态，团队会持续重复争论

## Decision fields

每个分叉点必须至少回答：

1. 当前状态
2. 当前归属类型
   - `临时技术债`
   - `长期产品策略`
   - `兼容包袱`
3. 用户可见性
4. 当前策略
5. 目标策略
6. 触发条件
7. 退出条件 / 收敛条件
8. 如果不处理，会造成什么问题

---

## Divergence 1 — Codex 模型锁定为 `gpt-5.4`

### Current state

- Happy 当前把 Codex 运行时默认模型锁到 `gpt-5.4`
- 该锁定已经影响：
  - `packages/happy-cli/src/codex-shared/configResolution.ts`
  - `packages/happy-cli/src/codex/messageMode.ts`
  - `packages/happy-cli/src/automation/TaskRunner.ts`
  - App 新建会话和模型选项 UI
- 文档 `docs/adding-ai-models.md` 已明确承认这属于 `happy-opinionated`

### Current ownership type

- **长期产品策略（当前）**
- 但是否继续保留还**没有完成正式决策**

### User-visible

- **是**
- 体现为：
  - App 中 Codex 模型列表受限
  - profile / automation 注入的模型与上游发现值不一致
  - 用户可能误以为 Codex 本身只支持或推荐 `gpt-5.4`

### Current policy

- 暂时保留锁定
- 在治理文档中承认它是 `happy-opinionated`
- 不再把它表述成“上游默认行为”

### Target policy

候选路线只能二选一，不允许继续模糊：

#### Option A — 收敛到上游

- `default` = 继承上游 Codex config / runtime discovered model
- App 以运行时能力发现为主
- Happy 仅保留显式 override

#### Option B — 保留产品锁定，但显式产品化

- UI、metadata、文档都明确显示：
  - 这是 Happy policy，不是 upstream default
- automation / profile / session creation 保持一致

### Trigger conditions

以下变更必须重新审视这个决策：

- 上游 `openai/codex` 新 release 改变模型发现或推荐模型策略
- Happy 开始支持多个 Codex profile / config-first 真继承
- App 新建会话流程从硬编码列表改成 capability-driven

### Exit criteria

满足以下任一条件，才算这个分叉点“收口”：

- 已解除锁定并完成 UI + runtime + automation 一致性迁移
- 或正式确认长期保留锁定，并且 UI / metadata / docs 全量显式化

### If we do nothing

- 团队会持续混淆“Happy 策略”和“上游 Codex 能力”
- 后续每次谈模型、profile、automation 都会重复争论
- config-first 目标会长期被削弱

---

## Divergence 2 — 粗粒度 permission mode 映射

### Current state

- Happy 当前将 Codex 权限抽象为少数几种 permission mode
- 最终主要映射到 approval-policy + sandbox
- 这与上游更细的 `execpolicy` / policy amendment / native approval 体系不一致

### Current ownership type

- **长期产品策略（当前）**
- 同时带有一定技术债成分，因为它压平了上游真实能力

### User-visible

- **是**
- 体现为：
  - 用户在 App 里看到的是简化模式
  - 不是上游原生策略视角

### Current policy

- 继续保留简单 permission mode 作为主入口
- 但不再假装它等于上游原生 policy

### Target policy

- 走“双层体系”：
  - 默认：Happy simplified mode
  - 高级：Codex native policy / execpolicy / profile 接管

### Trigger conditions

- 引入 execpolicy file / native policy UI
- config-first 进入实装阶段
- 权限争议反复出现在 PR review 中

### Exit criteria

- 用户能选择“Happy 简化模式”或“上游原生策略”
- 文档与 UI 不再混淆二者

### If we do nothing

- Happy 会长期困在“够用但不原生”的尴尬层
- 高级用户会持续觉得被阉割

---

## Divergence 3 — Happy MCP / progress / session-summary overlay

### Current state

- Happy 在 Codex 上叠加了自己的 operator workflow：
  - `change_title`
  - `update_progress`
  - `update_session_summary`
  - `request_user_input`
  - `<options>` XML
- 这些都不是 `openai/codex` 原生职责

### Current ownership type

- **长期产品策略**

### User-visible

- **是**
- 主要体现在：
  - Progress tab
  - Session summary
  - Happy MCP tool 行为

### Current policy

- 保留这套 overlay
- 但承认这是 Happy 产品层增强，不属于 upstream-aligned

### Target policy

- 保留，但尽量“薄覆盖”
- 避免与上游默认 developer instructions 冲突
- 通过 metadata / docs 明确这是 Happy operator layer

### Trigger conditions

- 上游 app-server / client instructions 行为变更
- Happy overlay 与上游默认行为开始冲突
- Progress / summary 数据结构进一步扩张

### Exit criteria

- overlay 与上游默认 instructions 的边界被清楚文档化
- 对用户来说它是明确的 Happy 增强，而不是隐式魔法

### If we do nothing

- 会不断累积 prompt / tool 行为冲突
- 以后每次出现“Codex 为什么会这样回答”都更难定位

---

## Divergence 4 — legacy MCP fallback policy

### Current state

- Happy 当前仍保留：
  - `codex-app-server`
  - `codex-mcp-legacy`
- 且在 auto 模式下支持 fallback

### Current ownership type

- **兼容包袱**

### User-visible

- **是**
- 主要体现在：
  - resolved backend
  - fallback reason
  - 会话行为差异

### Current policy

- 保留 legacy MCP
- 但明确它只是 compat，不再作为未来主能力面

### Target policy

- app-server 作为默认主路径
- legacy MCP 严格退居：
  - 旧版本兼容
  - fallback
  - 紧急兜底

### Trigger conditions

- app-server 在目标用户环境中足够稳定
- fallback telemetry 显示 legacy 使用率足够低

### Exit criteria

- 可以量化说明 legacy MCP 仍有必要保留，或已经具备退役条件

### If we do nothing

- 团队会继续把 legacy 当半正式主路径
- 新能力容易继续误落在 legacy 上

---

## Divergence 5 — `CODEX_HOME` overlay 的状态继承语义

### Current state

- Happy 当前用 overlay/symlink 方式复用 `~/.codex`
- 核心目标是 auth 注入
- 但 sqlite / memories / notices / rollout state 的继承语义还不清

### Current ownership type

- **临时技术债**

### User-visible

- **部分可见**
- 用户会感受到：
  - 为什么同样的 Codex 配置下，Happy 会话与本地直跑状态不完全一致

### Current policy

- 暂时继续使用 overlay
- 但不再把它描述成“天然继承全部 Codex 状态”

### Target policy

候选路线：

#### Option A — 真继承语义

- auth / config / sqlite / memories / notices 等都按明确定义继承

#### Option B — 显式分离语义

- auth 可以复用
- 其他状态明确隔离
- 并通过 metadata / docs 告知用户

### Trigger conditions

- config-first 深化
- 用户报告 session/thread/state 不一致问题
- app-server 与 local CLI 状态差异开始影响 resume / memory / rollout 行为

### Exit criteria

- `CODEX_HOME` overlay 不再是“看起来继承，但实际上半分裂”
- 继承/隔离边界有测试、有文档、有 metadata

### If we do nothing

- 最终一定会演化成最难排查的一类 bug：
  - 配置看似一致
  - 行为却不一致

---

## Decision summary table

| Divergence | Current type | Current policy | Target direction | Urgency |
|---|---|---|---|---|
| Locked model = `gpt-5.4` | 长期产品策略（待正式确认） | 暂时保留，但承认是 `happy-opinionated` | 二选一：解除锁定 or 正式产品化 | High |
| Coarse permission mode mapping | 长期产品策略 | 保留简化模式 | 发展成双层体系 | High |
| Happy MCP / progress / summary overlay | 长期产品策略 | 保留 | 薄覆盖 + 明确边界 | Medium |
| legacy MCP fallback policy | 兼容包袱 | 保留 fallback | 严格 compat 化，逐步评估退役 | High |
| `CODEX_HOME` overlay state semantics | 临时技术债 | 暂时沿用 | 继承语义显式化或状态隔离显式化 | High |

## Review rule

从 PR-1C 起，任何触及上述 5 个分叉点的 PR，都应该在描述里明确引用本登记中的对应条目，而不是只说：

- “这是临时方案”
- “后面再统一”
- “先这么做”

如果没有引用对应登记项，review 默认应要求作者补齐。
