# 意图驱动开发工作站 — 落地方案（Grounded PRD）

> 状态：待审阅 · 作者：AI 架构师 · 基线核实日期：2026-07-12
>
> 本文档基于对代码库的**实际核实**编写，纠正了原始需求中若干与代码不符的前提。
> 每一处"改哪里"都指向真实文件，未落实的部分明确标注 **净新建**。

## 0. 前提纠偏（Reality Check）

| 原始需求引用的"现有基础设施" | 代码库实际情况 | 结论 |
|---|---|---|
| `claude-stop-notify` hook 及其**拦截链路** | `scripts/claude-stop-notify/` 下的独立 shell 脚本，向 `~/.claude/settings.json` 注入 Stop hook 发 ntfy 推送。**无拦截链路、不接 WebSocket、与权限审批无关**。 | Auto Mode **不基于**它。真实锚点见下。 |
| 现有**目标分解引擎 / 角色引擎** | 不存在产品级引擎。`/goal` 是 Claude Code 的 dev skill；`.happy/agent-loops/` 是自主循环运行产物；`subagentStatus.ts` 仅展示 Claude 原生 subagent 状态。 | Phase 5 基本是**净新建**。 |
| `.agents/skills` 智能路由引擎 | 仅两个 Claude Code `SKILL.md`（agent-browser、terminal-emulator）。真实技能子系统在 `happy-wire/skills.ts` + app `(app)/skills/`。 | Phase 3 改真实技能子系统。 |
| 前端"实时语音界面" | **真实存在**：`happy-app/sources/realtime/RealtimeVoiceSession.tsx`。 | Phase 4 锚点有效 ✅ |
| wire 多模态/图片消息 | `messages.ts` **无** image/base64 字段。 | Phase 4 需新增 wire schema。 |

**真实的权限审批链路（Phase 1/2 的正确锚点）：**
- CLI：`happy-cli/src/claude/utils/permissionHandler.ts`
  - `handleToolCall`（L250）= 每个工具调用的唯一闸门
  - `handlePermissionRequest`（L349）= 推请求到 app（`updateAgentState.requests`）+ 推送通知
  - `permission` RPC handler（L713）= 接收 app 的 Approve/Deny
- App：`happy-app/sources/components/tools/PermissionFooter.tsx`（渲染审批 UI）

---

## 1. Phase 1 — Auto Mode 智能分类器（首个垂直切片，推荐先做）

**目标**：安全读操作静默放行，消除权限弹窗疲劳；仅危险命令走审批。

**改动（改真实文件，非 stop-notify）：**
1. `happy-cli/src/claude/utils/` 新增 `autoModeClassifier.ts`：纯函数 `classify(toolName, input): "safe" | "dangerous" | "neutral"`。
   - safe：`Read/Grep/Glob/LS/WebFetch/WebSearch` 等只读工具；`Bash` 中匹配只读命令白名单（`ls/cat/grep/git status/git diff...`）。
   - dangerous：`Bash` 破坏性命令（`rm -rf`、`git push`、`curl | sh`、写系统路径…）、`Write/Edit` 到关键路径。
   - 复用已有 `getToolDescriptor` 的 `edit`/`exitPlan` 标记。
2. `permissionHandler.ts` `handleToolCall`：在第 326 行"Approval flow"之前插入——当 `permissionMode === "auto"` 且 `classify()==="safe"` → 直接 `allow`；`"dangerous"` → 强制走 `handlePermissionRequest`（即使被 preAllow 也可选升级审批）。
3. `handlePermissionRequest` 的 `updateAgentState.requests[id]` 增加 `riskLevel` / `classifierReason` 字段，供 app 高亮危险请求。

**wire 同步**：`happy-wire` 中承载 `requests[id]` 形状的 schema（`sessionState.ts` / `messages.ts` 的 AgentState 相关）新增可选字段 `riskLevel?: "safe"|"dangerous"|"neutral"`、`classifierReason?: string`（可选字段=向后兼容）。

**验收**：本地 `happy` 会话下，`auto` 模式读操作不弹窗，`rm -rf` 触发 app 审批卡片并显示危险原因。

---

## 2. Phase 2 — 审查驱动移动端审批闭环

