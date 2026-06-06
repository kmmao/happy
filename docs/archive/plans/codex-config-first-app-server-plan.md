# Codex Config-First + App Server 改造计划

## Status

- Checklist complete as of 2026-04-12
- Remaining follow-up work is now maintenance / refinement rather than unchecked plan items

## Alignment classification

- Primary classification: `upstream-aligned`
- Secondary classification: `compat`

### Upstream baseline

- Upstream source: `openai/codex`
- Verified date: 2026-04-21
- Upstream reference:
  - focus area: `codex app-server` as rich client primary interface
  - focus area: `~/.codex/config.toml` / profile-driven configuration
  - focus area: legacy `mcp-server` as compatibility / fallback surface
- Affected local area:
  - `packages/happy-cli/src/codex/`
  - `packages/happy-cli/src/codex-app/`
  - `packages/happy-cli/src/codex-shared/`
- Known deviation:
  - Happy historically locked Codex model choice and simplified permission semantics
  - Happy continues to carry legacy MCP fallback for compatibility
- Follow-up intent:
  - 主路径继续向 upstream-aligned 收敛
  - legacy MCP 仅保留 compat 角色，不作为新能力承载面

### Why this document is not pure upstream-aligned

- 本计划虽然目标是“配置优先 + app-server 主路径”，但仍显式保留 `codex-mcp-legacy` 回退
- 因此它不是纯粹的上游对齐文档，而是：
  - **主策略**：upstream-aligned
  - **兜底策略**：compat

## 背景

当前 Happy 对 Codex 的接入核心是：

- Happy 负责远程控制、会话同步、权限交互、移动端 UI、协议映射
- 本地真正执行 coding agent 的仍然是 `codex` CLI
- 目前主要通过 `codex mcp-server` 对接，而不是官方更完整的 `codex app-server`

这导致几个实际问题：

- `default` 模式在 UI 里表达为“使用 Codex 默认配置”，但实现上仍会主动覆盖 `approval-policy` / `sandbox`
- 默认模型仍偏硬编码，不能天然继承用户已有 `~/.codex/config.toml`
- 为注入 OAuth token，当前 daemon 会临时覆写 `CODEX_HOME`，容易绕开用户已有的 Codex 配置、skills、sessions、hooks
- Happy 暂未利用官方 `app-server` 的能力发现、thread/turn 控制、review、plan/diff 更新、rate limit 读取等能力

## 目标

- 让 Happy 在“用户已经配置好 Codex”的前提下，优先尊重 Codex 自身配置文件与 profile
- 让 Happy 对 Codex 的调用从“CLI 适配层”升级为“配置优先的远程控制层”
- 在不破坏现有用户的前提下，引入 `codex app-server` 作为主路径
- 让 App 端的 Codex 模型、推理档位、能力展示逐步从硬编码切换到运行时发现
- 保留现有 `mcp-server` 路径作为兼容与回退方案，直到 `app-server` 达到稳定可替代

## 非目标

- 这轮不优先引入 OpenAI Agents SDK 作为主执行后端
- 这轮不重做 Happy 的 session protocol、E2E 加密、移动端消息模型
- 这轮不要求一次性移除所有旧逻辑

## 总体决策

### 1. 保留当前 Codex 调用方式吗

保留，但降级为：

- 兼容路径
- 灰度回退路径
- 本地环境不支持 `app-server` 时的兜底路径

不建议继续把它作为长期主路径。

### 2. 新旧路径如何区分

新增显式后端类型：

- `codex-app-server`
- `codex-mcp-legacy`

建议策略：

- 新会话默认优先 `codex-app-server`
- 若本机 Codex 版本不支持 `app-server`，或初始化失败且错误属于可回退类型，则自动回退到 `codex-mcp-legacy`
- 对已有会话，沿用创建时的 backend，避免跨后端恢复带来 thread/session 语义错位

建议在 metadata 中记录：

- `metadata.codex.backend = "codex-app-server" | "codex-mcp-legacy"`
- `metadata.codex.backendVersion = "<codex version>"`
- `metadata.codex.fallbackReason?: string`
- `metadata.codex.configMode = "inherit" | "managed-profile" | "managed-overrides"`

