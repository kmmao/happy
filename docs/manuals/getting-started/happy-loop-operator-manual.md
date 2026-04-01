# Happy 自主 Loop 操作手册

> 适用对象：想把 Happy 的自主 Agent / loop / brief / memory / Auto-Dream / automation 面板真正用起来的操作者。

## 1. 这套系统到底是什么

Happy 现在的自主系统不是一个额外的旁路守护进程，而是建立在 **同一套 daemon automation runtime** 上的能力组合：

- **Agent Loop**：真正执行自主工作的循环体
- **Brief**：每次 loop 结束后生成的结果摘要
- **Memory / Context**：loop 的长期记忆与本轮上下文
- **Auto-Dream**：后台定期汇总多个 loop 的 memory，生成高层 dream report
- **Automation 面板**：查看 jobs / guardians / audit / loop rollup 的总控视图

可以把它理解成：

- Loop 负责“做事”
- Brief 负责“总结这次做了什么”
- Memory 负责“下次继续从哪里接上”
- Auto-Dream 负责“更高层的长期整理”
- Automation 面板负责“观察整套自主系统现在是否健康”

---

## 2. 你最常用的入口

### CLI 入口

核心命令都在 `happy loop ...`：

- 创建 loop：`happy loop create`
- 查看 loop 列表：`happy loop list`
- 查看 loop 详情：`happy loop show <loopId>`
- 手动立即运行：`happy loop run-now <loopId>`
- 暂停 / 恢复：`happy loop pause <loopId>` / `happy loop resume <loopId>`
- 注入事件：`happy loop event <loopId> --title "..."`
- 查看 brief：`happy loop brief <loopId>`
- 查看 memory：`happy loop memory <loopId>`
- 查看 context：`happy loop context <loopId>`
- 推荐 loops：`happy loop suggest --path <dir>`
- 批量 bootstrap：`happy loop bootstrap --root <dir>`
- 管理 Auto-Dream：`happy loop dream-profile ...`

### App 入口

主要在两个页面：

- `Machine -> Loops`
  - 管 loop
  - 看 brief / memory / context
  - 看 suggestions / bootstrap / Auto-Dream
- `Machine -> Automation`
  - 看 jobs / guardians / audit
  - 看 loop rollup 汇总
  - 判断整套自主系统是否健康

---

## 3. 第一次上手：推荐使用顺序

如果你第一次真正启用它，建议按下面顺序：

### 路线 A：先手工建一个 loop

1. 先创建一个最简单的 loop
2. 观察它是否能正常 run / brief / memory
3. 再给它加策略、事件源、通知、下游 loop

示例：

```bash
happy loop create \
  --path /path/to/repo \
  --interval 10m \
  --prompt "Continuously inspect the repo, identify the highest-value next step, and keep progress moving." \
  --goal "Keep this repo moving forward autonomously" \
  --focus "Start from test failures, TODOs, and open change hotspots" \
  --working-memory "Prefer safe incremental progress over broad rewrites"
```

### 路线 B：先让系统推荐 loop

如果你机器上已经有很多 repo，更推荐先让系统给建议：

```bash
happy loop suggest --path ~/Documents/dev-workspace
```

如果建议合理，可以直接落地：

```bash
happy loop suggest --path ~/Documents/dev-workspace --create
```

如果你还想创建完就立刻运行：

```bash
happy loop suggest --path ~/Documents/dev-workspace --create --run-now
```

App 里也可以在 `Machine -> Loops` 页面直接：

- 查看 suggestion
- 单个采纳
- **全部采纳**

---

## 4. 最小可用工作流

这是最推荐的“先跑起来”闭环：

### 第一步：创建 loop

```bash
happy loop create \
  --name "repo-autopilot" \
  --path /path/to/repo \
  --interval 15m \
  --prompt "Inspect repo health, detect the next best engineering action, and execute or prepare it." \
  --goal "Keep the repo healthy without waiting for manual prompting"
```

### 第二步：看 loop 状态

```bash
happy loop list
happy loop show <loopId>
```

重点关注：

- `Runtime`
- `Phase`
- `Next run`
- `Failures`
- `Last brief`
- `Memory file`
- `Context file`
- `Stop reason`

### 第三步：手动触发一次

```bash
happy loop run-now <loopId>
```

### 第四步：检查产物

```bash
happy loop brief <loopId>
happy loop memory <loopId>
happy loop context <loopId>
```

如果这三样都有内容，说明闭环已经通了：

