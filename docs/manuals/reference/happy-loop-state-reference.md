# Happy 自主 Loop 状态与字段参考

这份文档解释 loop、automation 页面、常见状态字段的含义。

---

## 1. loop 基础状态

### `enabled`

- `true`：允许自动运行
- `false`：当前不自动运行

注意：

- `enabled: false` 不一定是异常
- 可能是你手动 pause
- 也可能是达到了停止条件

### `runtimeState`

常见值：

- `idle`
- `active`
- `blocked`
- `paused`

含义：

- `idle`：空闲，等待下次运行或事件
- `active`：有任务正在调度或执行
- `blocked`：因为失败或异常无法继续自动推进
- `paused`：人为暂停或因停止条件自动停下

### `phase`

常见值：

- `sleeping`
- `planning`
- `acting`
- `reflecting`
- `blocked`
- `paused`

含义：

- `sleeping`：休眠等待
- `planning`：已入队或在准备本轮执行
- `acting`：会话已启动，正在真正执行任务
- `reflecting`：本轮完成，正在收尾 / 同步结果
- `blocked`：异常阻塞
- `paused`：停止状态

---

## 2. 调度与时间字段

### `intervalMs`

loop 的基础周期。

### `nextRunAt`

下一次计划自动运行时间。

注意：

- 到了这个时间也不一定真的会跑
- 还会受 cooldown、quiet hours、daily cap、max iterations 等策略影响

### `lastEnqueuedAt`

最近一次任务被加入调度队列的时间。

### `lastStartedAt`

最近一次真正开始执行的时间。

### `lastCompletedAt`

最近一次结束的时间。

### `lastTriggerAt`

最近一次被触发的时间。

### `lastTriggerSource`

最近一次触发来源，常见值：

- `manual`
- `schedule`
- `event`

---

## 3. 失败与恢复字段

### `consecutiveFailures`

当前连续失败次数。

### `maxConsecutiveFailures`

失败预算上限。

### `retryBackoffMs`

失败后下一次自动尝试的回退时间。

### `lastError`

最近一次错误信息。

### `blockedReason`

loop 进入 `blocked` 的原因。

一般代表异常或失败导致的阻塞，而不是预期停机。

---

## 4. 策略与停止条件字段

### `cooldownMs`

自动运行之间的冷却时间。

### `quietHoursStart` / `quietHoursEnd`

静默时段。

### `maxAutoRunsPerDay`

每天自动运行次数上限。

### `autoRunsToday`

今天已经自动运行了多少次。

### `autoRunWindowStartedAt`

今天自动运行计数窗口的起始时间。

### `lastPolicyGateAt`

最近一次被策略拦住的时间。

### `lastPolicyGateReason`

最近一次被策略拦住的原因。

常见值：

- `quiet-hours`
- `cooldown`
- `max-auto-runs`
- `max-iterations`
- `stop-on-success`

### `maxIterations`

最多允许的迭代次数。

### `stopOnSuccess`

成功后是否自动停止。

### `stopReason`

预期内的停止原因。

常见值：

- `max-iterations`
- `stop-on-success`

和 `blockedReason` 的区别：

- `stopReason`：有意设计的停止
- `blockedReason`：失败或异常导致的阻塞

---

## 5. brief / memory / context 相关字段

### `lastBriefAt`

最近一次 brief 生成时间。

### `lastBriefSummary`

最近一次 brief 的摘要文本。

### `goal`

长期目标。

### `currentFocus`

当前焦点。

### `workingMemory`

工作记忆。

### `lastReflectionSummary`

最近一次反思摘要。

### `memoryUpdatedAt`

memory 最近更新时间。

这些字段共同决定 loop 是否真的有长期连续性。

---

## 6. 会话与运行字段

### `activeJobId`

当前活跃 job 的 ID。

### `activeSessionId`

当前活跃 session 的 ID。

### `lastSessionId`

最近一次 session ID。

### `continuityKey`

loop 对应的连续性标识，用于和 automation / guardian continuity 体系关联。

---

## 7. 事件字段

### `recentEvents`

最近事件列表。

每个事件常见状态：

- `pending`
- `dispatched`
- `completed`
- `failed`
- `cancelled`
- `ignored`

### `eventSourceAllowlist`

允许哪些事件来源触发 loop。

### `eventKeywordFilters`

要求事件标题 / 内容匹配哪些关键词。

### `pending events`

通常是指 `recentEvents` 中状态为 `pending` 的数量。

如果这个数长期偏高，说明事件来了但没有及时被消费。

---

## 8. 编排字段

### `downstreamLoopIds`

这个 loop 完成后可能触发的下游 loop。

### `downstreamTriggerOn`

在什么状态下触发下游：

- `completed`
- `failed`

---

## 9. 通知字段

### `notifyEvents`

哪些事件会触发通知：

- `completed`
- `failed`
- `blocked`
- `brief`

### `notificationChannels`

通知渠道：

- `push`
- `webhook`

### `notificationWebhookUrl`

webhook 目标地址。

---

## 10. Automation 页面指标

## 10.1 Loop Rollup

### `Total Loops`

当前机器上的 loop 总数。

### `Active Loops`

当前处于 active 的 loop 数量。

### `Blocked Loops`

当前处于 blocked 的 loop 数量。

### `Paused Loops`

当前暂停中的 loop 数量。

### `Loops With Pending Events`

还有待消费事件的 loop 数量。

### `Policy-Stopped Loops`

因策略门槛或停止条件而停下的 loop 数量。

---

## 10.2 Audit Stats

### `Policy Gated Count`

loop 因策略被拦住的累计次数。

### `Downstream Emit Count`

向下游 loop 发出事件的累计次数。

### `Guardian Reuse Count`

guardian continuity 重用次数。

### `Guardian Reuse Rate`

guardian 重用比例。

### `Session Reattached Count`

重启后成功重新关联 session 的次数。

### `Watchdog Stops`

watchdog 停止次数。

### `Stop Requests`

停止请求次数。

---

## 10.3 Jobs 计数

### `Queued`

排队中的 job。

### `Running`

正在执行或 dispatching 的 job。

### `Failed`

失败的 job。

### `Completed`

已完成 job。

### `Cancelled`

已取消 job。

---

## 11. 常见状态组合怎么理解

### 组合 1

- `enabled = true`
- `runtimeState = idle`
- `phase = sleeping`

含义：

- loop 健康
- 目前只是空闲等待下一次运行

### 组合 2

- `enabled = true`
- `runtimeState = active`
- `phase = acting`

含义：

- 当前正有 session 在执行

### 组合 3

- `enabled = false`
- `runtimeState = paused`
- `stopReason = stop-on-success`

含义：

- loop 已按预期完成阶段任务并停下

### 组合 4

- `enabled = false`
- `runtimeState = blocked`
- `blockedReason` 有值

含义：

- loop 因失败或异常被系统阻塞
- 需要人工介入判断是否恢复

### 组合 5

- `pending events > 0`
- `lastPolicyGateReason = cooldown`

含义：

- 事件已经来了，但目前被 cooldown 暂时压住

---

## 12. 最重要的判断逻辑

如果你只记一件事，记这个：

- `stopReason` 多半是预期内行为
- `blockedReason` 多半是需要关注的问题
- `lastPolicyGateReason` 表示被策略挡住，不一定是坏事
- `brief + memory + currentFocus` 才是判断 loop 是否真正有价值的核心信号
