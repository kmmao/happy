# Happy ↔ openai/codex 模块分类矩阵

## Status

- Drafted on 2026-04-21
- Snapshot type: current-state classification matrix
- Uses glossary from `docs/plans/codex-upstream-alignment-roadmap.md`

## Scope

这不是完整文件清单，而是 **Codex 对齐工作中最关键的模块快照**。  
目的不是“列举所有文件”，而是回答下面几个问题：

1. 当前模块主要属于哪一类：
   - `upstream-aligned`
   - `happy-opinionated`
   - `compat`
2. 为什么这样归类
3. 下一步想迁移到什么目标分类
4. 当前最大阻塞点是什么

## Upstream baseline

- Upstream source: `openai/codex`
- Verified date: 2026-04-21
- Reference points:
  - GitHub latest release shown as `0.122.0` on 2026-04-20
  - `codex app-server`
  - `~/.codex/config.toml` / profiles / capabilities
  - `execpolicy`

## Classification summary

| Classification | Count | Meaning |
|---|---:|---|
| `upstream-aligned` | 4 | 目标主要是跟随上游语义，当前偏差应视为 drift |
| `happy-opinionated` | 6 | 当前存在明确 Happy 产品策略或 UX 选择 |
| `compat` | 3 | 主要为了兼容旧路径、旧版本或 fallback |

> 注：个别模块带有次级属性，但矩阵按**当前主导角色**做主分类。

## Module matrix

