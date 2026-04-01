# Happy 自主 Loop 最佳实践

## 1. 什么时候适合建 Loop

适合建 loop 的场景：

- 有持续性的仓库维护需求
- 可以被“周期巡检 / 事件唤醒 / 状态推进”描述
- 允许系统逐步推进，而不是一次性大爆改
- 有明确目标、边界、停止条件

典型例子：

- CI 健康巡检
- flaky test 调查
- TODO / debt 持续清理
- 文档 / 版本 / 发布准备流程
- 多仓库 workspace 的长期自治

## 2. 什么时候不适合建 Loop

不适合直接建长期 loop 的场景：

- 任务目标不明确
- 需要强人工判断且难以参数化
- 需要一次性大规模改造
- 风险极高，且没有清晰边界
- 只是临时执行一次的命令式任务

这类场景更适合：

- 先手动 run
- 或建有限轮次 loop：`--max-iterations`
- 或开启 `--stop-on-success`

## 3. 默认推荐参数模板

### 保守型长期 Loop

```bash
happy loop create \
  --path /path/to/repo \
  --interval 15m \
  --prompt "Keep this repository healthy and move it forward safely." \
  --goal "Maintain repo health with bounded autonomous progress" \
  --cooldown 30m \
  --max-auto-runs 8 \
  --max-failures 3 \
  --retry-backoff 10m
```

适合：大多数长期 repo 守护场景。

### 夜间安静型 Loop

```bash
happy loop update <loopId> \
  --quiet-start 23:00 \
  --quiet-end 07:00
```

适合：不希望夜间大规模动作的项目。

### 有限任务型 Loop

```bash
happy loop create \
  --path /path/to/repo \
  --interval 20m \
  --prompt "Investigate and stabilize flaky tests." \
  --max-iterations 5 \
  --stop-on-success
```

适合：专项排查、一次性治理、有限阶段任务。

## 4. 事件驱动优先于高频轮询

如果问题本身更适合“有事再醒”，优先用：

- `--event-source`
- `--event-keyword`
- webhook / CI bridge / file watch

而不是一上来把 interval 设得非常短。

建议：

- 先事件驱动
- 再配一个保底的中低频 interval

## 5. 一定要加边界

建议至少加一类边界：

- 失败预算：`--max-failures`
- 节流：`--cooldown`
- 每日上限：`--max-auto-runs`
- 有限轮次：`--max-iterations`
- 成功即停：`--stop-on-success`

如果完全没有边界，loop 虽然“自主”，但不够“可运营”。

## 6. 推荐的组合策略

### 长期守护型

- `cooldown`
- `max-auto-runs`
- `max-failures`
- `retry-backoff`

### 调查型

- `max-iterations`
- `stop-on-success`
- 必要时 `quiet-hours`

### 高风险仓库

- `quiet-hours`
- 更大的 `cooldown`
- 更低的 `max-auto-runs`
- 打开通知

## 7. Brief / Memory / Auto-Dream 的使用建议

### Brief

适合每天扫一眼，回答：

- 最近 loop 做了什么
- 有没有值得你介入的问题

### Memory

适合检查 loop 是否真的在“连续思考”：

- 当前焦点是否在推进
- 工作记忆是否在积累
- 反思摘要是否有演进

### Auto-Dream

适合做高层复盘，不适合替代单个 loop 的执行细节。

## 8. UI 使用建议

### `Machine -> Loops`

适合：

- 配置 loop
- 打开 brief / memory / context
- 批量采纳 suggestions
- 管 bootstrap / Auto-Dream

### `Machine -> Automation`

适合：

- 看整套系统是否健康
- 看 blocked / paused / failed 是否变多
- 看 guardian / audit / rollup 是否异常

## 9. 推荐的日常巡检节奏

每天建议：

1. 打开 `Machine -> Automation`
2. 看 loop rollup
3. 看失败和 guardian 异常
4. 打开重点 loop 的 brief
5. 必要时看 memory / context
6. 对新 repo 跑 suggest / bootstrap

## 10. 一句话原则

Happy 的 loop 不是越多越好，而是：

- 目标清晰
- 边界明确
- 产物可看
- 状态可控
- 失败可停

做到这五点，loop 才会真的变成可持续的自主系统，而不是失控的自动任务。
