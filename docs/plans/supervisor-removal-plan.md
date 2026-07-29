# Supervisor 子系统下线方案

Status: **proposed**（待决策——分层范围需要拍板）· Created 2026-07-29

## 摘要

Supervisor 是 89 个文件、23621 行的子系统，其核心价值主张 analyze → fix →
re-analyze autopilot **在整个生命周期中一次都没有成功走通过**。唯一被真实使用的
是它的 research trigger（一次性深度调研出报告），而那个能力今天用一个普通会话
加一段 prompt 就能达成。

保留 AgentLoop 通用底座（38 文件 / 9968 行），移除 supervisor role 及其全部专属实现。

## 决策依据——生产库实测

查询时间 2026-07-29，库 `handy`。

### autopilot 主线从未闭环

| 指标 | 值 |
|---|---|
| SupervisorAction 总数 | 31（21 pending 从未处理 / 10 approved） |
| 10 个 approved 的 fixStatus | **全部 `failed`** |
| 真正 spawn 出 fix session（`fixSessionId` 非空） | **0** |
| 开出 issue（`issueUrl` 非空） | **0** |

「批准一个发现 → 自动开会话修复 → 再分析验证」这条链路，0 次成功。

### loop 引擎从未驱动过任何一次运行

| 指标 | 值 |
|---|---|
| `AgentLoop` where role='supervisor' | **0 行** |
| `SupervisorRun` 带 `loopId` | **0 行** |
| `AgentLoop` where role='generic' | 1 行（2026-06-24） |

`supervisorLoopEngine.ts`（1071 行）+ 相关 UI（约 2000 行）从未产出过一条记录。
ADR-0022 Phase 2–4 把 SupervisorLoop 迁移进 AgentLoop 的工作全部完成了，
但迁移后的新路径一次都没被使用。

### 运行量已归零两个月

| 月份 | SupervisorRun |
|---|---|
| 2026-03 | 62 |
| 2026-04 | 49 |
| 2026-05 | 24（最后一条 05-27） |
| 2026-06 起 | **0** |

status 分布：completed 104 / cancelled 24 / failed 7。
47 个 Project 中仅 **2 个**配置了 `supervisorConfig`。

### 实际被使用的是 research，不是 supervisor

19 份有 `reportContent` 的 run，内容全部是**竞品调研报告**（Octogent 对比、
Warp 生态分析、远程 AI 编程代理赛道全景），来自 `trigger='research'`。
healthScore 普遍 16–30——即"项目健康分析"这个设计意图从未产生有意义的输出。

trigger 分布：manual 65 / scheduled 45 / research 25。

**结论**：这个子系统真正交付的价值是"给我跑一次深度调研并写成报告"，
而非 autopilot。该能力不需要 15000 行基础设施承载。

## 保留边界：AgentLoop 底座不动

ADR-0022 确立 AgentLoop 为唯一持久自治原语，supervisor 只是它的一个 `role`。
拆除耦合极浅：

| 文件 | 对 supervisor 的依赖 |
|---|---|
| `agentLoopEngine.ts`（785 行） | **仅注释，零代码依赖** ✅ |
| `agentLoopRoutes.ts`（397 行） | 4 处 `if (loop.role === "supervisor")` 分派 |
| `AutomationRunner.ts`（CLI） | 4 路分派器中的 1 路（`job.kind === "supervisor"`） |
| `automation/types.ts` | `AutomationJobKind` 联合类型的 1 个成员 |

保留：38 文件 / 9968 行（server `agentLoopEngine` + `agentLoopRoutes` +
`agentLoopSuggestRoutes`，CLI `automation/AgentLoop*`，wire `agentLoop.ts`，
`AgentLoop` 表）。

## 移除分层——按证据强度排序

三层可独立执行，也可只做前一两层。

### 层 1 — Loop autopilot（11 文件 / 3568 行）

**证据：0 条数据，从未运行。**

- Server: `supervisorLoopEngine.ts`(1071)、`supervisorLoopRoutes.ts`(457)、
  `supervisorLoopBrief.ts`(136)、`supervisorLoopPhaseLogic.ts`(142)、
  `supervisorAutoLoop.ts`(205) + 各自 spec
- App: `supervisor-loop/[loopId].tsx`(648)、`SupervisorLoopConfigPanel.tsx`(697)、
  `SupervisorLoopStatusCard.tsx`(397)、`SupervisorLoopHistoryItem.tsx`(250)
- 改：`agentLoopRoutes.ts` 删 4 处 role 分支；`AgentLoop` 表删 supervisor-role 列；
  wire `agentLoop.ts` 删 supervisor-role 字段段

风险：**最低**。零数据、零用户。

### 层 2 — Fix / Action 审批流（20 文件 / 4591 行）

**证据：10 次批准全部失败，0 次产生 fix session，0 次开 issue。**

- Server: `supervisorActionRoutes.ts`(750)、`supervisorFixStatusLogic.ts`(243)、
  `supervisorFixStatusHandler.ts`(141)、`supervisorFixWatchdog.ts`(143)、
  `supervisorFixTrigger.ts`(92)、`supervisorAutoApproval.ts`(210)、
  `supervisorActionResurfacing.ts`(110)、`supervisorActionLogic.ts`(66) + spec
