# Automation / Agent Loop 操作手册

> 面向使用者与后续接手者的实操文档  
> 快速上手建议先读：`docs/manuals/getting-started/happy-loop-operator-manual.md`  
> 最佳实践建议再读：`docs/manuals/best-practices/happy-loop-best-practices.md`  
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

### 4. 观察 loop 运行态
现在 loop 不再只是“启用/暂停”，还会显示运行态和阶段。

你会看到的典型状态包括：
- `idle / sleeping`：等待下一次触发
- `active / planning`：已触发，正在规划
- `active / acting`：已经进入实际执行会话
- `blocked / blocked`：上一轮失败后进入阻塞，需要人工恢复或手动再跑一次
- `paused / paused`：已暂停，不再自动调度

处理 blocked loop 的常见方式：
- 看错误：`happy loop show <loopId>`
- 手动再跑：`happy loop run-now <loopId>`
- 恢复自动调度：`happy loop resume <loopId>`

### 5. 观察恢复后的会话
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

## Happy Loop 的事件唤醒与持久记忆

现在 `happy loop` 除了按周期运行，还支持两块更接近“自主 Agent”的能力：
- **事件唤醒**：loop 可以被外部/手动事件主动唤醒
- **持久记忆**：loop 会在项目目录下维护自己的 `memory.md`

### 事件唤醒怎么用
CLI:
- `happy loop event <loopId> --title "CI failed on main" --source github --details "workflow=test"`
- 如果只想入队事件、稍后再自动处理：
  - `happy loop event <loopId> --title "new issue" --no-auto-run`

App:
- Machine → Loops
- 打开某个 loop
- 选择 **Trigger Event**

事件会进入 loop 的 `recentEvents` 队列，并显示状态：
- `pending`
- `dispatched`
- `completed`
- `failed`
- `cancelled`
- `ignored`

### CI 事件桥接怎么用
要让 loop 对 CI 主动唤醒，需要在 loop 上开启 `ciBridgeEnabled`（CLI `--ci-bridge`，或在 App 的 advanced settings 中开启 CI Bridge）。

CLI 模拟/接入一条 CI 事件：
- `happy loop ci-event --path /path/to/repo --kind workflow_run --workflow "CI" --status completed --conclusion failure --branch main --sha abc123 --details "tests failed"`
- 只投递到单个 loop：
  - `happy loop ci-event --loop <loopId> --kind check_run --check lint --status completed --conclusion failure`

事件进入 loop 后会自动映射 source：
- `workflow_run` → `ci-workflow`
- `check_run` → `ci-check`
- `check_suite` → `ci-suite`
- 其他 → `ci-trigger`

这条桥接和 GitHub webhook bridge 不同：
- GitHub bridge 更偏向 issue / webhook 文本事件
- CI bridge 是面向 pipeline / check / suite 的一等事件模型

### 持久记忆在哪里
每个 loop 会在工作目录下维护：
- `.happy/agent-loops/<loopId>/memory.md`
- `.happy/agent-loops/<loopId>/context.md`

其中：
- `memory.md` 是跨轮次保留的长期记忆
- `context.md` 是本次 wakeup 的上下文快照

### 持久记忆里保存什么
当前保存的核心字段包括：
- Goal
- Current Focus
- Working Memory
- Reflection Summary

这些字段可以从两边维护：
- 你在 CLI / App 中手动编辑 loop 配置
- agent 在循环运行时更新 `memory.md`

当一次 loop session 正常结束后，Happy 会把 `memory.md` 的最新内容同步回 loop 状态。

### CLI 初始化一个更“自主”的 loop
示例：
- `happy loop create --path /path/to/repo --interval 10m --prompt "Continuously watch CI, triage failures, and prepare next actions" --goal "Keep the repo healthy without waiting for manual checks" --focus "Watch CI and flaky tests" --working-memory "Main branch recently had unstable integration tests" --reflection "Start by identifying the highest-signal failures"`

