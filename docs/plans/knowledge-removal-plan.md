# 知识库子系统移除方案

Status: **ready** · Created 2026-07-26

## 决策依据

记忆职责已迁移到显式文档体系（CONTEXT.md + 75 个 ADR + backlog.md + CLAUDE.md + skills）。
知识库自 2026-05-24 起零写入，46 个项目中 0 个启用（`knowledgeConfigResolver.ts:30`
默认 `enabled: false`），同期 136 个会话未触发任何注入。

同时确认已失效的关联系统：

| 系统 | 最后活动 | 处置 |
|---|---|---|
| claude-mem 插件 | 2026-03-08 | 建议卸载（本方案外） |
| 原生记忆文件 | 2026-05-18 | 保留（成本为零） |
| `memory_recall` 事件 | 累计 1 次真实触发 | 保留转发代码（25 行） |
| SupervisorRun | 近 30 天 0 次 | 仅摘除知识库依赖，不动 Supervisor |

## 移除总量

| 层 | 专属文件（整删） | 行数 | 需改文件 |
|---|---|---|---|
| App | 23 | 5,492 | 51（含 11 份 i18n × 181 条） |
| CLI | 5 | 841 | 25 |
| Wire | 1 | 193 | 7 |
| Server | 33 | ~6,460 | 18 |
| **合计** | **62** | **~12,990** | **101** |

外加：4 张表、6 个迁移、`Project.knowledgeConfig` 字段、`Skill.sourceKnowledgeId` 字段。

## 前置：数据归档（阶段 0）

`ProjectKnowledge.content` 的 schema 注释写 `Encrypted`，但实测为**明文**，可直接 SQL 导出。

```bash
docker exec happy-postgres-1 psql -U postgres -d handy -At -F$'\t' -c "
SELECT p.\"displayName\", k.\"entryType\", k.confidence, k.\"createdAt\"::date, k.title, k.content
FROM \"ProjectKnowledge\" k JOIN \"Project\" p ON p.id = k.\"projectId\"
WHERE k.status = 'active' ORDER BY p.\"displayName\", k.\"createdAt\";
" > /tmp/knowledge-export.tsv
```

写一个 ~20 行脚本把 TSV 转成按项目分文件的 markdown。**127 条 active 条目**
值得归档；其余 323 条（archived/superseded）跳过。

验收：归档文件存在，条目数 = 127。

> **归档位置（2026-07-29 更新）**：归档文件最初落在 `docs/archive/knowledge/`，
> 但内容按**机器上的项目绝对路径**分文件，包含本仓库之外的私人项目
> （量化策略、个人 Obsidian 仓库等）及本机目录结构，不适合进版本控制。
> 已整体移出仓库到 `~/Documents/happy-knowledge-archive/`（仅本机，不再跟踪）。

---

## 阶段 1 — App

**目标**：UI 入口和数据层全部摘除，App 编译通过。先做 App 是因为它是纯消费端，
删掉不影响任何其他包。

### 1.1 整删目录/文件（23 个）

```
sources/app/(app)/knowledge/                        # search.tsx
sources/app/(app)/project/[id]/knowledge/           # evolution.tsx
sources/components/knowledge/                       # 7 个文件，含 SessionKnowledgeSheet.tsx (832 行)
sources/components/project/KnowledgeEntryCard.tsx           (721)
sources/components/project/ProjectKnowledgeTab.tsx          (645)
sources/components/project/KnowledgeLifecycleTrendChart.tsx (250)
sources/components/project/KnowledgeEvolutionView.tsx       (111)
sources/components/project/config/KnowledgeConfigSection.tsx(442)
sources/hooks/useProjectKnowledge.ts                        (469)
sources/hooks/useSessionKnowledgeAccesses.ts                (264)
sources/hooks/useSessionKnowledge.ts                        (158)
sources/hooks/useKnowledgeSearch.ts                         (138)
sources/hooks/useProjectKnowledgeConfig.ts                  (132)
sources/hooks/useKnowledgeEvolution.ts                      (122)
sources/hooks/sessionKnowledgeState.ts + .test.ts
```

### 1.2 改动点（按风险排序）

**Tab 注册**（会影响布局，先做）
- `components/project/projectDetailTabs.ts` — 移除 knowledge tab 项
- `components/project/projectDetailTabPresentation.ts` — 移除对应展示配置
- `components/session/sessionPanelTabs.ts` — 移除 knowledge 面板项
- 同步更新 4 份测试：`projectDetailTabs.test.ts`、`sessionPanelTabs.test.ts`（18 处）、
  `mobileSessionPanelState.test.ts`、`SessionSidePanel.test.ts`

