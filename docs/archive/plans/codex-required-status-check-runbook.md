# Codex App Server Contract Required Status Check Runbook

## Status

- Drafted on 2026-04-21
- Scope: GitHub-side enforcement for the `Codex App Server Contract` check
- Related files:
  - `.github/workflows/codex-app-server-contract.yml`
  - `.github/pull_request_template.md`
  - `docs/plans/codex-upstream-alignment-roadmap.md`

## Goal

把仓库里的 `Codex App Server Contract` workflow 从“会自动跑的 CI”升级成“**必须通过才能合并**”的 required status check。

## What this runbook covers

- 为什么当前 workflow 采用 **always-on + job-internal short-circuit**
- 在 GitHub 仓库设置中如何把 check 设成 required
- 如何验证规则是否真的生效
- 常见误区和失败模式

## Current check identity

当前应被设置为 required 的 check 名称是：

- **`codex-app-server-contract`**

> 注意：这里指的是 workflow 中 **job name**，不是 workflow 文件名。  
> 我们已经把 job name 固定下来，避免 required check 名称漂移。

## Why we must NOT use workflow-level path filtering for a required check

GitHub 的 required status check 有一个很容易踩的坑：

- 如果 workflow 因 `paths` / `branches` / commit message 过滤而**根本没触发**
- required check 可能会停在 **Pending**
- 最终会把**完全无关的 PR 也卡住**

所以当前实现采用：

- workflow **始终触发**
  - `pull_request`
  - `push` to `main`
  - `merge_group`
  - `workflow_dispatch`
- job 内部再判断：
  - 命中 Codex contract 相关路径 → 跑 `yarn codex:verify-app-server-contract`
  - 没命中 → 快速成功退出

这套模式就是为了让它适合当 required check。

## Preconditions

在 GitHub 仓库设置 required status check 之前，先确认：

1. workflow 已经存在于默认分支
2. `codex-app-server-contract` 这个 check 名称已经**成功跑过至少一次**
3. 最近 7 天内该 check 在仓库里有成功记录

> GitHub 文档明确提到：要被设成 required，status check 需要在目标仓库中最近成功出现过。

## Repository admin execution checklist

> 这是一份给仓库管理员的最小执行清单。  
> 如果你只想知道“现在该点什么、验什么”，直接照着这份走。

## 5-minute admin checklist (copy-paste version)

把下面这段直接发给有仓库管理员权限的人即可：