后续你也可以更新这些记忆字段：
- `happy loop update <loopId> --goal "..."`
- `happy loop update <loopId> --focus "..."`
- `happy loop update <loopId> --working-memory "..."`
- `happy loop update <loopId> --reflection "..."`

### 建议的运维习惯
如果你希望 loop 更接近“完全自主”，建议：
1. 把 `goal` 写得长期稳定
2. 让 `currentFocus` 只描述最近一轮最重要的 frontier
3. 把跨轮次需要保留的事实写进 `workingMemory`
4. 每次观察 loop 时优先看：
   - `happy loop show <loopId>`
   - recent events
   - current focus
   - reflection summary
   - blocked reason

## 智能 Loop 推荐

现在 Happy 可以先分析一个项目路径，再给出推荐的自治 loop，而不是每次都要手写。

### CLI 用法
先看推荐：
- `happy loop suggest --path /path/to/repo`

直接落地缺失的推荐 loop：
- `happy loop suggest --path /path/to/repo --create`

如果希望创建后立即跑第一轮：
- `happy loop suggest --path /path/to/repo --create --run-now`

当前推荐器会根据仓库信号生成候选 loop，例如：
- CI Watchdog
- Dependency Hygiene
- Docs Drift
- Runtime Smoke
- Project Guardian

如果同路径下已经存在同名 loop，推荐结果会标记为已配置，不会重复创建。

### App 用法
在 Machine → Loops 页面：
1. 填写或粘贴目标路径
2. 点击 **Suggest Loops / 推荐循环**
3. 查看推荐理由、频率、当前焦点
4. 选择 **Adopt Suggestion / 采纳建议** 落地为真实 loop

这让 Happy 更接近“先理解项目，再帮你搭建自治系统”的工作流。

## 文件变更自动唤醒

现在 loop 可以启用 **File Watch**：当仓库文件发生变化时，Happy 会自动往该 loop 的 event inbox 投递事件，并尝试立即唤醒。

### 怎么开启
CLI 创建时：
- `happy loop create --path /path/to/repo --interval 10m --prompt "..." --file-watch`

CLI 更新时：
- 开启：`happy loop update <loopId> --file-watch`
- 关闭：`happy loop update <loopId> --no-file-watch`

App：
- Machine → Loops
- 编辑某个 loop
- 在高级选项里切换 **File Watch**

### 现在的行为
启用后：
- daemon 会监听 loop 的工作目录
- 文件变化会被聚合成一次事件，而不是每个文件都单独触发
- 事件来源会标记为 `file-watch`
- 如果 loop 当前空闲，会自动入队运行
- 如果 loop 当前已在运行，事件会先排入 `recentEvents`，等当前轮次结束后再处理

### 默认忽略的目录
为了避免噪音和自触发，当前会忽略：
- `.git`
- `.happy`
- `node_modules`
- `dist`
- `build`
- `coverage`
- `.next`
- `.turbo`

这意味着：
- loop 自己写入 `.happy/agent-loops/<loopId>/memory.md` 不会反过来触发自己
- 常见构建产物不会把 loop 反复唤醒

### 当前边界
这是第一版自动文件事件桥：
- 现在是“监听整个工作目录 + 默认忽略噪音目录”
- 还没有做到更细粒度的 include/exclude 规则
- 还没有把 GitHub / CI / 系统事件统一收敛到同一配置层

但它已经能把 `happy loop` 从“靠手动触发/定时轮询”推进到“代码一变就能自动醒来”。

## GitHub Webhook → Loop 事件桥

现在 Happy 会把现有的 GitHub webhook 自动桥接到启用了 **GitHub Bridge** 的 loop。

### 怎么开启
CLI 创建时：
- `happy loop create --path /path/to/repo --interval 10m --prompt "..." --github-bridge`

CLI 更新时：
- 开启：`happy loop update <loopId> --github-bridge`
- 关闭：`happy loop update <loopId> --no-github-bridge`

App：
- Machine → Loops
- 编辑 loop
- 在高级选项里切换 **GitHub Bridge**

### 当前桥接的是什么
当前第一版桥接复用了现有 `webhook-trigger` 自动化入口。

