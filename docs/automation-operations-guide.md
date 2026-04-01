# Automation / Agent Loop 操作手册

> 面向使用者与后续接手者的实操文档  
> 更新日期：2026-04-01

## 适用范围
这份文档聚焦 Happy 当前已经落地的自动化能力，覆盖：
- daemon automation 控制面
- generic `happy loop` 自主循环
- guardian continuity（守护会话连续性）
- recovered session（重启后的保守恢复）
- CLI 与 App UI 的主要操作入口

如果你想看实现状态与架构关系，优先看：
- `docs/plans/automation-loop-platform.md`
- `docs/plans/agent-loop-system.md`

## 一句话理解当前系统
Happy 现在的“自动化 / 自主 loop”不是独立旁路工具，而是构建在同一套 daemon automation runtime 之上的统一系统。

也就是说：
- supervisor 自动化
- webhook 自动化
- generic agent loop 自动化

本质上都共享：
- 同一个 job scheduler
- 同一个 session 跟踪模型
- 同一个 guardian continuity 模型
- 同一个 audit / stats / UI 可观测面

## 当前已经能做什么

### 1. 管理通用自主循环
可以通过 `happy loop` 管理一个长期运行的自主 agent loop：
- 创建 loop
- 查看 loop 列表
- 查看单个 loop 详情
- 更新 prompt / path / interval / agent / profile / env vars
- 暂停 / 恢复
- 立即触发一次
- 删除 loop

常用命令：
- `happy loop create --path <repo> --interval 10m --prompt "check repo and propose next step"`
- `happy loop list`
- `happy loop show <loopId>`
- `happy loop update <loopId> --prompt "..."`
- `happy loop pause <loopId>`
- `happy loop resume <loopId>`
- `happy loop run-now <loopId>`
- `happy loop remove <loopId>`

### 2. 观察自动化执行状态
可以通过 daemon automation 查看：
- 最近 jobs
- 当前 running / dispatching / queued 状态
- guardian 会话连续性
- automation audit 事件
- timeline
- recovered session 统计

常用命令：
- `happy daemon automation list`
- `happy daemon automation timeline`
- `happy daemon automation stats`
- `happy daemon automation audit`
- `happy daemon automation guardians list`

### 3. 针对异常进行操作
可以直接操作自动化任务与 guardian：
- 停止某个 running job 对应的 session
- 取消 queued job
- 清理 terminal jobs
- 清空 guardian continuity
- 清空 audit log

常用命令：
- `happy daemon automation stop <jobId>`
- `happy daemon automation cancel <jobId>`
- `happy daemon automation clear`
- `happy daemon automation guardians clear --all`
- `happy daemon automation audit clear`

### 4. 观察恢复后的会话
Happy 现在已经支持保守的 restart recovery，可观察：
- 哪些 job 是 recovered
- 哪些 guardian 是 recovered
- 有多少 session 是 daemon 重启后重新挂回来的

常用命令：
- `happy daemon automation list --recovered`
- `happy daemon automation guardians list --recovered`
- `happy daemon automation audit --recovered`
- `happy daemon automation stats`

## App 里的主要入口

### Machine Automation 页面
路径概念上是：
- Machine → Automation

这里能做：
- 看 jobs / guardians / guardian usage / audit / timeline
- 搜索具体 loopId / projectId / sessionId / guardianKey
- 按 running / failed / terminal / recovered 过滤 job
- 按 attached / persisted / recovered 过滤 guardian
- 按 anomalies / guardian / jobs / recovered 过滤 audit
- 停止、重试、取消任务
- 清理 terminal jobs、guardian continuity、audit log

### Machine Loops 页面
路径概念上是：
- Machine → Loops

这里能做：
- 创建 loop
- 编辑 loop
- 配置高级参数（agent / projectId / profileId / env vars）
- pause / resume / run-now / remove
- 打开最近 session
- 跳转到该 loop 对应的 automation history

## Guardian Continuity 是什么
Guardian continuity 可以理解为“同一条自动化上下文复用之前的守护会话”。

