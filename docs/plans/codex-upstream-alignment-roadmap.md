# Happy ↔ openai/codex 上游对齐改造 Roadmap

## Status

- Drafted on 2026-04-21
- Baseline upstream verified against `openai/codex` public repo and docs on 2026-04-21
- Current upstream reference point: GitHub latest release shown as `0.122.0` on 2026-04-20

## Objective

把 Happy 当前对 Codex 的接入，从“部分对齐 + 部分产品化硬分叉”的状态，升级为：

1. **协议与运行时行为尽量对齐上游**
2. **Happy 自己的产品分叉点显式化、可解释、可切换**
3. **回归测试覆盖从 reducer 扩到 app-server / session protocol / config contract**
4. **legacy MCP 路径从主路径降级为兼容路径**

## Why now

当前最大的结构性风险不是“功能少”，而是**边界模糊**：

- `codex app-server` 已成为上游 rich client 主接口，但 Happy 仍同时维护 legacy MCP 主逻辑
- Happy 已实现大量上游能力发现与 metadata 映射，但模型/权限/UI 行为仍有明显产品化硬改
- `CodexAppServerClient` 目前以手写类型对接上游 experimental API，存在协议漂移风险
- `CODEX_HOME` overlay 只解决了 auth 注入问题，尚未系统澄清 sqlite / memories / rollout state 继承语义

## Non-goals

- 这轮不重写 Happy 的 E2E 加密体系
- 这轮不移除 Claude / Gemini 相关逻辑
- 这轮不要求一次性删除所有 legacy Codex 代码
- 这轮不承诺与 openai/codex 每个内部实现细节完全一致

## Required decision gate (must happen first)

在任何实现前，必须先做一个治理决策：

### Decision A — Happy 对 Codex 的产品定位

必须明确以下两种路线选哪一种，或同时支持但区分模式：

1. **Upstream-aligned mode**
   - 优先继承用户现有 `~/.codex/config.toml`
   - 模型、approval、sandbox、reasoning、verbosity 以上游运行时发现/配置为准
   - Happy 只做远程控制、同步、UI 和增强交互

2. **Happy-opinionated mode**
   - Happy 可锁定模型、收敛权限模式、注入自己的 prompt overlay 与产品约束
   - 这类差异必须在 UI 和 metadata 中显式暴露

> **硬性要求**：从 Step 1 开始，所有实现与文档都必须标注自己属于哪一类：  
> `upstream-aligned` / `happy-opinionated` / `compat`

## Alignment classification glossary

### `upstream-aligned`

满足以下条件时才能使用这个标签：

- 该模块/行为的目标是**跟随已验证的 `openai/codex` 当前行为或配置语义**
- 如果 Happy 有偏差，这个偏差被视为 bug / drift，而不是产品特性
- 后续实现优先考虑“如何缩小差异”，而不是“如何继续包装这个差异”

**使用约束**

- 必须带上上游基线引用
- 若存在已知偏差，必须在同一段落显式写出
- 不能把“看起来差不多”算作 aligned

### `happy-opinionated`

满足以下条件时使用：

- Happy **有意**偏离 `openai/codex` 默认行为
- 偏离来自产品策略、运营策略、移动端 UX、远程控制需求或商业/安全选择
- 这种差异不是暂时 bug，而是当前版本的主观产品决策

**使用约束**

- 必须说明为什么要偏离上游
- 必须说明是否会在 UI / metadata / 文档中暴露
- 必须说明未来是长期保留，还是计划缩小差异

### `compat`

满足以下条件时使用：

- 该逻辑主要为兼容旧版本 Codex、旧协议、旧会话或回退路径而存在
- 它不是未来主路径，也不应继续承载新能力演进
- 若未来上游能力稳定，它应该被收缩、隔离或移除

**使用约束**

- 必须说明兼容对象是谁
- 必须说明触发条件
- 必须说明退役条件或至少说明为何尚不能退役

## Upstream baseline citation template

从 PR-1A 起，所有 Codex 相关计划、设计说明、实现说明、重要 PR 描述都应优先复用下面模板：

```md
### Upstream baseline

- Classification: upstream-aligned | happy-opinionated | compat
- Upstream source: https://github.com/openai/codex
- Verified date: YYYY-MM-DD
- Upstream reference:
  - release: x.y.z
  - docs/page: <url>
  - file/module: <path or url>
- Affected local module:
  - <repo path>
- Known deviation:
  - none | <explicit deviation>
- Follow-up intent:
  - keep aligned | intentionally diverge | compat only
```

如果是 `happy-opinionated` 或 `compat`，还应补这一段：