### 3. 配置优先级

Codex 相关配置的优先级应明确为：

1. 当前 turn 的显式 override
2. 当前 Happy profile 的显式 override
3. 当前 Happy profile 绑定的 Codex profile
4. 用户已有 `~/.codex/config.toml`
5. Codex 自身默认值

关键原则：

- 如果用户选择的是 `inherit`，Happy 不主动覆盖 Codex 的模型、approval、sandbox、personality、verbosity、reasoning 设置
- Happy 只在用户明确选择覆盖时才发送 override

### 4. Fallback Policy

Fallback 只指“运行后端回退”，不指配置文件切换。

也就是说：

- 配置仍优先使用同一套本地 Codex 配置
- 变的是 Happy 与 Codex 的通信后端：
  - 优先 `codex-app-server`
  - 失败时回退到 `codex-mcp-legacy`

自动 fallback 的规则建议为：

- 只有当 `requestedBackend = auto` 时，才允许自动 fallback
- 只有在“会话创建前”或“第一轮 turn 开始前”才允许自动 fallback
- 一旦某个会话已经成功用某个 backend 跑起来，该会话后续不再自动切换 backend
- 已有会话恢复时，必须 stick 到创建时的 backend

应该触发 fallback 的场景：

- 本机 `codex` 版本不支持 `app-server`
- `codex app-server` 子命令不存在
- `app-server` 启动即退出
- `initialize` / `thread/start` / `turn/start` 这类核心启动 RPC 不可用
- app-server 初始化阶段出现超时、协议错误、JSON-RPC 不兼容

不应该触发 fallback 的场景：

- API key / OAuth token 无效
- `~/.codex/config.toml` 内容错误
- 模型名配置错误
- 账号限流
- 工具调用失败
- 已经成功启动的会话在运行中出现普通业务错误

这些应直接报错，不应悄悄切换 backend。

### 5. Backend Observability / UX

Codex 会话必须能明确看到“当前实际使用的是哪个 backend”。

最少需要三层可观测性：

- 会话内状态标签
  - `Backend: Codex App Server`
  - `Backend: Codex Legacy MCP`
- 会话详情 / 调试信息
  - `Requested backend`
  - `Resolved backend`
  - `Config mode`
  - `Fallback reason`
  - `Codex version`
- fallback 发生时的 service message
  - 例如：`Codex App Server unavailable, fell back to Legacy MCP`

建议 metadata 字段：

```ts
metadata.codex = {
  requestedBackend: "auto" | "codex-app-server" | "codex-mcp-legacy",
  resolvedBackend: "codex-app-server" | "codex-mcp-legacy",
  configMode: "inherit" | "managed-profile" | "managed-overrides",
  fallbackReason?: string,
  backendVersion?: string,
};
```

关键原则：

- `requestedBackend` 和 `resolvedBackend` 必须分开记录
- `Auto` 模式下，如果实际发生回退，用户必须可见
- 不要求把 backend 选择放进新建会话主流程，但会话创建后必须可见实际 backend

## 推荐目录设计

保留现有目录，同时新增 app-server 实现：

- `packages/happy-cli/src/codex/`
  - 保留现有 `mcp-server` 路径
- `packages/happy-cli/src/codex-app/`
  - `CodexAppServerClient.ts`
  - `CodexAppServerBackend.ts`
  - `auth.ts`
  - `capabilities.ts`
  - `sessionProtocolMapper.ts`
  - `types.ts`
- `packages/happy-cli/src/codex-shared/`
  - `backendSelection.ts`
  - `configResolution.ts`
  - `codexHomeOverlay.ts`
  - `metadata.ts`

如果后续抽象成熟，再把 `codex/` 与 `codex-app/` 收敛到统一 backend 接口。

## 配置模型设计

在 Happy profile 中新增 `codexConfig`，建议字段：

