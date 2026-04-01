# Happy 自主 Loop FAQ

## 1. Happy loop 和健康监测 / research / supervisor 有什么区别？

- `happy loop` 是通用自主循环体，负责长期推进具体任务
- health / research / supervisor 更偏某类已有 automation 场景
- 现在的目标是把自主能力统一收敛到 Happy 的 shared automation plane，而不是再造第二套 daemon

## 2. loop 会不会一直无限跑下去？

可能，但现在已经支持明确边界：

- `--max-auto-runs`
- `--cooldown`
- `--quiet-start` / `--quiet-end`
- `--max-iterations`
- `--stop-on-success`

所以推荐所有生产 loop 都至少设置一种边界。

## 3. `run-now` 会不会被策略挡住？

一般不会。

`run-now` 是手动验证入口，适合在策略挡住自动运行时做人工确认。

## 4. brief、memory、context 应该先看哪个？

推荐顺序：

1. brief：先看最近做了什么
2. memory：再看长期状态有没有演进
3. context：最后看本轮到底带了什么输入

## 5. Auto-Dream 是不是第二个 Agent？

不是。

Auto-Dream 是后台整理层，不负责替代 loop 执行任务。

## 6. Suggestions 和 Bootstrap 有什么区别？

- `suggest`：针对某个目录生成建议
- `bootstrap`：对更大范围目录做扫描和批量落地
- `bootstrap-profile`：把这件事交给 daemon 周期性持续执行

## 7. 为什么我看到 loop 是 paused，不是 blocked？

`paused` 常见于：

- 你手动暂停了
- 命中了 `max-iterations`
- 命中了 `stop-on-success`

`blocked` 常见于：

- 连续失败达到失败预算
- 系统认为不能安全继续自动跑

## 8. `stopReason` 和 `blockedReason` 有什么区别？

- `stopReason`：预期内、策略化、可解释的自动停止
- `blockedReason`：异常或失败导致的阻塞

## 9. App 里应该主要看哪个页面？

- 日常操作：`Machine -> Loops`
- 系统健康：`Machine -> Automation`

## 10. 最推荐的入门方式是什么？

先别一上来开很多 loop。

推荐：

1. 选一个 repo
2. 建一个 loop
3. `run-now`
4. 看 brief / memory / context
5. 再加策略和通知
6. 最后再做批量 bootstrap 和 Auto-Dream
