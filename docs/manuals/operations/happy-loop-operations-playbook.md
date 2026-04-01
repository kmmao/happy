# Happy 自主 Loop 日常运营手册

这份文档回答的问题不是“怎么创建 loop”，而是：

- 上线后怎么持续运营
- 每天应该看什么
- 哪些信号说明系统健康
- 哪些 loop 应该继续、暂停、收紧或下线

---

## 1. 运营目标

日常运营 Happy 自主 loop，核心目标只有 4 个：

- **可见**：你能知道系统现在在做什么
- **可控**：loop 不会无限失控扩张
- **可恢复**：出问题后能快速拉回健康状态
- **可演进**：好的 loop 持续升级，差的 loop 及时收敛或下线

---

## 2. 运营分层

建议把运营动作分成 4 层：

### 第 1 层：日常巡检

关注：

- 现在系统健康吗
- 有没有 loop 卡住
- 有没有失败、阻塞、pending events 堆积

### 第 2 层：策略调优

关注：

- 哪些 loop 跑得太频繁
- 哪些 loop 边界不够清晰
- 哪些 loop 该增加 `cooldown` / `max-auto-runs` / `max-iterations`

### 第 3 层：loop 生命周期管理

关注：

- 哪些 loop 该新增
- 哪些 loop 该合并
- 哪些 loop 该暂停或删除

### 第 4 层：高层记忆整理

关注：

- Auto-Dream 是否持续产出高价值总结
- 是否能从多个 loop 中得到更高层视角

---

## 3. 每日巡检清单

建议每天至少做一次，顺序如下。

## 3.1 先看 Automation

页面：`Machine -> Automation`

优先看 3 个区域：

### Loop Rollup

重点关注：

- `Active Loops`
- `Blocked Loops`
- `Paused Loops`
- `Loops With Pending Events`
- `Policy-Stopped Loops`

判断标准：

- `Blocked Loops` 突然升高：失败预算、环境、prompt 边界可能有问题
- `Pending Events` 长时间高：事件消费跟不上
- `Policy-Stopped Loops` 持续增加：很多 loop 达到边界，要判断这是预期还是配置不合理

### Jobs

重点看：

- running 是否卡太久
- failed 是否增长
- terminal jobs 是否能定期清理

### Audit Stats

重点看：

- `Policy Gated Count`
- `Downstream Emit Count`
- `Guardian Reuse Count`
- `Session Reattached Count`
- `Watchdog Stops`
- `Stop Requests`

---

## 3.2 再看重点 Loops

页面：`Machine -> Loops`

建议每天挑重点 loop 看：

- 最近最活跃的
- 最近失败过的
- 最近刚新增的
- 负责核心 repo 的

重点看：

- 状态（enabled / paused / blocked）
- runtime / phase
- next run
- last brief
- current focus
- stop reason / blocked reason

---

## 3.3 最后看产物

针对重点 loop，建议快速打开：

- brief
- memory
- context

判断标准：

### brief 健康

- 最近有更新
- 内容不是空洞重复
- 能看出明确进展或阻塞

### memory 健康

- current focus 在变化
- working memory 在积累
- reflection summary 不是机械重复

### context 健康

- 本轮 mission 清晰
- 事件来源明确
- durable memory 被正确带入

---

## 4. 每周复盘清单

建议每周做一次更高层的复盘。

## 4.1 看哪些 loop 值得保留

保留一个 loop，至少应该满足其中 2-3 条：

- 能持续产出有价值 brief
- memory 有真实演进
- 很少 block
- 不需要高频人工干预
- 对核心 repo 有实质帮助

## 4.2 看哪些 loop 应该暂停或删除

建议暂停 / 删除的典型信号：

- 长期没有有效产出
- brief 反复空转
- 经常失败但没有积累价值
- 目标不清晰
- 与别的 loop 重复
- 只是临时任务，却被错误做成长期 loop

## 4.3 看哪些 loop 应该变成有限型

如果出现这些情况，建议改成：

- `--max-iterations`
- `--stop-on-success`

适合信号：

- 本质是调查任务，不该长期常驻
- 本质是阶段性治理，不该永久运行
- 经常“做完了又继续空转”