**容器组件**
- `-session/SessionView.tsx`（17 处）— 移除 Sheet 挂载与触发
- `components/ChatHeaderView.tsx`（11 处）— 移除入口按钮
- `components/project/ProjectDetailView.tsx`（10 处）
- `components/session/SessionSidePanel.tsx`（9）、`MobileSessionPanelSheet.tsx`（8）、
  `SidePanelSummaryTab.tsx`（4）
- `components/project/ProjectProfileCard.tsx`（6）— ProjectProfile 一并移除
- `components/project/ProjectConfigTab.tsx`（2）— 移除 KnowledgeConfigSection 引用
- `app/(app)/_layout.tsx`（2）— 注销两条路由
- `app/(app)/project/[id].tsx`（1）、`app/(app)/settings/features.tsx`（9）

**同步层**
- `sync/storage.ts`（12）、`sync/syncEphemeralHandlers.ts`（13）、
  `sync/ingest/syncEphemeralIngest.ts`（13）+ 其 test（13）
- `sync/apiTypes.ts`（6）、`sync/ops.ts`（4）、`sync/settings.ts`（3）、
  `sync/localSettings.ts`（3）、`sync/apiSkills.ts`（2）、`sync/apiClaudeControl.ts`（2）
- `components/tools/knownTools.tsx`（5）— 移除 `query_project_knowledge` 工具展示

**i18n**：11 份文件各删 181 条 key（`_default.ts` + 10 种语言）。
建议脚本化：先从 `_default.ts` 提取 knowledge 相关 key 列表，再逐文件删除，
避免手工遗漏导致 `t()` 运行时报错。

### 1.3 验收

```bash
yarn workspace happy-app typecheck
yarn workspace happy-app test
grep -ri "nowledge" packages/happy-app/sources --include="*.ts" --include="*.tsx" | grep -v acknowledge
```
最后一条应无输出（注意排除 `acknowledge` 误伤）。

**提交点**：`refactor(app): remove knowledge base UI and data layer`

---

## 阶段 2 — CLI

**目标**：停止采集与注入。此时 Server 仍在跑，API 只是没人调。

### 2.1 整删（5 个文件，841 行）

```
src/knowledge/                       # index.ts, knowledgeClient.ts (221),
                                     # turnCollector.ts (229), repoMapGenerator.ts (271)
src/claude/remoteKnowledgeHelpers.ts (115)
```

### 2.2 改动点

**最大的一处**：`claude/claudeRemoteLauncherCore.ts` — **115 处引用**。
这是本阶段的主要风险点，建议单独一个 commit。摘除内容：
TurnCollector 生命周期、fetch-knowledge 调用、注入拼接、repo-map 生成触发。
⚠️ 注意保留同文件 2186-2210 行的 `memory_recall` 转发逻辑 —— 那是原生记忆，与本次移除无关。

**其余**
- `codex/runCodex.ts`（14）— Codex 侧同样的采集链路
- `claude/utils/startHappyServer.ts`（8）+ test（14）— MCP `query_project_knowledge` 注册
- `api/apiSession.ts`（11）、`api/apiMachine.ts`（7）、`api/types.ts`（3）
- `claude/utils/generateHookSettings.ts`（5）+ test（5）— 采集 hook
- `modules/common/registerMcpHandlers.ts`（4）
- `supervisor/buildResearchPrompt.ts`（3）— 提示词里的知识引用
- `claude/utils/mcpServerManager.ts`（2）、`utils/progressAutomation.ts`（2）
- 单处引用：`claudeRemote.ts`、`systemPrompt.ts`、`claudeControlHandlers.ts`、
  `happyMcpStdioBridge.ts`、`startDaemon.ts`、`machineRpcRoutes.ts`、
  `sessionCryptoCodec.ts`、`SessionTranscriptScanner.ts`、`AutoDreamCoordinator.ts`
- 测试：`CodexAppServerClient.test.ts`（3）、`claudePtyController.test.ts`（4）、
  `claudeControlHandlers.test.ts`（3）

### 2.3 Wire（与 CLI 同批，因 CLI 依赖它）

- 整删 `src/knowledge.ts`（193 行）
- 改 `src/index.ts`（移除 re-export）、`happyMcp.ts`（8 处，移除 MCP 工具定义）+
  `happyMcp.test.ts`（3）、`inbox.ts`（1）、`skills.ts`（2）、
  `claudeControlRpc.ts`（1）、`sessionState.test.ts`（1）

### 2.4 验收