```ts
type CodexBackendMode = "codex-app-server" | "codex-mcp-legacy";

type CodexConfigMode =
  | "inherit"
  | "managed-profile"
  | "managed-overrides";

type CodexProfileConfig = {
  backendMode?: CodexBackendMode;
  configMode?: CodexConfigMode;
  codexProfileName?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  reasoningSummary?: string | null;
  verbosity?: string | null;
  personality?: string | null;
  serviceTier?: string | null;
  webSearchEnabled?: boolean | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
};
```

语义：

- `inherit`
  - 完全继承用户 Codex 配置
  - Happy 不主动设置模型、approval、sandbox
- `managed-profile`
  - Happy 指定使用某个 Codex profile 名称
- `managed-overrides`
  - Happy 对当前 thread / turn 发局部覆盖，但不改磁盘上的全局配置

## 分阶段实施清单

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
- **CRITICAL: all tests must pass before starting next task**
- **CRITICAL: update this plan file when scope changes during implementation**
- Run tests after each change

## Testing Strategy

- **Unit tests**: 配置解析、backend 选择、fallback 判定、capability 映射、overlay home 行为
- **Integration tests**: `codex app-server` 初始化、auth 注入、metadata 映射、自动回退逻辑
- **Manual smoke tests**:
  - 用户已有 `~/.codex/config.toml`
  - 用户仅有 API key
  - 用户仅有 ChatGPT OAuth
  - `app-server` 不可用时回退到 legacy

## Progress Tracking

- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## Implementation Steps

### Task 0: 明确现状与基线

- [x] 盘点当前 Codex 路径涉及的文件与实际覆盖行为
- [x] 补一份当前行为矩阵：
  - `default` / `read-only` / `safe-yolo` / `yolo`
  - `OPENAI_MODEL`
  - `CODEX_HOME`
  - Happy sandbox 开关
- [x] 补测试覆盖当前 `resolveCodexExecutionPolicy()` 的现状行为
- [x] 在文档中记录 legacy 路径的已知限制

涉及文件：

- `packages/happy-cli/src/codex/runCodex.ts`
- `packages/happy-cli/src/codex/codexMcpClient.ts`
- `packages/happy-cli/src/codex/executionPolicy.ts`
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-app/sources/components/modelModeOptions.ts`

当前行为矩阵摘要：

- `default`
  - 现行为继承本地 Codex 配置
  - 不主动下发 approval/sandbox override
- `read-only`
  - 映射到只读执行策略
- `safe-yolo`
  - 映射到 workspace-write + on-failure
- `yolo`
  - 映射到 danger-full-access + on-failure
- `OPENAI_MODEL`
  - 不再作为 Codex 会话的默认强制模型
  - 仅在显式覆盖时参与
- `CODEX_HOME`
  - 现为 overlay 模式，不再用临时空目录覆盖真实 `~/.codex`
- Happy sandbox
  - 开启时仍由 Happy 作为外层 OS sandbox 控制边界

legacy 路径已知限制：

- 仍依赖 `codex mcp-server`
- provider-native能力发现不如 app-server 完整
- review/plan/diff/账号状态等事件粒度较弱
- 对 Codex 新能力的适配滞后于 app-server

### Task 1: 修正“default = inherit Codex config”语义

- [x] 调整 Codex 权限模式映射逻辑
- [x] 当 permission mode 为 `default` 时，不再强制下发 `approval-policy`
- [x] 当 permission mode 为 `default` 时，不再强制下发 `sandbox`
- [x] App 文案与行为对齐，确保 `default` 真正表示“Use Codex default settings”
- [x] 新建测试覆盖：
  - `default` 不下发 override
  - 非 `default` 仍按预期下发 override

涉及文件：

- `packages/happy-cli/src/codex/executionPolicy.ts`
- `packages/happy-cli/src/codex/runCodex.ts`
- `packages/happy-app/sources/components/modelModeOptions.ts`
- `packages/happy-app/sources/components/tools/PermissionFooter.tsx`

### Task 2: 修正默认模型策略，改为 config-first

- [x] App 侧为 Codex 增加默认模型项：`Use Codex default`
- [x] 将 Codex 默认模型 key 从硬编码 `gpt-5.4` 调整为 `default`
- [x] 若用户未显式选择模型，不发送 `model`
- [x] 仅当用户主动选择具体模型时发送 `meta.model`
- [x] 补测试覆盖：
  - `default` 不发送 `meta.model`
  - 指定模型时发送

涉及文件：

- `packages/happy-app/sources/components/modelModeOptions.ts`
- `packages/happy-app/sources/app/(app)/new/index.tsx`
- `packages/happy-app/sources/sync/sync.ts`

### Task 3: 解决 `CODEX_HOME` 覆盖用户配置的问题

- [x] 引入 `codexHomeOverlay` 设计，避免用临时空目录替换真实 `~/.codex`
- [x] 若需要写 auth，仅写入 overlay 的 auth 部分
- [x] 保留用户现有：
  - `config.toml`
  - `profiles`
  - `skills`
  - `agents`
  - `hooks`
  - `sessions`
- [x] 设计 overlay 生命周期与清理策略
- [x] 补测试覆盖：
  - 真实配置可见
  - auth 可注入
  - 会话结束后 overlay 可清理

涉及文件：

- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/codex-shared/codexHomeOverlay.ts`