也就是说：
- 当 Happy daemon 收到现有的 GitHub issue/webhook 事件
- 除了继续走原来的 webhook 自动化流程
- 还会额外向匹配的 loop 注入一个 `github-webhook` 事件

匹配规则：
- loop 已启用
- loop 开启了 GitHub Bridge
- loop 的工作目录位于 webhook 的 `repoPath` 之内

### 当前会产生什么 loop 事件
事件内容大致包括：
- 标题：`Issue #<number>: <title>`
- 来源：`github-webhook`
- 详情：author / labels / issue URL

这样 loop 可以在自己的长期记忆上下文里感知外部 GitHub 信号，而不是只依赖定时轮询或本地文件变化。

### 当前边界
这一版还不是完整的 GitHub/CI 统一事件总线：
- 现在桥接的是现有 issue/webhook 自动化入口
- 还没有覆盖独立的 `workflow_run` / `check_run` / `pull_request` 专用事件类型（当前已先提供 `ci-webhook` 语义桥接）
- 还没有做到每个 loop 可配置更细粒度的 webhook 过滤规则

但它已经把“生产里已有的 GitHub webhook 信号”正式接到了 Happy loop 的自治内核上。

## 事件过滤策略

现在每个 loop 都可以控制“哪些事件值得唤醒自己”。

### 可配置的两层过滤
1. **Event Sources**
   - 限制允许进入 loop 的事件来源
   - 例如：
     - `github-webhook`
     - `file-watch`
     - `manual`
     - `ui`

2. **Event Keywords**
   - 只接受标题或详情里包含某些关键词的事件
   - 例如：
     - `ci`
     - `workflow`
     - `flake`
     - `urgent`

### CLI 用法
创建时：
- `happy loop create --path /path/to/repo --interval 10m --prompt "..." --event-source github-webhook --event-source file-watch --event-keyword ci --event-keyword workflow`

更新时：
- 添加来源：`happy loop update <loopId> --event-source github-webhook`
- 清空来源：`happy loop update <loopId> --clear-event-sources`
- 添加关键词：`happy loop update <loopId> --event-keyword ci`
- 清空关键词：`happy loop update <loopId> --clear-event-keywords`

### App 用法
在 Machine → Loops → 编辑 loop：
- `Event Sources`：每行一个来源
- `Event Keywords`：每行一个关键词

### 过滤后的表现
如果一个事件不匹配当前 loop 的过滤条件：
- 事件不会触发自动运行
- 事件仍会进入 `recentEvents`
- 但状态会记为 `ignored`

这样你仍然可以在 UI / CLI 里看到：
- 某个事件来过
- 它为什么没有触发 loop

### 实际建议
如果你想把 loop 做得更稳：
- `CI Watchdog` 这类 loop：
  - sources: `github-webhook`, `file-watch`
  - keywords: `ci`, `workflow`, `test`, `flake`
- `Docs Drift` 这类 loop：
  - sources: `file-watch`
  - keywords: `readme`, `docs`, `guide`
- `Project Guardian` 这类 loop：
  - 可以先不配关键词
  - 只做来源控制


## 失败预算与自动重试

为了让 `happy loop` 更接近“完全自主”，现在每个 loop 都可以配置失败策略，而不是默认一失败就彻底停住。

### 可配置的两项策略
- **Max Consecutive Failures**：允许连续失败多少次后才进入 blocked
- **Retry Backoff**：未达到失败上限时，下一次自动重试前等待多久

### 示例
CLI 创建时：
- `happy loop create --path /path/to/repo --interval 10m --prompt "..." --max-failures 3 --retry-backoff 5m`

CLI 更新时：
- `happy loop update <loopId> --max-failures 3 --retry-backoff 5m`
- 恢复默认的“首错即阻塞”：
  - `happy loop update <loopId> --max-failures 1 --clear-retry-backoff`

App：
- Machine → Loops → 编辑 loop
- 在高级选项里设置 **Max Consecutive Failures** 和 **Retry Backoff**