```md
### Divergence rationale

- Why not upstream-aligned:
  - <reason>
- User-visible?
  - yes | no
- Where exposed:
  - UI | metadata | docs | hidden internal behavior
- Planned future:
  - keep | shrink | make configurable | remove
```

## Document annotation rule

Codex 相关文档至少要在开头显式回答两件事：

1. **这个文档主要属于哪个分类**
2. **它引用的上游基线是什么**

如果文档是混合型（例如主路径想对齐上游，但又包含 legacy fallback），可以写：

- Primary classification: `upstream-aligned`
- Secondary classification: `compat`

## App-server schema baseline refresh workflow

Happy 现在对 Codex app-server 通知的 contract 基线，不再只靠手写 fixture；  
它还依赖一个从上游 `ServerNotification.json` 抽取通知子集的生成脚本。

### Why this workflow exists

- 上游 `openai/codex` 的 README 示例更偏展示，不足以作为硬契约
- 整份上游 schema 过大、过脆，不适合直接拿来做 repo 内常规 golden
- 所以我们采用：
  - **上游完整 schema** 作为来源
  - **本地受控子集 schema** 作为 Happy 当前消费面的 contract baseline

### Source of truth

- Upstream source schema:
  - `openai/codex/codex-rs/app-server-protocol/schema/json/ServerNotification.json`
- Local generated subset:
  - `packages/happy-cli/src/codex-app/__fixtures__/server_notification_contract_subset.json`
- Generator:
  - `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`

### Refresh steps

1. 更新或重新校验本地 upstream checkout  
   - 默认脚本读取：
     - `/tmp/openai-codex/codex-rs/app-server-protocol/schema/json/ServerNotification.json`
   - 若上游 checkout 不在这个路径，显式传：
     - `OPENAI_CODEX_SERVER_NOTIFICATION_SCHEMA=/abs/path/to/ServerNotification.json`

2. 重新生成本地 schema 子集基线

```bash
yarn codex:refresh-app-server-contract
```

或在 `happy-cli` 包内直接运行：

```bash
yarn workspace @kmmao/happy-coder generate:codex-app-server-notification-contract
```

3. 检查生成 diff
   - 是否只是 schema 结构变动
   - 是否出现新的 notification method
   - 是否已有本地 raw fixtures 失效

4. 跑最小验证

```bash
yarn codex:verify-app-server-contract
```

其中 package 内等价命令为：

```bash
yarn workspace @kmmao/happy-coder verify:codex-app-server-notification-contract
```

这个验证命令会顺序执行：

1. 重新生成 schema 子集
2. 检查生成结果是否会改动已提交基线  
   - 若 `server_notification_contract_subset.json` 因重新生成而发生 diff，则直接失败
3. 构建 `happy-cli`
4. 运行 codex-app contract 目标测试

5. 通过最小验证后，再跑 `happy-cli` 全量回归

```bash
yarn workspace @kmmao/happy-coder test
```

### When to run this workflow

- 上游 `openai/codex` baseline 更新时
- `CodexAppServerClient` 新增/移除消费 notification method 时
- app-server 相关 raw fixture 发生结构性调整时
- contract 测试因为 schema 漂移而失败时

### Review expectations

任何涉及这套基线的 PR，都应该说明：

- 上游基线日期
- 上游 schema 来源路径
- 本地子集是否新增/删减 notification methods
- fixture 是否因 schema 变化而被迫补齐
- 是否执行过：
  - `yarn codex:refresh-app-server-contract`
  - `yarn codex:verify-app-server-contract`

### CI behavior

`Codex App Server Contract` workflow 现在采用：

- **always-on triggers**
  - `pull_request`
  - `push` to `main`
  - `merge_group`
  - `workflow_dispatch`
- **job-internal short-circuit**
  - 若本次改动未命中 Codex app-server contract 相关路径，则 job 直接成功退出
  - 若命中相关路径，则运行 `yarn codex:verify-app-server-contract`

这样做的原因是避免 GitHub Actions 的 workflow 级 path filter 把 required check 留在 pending 状态，反而阻塞无关 PR 合并。

---

# Execution Plan

## Step 1 — 建立上游基线与分叉治理规则

### Goal

把“什么必须跟上游，什么允许 Happy 分叉”写清楚，避免后续 PR 反复争论。

### Scope

- 新建一份对齐策略文档（可并入本文件或补充到 Codex 相关 docs）
- 定义上游基线字段：
  - upstream repo
  - release version
  - verification date
  - affected module
- 定义三类标签：
  - `upstream-aligned`
  - `happy-opinionated`
  - `compat`

### Files