实现说明：

- 采用 symlink/junction overlay 的方式复用现有 Codex home 内容
- overlay 只覆盖 `auth.json`
- daemon 在会话退出时对 overlay 做 best-effort cleanup

### Task 4: 抽象 Codex backend 选择层与 fallback 策略

- [x] 新增 backend 选择器：`codex-app-server` / `codex-mcp-legacy`
- [x] 设计 capability probe：
  - 检查 codex 版本
  - 检查 `app-server` 命令是否存在
  - 检查必要方法是否可初始化
- [x] 设计 fallback 分类：
  - 可回退错误
  - 不可回退错误
- [x] 明确自动 fallback 的触发窗口：
  - 会话创建前
  - 第一轮 turn 前
- [x] 明确禁止 fallback 的错误类型：
  - auth 错误
  - config 错误
  - model 错误
  - rate limit
  - 运行中普通业务错误
- [x] 在 metadata 中记录最终 backend 与回退原因
- [x] 补测试覆盖 backend 选择矩阵
- [x] 补测试覆盖 fallback 允许 / 禁止矩阵

实现说明：

- 已新增 `backendSelection.ts`，默认使用 `auto`
- 当前 `runCodex()` 已接入：
  - `auto` → 优先尝试 `codex-app-server`
  - 失败时回退 `codex-mcp-legacy`
  - `HAPPY_CODEX_BACKEND=app-server|legacy|auto` 环境变量选择
- 当前 auto fallback 触发点集中在 app-server 建连阶段
- 当前已对 connect/bootstrap 错误做 fallback 分类；运行中错误仍未扩展到完整矩阵
- 当前 `runCodex()` 已支持 `happySessionId` reconnect
- 在 `requestedBackend = auto` 且存在旧 Happy session metadata 时，会优先沿用旧会话的 backend 决策
- app-server thread id 已写入 `metadata.codex.threadId`
- reconnect 到既有 app-server 会话时，会优先尝试 `thread/resume`
- app-server 登录已接入：
  - `chatgptAuthTokens`
  - `apiKey`
  - `account/chatgptAuthTokens/refresh`
- 已完成本机 smoke：
  - `CodexAppServerClient.connect()`
  - `model/list`
  - `disconnect()`
- 已新增单测覆盖：
  - backend 选择与 fallback 分类
  - `CodexAppServerClient.connect()`
  - `thread/start + turn/start`
  - command approval 响应
  - request_user_input 响应

涉及文件：

- `packages/happy-cli/src/codex-shared/backendSelection.ts`
- `packages/happy-cli/src/codex/runCodex.ts`
- `packages/happy-cli/src/api/types` 或 metadata 定义处

### Task 5: 新增 `codex app-server` client

- [x] 新建 `packages/happy-cli/src/codex-app/`
- [x] 实现 `CodexAppServerClient`
- [x] 启动 `codex app-server`
- [x] 实现 JSON-RPC transport
- [x] 接入最小必要方法：
  - `initialize`
  - `config/read`
  - `thread/start`
  - `thread/resume`
  - `turn/start`
  - `turn/interrupt`
