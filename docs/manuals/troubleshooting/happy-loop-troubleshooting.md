# Happy 自主 Loop 故障排查手册

## 1. 排查顺序建议

遇到问题时，推荐按下面顺序查：

1. `happy loop show <loopId>`
2. `happy loop brief <loopId>`
3. `happy loop memory <loopId>`
4. `happy loop context <loopId>`
5. 打开 `Machine -> Automation`
6. 打开 `Machine -> Loops`

先看 loop 自身状态，再看系统级 automation 状态。

---

## 2. loop 不运行

### 先检查

```bash
happy loop show <loopId>
```

重点看：

- `Enabled`
- `Runtime`
- `Phase`
- `Next run`
- `Stop reason`
- `Blocked reason`
- `Last error`

### 常见原因

#### 原因 1：loop 被暂停了

现象：

- `Enabled: false`
- `Runtime: paused`

处理：

```bash
happy loop resume <loopId>
```

#### 原因 2：loop 被失败预算 block 了

现象：

- `Runtime: blocked`
- 有 `Blocked reason`

处理：

```bash
happy loop resume <loopId>
```

如果还会再次失败，建议同时检查：

- `--max-failures`
- `--retry-backoff`
- prompt 是否过于激进

#### 原因 3：达到停止条件

现象：

- `Stop reason: max-iterations`
- 或 `Stop reason: stop-on-success`

处理：

- 这是预期行为，不是 bug
- 如果要继续自动运行：

```bash
happy loop update <loopId> --clear-max-iterations --no-stop-on-success
happy loop resume <loopId>
```

#### 原因 4：被策略节流

现象：

- `Last policy gate` 有值
- `Policy state` 显示 quiet hours / cooldown / max auto runs

处理：

```bash
happy loop update <loopId> --clear-cooldown
happy loop update <loopId> --clear-quiet-start --clear-quiet-end
happy loop update <loopId> --clear-max-auto-runs
```

或者直接手动运行：

```bash
happy loop run-now <loopId>
```

> 手动 `run-now` 适合临时绕过自动运行限制做验证。

---

## 3. loop 运行了，但没有结果

### 检查 brief

```bash
happy loop brief <loopId>
```

如果没有 brief：

- 说明这轮可能没有正常走到 terminal completion
- 或本轮失败过早
- 或 session 没有收尾

### 检查 automation 页面

看：

- 是否还有 running job
- 是否有 failed job
- 是否出现 watchdog stop / stop request

### 检查最近错误

```bash
happy loop show <loopId>
```

重点看：

- `Last error`
- `Last session`
- `Last started`
- `Last completed`

---

## 4. brief 有了，但 memory 没更新

### 检查 memory

```bash
happy loop memory <loopId>
```

如果 memory 长期不更新，通常说明：

- loop 的执行内容没有正确写回 `memory.md`
- 本轮没有产生新的 durable state
- prompt 没有足够强调写 memory

### 检查 context

```bash
happy loop context <loopId>
```

确认本轮是否真的带着 memory/context 在运行。

### UI 排查

在 `Machine -> Loops` 打开：

- Memory
- Context
- Brief

对照看：

- brief 是否在变化
- memory 是否停滞
- context 是否正确注入任务描述和触发事件

---

## 5. loop 经常失败

### 看失败预算

```bash
happy loop show <loopId>
```

关注：

- `Failures`
- `Retry backoff`
- `Blocked reason`

### 建议调整

#### 降低频率

```bash
happy loop update <loopId> --cooldown 30m
```

#### 增加失败回退

```bash
happy loop update <loopId> --retry-backoff 15m
```

#### 收紧任务边界

- 缩小 prompt
- 明确 `goal`
- 明确 `focus`
- 给出更保守的 `working-memory` 约束

#### 改成有限型 loop

```bash
happy loop update <loopId> --max-iterations 3 --stop-on-success
```

如果你不确定长期 loop 是否合适，先把它改成有限轮次更安全。

---

## 6. 事件注入了，但 loop 没被唤醒

### 先查事件过滤器

看 loop 是否设置了：

- `eventSourceAllowlist`
- `eventKeywordFilters`

如果事件源或关键词不匹配，事件会被忽略。

### 测试方式

```bash
happy loop event <loopId> --source manual --title "CI failed on main" --details "workflow=test"
```

再看：

```bash
happy loop show <loopId>
```

重点看：

- `Pending events`
- `Last trigger`
- `Recent events`

### 如果事件被排队但没立刻运行