- `docs/plans/codex-upstream-alignment-roadmap.md`（本文件）
- `docs/adding-ai-models.md`
- `docs/plans/codex-config-first-app-server-plan.md`

### Tasks

- 标出当前已知分叉点：
  - locked model = `gpt-5.4`
  - coarse permission mode mapping
  - Happy MCP/progress/session-summary overlay
- 为每个分叉点定义后续策略：
  - 保留
  - 缩小
  - 改成可配置
  - 删除

### Verification

- 文档中每个 Codex 关键模块都能归类到三类标签之一
- 后续步骤都引用该分类

### Exit Criteria

- 团队后续 PR 不再用“这是上游行为还是 Happy 行为？”反复争论

### Depends on

- none

### Step 1 PR Breakdown

> 原则：Step 1 不做“大而全治理 PR”。必须拆成**可单独 review、可单独合并、可单独验证**的小 PR。  
> 否则最终效果只会是“文档写了很多，但后续 PR 还是照样吵”。

#### PR-1A — 建立对齐分类词汇与引用模板

**Goal**

把后续所有 Codex 相关 PR 都必须遵守的分类语言先钉死。

**Scope**

- 定义并落文档：
  - `upstream-aligned`
  - `happy-opinionated`
  - `compat`
- 定义上游引用模板：
  - upstream source
  - verified date
  - upstream version / release / commit
  - affected module
- 把 Step 1 的 Required decision gate 变成可复用模板

**Files**

- `docs/plans/codex-upstream-alignment-roadmap.md`
- `docs/plans/codex-config-first-app-server-plan.md`
- `docs/adding-ai-models.md`

**Checklist**

- [x] 在 roadmap 中补齐三类标签的严格定义
- [x] 在 Codex 相关历史计划中补“本计划适用分类”的说明
- [x] 在 `docs/adding-ai-models.md` 的 Codex 部分加一句：该文档当前属于 `happy-opinionated` 还是 `upstream-aligned`
- [x] 定义一个标准注释块/表格模板，供后续 PR 直接复用

**Verification**

- 任意后续 Codex 相关 PR 都能引用这三个标签，不再自造词汇
- 文档中存在统一的“上游基线引用模板”

**Exit criteria**

- 团队不再用模糊表达，比如“基本跟上游一致”“差不多兼容”

**Depends on**

- none

---

#### PR-1B — 输出模块级分类矩阵（当前真实状态）

**Goal**

把 Happy 里所有关键 Codex 模块先分类，不再靠口头理解。

**Scope**

- 建一个模块级矩阵，覆盖至少：
  - `runCodex.ts`
  - `CodexAppServerClient.ts`
  - `codexMcpClient.ts`
  - `configResolution.ts`
  - `executionPolicy.ts`
  - `sessionProtocolMapper.ts`
  - `codexHomeOverlay.ts`
  - app 侧 Codex metadata / model / permission UI

**Files**

- `docs/plans/codex-upstream-alignment-roadmap.md`
- `docs/plans/codex-upstream-alignment-matrix.md`

**Checklist**

- [x] 每个关键模块都标注当前分类：`upstream-aligned` / `happy-opinionated` / `compat`
- [x] 每个模块都写出“为什么是这个分类”
- [x] 每个模块都写出“下一步目标分类”（如果要迁移）
- [x] 标出 blocker / owner / 风险级别

**Verification**

- 任何 reviewer 都能在 5 分钟内看清当前边界，而不是重新读代码猜

**Exit criteria**

- “这个模块到底是在跟上游还是在走 Happy 自己策略”可以文档化回答

**Depends on**

- PR-1A

**Deliverable**

- 见：`docs/plans/codex-upstream-alignment-matrix.md`

---

#### PR-1C — 对当前主要分叉点做显式决策登记

**Goal**

先把最容易吵起来的分叉点做决策登记，不允许继续暧昧。

**Must-cover decisions**

- locked model = `gpt-5.4`
- coarse permission mode mapping
- Happy MCP / progress / session-summary overlay
- legacy MCP fallback policy
- `CODEX_HOME` overlay 是否只是 auth 注入，还是状态继承策略

**Files**

- `docs/plans/codex-upstream-alignment-roadmap.md`
- `docs/plans/codex-divergence-register.md`

**Checklist**

- [x] 每个分叉点写明当前状态
- [x] 每个分叉点写明目标策略：保留 / 缩小 / 变配置 / 删除
- [x] 每个分叉点写明它属于：
  - 临时技术债
  - 长期产品策略
  - 兼容包袱
- [x] 对“锁模型”给出明确候选路线，而不是继续模糊

**Verification**