### 当前行为
- 如果失败次数 **还没达到上限**：
  - loop 保持启用
  - `consecutiveFailures` 递增
  - `nextRunAt` 会按 `retryBackoff` 推迟
  - loop 不会进入 blocked
- 如果失败次数 **达到上限**：
  - loop 进入 `blocked`
  - `blockedReason` 会保留最近失败原因
- 如果后续成功：
  - `consecutiveFailures` 自动清零
- 如果你手动 `resume`：
  - 失败计数也会清零，等于开启一轮新的自治尝试


## 仓库扫描与批量 Bootstrap

现在 Happy 不只是“对单个 repo 建议 loop”，还支持对一个根目录做仓库发现，然后批量生成/落地 loop。

### CLI
先扫描并生成计划：
- `happy loop bootstrap --root ~/Documents/dev-workspace`

直接批量创建缺失 loop：
- `happy loop bootstrap --root ~/Documents/dev-workspace --create`

创建后立刻启动首轮：
- `happy loop bootstrap --root ~/Documents/dev-workspace --create --run-now`

可选参数：
- `--depth <n>`：扫描深度
- `--limit <n>`：最多扫描多少个 git 仓库

### App
在 Machine → Loops 页面：
- 点击 **Scan Repos**
- 查看每个仓库的建议数量和可创建数量
- 选择 **Create Missing Loops** 或 **Create + Run Missing Loops**

### 当前行为
- 只扫描包含 `.git` 的本地仓库
- 会跳过 `.git`、`.happy`、`node_modules`、`dist`、`build` 等噪音目录
- 推荐结果仍然复用现有 `suggestAgentLoops`，不会新造第二套推荐逻辑
- 已配置的 loop 会被标记，不会重复创建


## Bootstrap 守护配置（持续自动发现新仓库）

如果你不想手动反复执行 `happy loop bootstrap`，现在可以配置 daemon 持续扫描某个根目录，并自动把新仓库 materialize 为 loop。

### CLI
创建一个 bootstrap profile：
- `happy loop bootstrap-profile create --root ~/Documents/dev-workspace --interval 6h --depth 4 --limit 20 --auto-run-created`

查看已有配置：
- `happy loop bootstrap-profile list`
- `happy loop bootstrap-profile show <profileId>`

手动立即执行一次：
- `happy loop bootstrap-profile run-now <profileId>`

暂停 / 恢复：
- `happy loop bootstrap-profile pause <profileId>`
- `happy loop bootstrap-profile resume <profileId>`

更新 / 删除：
- `happy loop bootstrap-profile update <profileId> --interval 12h --limit 40`
- `happy loop bootstrap-profile remove <profileId>`

### App
在 Machine → Loops 页面：
- 使用 **Bootstrap Profiles** 区域创建守护配置
- 可直接查看最近扫描到的 repo 数、建议数、创建数与错误信息
- 可对单个配置执行 edit / pause / resume / run-now / remove

### 当前行为
- profile 会按 `interval` 定期扫描 `rootDirectory`
- 每轮会复用现有 `suggestAgentLoops` 逻辑生成建议
- 对已存在的 loop 仍然做去重，不会重复创建
- 可以选择 `autoRunCreatedLoops`，让新建 loop 落地后立即开始第一轮自治

## 自动运行策略（Cooldown / Quiet Hours / Max Auto-Runs）

现在每个 loop 都可以额外配置“什么时候不要自动跑太频繁”。

### 三个核心策略
- `Cooldown`：一次自动运行结束后，至少间隔多久才允许下一次自动运行
- `Quiet Hours`：在某个本地时间窗口内，不自动响应 schedule / event 唤醒
- `Max Auto-Runs Per Day`：每天最多允许多少次 schedule / event 自动运行

注意：
- 这些策略只约束 **自动运行**（`schedule` / `event`）
- `happy loop run-now <loopId>` 的 **手动运行不受限制**
- 如果事件因为策略未执行，事件会继续保留在 `pending`，不会被丢掉