- [x] 做基础错误分类与日志
- [x] 补单元测试
- [x] 补集成测试

### Task 6: 改造 Codex session loop 到 app-server 主路径

- [x] 在 `runCodex()` 中接入 app-server backend
- [x] 保留 legacy backend，不删除
- [x] 新会话默认优先 app-server
- [x] 对 reconnect 场景补 `happySessionId` 支持
- [x] 对旧会话保留 backend sticky 策略
- [x] 统一中断、退出、keepAlive、resume 行为
- [x] 补测试覆盖：
  - app-server 创建新线程
  - app-server 恢复线程
  - 中断与退出
  - 自动回退到 legacy

涉及文件：

- `packages/happy-cli/src/codex/runCodex.ts`
- `packages/happy-cli/src/codex-app/CodexAppServerBackend.ts`

### Task 7: 接入官方能力发现

- [x] 读取并缓存：
  - `model/list`
  - `config/read`
  - `account/read`
  - `account/rateLimits/read`
- [x] 读取并缓存：
  - `experimentalFeature/list`
  - `skills/list`
  - `mcpServerStatus/list`
- [x] 将能力写入 session metadata
- [x] App 改为优先使用 metadata 渲染 Codex 模型、能力与说明
- [x] 去掉硬编码 Codex 模型列表作为主来源，改为 fallback
- [x] 补测试覆盖 metadata 映射

涉及文件：

- `packages/happy-cli/src/codex-app/capabilities.ts`
- `packages/happy-app/sources/components/modelModeOptions.ts`
- `packages/happy-app/sources/components/AgentInput.tsx`

实现说明：

- 当前 app-server 能力加载已接入：
  - `model/list`
  - `config/read`
  - `account/read`
  - `account/rateLimits/read`
- 额外已接入：
  - `experimentalFeature/list`
  - `skills/list`
  - `mcpServerStatus/list`
- 这些数据会写入 `metadata.codex`
- 已接入动态刷新触发：
  - `account/updated`
  - `account/rateLimits/updated`
  - `skills/changed`
  - `mcpServer/startupStatus/updated`
- App 侧模型列表已优先使用 metadata
- 当前 App 侧会话详情已能展示部分 Codex 能力元信息：
  - backend
  - backend version
  - fallback reason
  - config mode
  - Codex profile
  - Codex account
  - Codex plan
- 当前 App 侧尚未单独渲染 features / skills / MCP status，但 metadata 已具备

### Task 8: 接入官方 auth 流程，替代临时 `CODEX_HOME` 注入

- [x] API key 场景走 app-server 原生登录
- [x] ChatGPT OAuth 场景走 app-server 原生登录
- [x] 评估并接入最小 token refresh
- [x] 将 Happy 云端 token 与本地 app-server 登录态打通
- [x] legacy backend 继续保留当前 auth 兼容逻辑
- [x] 补单元测试覆盖两类 auth
- [x] 补集成测试覆盖两类 auth

实现说明：

- app-server 路径下，`runCodex()` 会优先读取 Happy 云端保存的 OpenAI vendor token
- 若拿到 `oauth.access_token + account_id`，走 `chatgptAuthTokens` 登录
- 若未拿到云端 OAuth，但进程环境中存在 `OPENAI_API_KEY`，则走 `apiKey` 登录
- 已接入 `account/chatgptAuthTokens/refresh` 的最小处理：
  - 发生 unauthorized 刷新请求时，重新从 Happy 云端读取 OpenAI vendor token
  - 若仍有 `access_token + account_id`，则返回给 app-server
- 更完整的 refresh / 续期策略仍待补
- 已新增条件集成测试：
  - `OPENAI_API_KEY` 存在时验证 `apiKey` 登录
  - `HAPPY_TEST_CODEX_ACCESS_TOKEN` + `HAPPY_TEST_CODEX_ACCOUNT_ID` 存在时验证 `chatgptAuthTokens` 登录

### Task 9: 增加 `codexConfig` 到 Happy profile