- 后续 PR 不再把“这只是临时方案”挂嘴边却不登记

**Exit criteria**

- 至少 5 个主要分叉点被显式登记，且每个都有后续处理方向

**Depends on**

- PR-1A
- PR-1B

**Deliverable**

- `docs/plans/codex-divergence-register.md`

---

#### PR-1D — 把治理规则接到日常提交流程

**Goal**

让 Step 1 不只是文档存在，而是进入后续 PR 的最小检查面。

**Scope**

- 给 Codex 相关改动增加最小流程要求：
  - 必须标注分类
  - 必须标注上游基线
  - 如果是分叉，必须写理由

**Files**

- `.github/pull_request_template.md`
- `AGENTS.md` 或对应 Codex 说明文档（仅在合适位置补充，不制造重复规则）
- `docs/plans/codex-upstream-alignment-roadmap.md`

**Checklist**

- [x] 在 PR 模板中加一段 Codex 相关改动检查项
- [x] 明确哪些改动必须引用上游版本/日期
- [x] 明确哪些改动属于 `happy-opinionated` 时必须同步 UI/metadata/文档
- [x] 明确哪些路径变更必须执行 `yarn codex:verify-app-server-contract`
- [x] 为 Codex app-server contract 面增加独立 GitHub Actions 检查
- [x] 避免把相同规则复制到多个地方造成未来漂移

**Verification**

- 新的 Codex 相关 PR 在描述里天然会带分类和上游基线
- 涉及 Codex app-server contract 面的 PR，作者无法再模糊“这次算不算需要跑 verify”
- 涉及指定路径的 PR 会自动触发 `Codex App Server Contract` CI 检查

**Exit criteria**

- Step 1 的治理规则被“流程化”，不是“写完就忘”

**Depends on**

- PR-1A
- PR-1C

**Deliverable**

- `.github/pull_request_template.md`
- `.github/workflows/codex-app-server-contract.yml`
- `docs/plans/codex-required-status-check-runbook.md`

**Implementation note**

- 仓库原先没有 PR template 文件；PR-1D 在此基础上新增最小可用模板
- 为避免重复规则漂移，本轮不把同样检查项再复制进 `AGENTS.md`，统一以 roadmap + matrix + PR template 为主
- PR template 中已把 `yarn codex:verify-app-server-contract` 的触发条件具体化到路径级别，主要覆盖：
  - `packages/happy-cli/src/codex-app/**`
  - `packages/happy-cli/src/codex-app/__fixtures__/**`
  - `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`
- CI 中新增 `Codex App Server Contract` workflow，对上述 contract 相关路径变更自动执行 `yarn codex:verify-app-server-contract`
- required status check 的 GitHub 侧实施方式、限制和验证步骤，统一收口到：
  - `docs/plans/codex-required-status-check-runbook.md`

---

#### Recommended merge order for Step 1

1. **PR-1A** — 词汇和模板
2. **PR-1B** — 当前模块矩阵
3. **PR-1C** — 分叉点决策登记
4. **PR-1D** — 流程接线

#### What must NOT happen

- 不要把 PR-1A~1D 合成一个超大 PR
- 不要在 Step 1 顺手夹带 Step 2 的 contract test 或 Step 5 的 config 代码改动
- 不要先改代码、后补治理；这样 Step 1 就失去意义了

---

## Step 2 — 把 app-server 接口改成 contract-first

### Goal

避免 `CodexAppServerClient` 因手写类型与上游协议漂移而静默损坏。

### Context

上游 `codex app-server` 明确支持：

- `generate-ts`
- `generate-json-schema`
- thread / turn / item 生命周期
- 大量实验 API

Happy 当前已经走 app-server 主路径，但 client 侧仍以手写类型为主。

### Scope

- 为 `codex app-server` 建立 schema/codegen 或 contract test 流程
- 至少覆盖 Happy 当前已调用的方法：
  - `initialize`
  - `model/list`
  - `config/read`
  - `thread/start`
  - `thread/resume`
  - `turn/start`
  - `turn/interrupt`
  - permission / elicitation 相关通知

### Files

- `packages/happy-cli/src/codex-app/CodexAppServerClient.ts`
- `packages/happy-cli/src/codex-app/`
- `docs/plans/session-protocol-impl.md`

### Tasks

- 建一个“上游 schema 快照”获取方式
- 选一个策略：
  - 直接使用 codegen 产物
  - 保留手写类型，但加 contract snapshot test
- 对所有已调用 RPC 方法补 schema 对齐测试
- 对 `experimentalApi: true` 用到的字段单独加风险注释

### Verification

- 上游 schema 变更时，Happy 能在 CI 中直接红，而不是运行时才炸