可能原因：

- 正在 quiet hours
- cooldown 中
- hit daily cap
- 已有 active job

去 `Machine -> Automation` 看当前 job 状态最直观。

---

## 7. Suggestions 没有生成结果

### 先确认路径下是否真有仓库

```bash
happy loop suggest --path ~/Documents/dev-workspace
```

如果没有 suggestion：

- 路径下可能没有可识别 repo
- 已经全部配置过 loop
- 当前 repo 特征不明显，无法产出高置信建议

### 处理建议

- 先换到更明确的 repo 根目录
- 在 App 里查看 Suggestions 卡片
- 用 `bootstrap` 扫更大的根目录

---

## 8. Bootstrap 没有效果

### 检查 root / depth / limit

```bash
happy loop bootstrap --root ~/Documents/dev-workspace --depth 4 --limit 20
```

如果没结果，通常是：

- 深度不够
- limit 太小
- 目录里没有可识别 repo
- 建议已全部落地

### 如果使用 bootstrap-profile

检查：

```bash
happy loop bootstrap-profile list
happy loop bootstrap-profile show <profileId>
```

重点看：

- `enabled`
- `nextRunAt`
- `lastCreatedCount`
- `lastError`

---

## 9. Auto-Dream 没生成 report

### 先看 profile 状态

```bash
happy loop dream-profile list
happy loop dream-profile show <profileId>
```

重点看：

- `status`
- `stage`
- `lastMemoryFiles`
- `lastUpdatedFiles`
- `lastError`

### 常见原因

#### 原因 1：没有足够的 memory 文件

Auto-Dream 依赖：

- `.happy/agent-loops/**/memory.md`

如果 loop 还没形成 memory 累积，dream report 就不会有太多内容。

#### 原因 2：root 路径不对

创建 profile 时 root 选错了，扫描不到 loop 支持目录。

#### 原因 3：profile 被暂停

```bash
happy loop dream-profile resume <profileId>
```

#### 原因 4：想立刻验证

```bash
happy loop dream-profile run-now <profileId>
```

---

## 10. Automation 页面应该怎么看异常

### Loop Rollup

如果这里的数字不对劲，通常代表系统层面出了问题：

- `Blocked Loops` 持续上涨：失败预算太紧、任务太难、环境不稳定
- `Paused Loops` 很多：很多 loop 被手动停了，或触发了停止条件
- `Policy-Stopped Loops` 上涨：达到 `max-iterations` / `stop-on-success` / 策略门槛
- `Loops With Pending Events` 长期偏高：事件来了，但消费不及时

### Audit Stats

重点看：

- `Policy Gated Count`
- `Downstream Emit Count`
- `Guardian Reuse Count`
- `Session Reattached Count`
- `Watchdog Stops`
- `Stop Requests`

### Jobs

如果 jobs 长期：

- 一直 running
- 一直 dispatching
- failed 积累

说明不是某个 loop 单点问题，而是 automation runtime 层面要排查。

---

## 11. 最快恢复方法

如果你只想“先让系统恢复可用”，推荐最短路径：

### 情况 A：某个 loop 卡住

```bash
happy loop show <loopId>
happy loop resume <loopId>
happy loop run-now <loopId>
```

### 情况 B：先把策略放宽做验证

```bash
happy loop update <loopId> --clear-cooldown --clear-max-auto-runs --clear-quiet-start --clear-quiet-end
happy loop run-now <loopId>
```

### 情况 C：先去掉停止条件

```bash
happy loop update <loopId> --clear-max-iterations --no-stop-on-success
happy loop resume <loopId>
```

### 情况 D：系统层面看整体

打开：

- `Machine -> Automation`
- `Machine -> Loops`

优先确认：

- 有没有 active jobs
- 有没有 blocked loops
- 有没有 pending events 堆积

---

## 12. 排查时的原则

### 不要第一步就大改 prompt

先查：

- 状态
- brief
- memory
- context
- audit

很多问题根本不是 prompt 本身，而是：

- loop 被策略挡住
- loop 已经暂停
- loop 已达到停止条件
- event 被过滤掉

### 优先先验证“闭环是否存在”

只要下面 4 个有了，说明系统主链路是通的：

- run
- brief
- memory
- automation 可观测

### 先收边界，再提强度

如果 loop 不稳定，不要立刻加频率，先：

- 加 cooldown
- 加 retry backoff
- 加 max iterations
- 加 stop-on-success

这样更容易把系统收敛到健康状态。