- [x] 在 CLI 与 App 的 profile schema 中新增 `codexConfig`
- [x] 提供三种模式：
  - `inherit`
  - `managed-profile`
  - `managed-overrides`
- [x] App 侧提供基础配置 UI
- [x] 新建 profile 同步逻辑
- [x] 补测试覆盖 schema 与 sync

涉及文件：

- `packages/happy-cli/src/persistence.ts`
- `packages/happy-app/sources/sync/settings.ts`
- `packages/happy-app/sources/components/ProfileEditForm.tsx`
- `packages/happy-app/sources/sync/profileSync.ts`

### Task 10: 增加 Codex profile 绑定与受管 override

- [x] `inherit` 模式下，不写任何 Codex 配置
- [x] `managed-profile` 模式下，允许指定 Codex profile 名称
- [x] `managed-overrides` 模式下，按 thread / turn 下发：
  - model
  - reasoning effort
  - reasoning summary
  - verbosity
  - personality
  - service tier
  - web search
- [x] 明确哪些字段允许热切换，哪些需要重建 turn / thread
- [x] 补测试覆盖三种模式

实现说明：

- `codexConfig` 现已支持 schema、profile sync、Profile 编辑 UI、环境变量映射和运行时消费
- `inherit`：不下发任何内部 Codex 配置 env
- `managed-profile`：下发 `HAPPY_CODEX_PROFILE`
- `managed-overrides`：下发 `HAPPY_CODEX_MODEL`、`HAPPY_CODEX_REASONING_EFFORT`、`HAPPY_CODEX_REASONING_SUMMARY`、`HAPPY_CODEX_VERBOSITY`、`HAPPY_CODEX_PERSONALITY`、`HAPPY_CODEX_SERVICE_TIER`、`HAPPY_CODEX_WEB_SEARCH`、`HAPPY_CODEX_APPROVAL_POLICY`、`HAPPY_CODEX_SANDBOX_MODE`
- 当前热切换边界：
  - 消息级 model override 仍可继续热切换
  - profile 级 codexConfig 在会话生成 / reconnect 时生效
  - 更完整的细粒度 turn/thread 重建策略仍可继续细化

### Task 11: 接 plan / diff / review / steer 富事件

- [x] 接入：
  - `turn/steer`
  - `turn/plan/updated`
  - `turn/diff/updated`
  - `review/start`
- [x] 将官方结构映射到 Happy 现有 session protocol
- [x] 在 App 中展示：
  - 计划更新
  - 差异预览
  - review 结果
  - 运行中 steer 状态
- [x] 补测试覆盖协议映射

实现说明：

- `turn/plan/updated` 已映射为 service message
- `turn/diff/updated` 已映射为 diff fenced block service message
- steer 活动已映射为 service message
- review 相关 item 已映射为 service message

### Task 12: Backend 可观测性、fallback UX 与长期区分策略

- [x] 为 backend 增加显式用户可见状态
- [x] 在 session metadata 中显示当前 backend
- [x] 在 App 中显示：
  - `Codex App Server`
  - `Codex Legacy MCP`
- [x] 在 App 中区分显示：
  - `Requested backend`
  - `Resolved backend`
- [x] 记录自动回退原因
- [x] fallback 发生时发送 service message
- [x] 在 session detail / debug info 中展示：
  - `Config mode`
  - `Fallback reason`
  - `Codex version`
- [x] 提供开发开关：
  - 强制 app-server
  - 强制 legacy
  - 自动选择
- [x] 补测试覆盖 fallback 可观测性

实现说明：

- 当前 legacy Codex 会话会在 metadata 中写入 `metadata.codex`
- 会话信息页已能显示 `requestedBackend` 与 `resolvedBackend`
- 会话信息页已能显示 `backendVersion` 与 `fallbackReason`
- 会话信息页已能显示 `configMode`
- 已补 session-protocol mapper 测试，覆盖 `service_message -> service` 映射

### Task 13: 可选的 Happy 托管 Codex profiles

- [x] 定义可选 profile 集：
  - `happy_fast`
  - `happy_balanced`
  - `happy_max`
  - `happy_plan`
  - `happy_review`