### Exit Criteria

- `CodexAppServerClient` 的协议风险从“静默漂移”降低到“显式失败”

### Depends on

- Step 1

---

## Step 3 — 澄清并实现 `CODEX_HOME` / sqlite / memories 继承语义

### Goal

把 Happy 的 overlay 模式从“只够跑 auth”的状态，升级为“状态语义清晰、不会半继承半分裂”。

### Context

上游 docs 已明确：

- `CODEX_HOME`
- `sqlite_home`
- `CODEX_SQLITE_HOME`
- WorkspaceWrite 下的 state DB 默认行为

Happy 当前 `codexHomeOverlay` 只显式处理了：

- 继承源 home
- 跳过原始 `auth.json`
- 注入新的 `auth.json`

### Scope

- 明确以下状态是否继承：
  - auth
  - skills
  - sessions / threads
  - sqlite state
  - memories
  - notices
  - marketplace/plugin state

### Files

- `packages/happy-cli/src/codex-shared/codexHomeOverlay.ts`
- `packages/happy-cli/src/codex-shared/configResolution.ts`
- 相关测试文件

### Tasks

- 列出当前 overlay 实际保留/绕开的目录
- 定义三种模式：
  - fully inherit
  - inherit + auth override
  - managed isolated state
- 对 sqlite / memories 的行为写测试
- 在 metadata 中暴露当前实际模式

### Verification

- 同一用户直接运行 `codex` 与通过 Happy 运行时，能解释清楚为什么 thread/state 一致或不一致

### Exit Criteria

- 不再出现“配置看似继承了，但状态其实是另一套”的隐性 bug

### Depends on

- Step 1

---

## Step 4 — 把 legacy MCP 路径隔离成兼容层

### Goal

停止把 legacy MCP 当作 Codex 能力演进主通道。

### Scope

- 明确 `codex-app-server` 是默认主路径
- `codex-mcp-legacy` 只保留：
  - 旧版本兼容
  - fallback
  - 紧急兜底

### Files

- `packages/happy-cli/src/codex/runCodex.ts`
- `packages/happy-cli/src/codex/codexMcpClient.ts`
- `packages/happy-cli/src/codex-shared/backendSelection.ts`

### Tasks

- 给 fallback 打 telemetry / service message / metadata
- 限制新能力只先落 app-server
- 建一份 legacy MCP 支持矩阵

### Verification

- 新会话默认走 app-server
- fallback 原因用户可见
- 运行中不隐式跨 backend 漂移

### Exit Criteria

- “主路径”和“兼容路径”的角色边界稳定下来

### Depends on

- Step 2
- Step 3

---

## Step 5 — 把配置解析改成真正的 config-first

### Goal

让 Happy 对 Codex 的运行时设置真正遵守“用户配置优先”，而不是口头上说 inherit、实现上偷偷 override。

### Context

上游 profile/config 已支持：

- model
- model_provider
- approval_policy
- approvals_reviewer
- sandbox_mode
- model_reasoning_effort
- plan_mode_reasoning_effort
- model_reasoning_summary
- model_verbosity
- personality
- web_search
- feature toggles

Happy 当前虽然已经接入部分 config/read / model/list 能力，但仍存在：

- locked model
- 粗粒度 permission mode
- 若干前端硬编码 fallback

### Files

- `packages/happy-cli/src/codex-shared/configResolution.ts`
- `packages/happy-cli/src/codex/messageMode.ts`
- `packages/happy-cli/src/codex/executionPolicy.ts`
- `packages/happy-app/sources/components/modelModeOptions.ts`
- `packages/happy-app/sources/app/(app)/new/index.tsx`

### Tasks

- 落实优先级链：
  1. turn override
  2. Happy profile explicit override
  3. Happy-bound Codex profile
  4. `~/.codex/config.toml`
  5. upstream defaults
- 区分：
  - inherit
  - managed-profile
  - managed-overrides
- 清理 UI 中的硬编码模型/模式 fallback
- 把 `gpt-5.4` 锁定改成：
  - 可配置分叉策略，或
  - upstream-aligned default

### Verification

- `default` 模式不会再偷偷覆盖 model / sandbox / approval
- App 新建会话页面和后端实际运行参数一致

### Exit Criteria

- “UI 说默认，实际不是默认”的欺骗式行为被消灭

### Depends on

- Step 1
- Step 3

---

## Step 6 — 为 session protocol / normalizer / reducer 建完整跨层契约测试

### Goal

把当前已经开始做的 trace fixture 回归，继续上推到协议层，形成真正的跨层防线。

### Context

目前已经有：