- CLI: `buildFixPrompt.ts`(317)、`diagnoseFixStatus.ts`、`mergeQueue.ts`
- App: `SupervisorActionCard.tsx`(963)、`supervisor-actions.tsx`(49)
- 表: `SupervisorAction`（31 行，无一成功）

风险：**低**。功能实际处于损坏状态，移除即修复"看起来能用其实不能"的误导。

### 层 3 — 分析 / 报告 / 配置（58 文件 / 15462 行）

**证据：104 次 completed，但 2026-05-27 后归零；47 个项目中仅 2 个启用。**

- Server: `supervisorRoutes.ts`(306)、`supervisorRunRoutes.ts`(517)、
  `supervisorReportRoutes.ts`(361)、`supervisorAnalyticsRoutes.ts`(243)、
  `supervisorDimensionRoutes.ts`(398)、`supervisorScheduler.ts`(207)、
  `supervisorRunTrigger.ts`(100)、`supervisorRunStatusApply.ts`(490)、
  `supervisorConfig.ts`(135)、`supervisorScoring.ts`(63) 等
- CLI: `handleSupervisorTrigger.ts`(931)、`buildSupervisorPrompt.ts`(340)、
  `buildResearchPrompt.ts`(318)、`dimensionTemplates.ts`(258)、`preflightSync.ts`(352)
- App: `supervisor-settings.tsx`(2180)、`apiSupervisor.ts`(1190)、
  `ProjectSupervisorTab.tsx`(740)、`supervisor-run/[runId].tsx`(716) 等
- 表: `SupervisorRun`(135)、`SupervisorDimension`；
  `Project.supervisorConfig` + `Project.supervisorEnabledDimensions` 两列
- 改：`ProjectDetailView.tsx` 摘掉 Supervisor tab；
  `machineHeartbeatScans.ts` 摘掉 `checkAndTriggerScheduledRuns`；
  wire `inbox.ts` 的 `"supervisor"` category；i18n 键清理

风险：**中**。需先决定 research 能力如何承接（见下）。

## 前置：数据与能力承接

### 归档 19 份调研报告

`SupervisorRun.reportContent` 为明文，可直接导出：

```bash
docker exec happy-postgres-1 psql -U postgres -d handy -At -F$'\t' -c "
SELECT \"createdAt\"::date, coalesce(\"reportTitle\",'untitled'), \"reportContent\"
FROM \"SupervisorRun\" WHERE \"reportContent\" IS NOT NULL ORDER BY \"createdAt\";
" > /tmp/supervisor-reports.tsv
```

内容是关于 Happy 自身的竞品调研，无个人数据，可留在仓库
（建议 `docs/archive/research/`）。**注意**：与知识库归档不同，那批因含
其他项目的私人内容已于 2026-07-29 移出仓库；本批无此问题，但导出后仍应扫一遍。

### research 能力的替代

25 次 research trigger 是这个子系统唯一的真实产出来源。承接方式（按成本排序）：

1. **一个 skill / prompt 模板**——把 `buildResearchPrompt.ts`(318 行) 的提示词
   固化成 `.claude/skills/` 下一个 skill，用普通会话跑。成本 ~0，覆盖已发生的全部用例。
2. 保留 research trigger 的最小 HTTP 入口，砍掉 dimension / scoring / action 全套。
3. 什么都不做——需要时手写 prompt。

推荐 1。

## 受影响的 ADR

6 份 ADR 是 supervisor 专属，随移除作废（标记 superseded，不删）：

- ADR-0043 scoring-credentials-zero-variance-extracted
- ADR-0047 supervisor-decision-flow-split-is-intentional
- ADR-0054 fixstatus-lifecycle-one-seam
- ADR-0059 supervisorconfig-json-blob-has-one-owner
- ADR-0060 supervisor-session-deactivation-one-seam
- ADR-0064 fix-action-payload-projection-one-seam

ADR-0022 需补一段说明：吸收工作已完成，但 supervisor role 因零使用而下线，
AgentLoop 保留为唯一 role=generic 的原语。

`CONTEXT.md` 需删除 Supervisor / SupervisorRun / SupervisorLoop /
SupervisorAction / SupervisorConfig 五个词条并调整关系图。

## 执行顺序

各阶段独立可发布，建议按层倒序无关性执行：

| 阶段 | 内容 | 前置 |
|---|---|---|
| 0 | 导出 19 份报告 + research prompt 固化为 skill | — |
| 1 | 层 1 Loop（3568 行） | 无 |
| 2 | 层 2 Fix/Action（4591 行） | 无 |
| 3 | 层 3 分析/报告（15462 行） | 阶段 0 |
| 4 | 数据表 drop + ADR/CONTEXT 收尾 | 1–3 |

数据表迁移必须用 `prisma migrate diff` 生成，不可手写 DDL
（见 `packages/happy-server/CLAUDE.md`）。

## 验收

- `git ls-files | grep -i supervisor` 仅剩迁移文件与 superseded ADR
- `yarn workspace happy-server typecheck` / `happy-app typecheck` 通过
- server + CLI + agent 测试全绿（注意 app 有 4 个 `autoCompact` 预先存在失败，
  CLI 有 1 个 codex `service_tier` 环境失败，与本次无关）
- AgentLoop generic 路径回归：创建 → 触发 → 迭代回调 → 停用
- i18n audit 无新增未翻译键