### CLI
创建时：
- `happy loop create --path /path/to/repo --interval 10m --prompt "..." --cooldown 30m --quiet-start 23:00 --quiet-end 07:00 --max-auto-runs 8`

更新时：
- `happy loop update <loopId> --cooldown 30m`
- `happy loop update <loopId> --quiet-start 23:00 --quiet-end 07:00`
- `happy loop update <loopId> --max-auto-runs 8`

清空时：
- `happy loop update <loopId> --clear-cooldown`
- `happy loop update <loopId> --clear-quiet-start --clear-quiet-end`
- `happy loop update <loopId> --clear-max-auto-runs`

### App
在 Machine → Loops → 编辑 loop → Advanced 中可以设置：
- `Cooldown`
- `Quiet Hours`
- `Max Auto-Runs Per Day`

同时页面详情里会显示：
- 今天自动运行次数
- 当前自动运行窗口起点

## GitHub Actions Webhook 真实接入

Happy 现在除了通用 `ci-event`，还支持直接把真实 GitHub Actions webhook payload 转成 loop 的 CI 事件。

### CLI
- `happy loop github-actions-webhook --event workflow_run --payload-file payload.json --path /path/to/repo`
- `happy loop github-actions-webhook --event check_run --payload-file payload.json --loop <loopId>`

### 当前行为
- 支持 `workflow_run` / `check_run` / `check_suite`
- 会转成统一的 `ci-trigger` 模型进入现有 daemon 自动化平面
- 如果未显式传 `--path`，系统会尽量根据仓库 `origin` remote URL 匹配 loop
- 因此对于生产仓库，建议确保 loop 目录里的 git remote `origin` 可读且准确

### 推荐用法
- repo 上已有 CI Watchdog loop 时，开启 `CI Bridge`
- GitHub Actions webhook 到来后，让 loop 在自己的长期记忆上下文里处理失败、漂移和下一步动作

## 多 Loop 编排（Downstream Loops）

Happy loop 现在支持轻量级的多 loop 编排，但仍然保持在现有 daemon + 事件总线里，不新造第二套 workflow runtime。

### 能做什么
上游 loop 结束后，可以把结果事件自动注入下游 loop：
- 上游 `completed` 后触发下游
- 上游 `failed` 后触发下游
- 或两者都触发

事件源会标记为：
- `loop-completed`
- `loop-failed`

### CLI
创建时：
- `happy loop create --path /repo/a --interval 10m --prompt "..." --downstream-loop <loopB> --downstream-trigger completed`

更新时：
- `happy loop update <loopId> --downstream-loop <loopB> --downstream-loop <loopC>`
- `happy loop update <loopId> --downstream-trigger completed --downstream-trigger failed`
- `happy loop update <loopId> --clear-downstream-loops`
- `happy loop update <loopId> --clear-downstream-triggers`

### App
在 Machine → Loops → 编辑 loop → Advanced 中可配置：
- `Downstream Loops`：每行一个 loop ID
- `Downstream Triggers`：每行一个触发条件（`completed` / `failed`）

### 设计边界
- 这是 **事件驱动编排**，不是 DAG/workflow engine
- 不处理拓扑排序、并发图、回滚图等重型概念
- 如果你配置了环状 downstream 关系，可能形成自激活链路；建议结合：
  - `Cooldown`
  - `Max Auto-Runs Per Day`
  - 事件过滤策略

## 策略命中审计与运行可视化

为了更容易理解“为什么 loop 没自动跑”，现在自动化面板和 loop 详情会暴露策略命中信息。

### 新增可观测项
在 Machine → Automation → Audit Stats 中，现在会看到：
- `Policy Gated Runs`
- `Downstream Events Emitted`

在 audit 时间线里，也会出现新的事件类型：
- `Loop Policy Gated`
- `Downstream Event Emitted`

### loop 详情里能看到什么
在 Machine → Loops 里，每个 loop 现在会展示：
- 当前 `Policy State`
  - `Ready`
  - `Quiet Hours`
  - `Cooldown`
  - `Daily Cap Reached`
- 最近一次策略拦截的原因与时间
- 上游 / 下游 loop 关联