- 跑了一轮
- 生成了总结
- 写入了持续记忆
- 保存了本轮上下文

---

## 5. 重要概念：Brief / Memory / Context 有什么区别

### Brief

`brief-latest.md` 是“这次跑完的摘要”。

适合用来：

- 快速看 loop 最近做了什么
- 发通知
- 给你做管理层面的扫一眼

命令：

```bash
happy loop brief <loopId>
```

### Memory

`memory.md` 是“这个 loop 的长期记忆”。

适合用来：

- 保存长期目标
- 保存当前焦点
- 保存长期约束、假设、线索
- 让下一轮 run 能接上上一次的思路

命令：

```bash
happy loop memory <loopId>
```

### Context

`context.md` 是“这一次调度前注入给 agent 的上下文快照”。

适合用来：

- 了解本轮到底带着什么任务和触发信息启动
- 排查“为什么这次 agent 会这么做”

命令：

```bash
happy loop context <loopId>
```

---

## 6. 在 UI 里怎么操作

## 6.1 `Machine -> Loops`

这个页面是日常主要入口。

你能做的事：

- 创建 loop
- 编辑 loop
- 查看 loop 详情
- Run Now / Pause / Resume / Remove
- Trigger Event
- 查看 Brief
- 查看 Memory
- 查看 Context
- 查看 Suggestions 并采纳
- 执行 Bootstrap
- 管理 Auto-Dream Profiles

### 查看文件产物

点开某个 loop 的操作菜单后，可以直接打开：

- Brief
- Memory
- Context

进入文件查看页后，支持：

- 复制内容
- 复制路径
- 在机器上打开原文件
- 搜索
- 匹配跳转
- 聚焦上下文 / 全文模式
- 自动刷新
- 变化提示
- 自动切到 Diff
- 清理快照
- 查看前后版本 Diff

这对排查“loop 最近有没有在持续写 memory、brief 有没有更新”很重要。

## 6.2 `Machine -> Automation`

这个页面用于看“整套自主系统是否正常”。

主要看 4 类信息：

- **Jobs**：正在跑/排队/失败的自动化任务
- **Guardians**：连续性会话守护状态
- **Audit Stats / Audit Events**：系统行为审计与异常痕迹
- **Loop Rollup**：loop 总数、活跃数、阻塞数、暂停数、待处理事件数、策略停止数

建议你用它回答这些问题：

- 现在有没有 loop 在活跃运行？
- 有没有 loop 被 block？
- 有没有 loop 因为策略或停止条件自动停下？
- 有没有 guardian 挂住或需要恢复？
- 最近失败是不是在升高？

---

## 7. 怎么配置 loop 的自动化策略

## 7.1 失败预算

如果你不希望它一直失败重试，可以设置失败预算：

```bash
happy loop update <loopId> --max-failures 3 --retry-backoff 5m
```

含义：

- 最多连续失败 3 次
- 每次失败后等待 5 分钟再尝试下一次

如果达到失败上限，loop 会进入 `blocked`

---

## 7.2 节流策略

### 冷却时间

```bash
happy loop update <loopId> --cooldown 30m
```

用途：

- 避免太频繁自动运行
- 适合成本高、波动大、外部依赖多的 repo

### 安静时段

```bash
happy loop update <loopId> --quiet-start 23:00 --quiet-end 07:00
```

用途：

- 夜间不自动跑
- 避免打扰、避免夜间大规模改动

### 每日自动运行上限

```bash
happy loop update <loopId> --max-auto-runs 8
```

用途：

- 防止 loop 一天内过度消耗资源
- 适合多 repo、多 loop 场景

---

## 7.3 新增：停止条件

这是当前最重要的新能力之一。

### 最大迭代次数

如果你希望一个 loop 只做有限轮数，而不是永远跑：

```bash
happy loop update <loopId> --max-iterations 20
```

效果：

- 当 loop 达到指定 iteration 后
- 自动运行会停止
- loop 会进入暂停状态
- `stopReason` 会记录为 `max-iterations`

适合：

- 一次性治理任务
- 有限扫描 / 有限清理 / 有限修复任务
- 不想长期常驻的短期自主流程

### 成功后自动停止

如果你希望某个 loop 成功做完一次就停：

```bash
happy loop update <loopId> --stop-on-success
```

关闭它：

```bash
happy loop update <loopId> --no-stop-on-success
```

效果：

