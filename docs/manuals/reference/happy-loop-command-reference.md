# Happy 自主 Loop 命令参考

这份文档用于快速查 `happy loop` 相关命令与参数。

> 如果你是第一次使用，先看：`docs/manuals/getting-started/happy-loop-operator-manual.md`

## 1. 核心命令总览

### Loop 本体

- `happy loop create`
- `happy loop update <loopId>`
- `happy loop list`
- `happy loop show <loopId>`
- `happy loop pause <loopId>`
- `happy loop resume <loopId>`
- `happy loop run-now <loopId>`
- `happy loop remove <loopId>`

### Loop 产物 / 状态

- `happy loop brief <loopId>`
- `happy loop memory <loopId>`
- `happy loop context <loopId>`

### Loop 事件

- `happy loop event <loopId> --title "..."`
- `happy loop ci-event ...`
- `happy loop github-actions-webhook ...`

### 建议与批量落地

- `happy loop suggest --path <dir>`
- `happy loop bootstrap --root <dir>`
- `happy loop bootstrap-profile ...`

### Auto-Dream

- `happy loop dream-profile ...`

---

## 2. `happy loop create`

### 作用

创建一个新的自主 loop。

### 最小参数

```bash
happy loop create \
  --path <dir> \
  --interval <10m> \
  --prompt "..."
```

### 常用参数

#### 基本信息

- `--name <name>`：loop 名称
- `--path <dir>` / `--directory <dir>`：仓库或工作目录
- `--interval <10m>`：调度周期
- `--prompt "..."`：loop 主任务描述
- `--agent <claude|codex|gemini>`：指定 agent
- `--project <id>`：项目 ID
- `--profile <id>`：profile ID

#### 上下文与记忆

- `--goal "..."`：长期目标
- `--focus "..."`：当前焦点
- `--working-memory "..."`：工作记忆
- `--reflection "..."`：反思摘要种子

#### 自动唤醒来源

- `--file-watch`：启用文件观察
- `--github-bridge`：启用 GitHub bridge
- `--ci-bridge`：启用 CI bridge
- `--event-source <name>`：允许的事件来源
- `--event-keyword <text>`：事件关键词过滤

#### 失败与节流策略

- `--max-failures <n>`：最大连续失败次数
- `--retry-backoff <10m>`：失败回退时间
- `--cooldown <10m>`：自动运行冷却时间
- `--quiet-start <HH:MM>`：安静时段开始
- `--quiet-end <HH:MM>`：安静时段结束
- `--max-auto-runs <n>`：每天自动运行上限

#### 停止条件

- `--max-iterations <n>`：最大迭代次数
- `--stop-on-success`：成功后自动停止

#### 编排

- `--downstream-loop <id>`：下游 loop
- `--downstream-trigger <completed|failed>`：何时触发下游

#### 通知

- `--notify-event <completed|failed|blocked|brief>`
- `--notify-channel <push|webhook>`
- `--notify-webhook <url>`

#### 环境变量

- `--env KEY=value`

#### 运行方式

- `--no-run-now`：创建后先不立即运行
- `--json`：输出 JSON

---

## 3. `happy loop update <loopId>`

### 作用

更新一个已有 loop 的配置。

### 常见修改

#### 修改节流策略

```bash
happy loop update <loopId> --cooldown 30m
happy loop update <loopId> --quiet-start 23:00 --quiet-end 07:00
happy loop update <loopId> --max-auto-runs 8
```

#### 修改停止条件

```bash
happy loop update <loopId> --max-iterations 5
happy loop update <loopId> --stop-on-success
happy loop update <loopId> --no-stop-on-success
```

#### 修改失败策略

```bash
happy loop update <loopId> --max-failures 3 --retry-backoff 10m
```

#### 修改事件过滤

```bash
happy loop update <loopId> --event-source github-webhook
happy loop update <loopId> --event-keyword ci
```

### 常见清空参数

- `--clear-name`
- `--clear-project`
- `--clear-profile`
- `--clear-event-sources`
- `--clear-event-keywords`
- `--clear-goal`
- `--clear-focus`
- `--clear-working-memory`
- `--clear-reflection`
- `--clear-max-failures`
- `--clear-retry-backoff`
- `--clear-cooldown`
- `--clear-quiet-start`
- `--clear-quiet-end`
- `--clear-max-auto-runs`
- `--clear-max-iterations`
- `--clear-downstream-loops`
- `--clear-downstream-triggers`
- `--clear-notify-events`
- `--clear-notify-channels`
- `--clear-notify-webhook`
- `--clear-env`

---

## 4. `happy loop list`

### 作用

查看所有 loop 的摘要列表。

### 主要看什么

- `state=`：runtime / phase
- `failures=`：失败计数
- `policy=`：当前策略门槛或停止原因
- `cap=`：当天自动运行计数 / 上限
- `iterCap=`：当前迭代 / 最大迭代
- `stopOnSuccess=`：是否成功后停止
- `every=`：运行周期
- `next=`：下次运行时间