- `typesRawFixtures.test.ts`
- `reducerFixtures.test.ts`

但更上游的风险仍在：

- `sessionProtocolMapper`
- app-server item / turn / permission / tool event 形状变化

### Files

- `packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts`
- `packages/happy-app/sources/sync/typesRaw.ts`
- `packages/happy-app/sources/sync/reducer/reducer.ts`
- fixture / testdata 目录

### Tasks

- 为 `sessionProtocolMapper` 增加真实 fixture 回归
- 引入“上游 app-server 样本事件 → Happy session envelope → normalized → reducer”链路测试
- 把 trace fixture 分层：
  - raw upstream-like
  - normalized
  - reduced UI

### Verification

- 上游协议一漂，至少有一层 CI 会红

### Exit Criteria

- 不是只有 reducer 稳，而是整条 Codex 消息链路都有契约测试

### Depends on

- Step 2
- Step 4

---

## Step 7 — 把权限体系从“粗粒度产品模式”升级成“双层体系”

### Goal

保留 Happy 易用权限模式，同时给高级用户暴露更接近上游的原生能力。

### Context

上游已有：

- `execpolicy`
- prefix rules
- host executable constraints
- per-tool MCP approval

Happy 当前只映射成少数几种 permission mode → approval + sandbox。

### Files

- `packages/happy-cli/src/codex/executionPolicy.ts`
- `packages/happy-app/sources/components/modelModeOptions.ts`
- 相关 profile / settings UI

### Tasks

- 保留简单模式：
  - default
  - read-only
  - safe-yolo
  - yolo
- 新增高级入口：
  - 选择已有 Codex profile
  - 选择 execpolicy file
  - 或显示“由上游策略接管”
- 在 metadata/UI 中显示当前是否处于：
  - Happy simplified mode
  - Codex native policy mode

### Verification

- 简单用户不被复杂度淹没
- 高级用户不再被迫接受 Happy 的粗粒度权限抽象

### Exit Criteria

- 权限体系不再成为 Happy 和上游差异的长期技术债

### Depends on

- Step 1
- Step 5

---

## Step 8 — 让 UI 从“展示 metadata”升级到“被 metadata 驱动”

### Goal

不要只在会话详情里展示 Codex 元信息，而是让创建会话、能力提示、设置项都真正使用运行时能力发现结果。

### Files

- `packages/happy-app/sources/app/(app)/session/[id]/CodexInfoSection.tsx`
- `packages/happy-app/sources/app/(app)/session/[id]/codexMetadata.ts`
- `packages/happy-app/sources/components/modelModeOptions.ts`
- `packages/happy-app/sources/app/(app)/new/index.tsx`

### Tasks

- 用 metadata 驱动：
  - models
  - reasoning effort
  - reasoning summary
  - plan mode hints
  - skills / MCP status
  - account / rate limit 信息
- 区分 unavailable / hidden / experimental
- 显式标记当前 backend 与 fallback

### Verification

- UI 不再把旧硬编码模型列表当真相来源

### Exit Criteria

- Happy App 的 Codex UI 以运行时发现为主，以本地 fallback 为辅

### Depends on

- Step 2
- Step 5
- Step 6

---

## Step 9 — 处理“锁模型”这个最大分叉点

### Goal

对 `gpt-5.4` 锁定做正式决策，不再维持“实现已锁死、口头却说上游对齐”的暧昧状态。

### Options

#### Option A — 解除锁定，走上游优先

- `default` = 使用 Codex 当前配置 / 默认模型
- App 从 runtime discovered models 里渲染
- Happy profile 可选显式 override

#### Option B — 保留锁定，但显式产品化

- UI 明确告诉用户这是 Happy policy
- metadata 记录 `happyOpinionatedModelLock = true`
- 文档明确这不是 upstream-aligned 行为

### Files

- `packages/happy-cli/src/codex-shared/configResolution.ts`
- `packages/happy-cli/src/codex/messageMode.ts`
- `packages/happy-cli/src/automation/TaskRunner.ts`
- `packages/happy-app/sources/components/modelModeOptions.ts`
- `packages/happy-app/sources/app/(app)/new/index.tsx`
- `docs/adding-ai-models.md`

### Verification

- 模型行为、UI、automation 注入三者一致

### Exit Criteria

- 团队不再对“Codex 为什么只能是 gpt-5.4”产生语义错乱

### Depends on

- Step 1
- Step 5
- Step 8

---

## Step 10 — rollout / observability / deprecation 收口

### Goal

把这轮改造变成可上线、可观察、可回滚的迁移，而不是一批“看起来完成”的局部 PR。