```bash
yarn workspace @kmmao/happy-wire build
yarn workspace @kmmao/happy-coder build && yarn workspace @kmmao/happy-coder test
```
CLI 测试必须先 build（daemon 直接跑产物）。

**提交点**：`refactor(wire,cli): remove knowledge collection and injection`

---

## 阶段 3 — Server

**目标**：API 与后台任务下线。表还在，数据还在，可回滚。

### 3.1 整删（33 个文件，~6,460 行）

```
sources/modules/knowledge*.ts + *.spec.ts     # 26 个，4,128 行
sources/modules/embeddingService.ts + .spec.ts # 仅服务知识库，已确认无其他调用方
sources/app/api/routes/knowledgeRoutes.ts          (995)
sources/app/api/routes/knowledgeLifecycleRoutes.ts (263)
sources/app/api/routes/knowledgeSearchRoutes.ts    (163)
sources/app/api/routes/knowledgeConfigRoutes.ts    (120)
sources/app/api/socket/knowledgeHandler.ts         (398)
sources/scripts/backfillKnowledgeEmbeddings.ts     (94)
```

### 3.2 改动点

- `app/api/api.ts`（13）— 注销 4 个路由族
- `app/events/syncEphemeral.ts`（13）+ spec（2）— 移除 knowledge ephemeral 通道
- `app/api/socket/machineUpdateHandler.ts`（9）+ spec（6）
- `app/api/supervisor/supervisorRunStatusApply.ts`（5）— **删除 `contributeSupervisorKnowledge`
  调用**（唯一引用点，`:57`）。Supervisor 本体不动。
- `app/api/routes/skillRoutes.ts`（5）— `sourceKnowledgeId` 相关逻辑
- `app/api/socket/sessionVersionedFieldUpdate.ts`（4）
- `app/api/socket.ts`（2）、`registerSocketEvent.ts`（2）、`machineVersionedUpdate.ts`（2）、
  `app/events/eventRouter.ts`（2）
- `app/api/ownership.ts`（1）、`routes/inboxRoutes.ts`（1）、
  `modules/inboxCreate.ts`（1）、`routes/supervisorRoutes.spec.ts`（2）
- `modules/projectDedup.ts`（1）— **只删数组里的 `"ProjectKnowledge"` 字符串**
  （`:64`），文件保留（main.ts 在用）
- `modules/knowledgeLifecycleScheduler.ts` 的启动注册点 — 检查 `main.ts`

### 3.3 验收

```bash
yarn workspace happy-server typecheck && yarn workspace happy-server test
```
启动服务，确认 App（阶段 1 已改）能正常连接、项目页无 404。

**提交点**：`refactor(server): remove knowledge API, modules and scheduler`

---

## 阶段 4 — 数据库

**目标**：不可逆步骤。**必须在阶段 0 归档完成、阶段 1-3 已合并并稳定运行数日后执行。**

### 4.1 schema.prisma 改动

删除 4 个 model：
- `ProjectKnowledge`（807-861，55 行）
- `KnowledgeRelation`（867-885，19 行）
- `KnowledgeAccess`（891-917，27 行）
- `ProjectProfile`（919-929，11 行）

删除其他 model 中的引用：
- `:164` `Session.knowledgeAccesses KnowledgeAccess[]`
- `:473` `Project.knowledgeConfig String?`
- `:485` `Project.knowledgeEntries ProjectKnowledge[]`
- `:486` `Project.profile ProjectProfile?`
- `:1017` `Skill.sourceKnowledgeId String?` — **表内 0 条记录，安全删除**

### 4.2 生成迁移

```bash
yarn workspace happy-server generate
```
⚠️ 项目规则：**绝不手写迁移**，只能通过 `yarn generate`。

### 4.3 pgvector 扩展

`vector(1024)` 仅用于 `ProjectKnowledge.embedding`。删表后 extension 可保留
（不占资源，未来可能复用），不必额外处理。

### 4.4 验收

```bash
yarn workspace happy-server typecheck && yarn workspace happy-server test
docker exec happy-postgres-1 psql -U postgres -d handy -c "\dt" | grep -i knowledge   # 应无输出
```

**提交点**：`refactor(server): drop knowledge tables (migration)`

---

## 回滚策略

阶段 1-3 均为纯代码删除，`git revert` 即可，数据完好无损。
**阶段 4 一旦执行，450 条数据永久丢失** —— 这是唯一的单向门，
所以阶段 0 的归档是它的硬前置。

## 建议节奏

阶段 1-3 可在一天内连续完成（各自独立提交），阶段 4 隔几天再做，
留出发现遗漏的窗口期。