---

## 5. `happy loop show <loopId>`

### 作用

查看单个 loop 的完整详情。

### 最值得关注的字段

- `Runtime`
- `Phase`
- `Failures`
- `Cooldown`
- `Quiet hours`
- `Max auto-runs/day`
- `Max iterations`
- `Stop on success`
- `Stop reason`
- `Blocked reason`
- `Last brief`
- `Memory file`
- `Context file`
- `Current focus`
- `Working memory`
- `Reflection summary`

---

## 6. `pause` / `resume` / `run-now`

### `happy loop pause <loopId>`

暂停自动运行。

### `happy loop resume <loopId>`

恢复自动运行。

### `happy loop run-now <loopId>`

立即手动触发一次运行。

常用于：

- 验证 loop 是否正常
- 暂时绕过自动运行策略门槛做人工检查
- 在调参数后手动验证效果

---

## 7. `brief` / `memory` / `context`

### `happy loop brief <loopId>`

查看最近一次 brief。

### `happy loop memory <loopId>`

查看 durable memory。

### `happy loop context <loopId>`

查看本轮调度上下文。

建议顺序：

1. `brief`
2. `memory`
3. `context`

---

## 8. `happy loop event`

### 作用

向 loop 注入一个事件。

### 基本用法

```bash
happy loop event <loopId> \
  --title "CI failed on main" \
  --details "workflow=test" \
  --source github
```

### 参数

- `--title <text>`：事件标题
- `--details <text>`：事件详情
- `--source <name>`：事件来源
- `--no-auto-run`：只入队，不立即唤醒
- `--json`：输出 JSON

---

## 9. `happy loop suggest`

### 作用

分析某个目录，生成推荐 loop。

### 常见用法

```bash
happy loop suggest --path ~/Documents/dev-workspace
happy loop suggest --path ~/Documents/dev-workspace --create
happy loop suggest --path ~/Documents/dev-workspace --create --run-now
```

### 参数

- `--path <dir>`
- `--agent <claude|codex|gemini>`
- `--project <id>`
- `--profile <id>`
- `--create`
- `--run-now`
- `--json`

---

## 10. `happy loop bootstrap`

### 作用

扫描更大范围目录，批量生成 / 落地 loop。

### 常见用法

```bash
happy loop bootstrap --root ~/Documents/dev-workspace
happy loop bootstrap --root ~/Documents/dev-workspace --create
happy loop bootstrap --root ~/Documents/dev-workspace --create --run-now
```

### 参数

- `--root <dir>`
- `--depth <n>`
- `--limit <n>`
- `--agent <claude|codex|gemini>`
- `--project <id>`
- `--profile <id>`
- `--create`
- `--run-now`
- `--json`

---

## 11. `happy loop bootstrap-profile`

### 作用

让 daemon 周期性执行 bootstrap。

### 子命令

- `list`
- `show <profileId>`
- `create ...`
- `update <profileId> ...`
- `pause <profileId>`
- `resume <profileId>`
- `run-now <profileId>`
- `remove <profileId>`

### `create` 常用参数

- `--name <name>`
- `--root <dir>`
- `--interval <6h>`
- `--depth <n>`
- `--limit <n>`
- `--agent <claude|codex|gemini>`
- `--project <id>`
- `--profile <id>`
- `--auto-run-created`
- `--run-now`
- `--json`

---

## 12. `happy loop dream-profile`

### 作用

管理 Auto-Dream 背景记忆整理 profile。

### 子命令

- `list`
- `show <profileId>`
- `create ...`
- `update <profileId> ...`
- `pause <profileId>`
- `resume <profileId>`
- `run-now <profileId>`
- `remove <profileId>`

### `create` 常用参数

- `--name <name>`
- `--root <dir>`
- `--interval <12h>`
- `--depth <n>`
- `--limit <n>`
- `--run-now`
- `--json`

---

## 13. `ci-event` 与 `github-actions-webhook`

### `happy loop ci-event`

适合：

- 手动模拟 CI 事件
- 从外部系统桥接 CI 状态

### `happy loop github-actions-webhook`

适合：

- 直接注入 GitHub Actions webhook payload

这两类命令主要用于更高级的事件驱动接入场景。

---

## 14. 最常用命令组合

### 创建 -> 查看 -> 运行 -> 检查产物

```bash
happy loop create --path /path/to/repo --interval 15m --prompt "..."
happy loop list
happy loop show <loopId>
happy loop run-now <loopId>
happy loop brief <loopId>
happy loop memory <loopId>
```

### 调整策略

```bash
happy loop update <loopId> --cooldown 30m --max-auto-runs 8
happy loop update <loopId> --max-iterations 5 --stop-on-success
```

### 批量铺开

```bash
happy loop suggest --path ~/Documents/dev-workspace --create
happy loop bootstrap --root ~/Documents/dev-workspace --create
```

### 背景整理

```bash
happy loop dream-profile create --root ~/Documents/dev-workspace --interval 12h --run-now
```