- [x] 仅在用户明确选择时写入 Codex 配置
- [x] 不静默修改用户现有 profile
- [x] 补迁移文档

建议托管 profile 定义：

- `happy_fast`
  - model: `gpt-5.4-mini`
  - reasoning effort: `low`
  - summary: `none`
  - verbosity: `low`
  - web search: `disabled`
- `happy_balanced`
  - model: `gpt-5.4`
  - reasoning effort: `medium`
  - summary: `concise`
  - verbosity: `medium`
  - web search: `cached`
- `happy_max`
  - model: `gpt-5.4`
  - reasoning effort: `high`
  - summary: `detailed`
  - verbosity: `high`
  - web search: `live`
- `happy_plan`
  - model: `gpt-5.4`
  - reasoning effort: `high`
  - summary: `detailed`
  - verbosity: `medium`
  - web search: `cached`
- `happy_review`
  - model: `gpt-5.4`
  - reasoning effort: `high`
  - summary: `concise`
  - verbosity: `low`
  - web search: `disabled`

迁移原则：

- 已有用户默认保持 `inherit`
- 不自动写入或覆盖 `~/.codex/config.toml`
- 仅在用户明确选择托管 profile 时才写入对应配置
- 切换回 `inherit` 时，不删除用户已有原生 Codex 配置

### Task 14: 验收与发布策略

- [x] 完成灰度开关
- [x] 完成本地回归矩阵
- [x] 完成升级说明
- [x] 完成 fallback 指南
- [x] 当 `codex-app-server` 稳定后，将其提升为默认 backend
- [x] legacy backend 至少保留一个稳定周期后再评估是否删除

灰度开关：

- `HAPPY_CODEX_BACKEND=auto`
- `HAPPY_CODEX_BACKEND=app-server`
- `HAPPY_CODEX_BACKEND=legacy`

本地回归矩阵：

- legacy MCP 新会话
- app-server 新会话
- auto 模式建连失败回退
- `happySessionId` reconnect
- app-server thread resume
- app-server capability load
- app-server auth:
  - apiKey
  - chatgptAuthTokens
  - token refresh
- Profile `codexConfig`:
  - inherit
  - managed-profile
  - managed-overrides

升级说明：

- 默认 Codex 会话优先尝试 app-server
- `default` 模式会优先继承本地 Codex 配置
- 若 app-server 不可用且 backend 为 `auto`，会自动回退到 legacy MCP
- 会话详情页会明确展示 requested/resolved backend

fallback 指南：

- backend 为 `auto` 时：
  - app-server 启动/协议错误可回退
  - auth/config/model/rate-limit 错误不回退
- backend 为 `app-server` 时：
  - 直接报错，不自动回退
- backend 为 `legacy` 时：
  - 不尝试 app-server

默认 backend 提升条件：

- app-server connect/model list/auth/reconnect/thread resume 在本地与测试环境稳定
- session info / metadata 可观测性完整
- fallback 分类明确且有测试保护

legacy backend 退役条件：

- 至少经过一个稳定发布周期
- app-server 覆盖主路径使用场景
- 无高频回退依赖后再评估移除

## 后端区分方案

建议在实现中同时保留“配置模式”和“运行后端”两个维度：

### 运行后端

- `codex-app-server`
- `codex-mcp-legacy`

### 配置模式

- `inherit`
- `managed-profile`
- `managed-overrides`

这样可以避免把两个维度揉成一个字段，造成后续语义混乱。

示例：

- `backend = codex-app-server`, `configMode = inherit`
  - 最推荐
  - Happy 只做远程控制，不主动覆盖 Codex 默认设置
- `backend = codex-app-server`, `configMode = managed-overrides`
  - Happy 对当前 thread/turn 做受控增强
- `backend = codex-mcp-legacy`, `configMode = inherit`
  - 兼容模式
  - 在 app-server 不可用时仍可工作

## 验收标准