### Tasks

- 打指标：
  - app-server success rate
  - fallback rate
  - config-read success rate
  - capability-load success rate
  - permission approval failure rate
- 记录问题归因：
  - auth
  - config parse
  - unsupported version
  - protocol drift
  - runtime feature mismatch
- 制定 legacy MCP 退役条件

### Verification

- 能量化判断是否还能继续保留 legacy MCP 主兼容成本

### Exit Criteria

- 有数据支持后续决定“继续双栈”还是“逐步退役 legacy”

### Depends on

- Step 4
- Step 8
- Step 9

---

# Recommended PR Sequence

建议按下面顺序拆 PR：

1. **PR-1**: Step 1（治理规则与文档基线）
2. **PR-2**: Step 2（app-server contract-first）
3. **PR-3**: Step 3（CODEX_HOME / sqlite / memories 语义）
4. **PR-4**: Step 4（legacy MCP 降级与 fallback 观测）
5. **PR-5**: Step 5（config-first 真正落地）
6. **PR-6**: Step 6（协议到 reducer 的跨层测试链）
7. **PR-7**: Step 7（高级权限/execpolicy 接入）
8. **PR-8**: Step 8（UI capability-driven）
9. **PR-9**: Step 9（模型锁定决策落实）
10. **PR-10**: Step 10（rollout / telemetry / deprecation）

## Direct submission checklist for Step 1 (PR-1A~1D)

> 这一节是给“现在就要提交”的执行清单，不是抽象建议。  
> 原则：**治理文档链（PR-1A~1D）和 contract baseline 实现链必须分开**。  
> 如果把两条链揉在一起，review 很容易失焦，后续 blame/history 也会变脏。

### Global rule for every Step 1 PR

- **禁止** `git add .`
- 必须按文件路径精确暂存
- 如果工作树里存在无关改动，先不要顺手带上
- 如果某个改动更像 Step 2/contract baseline，就不要硬塞进 Step 1

### Files that belong to Step 1 governance PRs

- `docs/plans/codex-upstream-alignment-roadmap.md`
- `docs/plans/codex-upstream-alignment-matrix.md`
- `docs/plans/codex-divergence-register.md`
- `docs/plans/codex-config-first-app-server-plan.md`
- `docs/adding-ai-models.md`
- `.github/pull_request_template.md`
- `.github/workflows/codex-app-server-contract.yml`
- `package.json`
- `packages/happy-cli/package.json`

### Files that should NOT be mixed into Step 1 governance PRs

这些文件更适合单独进入 Step 2 / contract baseline PR：

- `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`
- `packages/happy-cli/src/codex-app/CodexAppServerNotificationSchemaContract.test.ts`
- `packages/happy-cli/src/codex-app/CodexAppServerClient.test.ts`
- `packages/happy-cli/src/codex-app/CodexAppServerClient.ts`
- `packages/happy-cli/src/codex-app/__fixtures__/**`
- `packages/happy-cli/src/codex/__tests__/sessionProtocolMapper.test.ts`
- `packages/happy-cli/src/codex/__fixtures__/**`

如果当前工作树已经同时包含这些实现文件，**也不要把它们和 Step 1 混提**。按路径拆开提交。

---

### PR-1A — 词汇与上游基线模板

**Recommended title**

- `docs: define codex alignment glossary and baseline template`

**Recommended files**

- `docs/plans/codex-upstream-alignment-roadmap.md`
- `docs/plans/codex-config-first-app-server-plan.md`
- `docs/adding-ai-models.md`

**Recommended commit**

```bash
git add docs/plans/codex-upstream-alignment-roadmap.md \
        docs/plans/codex-config-first-app-server-plan.md \
        docs/adding-ai-models.md
git commit -m "docs: define codex alignment glossary and baseline template"
```

**PR description must mention**

- 新增 `upstream-aligned / happy-opinionated / compat`
- 新增 upstream baseline citation template
- 现有 Codex 文档已开始接这套词汇

---

### PR-1B — 模块分类矩阵

**Recommended title**

- `docs: classify codex modules by alignment strategy`

**Recommended files**

- `docs/plans/codex-upstream-alignment-matrix.md`

**Recommended commit**

```bash
git add docs/plans/codex-upstream-alignment-matrix.md
git commit -m "docs: classify codex modules by alignment strategy"
```

**PR description must mention**

- current classification
- target classification
- blocker / risk / owner lane

---

### PR-1C — 分叉点决策登记

**Recommended title**

- `docs: register key codex divergence decisions`

**Recommended files**

- `docs/plans/codex-divergence-register.md`
- `docs/plans/codex-upstream-alignment-roadmap.md`