| Area | Local module(s) | Current classification | Why this classification | Target classification | Main blocker / tension | Risk | Suggested owner lane |
|---|---|---|---|---|---|---|---|
| CLI runtime entry | `packages/happy-cli/src/codex/runCodex.ts` | `upstream-aligned` | 主目标已是优先走 `codex app-server`，并把 metadata / capability 接回 Happy；虽然仍背着 fallback，但主导方向不是继续发明第二套协议 | `upstream-aligned` | app-server 主路径与 legacy fallback 仍在同一 orchestration 中耦合 | High | CLI / Codex runtime |
| App-server client | `packages/happy-cli/src/codex-app/CodexAppServerClient.ts` | `upstream-aligned` | 直接消费 app-server JSON-RPC、capabilities、turn/item lifecycle，目标就是保语义一致 | `upstream-aligned` | 手写类型 + experimental API，容易协议漂移 | High | CLI / app-server |
| Legacy MCP client | `packages/happy-cli/src/codex/codexMcpClient.ts` | `compat` | 核心职责是兼容 `mcp` / `mcp-server` 旧路径和老版本 Codex，不是未来主能力面 | `compat` | 仍需覆盖老版本与 fallback 场景 | Medium | CLI / compatibility |
| Backend selector | `packages/happy-cli/src/codex-shared/backendSelection.ts` | `compat` | 主要处理 app-server 与 legacy MCP 之间的回退与判定，本质就是兼容层控制器 | `compat` | fallback 规则仍带有启发式字符串匹配 | Medium | CLI / compatibility |
| Config resolution | `packages/happy-cli/src/codex-shared/configResolution.ts` | `happy-opinionated` | 当前直接锁定 `gpt-5.4`，并通过 Happy 环境变量驱动 runtime override，这不是上游默认行为 | `upstream-aligned` 或 `happy-opinionated` 明确双模 | 是否继续锁模型尚未正式决策 | High | CLI / config |
| Message mode normalization | `packages/happy-cli/src/codex/messageMode.ts` | `happy-opinionated` | 会话内 model 选择被收敛到 Happy 定义的锁定模型策略，而不是尊重上游发现结果 | `happy-opinionated`（显式保留）或 `upstream-aligned` | 与锁模型策略强耦合，无法单独演进 | High | CLI / config |
| Execution policy mapping | `packages/happy-cli/src/codex/executionPolicy.ts` | `happy-opinionated` | 目前是 Happy 自己的粗粒度 permission mode → Codex approval/sandbox 映射，不是上游原生 policy/execpolicy 体系 | 双层：默认 `upstream-aligned` + 可选 `happy-opinionated` | 简化模式和原生策略如何共存还没设计清楚 | High | CLI / permissions |
| Codex home overlay | `packages/happy-cli/src/codex-shared/codexHomeOverlay.ts` | `happy-opinionated` | 这是 Happy 为远程 auth 注入而做的本地 overlay 机制，上游没有这层产品需求 | `upstream-aligned` 语义 + 必要时显式隔离模式 | sqlite / memories / notices / rollout state 继承语义不清 | High | CLI / persistence |
| Session protocol adapter | `packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts` | `upstream-aligned` | 虽然输出是 Happy session envelope，但目标是尽量无损保留上游 app-server / MCP 语义 | `upstream-aligned` | 缺少 schema/codegen 级 contract 防线；当前仍以手工 fixture 为主 | High | CLI / protocol |
| Happy operator overlay | `packages/happy-cli/src/codex/baseInstructions.ts`, `packages/happy-cli/src/codex/happyMcpStdioBridge.ts` | `happy-opinionated` | `request_user_input`、progress、session summary、options XML 都是 Happy 产品层增强，不属于上游 Codex 原生职责 | `happy-opinionated`（但需显式化） | 需要防止与上游默认 developer instructions 冲突 | Medium | CLI / product UX |
| Automation injection | `packages/happy-cli/src/automation/TaskRunner.ts`（Codex env 注入部分） | `happy-opinionated` | 自动任务给 Codex 注入固定模型/env 策略，是 Happy 的产品执行选择 | 与模型策略保持一致 | 模型锁定和 profile/config-first 还未统一 | Medium-High | Automation / Codex |
| App model selection UI | `packages/happy-app/sources/components/modelModeOptions.ts`, `packages/happy-app/sources/app/(app)/new/index.tsx`, `packages/happy-app/sources/components/NewSessionWizard.tsx` | `happy-opinionated` | UI 当前只暴露 Happy 想让用户看到的 Codex 模型与 permission mode，不是运行时发现主导 | `upstream-aligned` + 可选 overlay | 前端仍受锁模型与粗粒度权限模式牵制 | High | App / session creation |
| App metadata rendering | `packages/happy-app/sources/app/(app)/session/[id]/codexMetadata.ts`, `packages/happy-app/sources/app/(app)/session/[id]/CodexInfoSection.tsx` | `upstream-aligned` | 已经在消费 backend/config/account/rate-limit/skills 等运行时发现结果，方向上是在贴近上游真实状态 | `upstream-aligned` | 仍主要是展示层，还没反过来驱动创建会话和策略选择 | Medium | App / session details |

## Hot spots

这些模块是当前最容易引发争议或返工的地方：

1. **`configResolution.ts`**
   - 这里决定 Happy 到底是在“跟上游”还是“继续锁自己的模型”
2. **`executionPolicy.ts`**
   - 这里决定 Happy 是继续扁平化 Codex 权限模型，还是开始兼容上游原生策略
3. **`codexHomeOverlay.ts`**
   - 这里决定状态继承是真继承，还是看似继承、实则分裂
4. **`runCodex.ts`**
   - 这里决定 app-server 主路径与 compat fallback 是否真正隔离
5. **App 新建会话 UI**
   - 这里决定用户看到的是上游真实能力，还是 Happy 的产品过滤结果

## Recommended use

后续所有 Codex 相关 PR，在描述中至少应引用本矩阵中的一行，并明确回答：

- 本 PR 改的是哪个模块
- 它当前属于哪个分类
- 改完后目标分类是否变化
- 如果不变化，为什么

## Known gaps

这份矩阵目前还没有覆盖：

- 更细的 `codex-app` 子模块拆分
- app-server schema/codegen 产物
- 更细的 app UI 组件粒度
- 自动化/世界模型对 Codex 的所有注入路径

这些应在后续 PR-1B 扩展版或 Step 2/5/8 的执行中继续下钻。
