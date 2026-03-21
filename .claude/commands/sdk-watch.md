分析上游 Claude Code SDK 更新与官方文档变化，找出应集成到本项目的功能

## 使用方式

`/sdk-watch [focus]`

- focus（可选）：`sdk` | `upstream` | `docs` | 不指定则全部执行

## 执行步骤

### 1. Claude Agent SDK 版本分析

检查 `@anthropic-ai/claude-agent-sdk` 和 `@anthropic-ai/sandbox-runtime` 的版本差异：

```bash
# 当前项目使用版本
cat packages/happy-cli/package.json | grep -E "claude-agent-sdk|sandbox-runtime"

# npm 最新版本
npm view @anthropic-ai/claude-agent-sdk version
npm view @anthropic-ai/sandbox-runtime version

# npm 最新版本的 changelog / 发布历史
npm view @anthropic-ai/claude-agent-sdk --json | jq '.time' 2>/dev/null || npm view @anthropic-ai/claude-agent-sdk time
```

对每个有版本差异的包：
1. 列出当前版本到最新版本之间的所有发布版本
2. 查看每个版本的变更（`npm view @anthropic-ai/claude-agent-sdk@X.Y.Z`）
3. 分析变更内容分类：
   - **Breaking Changes** — 升级必须处理的破坏性变更
   - **New Features** — 新增 API、新能力
   - **Bug Fixes** — 修复的问题
   - **Performance** — 性能优化

### 2. SDK 源码差异分析

检查 SDK 的 TypeScript 类型定义和导出，与项目当前使用方式对比：

```bash
# 查看当前项目如何使用 SDK
grep -r "claude-agent-sdk\|claude_agent_sdk" packages/happy-cli/src/ --include="*.ts" -l
grep -r "from.*@anthropic-ai" packages/happy-cli/src/ --include="*.ts"
```

对比 SDK 新版本导出的 API 与项目当前使用的 API，标记：
- **已使用** — 项目已集成的 API
- **未使用但有价值** — SDK 提供但项目未用的功能（如新的事件类型、工具能力等）
- **已废弃** — 项目使用了 SDK 即将废弃的 API

### 3. 上游仓库功能差异分析

对比上游 `slopus/happy` 的代码与本地代码，找出有价值但未集成的功能：

```bash
# 获取上游最新
git fetch upstream

# 查看上游相比本地的差异文件
git diff main..upstream/main --stat

# 查看上游的最近提交
git log upstream/main --oneline -30

# 查看上游有而本地没有的文件（可能是新功能）
git diff main..upstream/main --diff-filter=A --name-only
```

重点关注：
- **新增文件** — 上游新加了什么功能模块
- **功能差异** — 同一文件上游有改进但本地未同步
- **API 端点** — 上游新增的 API 路由
- **数据模型** — Prisma schema 变更
- **CLI 功能** — 新增的命令行参数或子命令

### 4. 官方文档更新检查

使用 WebFetch 抓取 Claude Code 官方文档，检查最新功能动态：

```
WebFetch: https://code.claude.com/docs/en/overview
WebFetch: https://code.claude.com/docs/en/changelog
```

关注以下方向的更新：
- **Agent SDK** — 新的 agent 能力、工具定义、事件流
- **MCP（Model Context Protocol）** — 新的 MCP server 能力、工具扩展
- **Session 管理** — 会话生命周期、恢复、多会话
- **安全机制** — 权限模型、沙盒、审计
- **性能优化** — 流式传输、上下文管理、缓存
- **多模型支持** — 新模型接入、模型路由
- **CLI 功能** — 新的命令行特性、配置项

### 5. 综合分析报告

输出结构化报告：

```markdown
# SDK Watch 分析报告 — YYYY-MM-DD

## 1. SDK 版本状态
| 包名 | 当前版本 | 最新版本 | 差距 | 升级风险 |
|------|---------|---------|------|---------|
| @anthropic-ai/claude-agent-sdk | X.Y.Z | A.B.C | N 个版本 | 低/中/高 |
| @anthropic-ai/sandbox-runtime | X.Y.Z | A.B.C | N 个版本 | 低/中/高 |

## 2. 应集成的新功能（按优先级排序）
### P0 — 立即集成（影响核心体验或安全）
- [ ] 功能描述 — 来源（SDK/上游/文档）— 实施复杂度

### P1 — 近期集成（提升用户体验）
- [ ] 功能描述 — 来源 — 实施复杂度

### P2 — 可选集成（锦上添花）
- [ ] 功能描述 — 来源 — 实施复杂度

## 3. 已废弃 API 警告
- 需要迁移的 API 列表及建议替代方案

## 4. 上游未同步的重要功能
- 功能名 — 涉及模块 — 合并难度 — 建议

## 5. 官方文档新动向
- 新特性 — 是否与本项目相关 — 建议行动

## 6. 建议行动计划
1. 第一步：...
2. 第二步：...
```

## 注意事项

- 本项目是 Claude Code 的上层封装（Mobile/Web 远程控制），不是 Claude Code 本身
- 上游仓库 `slopus/happy` 是另一个维护者的 fork，分叉点 `bb7a1173`
- SDK 升级要保守：先在 dev 分支验证，跑完所有测试再合并（参见 memory）
- 分析时注意区分"对本项目有价值"和"只对 CLI 直接使用有价值"的功能
- 优先关注：会话管理增强、Agent 能力扩展、安全机制、流式传输优化
- 不要自动升级任何依赖，只提供分析和建议
- 如果 `$ARGUMENTS` 指定了 focus，只执行对应部分，跳过其他
