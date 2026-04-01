# Happy 自主 Loop 模板库

这份文档提供可以直接复制的 loop / bootstrap / Auto-Dream 模板。

> 用法建议：先复制最接近你场景的模板，再按 repo 路径、prompt、目标、边界做微调。

## 1. 最保守的长期守护模板

适合：

- 核心 repo
- 希望长期自治，但不想太激进

```bash
happy loop create \
  --name "repo-guardian" \
  --path /path/to/repo \
  --interval 15m \
  --prompt "Continuously inspect this repository, identify the safest highest-value next step, and keep it healthy over time." \
  --goal "Keep this repository healthy without manual babysitting" \
  --focus "Start from failing checks, regressions, and obvious maintenance gaps" \
  --working-memory "Prefer safe incremental progress. Avoid broad rewrites unless strongly justified." \
  --cooldown 30m \
  --max-auto-runs 8 \
  --max-failures 3 \
  --retry-backoff 10m
```

## 2. 夜间安静的长期模板

适合：

- 白天可以自动跑
- 夜里不希望惊扰或产生大动作

```bash
happy loop create \
  --name "daytime-guardian" \
  --path /path/to/repo \
  --interval 20m \
  --prompt "Keep this repository healthy and steadily improve its state." \
  --goal "Maintain stable forward progress during business hours" \
  --cooldown 30m \
  --quiet-start 23:00 \
  --quiet-end 07:00 \
  --max-auto-runs 6 \
  --max-failures 3 \
  --retry-backoff 15m
```

## 3. CI 失败处理模板

适合：

- CI 失败时醒来
- 平时尽量少跑

```bash
happy loop create \
  --name "ci-triage" \
  --path /path/to/repo \
  --interval 1h \
  --prompt "When CI fails, investigate the failure, identify the most useful next action, and drive recovery." \
  --goal "Keep CI green with minimal manual intervention" \
  --event-source github-webhook \
  --event-keyword ci \
  --event-keyword failed \
  --event-keyword workflow \
  --cooldown 20m \
  --max-auto-runs 10 \
  --max-failures 3 \
  --retry-backoff 10m
```

## 4. 文件变化唤醒模板

适合：

- 本地开发目录
- 希望 repo 变化后自动检查

```bash
happy loop create \
  --name "file-watch-guardian" \
  --path /path/to/repo \
  --interval 45m \
  --prompt "Monitor repository changes, detect newly introduced issues or drift, and keep the repo in a healthy state." \
  --goal "React to meaningful codebase changes without requiring manual checks" \
  --file-watch \
  --cooldown 20m \
  --max-auto-runs 10 \
  --max-failures 3 \
  --retry-backoff 10m
```

## 5. 有限轮次调查模板

适合：

- flaky test 调查
- 一次性专项分析
- 想让系统做几轮就停

```bash
happy loop create \
  --name "bounded-investigation" \
  --path /path/to/repo \
  --interval 20m \
  --prompt "Investigate the target problem thoroughly, produce clear findings, and stop when the work is complete or bounded iterations are exhausted." \
  --goal "Resolve or clarify one bounded investigation autonomously" \
  --focus "Narrow to the highest-signal failure or uncertainty" \
  --max-iterations 5 \
  --stop-on-success \
  --max-failures 2 \
  --retry-backoff 15m
```

## 6. 文档维护模板

适合：

- README / docs / changelog 持续整理
- 较低风险内容维护

```bash
happy loop create \
  --name "docs-maintainer" \
  --path /path/to/repo \
  --interval 6h \
  --prompt "Continuously improve repository documentation so it stays accurate, usable, and aligned with current code and workflows." \
  --goal "Keep repo documentation current and useful" \
  --focus "Start from obvious drift between code, docs, and operator flows" \
  --cooldown 2h \
  --max-auto-runs 4 \
  --max-failures 2 \
  --retry-backoff 30m
```

## 7. 技术债清理模板

适合：

- TODO / lint / small cleanup
- 持续性小修小补

```bash
happy loop create \
  --name "debt-gardener" \
  --path /path/to/repo \
  --interval 4h \
  --prompt "Continuously identify and chip away at the highest-value low-risk technical debt in this repository." \
  --goal "Reduce technical debt through steady low-risk iteration" \
  --focus "Prioritize low-risk, high-signal cleanup over broad refactors" \
  --cooldown 1h \
  --max-auto-runs 4 \
  --max-failures 2 \
  --retry-backoff 20m
```