**A. 高危审批 UI（大部分已存在，做增量）**
- `PermissionFooter.tsx`：读取 Phase 1 的 `riskLevel`，危险请求红色高亮 + 显示 `classifierReason`。Approve/Deny 经现有 `permission` RPC 回传（已有）。

**B. PR Diff 移动端审查（净新建）**
- `happy-server`：新增路由 `githubPrDiff`（`sources/app/api/routes/`），服务端用 `gh`/GitHub API 拉取指定 PR 的 diff（token 存服务端，不下发）。
- `happy-wire`：新增 `githubPr.ts` — `PrDiffRequestSchema` / `PrDiffResponseSchema`。
- `happy-app`：新增组件 `components/tools/PrDiffView.tsx` + 会话内入口，渲染 diff（复用现有代码高亮）。

**验收**：Agent `gh pr create --draft` 后，app 出现可点开的 PR diff 视图。

---

## 3. Phase 3 — 技能 Front-matter 路由引擎

**改真实技能子系统：**
1. 定位并重构 skill 内容解析处（`content: string` 的消费方 + server 端注入 `SkillContent`）。新增 `parseSkillFrontmatter(content)` → `{ frontmatter, body }`（YAML front-matter）。
2. `happy-wire/skills.ts`：`SkillSummarySchema` / `SkillContentSchema` 新增可选字段：
   - `model?: string`（如 `haiku`）
   - `userInvocable?: boolean`（默认 true）
   - `disableModelInvocation?: boolean`（默认 false）
3. **model 动态路由**：Agent 执行技能时，若 `frontmatter.model` 存在 → 覆盖本次调用模型（降级到便宜模型）。落点在 CLI 组装 Claude 调用参数处。
4. **调用约束**：`userInvocable:false` 或 `disableModelInvocation:true` 的技能，Auto Mode 下分类器（Phase 1）直接拒绝模型自主调用，仅允许 app 手动触发。

**验收**：含 `model: haiku` 的技能执行时实际走 haiku；`disable_model_invocation: true` 技能模型无法自调。

---

## 4. Phase 4 — 视觉意图注入引擎

1. `happy-wire/messages.ts`：`SessionMessageSchema` 内容体新增多模态分支 — `ImageContentSchema { type:"image", mediaType, dataRef }`（图片走 S3/加密引用，不塞 base64 进消息体）。
2. `happy-app`：`RealtimeVoiceSession.tsx` 旁新增 HTML/图片投递入口（`expo-image-picker` / 文件选择）。
3. `happy-server`：Harness 上下文组装处，将视觉素材作为 messages array 的多模态 content，与语音指令合并下发给 Agent。

**验收**：投递 Claude Design 的 HTML 原型 + 语音指令，Agent 基于视觉生成/重构组件。

---

## 5. Phase 5 — 确定性 Dynamic Workflows（净新建，最大）

1. **多角色并发编排引擎**（净新建，非"升级"）：构建阶段用 `Promise.all` 并发启动多个带不同角色 prompt 的 sub-agent（Agent A 前端 / Agent B 后端 Prisma）。落点：CLI/agent 侧新增 orchestrator 模块。
2. **工作流持久化**：任务完成后在 `.happy/workflows/` 生成 `.js` 配置，记录每个子代理的 prompt、模型、顺位，可直接 `node run` 复现（100% 确定性）。
3. `happy-wire`：新增 `workflow.ts` — 工作流定义/角色/持久化 schema。

**验收**：一次多角色协作后生成可复跑的 `.happy/workflows/*.js`。

---

## 依赖顺序与 wire 同步纪律

每次改 `happy-wire` → `yarn workspace @kmmao/happy-wire build` → 验证 CLI/Agent/Server/App 下游 build/typecheck。新增字段一律 optional 保向后兼容。

**建议开发顺序**：Phase 1（最小、验证协议闭环）→ Phase 2A → Phase 3 → Phase 2B → Phase 4 → Phase 5。

## 规模与风险提示

- Phase 1/2A/3：真实系统的增量扩展，风险低。
- Phase 2B/4：净新建但边界清晰（服务端拉 PR、多模态消息），中等。
- Phase 5：净新建大型编排系统，最高风险，建议独立里程碑。
- 全部一次性盲开 + 单个草稿 PR 不可行：会产出编译不过、方向存疑的代码，审查成本极高。**逐 Phase 垂直切片 + 逐 Phase 验证**是唯一稳妥路径。