- 某次 run 成功完成后
- loop 自动暂停
- `stopReason` 会记录为 `stop-on-success`

适合：

- 一次性收尾任务
- 完成 bootstrap 后不想继续常驻
- 某个阶段性迁移完成后自动退出

### 手动运行是否还能继续

可以。

即使 loop 因策略暂停：

```bash
happy loop run-now <loopId>
```

仍然可以手动跑。

如果要重新恢复自动运行：

```bash
happy loop resume <loopId>
```

---

## 8. 事件驱动怎么用

如果你希望 loop 不是纯定时，而是被外部事件唤醒：

### 手动注入事件

```bash
happy loop event <loopId> \
  --source manual \
  --title "CI failed on main" \
  --details "workflow=test"
```

### 限制事件来源

```bash
happy loop update <loopId> --event-source github-webhook
happy loop update <loopId> --event-source file-watch
```

### 限制事件关键词

```bash
happy loop update <loopId> --event-keyword ci
happy loop update <loopId> --event-keyword flaky
```

适合：

- GitHub Actions 失败
- 本地文件变化
- 外部 webhook
- 你手动发出一个“该醒来处理了”的信号

---

## 9. 多 loop 编排怎么用

如果你希望一个 loop 完成后推动另一个 loop：

### 成功后触发下游

```bash
happy loop update <loopId> \
  --downstream-loop <downstreamLoopId> \
  --downstream-trigger completed
```

### 失败后也触发下游

```bash
happy loop update <loopId> --downstream-trigger failed
```

适合做：

- 上游检测 -> 下游修复
- 上游分析 -> 下游整理
- 上游生成结果 -> 下游通知/归档

---

## 10. 通知怎么开

如果你希望 loop 跑完自动告诉你：

### Push 通知

```bash
happy loop update <loopId> \
  --notify-event completed \
  --notify-event brief \
  --notify-channel push
```

### Webhook 通知

```bash
happy loop update <loopId> \
  --notify-event failed \
  --notify-channel webhook \
  --notify-webhook https://example.com/hook
```

适合：

- 成功后收到简报
- 失败后立刻告警
- 把摘要推给外部系统

---

## 11. 建议和批量生成怎么用

## 11.1 Suggest

让系统先分析目录并生成建议：

```bash
happy loop suggest --path ~/Documents/dev-workspace
```

你可以：

- 在 CLI 里看建议
- 在 App 的 `Machine -> Loops` 里看建议卡片
- 单个采纳
- **全部采纳**

## 11.2 Bootstrap

如果你想对一整个 workspace 批量做 loop 初始化：

```bash
happy loop bootstrap --root ~/Documents/dev-workspace
```

直接创建：

```bash
happy loop bootstrap --root ~/Documents/dev-workspace --create
```

创建并立即跑：

```bash
happy loop bootstrap --root ~/Documents/dev-workspace --create --run-now
```

## 11.3 Bootstrap Profile

如果你不想每次手动 bootstrap，可以让 daemon 持续扫描：

```bash
happy loop bootstrap-profile create \
  --root ~/Documents/dev-workspace \
  --interval 6h \
  --depth 4 \
  --limit 20 \
  --auto-run-created
```

常用命令：

```bash
happy loop bootstrap-profile list
happy loop bootstrap-profile show <profileId>
happy loop bootstrap-profile run-now <profileId>
happy loop bootstrap-profile pause <profileId>
happy loop bootstrap-profile resume <profileId>
```

---

## 12. Auto-Dream 怎么用

Auto-Dream 不是第二个 Agent runtime。

它是后台整理服务，负责：

- 扫描 `.happy/agent-loops/**/memory.md`
- 汇总多个 loop 的长期记忆
- 生成 dream report

### 创建 Auto-Dream profile

```bash
happy loop dream-profile create \
  --root ~/Documents/dev-workspace \
  --interval 12h \
  --name "workspace-dream" \
  --depth 4 \
  --limit 50 \
  --run-now
```

### 常用命令

```bash
happy loop dream-profile list
happy loop dream-profile show <profileId>
happy loop dream-profile run-now <profileId>
happy loop dream-profile pause <profileId>
happy loop dream-profile resume <profileId>
happy loop dream-profile remove <profileId>
```

### UI 里怎么用

在 `Machine -> Loops` 页面底部的 `Auto-Dream Profiles` 区块可直接：

- 创建 / 编辑 profile
- 运行
- 暂停 / 恢复
- 删除
- 打开最新 dream report

---