## 8. 多 Loop 编排模板

适合：

- 上游检测 + 下游执行
- 需要拆分职责

### 上游 loop

```bash
happy loop create \
  --name "ci-detector" \
  --path /path/to/repo \
  --interval 30m \
  --prompt "Detect CI regressions and produce precise downstream triggers." \
  --goal "Act as an upstream detector loop" \
  --event-source github-webhook \
  --event-keyword ci
```

### 下游 loop

```bash
happy loop create \
  --name "ci-remediator" \
  --path /path/to/repo \
  --interval 1h \
  --prompt "Respond to upstream CI failure signals and drive useful remediation work." \
  --goal "Handle remediation after upstream detection"
```

然后把两者连起来：

```bash
happy loop update <upstreamLoopId> \
  --downstream-loop <downstreamLoopId> \
  --downstream-trigger completed
```

## 9. 通知模板

### 成功 + brief 推送

```bash
happy loop update <loopId> \
  --notify-event completed \
  --notify-event brief \
  --notify-channel push
```

### 失败 webhook 告警

```bash
happy loop update <loopId> \
  --notify-event failed \
  --notify-channel webhook \
  --notify-webhook https://example.com/hook
```

## 10. 批量建议落地模板

### 先看建议

```bash
happy loop suggest --path ~/Documents/dev-workspace
```

### 直接创建建议

```bash
happy loop suggest --path ~/Documents/dev-workspace --create
```

### 创建并立即运行

```bash
happy loop suggest --path ~/Documents/dev-workspace --create --run-now
```

## 11. Bootstrap 模板

### 一次性扫描并生成

```bash
happy loop bootstrap --root ~/Documents/dev-workspace --depth 4 --limit 20
```

### 一次性扫描并创建

```bash
happy loop bootstrap --root ~/Documents/dev-workspace --depth 4 --limit 20 --create
```

### 创建并立即跑

```bash
happy loop bootstrap --root ~/Documents/dev-workspace --depth 4 --limit 20 --create --run-now
```

## 12. Bootstrap Profile 模板

适合：

- 想让 daemon 持续发现新 repo
- 不想反复手动 bootstrap

```bash
happy loop bootstrap-profile create \
  --root ~/Documents/dev-workspace \
  --interval 6h \
  --depth 4 \
  --limit 20 \
  --auto-run-created
```

## 13. Auto-Dream 模板

### 单 workspace 背景 dream

```bash
happy loop dream-profile create \
  --root ~/Documents/dev-workspace \
  --interval 12h \
  --name "workspace-dream" \
  --depth 4 \
  --limit 50 \
  --run-now
```

### 单 repo 小范围 dream

```bash
happy loop dream-profile create \
  --root /path/to/repo \
  --interval 24h \
  --name "repo-dream" \
  --depth 2 \
  --limit 10
```

## 14. 模板选型建议

如果你不知道该选哪个，按这个顺序判断：

- 想长期看护 repo：用“最保守的长期守护模板”
- 想只在 CI 问题出现时醒来：用“CI 失败处理模板”
- 想只做几轮就停：用“有限轮次调查模板”
- 想批量铺开：先用 Suggest / Bootstrap 模板
- 想做高层记忆整理：用 Auto-Dream 模板

## 15. 一个最推荐的起步模板

如果你只想先成功一次，建议直接用这个：

```bash
happy loop create \
  --name "repo-guardian" \
  --path /path/to/repo \
  --interval 15m \
  --prompt "Continuously inspect this repository, identify the safest highest-value next step, and keep it healthy over time." \
  --goal "Keep this repository healthy without manual babysitting" \
  --focus "Start from failing checks, regressions, and obvious maintenance gaps" \
  --working-memory "Prefer safe incremental progress. Avoid broad rewrites unless strongly justified." \
  --cooldown 30m \
  --max-auto-runs 8 \
  --max-failures 3 \
  --retry-backoff 10m
```

然后按顺序执行：

```bash
happy loop list
happy loop show <loopId>
happy loop run-now <loopId>
happy loop brief <loopId>
happy loop memory <loopId>
```

只要这条链路通了，你再慢慢升级到事件驱动、批量 bootstrap、Auto-Dream 就会顺很多。