> 说明：`roadmap` 在这里仅应包含 PR-1C checklist 打勾与 deliverable 回填，不应混入其他无关内容。

**Recommended commit**

```bash
git add docs/plans/codex-divergence-register.md \
        docs/plans/codex-upstream-alignment-roadmap.md
git commit -m "docs: register key codex divergence decisions"
```

**PR description must mention**

- 5 个主要分叉点
- 每个条目的当前归属类型
- 每个条目的目标策略
- 锁模型问题已从“模糊争议”升级为“明确候选路线”

---

### PR-1D — 流程接线

**Recommended title**

- `ci: enforce codex app-server contract workflow in PR checks`

**Recommended files**

- `.github/pull_request_template.md`
- `.github/workflows/codex-app-server-contract.yml`
- `package.json`
- `packages/happy-cli/package.json`
- `docs/plans/codex-upstream-alignment-roadmap.md`

**Recommended commit**

```bash
git add .github/pull_request_template.md \
        .github/workflows/codex-app-server-contract.yml \
        package.json \
        packages/happy-cli/package.json \
        docs/plans/codex-upstream-alignment-roadmap.md
git commit -m "ci: enforce codex app-server contract workflow in PR checks"
```

**PR description must mention**

- 新增 `Codex App Server Contract` workflow
- 新增 `yarn codex:refresh-app-server-contract`
- 新增 `yarn codex:verify-app-server-contract`
- PR template 已明确 verify 的路径级触发条件

---

### Recommended follow-up PR (outside Step 1)

Step 1 完成后，下一条更合理的 PR 应该是：

#### PR-2X — Codex app-server contract baseline

**Recommended title**

- `test: add codex app-server schema-driven contract baseline`

**Typical files**

- `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`
- `packages/happy-cli/src/codex-app/CodexAppServerNotificationSchemaContract.test.ts`
- `packages/happy-cli/src/codex-app/__fixtures__/server_notification_contract_subset.json`
- `packages/happy-cli/src/codex-app/__fixtures__/notification_contract_core.json`
- `packages/happy-cli/src/codex-app/__fixtures__/notification_contract_items.json`
- `packages/happy-cli/src/codex-app/__fixtures__/notification_contract_upstream_rich.json`
- `packages/happy-cli/src/codex-app/CodexAppServerClient.test.ts`

### Reviewer sanity check

如果 reviewer 在一个 PR 里同时看到以下两类内容，应该主动要求拆 PR：

- 治理文档 / 模板 / rules / workflow policy
- contract fixture / schema baseline / client test 实现

因为这通常意味着：
- PR scope 已经失焦
- 后续很难判断“这次是在定规则”还是“这次是在补实现”

# Parallelism

可并行的只有这些：

- Step 2 与 Step 3 可部分并行
- Step 6 的测试基建可在 Step 2 末期预研
- Step 8 的 UI 改造可在 Step 5 / 6 接近完成时并行推进

**不建议并行**：

- Step 5 与 Step 9  
  因为模型锁定策略不定，先改 UI/配置很容易返工

# Acceptance Bar

只有同时满足以下条件，才算这轮 roadmap 完成：

1. app-server 成为 Happy 的默认 Codex 主路径
2. legacy MCP 明确退居兼容层
3. Happy 对 upstream Codex 的分叉点有文档、有 metadata、有 UI 表达
4. `normalizeRawMessage` / reducer / session protocol / app-server contract 都有 fixture 或契约测试
5. “default = inherit Codex config” 在实现上也是真的

# Anti-patterns to avoid

- 用更多硬编码掩盖 upstream 差异
- 继续让 UI 假装默认、运行时偷偷 override
- 把 experimental API 当稳定契约使用却不加 contract test
- 没搞清 state/sqlite/memories 继承语义就继续扩 Happy overlay
- 继续往 legacy MCP 路径堆新能力

# Plan mutation protocol

如果执行中发现 reality mismatch，按以下规则变更计划：

- **Split**：某一步过大，拆成多个 PR-sized steps
- **Insert**：发现新的 blocker，在依赖边中插入新 step
- **Reorder**：仅允许在不破坏依赖前提下重排
- **Abandon**：若某分叉策略被否定，必须在文档中写明原因和替代路径

每次变更必须更新：

- 本 roadmap
- 相关子计划文档
- 受影响的验收标准

# Sources

- openai/codex repo: `https://github.com/openai/codex`
- app-server protocol README
- config docs
- execpolicy README
- existing local plans:
  - `docs/plans/codex-config-first-app-server-plan.md`
  - `docs/plans/session-protocol-impl.md`