这意味着你不用只猜“为什么没跑”，而是能直接看到：
- 是不是在 quiet hours
- 是不是刚跑完还在 cooldown
- 是不是今天自动运行次数已经打满

## Loop 链路跳转

在 Machine → Loops → 打开某个 loop 时：
- 如果它配置了下游 loop，会出现 **Open Downstream Loop**
- 如果它被别的 loop 指向，会出现 **Open Upstream Loop**

这让你能快速沿着自治链路排查：
- 哪个上游 loop 触发了当前 loop
- 当前 loop 又会把结果传给谁

## Kairos Brief / 通知

### 现在新增了什么
每次 loop 终态（completed / failed / blocked）后，daemon 会：
- 生成 repo-local brief：`.happy/agent-loops/<loopId>/brief-latest.md`
- 归档历史 brief 文件
- 回写 loop 元数据：`lastBriefAt` / `lastBriefSummary`
- 按配置发送 push / webhook 通知

### CLI 用法
- 查看最新 brief：`happy loop brief <loopId>`
- 查看 durable memory：`happy loop memory <loopId>`
- 查看本次上下文：`happy loop context <loopId>`
- 创建时配置通知：
  - `happy loop create --path <repo> --interval 10m --prompt "..." --notify-event completed --notify-event brief --notify-channel push`
  - `happy loop create --path <repo> --interval 10m --prompt "..." --notify-event failed --notify-channel webhook --notify-webhook https://example.com/hook`
- 更新通知：
  - `happy loop update <loopId> --notify-event completed --notify-channel push`
  - `happy loop update <loopId> --clear-notify-events --clear-notify-channels`

### App UI 里怎么看
Machine → Loops 页面现在会显示：
- Notify events / channels / webhook
- Last brief 摘要
- 最新运行后的 brief 元信息
- 点开 loop 后会进入独立详情页查看 brief 内容（支持复制、搜索、匹配跳转、命中高亮、聚焦/全文搜索模式、自动刷新、刷新变化提示、变化后自动切到 diff、前后 diff、清理快照、在机器上打开原路径），并可继续 drill down 查看该 loop 的 memory/context 文件

## Auto-Dream 后台记忆整理

### 一句话理解
Auto-Dream 是 daemon 内部的后台整理服务。
它不会直接跑新 agent 会话，而是周期性扫描已有 loop 的 `memory.md`，生成一份背景 dream report，作为后续自主化判断和人工查看的统一摘要层。

### 产物位置
每个 profile 会在目标 root 下写出：
- `.happy/auto-dream/<profileId>/dream-latest.md`
- `.happy/auto-dream/<profileId>/dream-<hash>.md`

### CLI 用法
- 列表：`happy loop dream-profile list`
- 详情：`happy loop dream-profile show <profileId>`
- 创建：`happy loop dream-profile create --root <dir> --interval 12h [--name <name>] [--depth <n>] [--limit <n>] [--run-now]`
- 更新：`happy loop dream-profile update <profileId> [--name <name>|--clear-name] [--root <dir>] [--interval <12h>] [--depth <n>|--clear-depth] [--limit <n>|--clear-limit]`
- 控制：
  - `happy loop dream-profile pause <profileId>`
  - `happy loop dream-profile resume <profileId>`
  - `happy loop dream-profile run-now <profileId>`
  - `happy loop dream-profile remove <profileId>`

### App UI 入口
Machine → Loops 页面现在新增 Auto-Dream Profiles 区块，可直接：
- 创建 / 编辑 profile
- pause / resume / run-now / remove
- 查看 stage、最近扫描文件数、最新 dream report 路径
- 点开 profile 后会进入独立详情页查看最新 dream report（支持复制、搜索、匹配跳转、命中高亮、聚焦/全文搜索模式、自动刷新、刷新变化提示、变化后自动切到 diff、前后 diff、清理快照、在机器上打开原路径）


- loop policy now supports `maxIterations` and `stopOnSuccess` so autonomous runs can terminate cleanly without manual cleanup