- 用户已有 `~/.codex/config.toml` 时，Happy 默认不覆盖其模型与审批策略
- 用户未显式选模型时，不再默认把 Codex 会话固定到 `gpt-5.4`
- `CODEX_HOME` 不再导致用户现有 Codex 配置丢失
- 新会话默认优先走 `codex app-server`
- `app-server` 初始化失败时，能自动回退到 legacy，并把原因写入 metadata
- App 可显示 Codex 真正支持的模型与能力，而不是仅展示硬编码列表
- 旧用户现有会话与自动化不被破坏

## 风险与注意事项

- `app-server` 与 `mcp-server` 的 thread/session 语义不同，不能随意跨 backend 恢复
- `default` 语义从“Happy 的默认值”改成“Codex 的默认值”后，用户行为会更接近官方，但会改变现有一些隐式假设
- `CODEX_HOME` overlay 方案需要非常小心，避免污染真实用户数据目录
- App 侧一旦改为动态能力发现，需要保留足够的 fallback，避免旧 CLI 无 metadata 时 UI 失效
- app-server 文本输出是增量流，若按完整消息处理会导致单字符/碎片化渲染；已通过 session-protocol `text-delta` 事件修复
- workspace 内 `@kmmao/happy-wire` 依赖变更后需要保证工作区安装状态刷新，避免 CLI 继续使用旧的 wire schema

## Open Questions

- [x] app-server 初始化失败时，哪些错误应立即回退，哪些应直接报错
  - 启动/建连/协议/bootstrap 错误：允许在 `auto` 下回退
  - auth/config/model/rate-limit 错误：直接报错，不回退
- [x] 是否允许用户在一个 profile 里显式固定 legacy backend
  - 允许
  - 通过 `codexConfig.backendMode = codex-mcp-legacy`
- [x] Happy 是否需要提供“同步写入 Codex config.toml”的 UI，还是仅保留受管 override
  - 当前结论：优先保留受管 override
  - 不默认直接写 `~/.codex/config.toml`
- [x] `review/start` 的输出是否需要映射到单独的 review UI，而不是普通消息流
  - 当前阶段先走普通消息流 / service message
  - 后续若 review 交互复杂度提升，再单独抽 review UI

## Follow-up Backlog

- [ ] 把 Codex capability surface 从 Claude 兼容心智中彻底拆出来
  - 背景：`scripts/sync-ecc-to-codex.sh` 不会把 ECC `commands/` 安装成 Claude 风格插件命令；它会把命令生成为 `~/.codex/prompts/ecc-*.md`，skills 则由 Codex 直接从 `~/.agents/skills/` 读取。
  - 当前问题：Happy 前端很多地方仍把 Codex 当成“会提供 `slashCommands` 的 Claude 变体”，导致已安装的 prompts / skills / agents 在 Codex 会话里显示不完整或语义错位。
  - 目标：定义一套明确的 `codex surface` 模型，至少包含 `prompts`、`skills`、`agents`、`mcpServers`，不要继续把所有能力硬塞进 `slashCommands`。

- [ ] 调研 Codex 原生 prompt / command surface 的可执行语义，而不只是展示
  - 需要确认 `~/.codex/prompts/*.md` 在 Codex CLI / app-server 中到底是：
    - 仅作为 starter prompt / prompt library
    - 还是存在可枚举、可触发、可参数化执行的正式协议
  - 只有确认执行语义后，才能决定 Happy 的输入框是否应该把这些项渲染成“可发送命令”，还是“可插入 prompt 模板”。

- [ ] 将会话页、命令面板、设置页对 Codex 的展示统一到同一份 metadata contract
  - 避免出现：
    - 会话信息页能看到 skills，但命令面板看不到 prompts
    - 设置页展示 MCP，session 页不展示
    - 不同页面各自扫描本地目录，造成状态漂移
  - 建议后续把 Codex surface 收口到共享 schema，并加旧 CLI fallback。

- [ ] 为 Codex 安装方式补一条产品内说明
  - 明确告诉用户：
    - ECC for Codex 的 skills 来自 `~/.agents/skills/`
    - ECC 兼容命令会落到 `~/.codex/prompts/`
    - 它不是 Claude 插件市场那套 `commands/skills/plugins` 目录模型
  - 否则用户会继续误以为“没显示就是没安装成功”。