它的作用是：
- 避免每次自动化都从完全全新的上下文开始
- 让连续分析/修复有持续性
- 对 loop 来说，默认按 `agent-loop:<loopId>` 做隔离

当前系统中的表现：
- guardian 可被 remember / reuse / clear
- guardian 会在 CLI / App UI / audit 里可见
- 如果 daemon 重启，guardian 不会被激进乱挂回，而是遵守保守恢复策略

## Recovered Session 是什么
Recovered session 指的是：
- daemon 重启后
- Happy 发现某个之前已经被索引过的 live session 其实还活着
- 并且有足够证据证明它仍然是原来的 Happy 会话
- 于是把它重新挂回自动化运行态

当前采用的是保守恢复，而不是激进恢复。

### 当前恢复会检查什么
通常会检查：
- 该会话之前是否已经被 daemon 本地索引过
- 对应 PID 是否还活着
- 该进程是否仍然看起来像 Happy 进程
- 如果有 tmux session identifier，tmux 目标是否还存在
- 如果旧 PID 已失效，是否还能从 tmux pane 反查当前 pane PID
- 进程年龄是否与持久化记录大致匹配

### 当前不会做什么
当前不会做：
- 全局扫描并猜测所有旧会话
- 没有 daemon 本地证据就强行恢复
- 恢复来源不明的 guardian / session

## 常见运维动作

### 看当前自动化整体健康
建议顺序：
1. `happy daemon automation stats`
2. `happy daemon automation list`
3. `happy daemon automation audit`

重点关注：
- `watchdog stops`
- `stop requests`
- `sessions reattached`
- guardian reuse rate
- failed / running job 数量

### 看某个 loop 的实际执行情况
建议顺序：
1. `happy loop show <loopId>`
2. `happy daemon automation list --loop <loopId>`
3. `happy daemon automation audit --loop <loopId>`

如果在 App 中操作：
- 进入 Machine → Loops
- 选中该 loop
- 跳转到 loop 对应的 automation history

### guardian 状态不对，想强制从头开始
如果你怀疑 guardian continuity 已污染：
- App 中清理 guardian
- 或 CLI 执行 `happy daemon automation guardians clear --all`

这样下一次自动化会从更“干净”的上下文重新起步。

### daemon 重启后想看是否恢复成功
建议顺序：
1. `happy daemon automation stats`
2. `happy daemon automation audit --recovered`
3. `happy daemon automation list --recovered`

如果恢复成功，通常会看到：
- `sessions reattached` 大于 0
- audit 中出现 `session_reattached`
- recovered jobs / guardians 在 CLI 或 UI 中有标记

## 故障排查

### 现象：loop 已创建但没有继续跑
优先检查：
- loop 是否 `enabled`
- 当前是否已有同 loop 的 queued / dispatching / running job
- `nextRunAt` 是否已经到期
- daemon 是否仍在运行

### 现象：running job 卡住
优先检查：
- `happy daemon automation list`
- `happy daemon automation audit`
- 是否存在 watchdog stop
- 是否需要 `happy daemon automation stop <jobId>`

### 现象：daemon 重启后没恢复会话
可能原因：
- 该会话之前未被 tracked session registry 索引
- 旧 PID 已失效且 tmux 无法反查 pane PID
- tmux session 已不存在
- 进程看起来不再像 Happy 进程
- 进程年龄与持久化记录不匹配，触发保守拒绝

### 现象：感觉 recovered 数量不对
建议同时看三处：
- `happy daemon automation stats`
- `happy daemon automation audit --recovered`
- App 的 Machine → Automation recovered 过滤视图

## 对后续开发者的建议
如果你要继续开发这一块，建议优先从这些文件入手：
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/automation/AutomationScheduler.ts`
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/automation/AgentLoopRunner.ts`
- `packages/happy-cli/src/daemon/TrackedSessionRegistry.ts`
- `packages/happy-cli/src/utils/tmux.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/automation.tsx`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

最重要的原则有两个：
- 不要再造第二套 autonomous runtime
- 不要为了“更智能恢复”而破坏当前保守恢复的安全边界