## 13. 推荐的 4 种实际使用方式

## 13.1 长驻型 Repo 守护 Loop

适合：核心 repo 持续健康维护

建议配置：

- `--interval 10m`
- `--file-watch`
- `--ci-bridge`
- `--cooldown 30m`
- `--max-auto-runs 8`
- Push 通知 + Brief

## 13.2 事件驱动型 CI Loop

适合：只在 CI 失败时醒来处理

建议配置：

- `--event-source github-webhook`
- `--event-keyword ci`
- `--event-keyword failed`
- 不需要太短的固定 interval

## 13.3 有限轮次调查 Loop

适合：短期专项排查

建议配置：

- `--max-iterations 5`
- `--stop-on-success`

这样它不是常驻 Agent，而是“限定任务自动体”。

## 13.4 批量初始化 Workspace

适合：大量仓库统一自治

建议流程：

1. `suggest`
2. App 内批量采纳
3. 设置 `bootstrap-profile`
4. 设置 `Auto-Dream`
5. 用 `Automation` 页面做总控

---

## 14. 出问题时你应该先看哪里

### 情况 1：loop 没跑起来

先看：

```bash
happy loop show <loopId>
```

重点检查：

- `Enabled`
- `Runtime`
- `Phase`
- `Next run`
- `Stop reason`
- `Blocked reason`
- `Last error`

再去看 UI：

- `Machine -> Automation`
- `Machine -> Loops`

### 情况 2：loop 运行了但没有连续性

看：

```bash
happy loop memory <loopId>
happy loop context <loopId>
```

如果 memory 为空或长期不更新，说明 loop 没把 durable memory 正常写出来。

### 情况 3：loop 看起来有跑，但你不知道它做了什么

看：

```bash
happy loop brief <loopId>
```

或在 UI 中打开 brief viewer。

### 情况 4：系统整体不健康

去 `Machine -> Automation` 看：

- jobs 是否积压
- guardians 是否异常
- audit 里是否大量失败
- loop rollup 里是否 blocked / policy-stopped 持续上升

---

## 15. 一组推荐命令模板

### 创建一个偏保守的长期 loop

```bash
happy loop create \
  --name "repo-guardian" \
  --path /path/to/repo \
  --interval 15m \
  --prompt "Continuously keep this repository healthy and move it forward safely." \
  --goal "Keep the repository healthy without manual babysitting" \
  --cooldown 30m \
  --quiet-start 23:00 \
  --quiet-end 07:00 \
  --max-auto-runs 8 \
  --max-failures 3 \
  --retry-backoff 10m
```

### 创建一个有限轮次专项 loop

```bash
happy loop create \
  --name "flaky-test-investigation" \
  --path /path/to/repo \
  --interval 20m \
  --prompt "Investigate flaky tests and produce stable next actions." \
  --max-iterations 5 \
  --stop-on-success
```

### 给已有 loop 开启通知

```bash
happy loop update <loopId> \
  --notify-event completed \
  --notify-event brief \
  --notify-channel push
```

### 给已有 loop 增加下游编排

```bash
happy loop update <loopId> \
  --downstream-loop <otherLoopId> \
  --downstream-trigger completed
```

---

## 16. 推荐的日常操作节奏

每天最推荐的检查顺序：

1. 打开 `Machine -> Automation`
   - 看 loop rollup 是否健康
   - 看是否有 blocked / failed / guardians 异常
2. 打开 `Machine -> Loops`
   - 看重点 loop 的状态
   - 看最新 brief
3. 对异常 loop：
   - 看 `show`
   - 看 `brief`
   - 看 `memory`
   - 必要时 `run-now`
4. 对新 repo：
   - 先 `suggest`
   - 再批量采纳或 bootstrap
5. 对长周期系统：
   - 定期开 `Auto-Dream`
   - 用 dream report 看高层趋势

---

## 17. 最后一句：你现在应该怎么开始

如果你想最快进入可用状态，就按这个顺序：

1. 选一个 repo
2. 建一个 loop
3. `run-now`
4. 看 `brief` / `memory` / `context`
5. 去 `Automation` 页面确认系统健康
6. 再逐步加 `cooldown` / `max-auto-runs` / `max-iterations` / `stop-on-success`
7. 最后再启用 `suggest` / `bootstrap` / `Auto-Dream`

如果你这样操作，基本就能把 Happy 的自主系统真正跑起来，而不是只停留在“功能已经开发完成”的状态。