## 4.4 看哪些 loop 应该升级成编排

如果你发现一个 loop 同时做了：

- 检测
- 分析
- 修复
- 通知

可以考虑拆成多个 loop：

- 上游检测 loop
- 下游执行 loop
- 通知 / 整理 loop

这样比让一个 loop 包办所有职责更稳定。

---

## 5. 新增 loop 的准入规则

建议新增 loop 前，先过 5 个问题：

1. 目标是否清晰？
2. 这个工作是否真的是持续性的？
3. 是否已经有别的 loop 覆盖？
4. 边界是否明确？
5. 失败后是否容易恢复？

如果其中 3 个以上答不清，先不要建长期 loop。

更稳妥做法：

- 先 `run-now` 验证
- 或用有限型 loop 模板

---

## 6. 推荐的参数治理策略

## 6.1 默认建议

对于大多数长期 loop，建议默认有：

- `cooldown`
- `max-auto-runs`
- `max-failures`
- `retry-backoff`

对于调查型 / 阶段型 loop，建议默认有：

- `max-iterations`
- `stop-on-success`

## 6.2 不建议的配置

以下配置容易让系统失控：

- 很短 interval，但没有 cooldown
- 没有失败预算
- 没有 daily cap
- 没有停止条件
- prompt 过大、目标过泛

---

## 7. 运营动作建议库

## 7.1 loop 跑太频繁

处理：

```bash
happy loop update <loopId> --cooldown 30m
happy loop update <loopId> --max-auto-runs 6
```

## 7.2 loop 长期空转

处理：

- 收紧 prompt
- 强化 focus
- 增加 `--max-iterations`
- 开启 `--stop-on-success`

## 7.3 loop 经常失败

处理：

```bash
happy loop update <loopId> --max-failures 2 --retry-backoff 15m
```

再检查：

- 是否需要降频
- 是否需要拆分成两个 loop
- 是否任务本身不适合长期自治

## 7.4 loop 完成阶段任务后应该停掉

处理：

```bash
happy loop update <loopId> --stop-on-success
```

或：

```bash
happy loop update <loopId> --max-iterations 3
```

## 7.5 多个 loop 重复做类似事情

处理：

- 保留最清晰的那个
- 其他 pause 或 remove
- 如果职责不同，就做 upstream/downstream 编排

---

## 8. Auto-Dream 的运营建议

Auto-Dream 不适合拿来替代 loop 运营，它更像高层整理层。

建议使用方式：

- 每天看 loop brief
- 每周看 dream report
- 用 dream report 判断：
  - 哪些 loop 真有长期价值
  - 哪些工作在重复
  - 哪些焦点长期没有推进

如果 Auto-Dream 长期没有有价值输出，通常不是它本身的问题，而是底层 loop 的 memory 质量不够高。

---

## 9. 建议的团队协作模式

如果不止一个人会操作 Happy，建议分工：

### Operator

负责：

- 日常巡检
- 处理 blocked / paused / failed loop
- 调整参数

### Designer

负责：

- 定义 loop 的目标和边界
- 设计 prompt / focus / memory 策略
- 决定是否拆分多个 loop

### Reviewer

负责：

- 判断哪些 loop 真有价值
- 决定是否保留、升级或下线

---

## 10. 推荐的最小运营节奏

如果你不想搞太复杂，最小可行节奏就是：

### 每天 5 分钟

- 打开 `Machine -> Automation`
- 看 rollup
- 看 failed / blocked / pending events
- 打开 1-3 个重点 loop 的 brief

### 每周 20 分钟

- 看哪些 loop 没价值
- 看哪些 loop 需要更多边界
- 看是否要新增 bootstrap / Auto-Dream profile

### 每月一次

- 清理长期无效 loop
- 合并重复 loop
- 更新模板与最佳实践

---

## 11. 运营时最重要的判断标准

一个健康的自主系统，不是 loop 越多越好，而是：

- 能稳定运行
- 有边界
- 有产物
- 有可观测性
- 能复盘和收敛

如果某个 loop 不能满足这些条件，即使它“看起来很自动”，也不应该继续扩大使用范围。