```md
请帮忙把 `Codex App Server Contract` 配成仓库默认分支的 required status check。

目标 check 名称：
- `codex-app-server-contract`

请按下面顺序操作：

1. 确认这个 check 最近 7 天内成功跑过至少一次
2. 打开仓库 GitHub 页面
3. 进入 `Settings` → `Rules` → `Rulesets`
4. 找到默认分支（通常是 `main`）对应的 branch ruleset
5. 打开 `Require status checks to pass before merging`
6. 添加 required check：
   - `codex-app-server-contract`
7. source 先保持 `any source`
8. 保存规则

保存后请做两个快速验证：

A. 发一个**无关改动** PR
- 预期：`Codex App Server Contract` check 会出现
- 预期：会快速成功退出
- 预期：不会卡成 Pending

B. 发一个**命中 Codex contract 路径**的 PR
- 例如改：
  - `packages/happy-cli/src/codex-app/**`
  - `packages/happy-cli/src/codex-app/__fixtures__/**`
  - `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`
- 预期：check 会跑完整 verify 链
- 预期：失败会挡住合并

如果 check 在规则页里找不到，请先确认：
- workflow 已经在默认分支
- job name 还是 `codex-app-server-contract`
- 最近 7 天内成功跑过
```

### A. 代码侧准备

- [ ] `Codex App Server Contract` workflow 已合入默认分支
- [ ] workflow job name 确认仍为：
  - `codex-app-server-contract`
- [ ] 本地或 CI 已成功执行：
  - `yarn codex:verify-app-server-contract`
- [ ] 最近 7 天内，该 check 在仓库里至少成功出现过一次

### B. GitHub 仓库后台配置

- [ ] 打开仓库 `Settings`
- [ ] 进入 `Rules` → `Rulesets`
- [ ] 找到默认分支（通常 `main`）对应 ruleset，或新建一个 branch ruleset
- [ ] 打开：
  - `Require status checks to pass before merging`
- [ ] 添加 required check：
  - `codex-app-server-contract`
- [ ] source 先选择：
  - `any source`
- [ ] 不要顺手修改与本次目标无关的其它 rules

### C. 设置后验证

- [ ] 使用 GitHub CLI 查看 ruleset：
  - `gh ruleset list --repo kmmao/happy --parents`
- [ ] 检查默认分支规则命中情况：
  - `gh ruleset check --default --repo kmmao/happy`
- [ ] 发一个**无关改动** PR
  - 预期：check 出现并快速成功
  - 预期：不会 Pending 卡住
- [ ] 发一个**命中 Codex contract 路径**的 PR
  - 预期：check 跑完整 verify 链
  - 预期：失败会阻止合并

### D. 异常回退判断

如果下面任一项不满足，先不要宣布“required status check 已落地”：

- [ ] check 名称在 GitHub 规则页里能被选到
- [ ] 无关 PR 不会被 Pending 卡住
- [ ] 命中路径的 PR 确实被 check 约束
- [ ] reviewer 知道这个 check 名称和用途

### E. 完成定义

只有同时满足以下 4 条，才算完成：

- [ ] 仓库规则里已经配置 required check
- [ ] CI 会自动跑 `Codex App Server Contract`
- [ ] 无关 PR 不会被错误阻塞
- [ ] 命中 contract 路径的 PR 会被真正拦住

## Step-by-step setup (recommended: Rulesets)

### Option A — Repository Rulesets（推荐）

1. 打开仓库 GitHub 页面
2. 进入：
   - `Settings`
   - `Rules`
   - `Rulesets`
3. 为默认分支（通常是 `main`）创建或编辑 branch ruleset
4. 开启：
   - **Require status checks to pass before merging**
5. 添加 required check：
   - `codex-app-server-contract`
6. 如果仓库已经整体采用 strict 模式，可继续保持
7. 如果只是为 Codex contract 增加 required check，不要顺手改动其它无关分支规则

### Option B — Legacy branch protection（可用但不优先）

如果仓库还没迁移到 rulesets，也可以在：

- `Settings`
- `Branches`
- branch protection rule

里把 `codex-app-server-contract` 加为 required status check。

但从长期治理角度，更推荐 rulesets。

## Source selection guidance

GitHub rulesets/branch protection 可以要求 status check 来自特定 source/app。

当前建议：

- **先选 any source**

原因：

- 现阶段目标是先把 required check 规则稳定落地
- 如果立即绑定到特定 source，而仓库当前 check 历史或 app source 识别不稳定，容易先把合并流程搞死

如果后续需要进一步收紧，再考虑把来源限制到 GitHub Actions 对应 source。

## Merge queue note

如果仓库启用了 merge queue：

- workflow 必须包含 `merge_group`

当前 `Codex App Server Contract` workflow 已包含：

- `merge_group`

所以这一点已经满足。

## Validation after setup

完成设置后，至少做这几步验证：

### A. 本地命令链

```bash
yarn codex:verify-app-server-contract
```

### B. 查看仓库 rulesets

```bash
gh ruleset list --repo kmmao/happy --parents
```

### C. 查看默认分支受哪些规则影响

```bash
gh ruleset check --default --repo kmmao/happy
```

### D. 发一个只改无关文件的 PR

预期：

- `Codex App Server Contract` check 会出现
- 但应该快速成功退出
- 不应卡成 Pending

### E. 发一个改动 Codex contract 路径的 PR

例如修改：

- `packages/happy-cli/src/codex-app/**`
- `packages/happy-cli/src/codex-app/__fixtures__/**`
- `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`

预期：

- `Codex App Server Contract` check 会跑完整 verify 链
- 如果 schema 子集漂移或 contract 测试失败，PR 被挡住

## What to do if the check does not appear in required check picker

优先检查：

1. workflow 是否已合入默认分支
2. `codex-app-server-contract` 是否最近 7 天内成功运行过
3. job name 是否仍然是：
   - `codex-app-server-contract`
4. 仓库设置里选择的是 check name，不是 workflow filename

## Common failure modes

### 1. 无关 PR 被卡成 Pending

通常说明：

- workflow 还在用 workflow-level `paths` filter

而不是当前的 always-on + short-circuit 方案。

### 2. check 名称找不到

通常说明：

- workflow 刚创建，还没在默认分支成功跑过
- 或 job name 改了

### 3. PR 作者说“我以为不用跑 verify”

当前解决方式：

- PR template 已经把触发路径写死
- reviewer 应要求作者补：
  - refresh 结果
  - verify 结果

## Operational rule

一旦这个 check 被设成 required，以下改动默认都应视为“必须经过 Codex contract 守门”：

- `packages/happy-cli/src/codex-app/**`
- `packages/happy-cli/src/codex-app/__fixtures__/**`
- `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`
- `packages/happy-cli/package.json`
- `package.json`
- `.github/workflows/codex-app-server-contract.yml`

## Non-goals

这份 runbook 不负责：

- 直接替你改 GitHub 仓库后台设置
- 直接把 required check 配成 GitHub org 级强制 ruleset
- 处理所有其它 CI checks 的 required 策略

## Sources

- GitHub Docs — Creating rulesets for a repository
- GitHub Docs — Available rules for rulesets
- GitHub Docs — Troubleshooting required status checks
- GitHub CLI — `gh ruleset list`
- GitHub CLI — `gh ruleset check`
