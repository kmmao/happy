分析上游 Happy fork、Claude Code 运行时与官方文档的变化，找出应集成到本项目的功能

## 适用范围与边界

**本项目的 Claude 会话当前采用 PTY 模式**：`node-pty` 包裹真实的 `claude` TUI 子进程，从 JSONL 文件增量扫描会话状态。因此：

- ❌ **不再追踪** `@anthropic-ai/claude-agent-sdk` —— 我们不调用 `query()`，SDK 版本与本地无关
- ❌ **不再追踪** `claude -p` / headless / `--sdk-url` —— 我们不走 headless 路径
- ✅ **继续追踪** `@anthropic-ai/sandbox-runtime` —— 用于本地 sandbox 模式
- ✅ **继续追踪** `@anthropic-ai/claude-code`（用户系统已装版本）的 JSONL 格式 / hooks 协议 / settings.json 字段变化（决定我们 PTY 适配层是否需要更新）
- ✅ **继续追踪** `@modelcontextprotocol/sdk`（本地 MCP 服务与 happy MCP 桥使用）
- ✅ **happy-codium** 不做单独 SDK 分析，**只追上游 `slopus/happy` 的 codium 包**，上游怎么改我们怎么改

## 使用方式

`/sdk-watch [focus]`

- focus（可选）：`runtime` | `codium` | `upstream` | `docs` | 不指定则全部执行

## 执行步骤

### 1. 运行时依赖版本分析（runtime）

仅追踪与 PTY 模式有关的运行时依赖，**跳过** `@anthropic-ai/claude-agent-sdk`：

```bash
# 当前项目使用版本
cat packages/happy-cli/package.json | grep -E "sandbox-runtime|modelcontextprotocol/sdk"
cat packages/happy-cli/package.json | grep -E "node-pty"   # PTY 适配核心

# npm 最新版本
npm view @anthropic-ai/sandbox-runtime version
npm view @modelcontextprotocol/sdk version
npm view @anthropic-ai/claude-code version    # 仅作"用户运行时 TUI"基线参考

# 发布历史
npm view @anthropic-ai/sandbox-runtime time
npm view @modelcontextprotocol/sdk time
```

对每个有版本差异的包：
1. 列出当前到最新之间的所有发布版本
2. `npm view <pkg>@X.Y.Z` 查看变更
3. 分类变更：
   - **Breaking Changes** — 升级必须处理的破坏性变更
   - **New Features** — 新增 API、新能力
   - **Bug Fixes** — 修复的问题
   - **Performance** — 性能优化

### 2. PTY 适配层兼容性检查

本项目对 `@anthropic-ai/claude-code` 的依赖是**形态依赖**而非代码依赖：

| 形态依赖项 | 影响位置 |
|---|---|
| JSONL 文件格式（messages / sidechains / metadata） | `packages/happy-cli/src/claude/jsonl/`、`packages/happy-cli/src/claude/pty/rawToJsonlMessage.ts` |
| Hooks 协议（`SessionStart` / `PreToolUse` / `PostToolUse` / `PermissionDenied` / `InstructionsLoaded` / `PostToolBatch` 等） | `packages/happy-cli/src/claude/utils/generateHookSettings.ts`、`startHookServer.ts` |
| `settings.json` 字段（`agent`、`permissions`、`sandbox`、`worktree.*`） | `packages/happy-cli/src/claude/utils/applyFlagSettings.ts`、`settingsParser.ts` |
| Slash command / `! <cmd>` 后台 shell / `/goal` / `/loop` 等内置 skills 行为 | App 端 message-view 渲染、CLI envelope 映射 |
| TUI 输出序列（终端通知 `terminalSequence`、窗口标题、铃声） | PTY 透传层 |
| 模型矩阵（新模型、effort 等级 `xhigh`/`max`、auto mode） | `packages/happy-cli/src/claude/utils/streamEventMapper.ts`、App 端 effort 选择器 |
| Skills / Plugins 自动加载与目录约定 | hook settings 注入逻辑 |

**检查方式**：

```bash
# 1. 本机已装 claude-code 版本
claude --version 2>/dev/null || echo "claude not on PATH"

# 2. 列出本项目消费这些形态的所有适配点
grep -rn "claude-code\|HookEvent\|terminalSequence\|reloadSkills\|MessageDisplay" packages/happy-cli/src/ --include="*.ts" | head -30

# 3. 当前 PTY 测试覆盖
ls packages/happy-cli/src/claude/pty/
ls packages/happy-cli/src/claude/jsonl/
```

随后用 **WebFetch 抓官方 changelog**（步骤 4），把当期所有"形态变更"映射回上述适配点，输出"需更新点 → 文件"列表。

### 3. happy-codium 上游对齐（codium）

**策略：codium 包不做独立 SDK 分析，纯粹追上游 `slopus/happy` 的 codium 包**。上游怎么改我们怎么改，不关心它是否使用 `claude-agent-sdk` 或 `claude -p`。

```bash
# 拉取上游最新
git fetch upstream

# codium 包是否存在差异
git diff main..upstream/main --stat -- packages/happy-codium packages/codium

# codium 包的提交历史
git log upstream/main ^main --oneline -- packages/happy-codium packages/codium 2>/dev/null | head -40

# codium 包 package.json 差异（依赖、scripts、版本）
git diff main..upstream/main -- packages/happy-codium/package.json packages/codium/package.json 2>/dev/null

# codium 新增文件
git diff main..upstream/main --diff-filter=A --name-only -- packages/happy-codium packages/codium 2>/dev/null
```

> **注意**：上游的 codium 包路径可能是 `packages/codium`，本地是 `packages/happy-codium`，需要同时检查两条路径。

**输出**：
- 上游 codium 的所有提交清单（commit hash + 一行描述）
- 依赖升级清单（含被本项目刻意 fork 命名的依赖）
- 新增/删除文件清单
- **建议**：除非显然破坏本地命名（`@kmmao/*` vs `@slopus/*`）或上游引入只服务于上游 server 的耦合，否则**默认合入**

### 4. 上游 fork 功能差异分析（upstream，不含 codium）

对比上游 `slopus/happy` 与本地的非 codium 包，找出有价值但未集成的功能：

```bash
# 上游相比本地的总差异
git diff main..upstream/main --stat | tail -30

# 上游有但本地没有的新增文件（排除 codium）
git diff main..upstream/main --diff-filter=A --name-only | grep -vE "packages/(happy-)?codium" | head -80

# 上游最近的提交
git log upstream/main ^main --oneline | head -60

# 按包看变更密集程度
git diff main..upstream/main --stat | grep -E "packages/(happy-cli|happy-server|happy-app|happy-wire|happy-agent)/" | head -30
```

重点关注：

- **新增文件** — 上游新加了什么功能模块
- **bug fix** — fix 类提交（搜索 `fix(security)` / `fix(sync)` / `fix(server)`）
- **API 端点** — 上游新增的 server 路由
- **数据模型** — `packages/happy-server/prisma/schema.prisma` 变更
- **协议变更** — `packages/happy-wire/src/` 新增 / 改动的 schema
- **CLI 功能** — 新增的子命令、daemon 行为
- **App 体验** — 新增的 settings、UI 流程

**对照** `docs/UPSTREAM_TRACKING.md`：
1. 任何"未评估"的高优先 PR / commit 列入本期分析
2. 已合并的标"已在本地"
3. 跳过的写明原因

### 5. 官方文档检查（docs）—— 聚焦 PTY 形态影响

抓取官方文档与 changelog，**只关注会影响 PTY 模式兼容性的变化**：

```
WebFetch: https://code.claude.com/docs/en/overview
WebFetch: https://code.claude.com/docs/en/changelog
WebFetch: https://code.claude.com/docs/en/hooks
WebFetch: https://code.claude.com/docs/en/settings
WebFetch: https://code.claude.com/docs/en/skills
```

关注方向（**SDK / headless / `claude -p` 相关变化主动忽略**）：

- **Hooks 协议** — 新 hook event、新字段、`terminalSequence`、`reloadSkills`、`MessageDisplay`、`additionalContext` 等
- **settings.json 字段** — `agent`、`permissions`、`sandbox`、`worktree.*`、`requiredMinimumVersion`、`bwrapPath`/`socatPath` 等
- **JSONL / 消息格式** — sidechain、metadata、`isMeta`、`isSynthetic`、新角色
- **MCP server 能力** — 新工具、新 transport、stdio MCP 行为变化
- **TUI 行为** — 终端控制序列、窗口标题、铃声、通知
- **新模型 / Effort** — 模型列表、`xhigh`/`max`、auto mode
- **Skills / Plugins** — 加载机制、目录约定、`/reload-skills`、disallowed-tools
- **新 CLI 子命令 / flag** — `! <cmd>`、`/goal`、`claude agents`、`--bg`、`--exec` 等是否影响 PTY 透传
- **Sandbox 沙盒** — bwrap / sandbox-exec / seatbelt 配置项

每条更新标注：
- **形态影响** — 是否改变 hooks / JSONL / settings 形态？
- **本项目适配点** — 对应哪些代码文件
- **建议行动** — 适配 / 监视 / 忽略

### 6. 综合分析报告

输出结构化报告：

```markdown
# SDK Watch 分析报告 — YYYY-MM-DD

## 1. 运行时依赖版本状态
| 包名 | 当前版本 | 最新版本 | 差距 | 升级风险 | 备注 |
|------|---------|---------|------|---------|------|
| @anthropic-ai/sandbox-runtime | X.Y.Z | A.B.C | N | 低/中/高 | |
| @modelcontextprotocol/sdk | X.Y.Z | A.B.C | N | 低/中/高 | |
| @anthropic-ai/claude-code（用户运行时基线） | X.Y.Z | A.B.C | N | — | 仅作 PTY 兼容参考 |

> 注：`@anthropic-ai/claude-agent-sdk` 与 `claude -p` headless 不在本项目集成范围内，不列入报告。

## 2. PTY 适配层应跟进的形态变化
| 形态变更 | 来源（hooks/settings/JSONL/TUI/模型） | 本项目适配点 | 优先级 |
|---|---|---|---|
| ... | ... | `packages/happy-cli/src/...` | P0/P1/P2 |

## 3. happy-codium 上游对齐
- 上游 codium 包提交清单（commit hash + 描述）
- 依赖升级清单
- 新增 / 删除文件
- **结论**：[全部同步 / 部分同步（列原因） / 跳过（列原因）]

## 4. 上游 fork 未同步的重要功能（非 codium）
| 功能 | 涉及模块 | 合并难度 | 建议 |
|------|---------|---------|------|
| ... | ... | 低/中/高 | 接入 / 监视 / 跳过 |

## 5. 应集成的功能（按优先级排序，跨来源汇总）
### P0 — 立即集成（影响核心体验/安全/稳定）
- [ ] 功能描述 — 来源（runtime/codium/upstream/docs）— 实施复杂度

### P1 — 近期集成（提升用户体验）
- [ ] 功能描述 — 来源 — 实施复杂度

### P2 — 可选集成（锦上添花）
- [ ] 功能描述 — 来源 — 实施复杂度

## 6. 官方文档新动向（仅 PTY 形态相关）
- 新特性 — 形态影响 — 适配点 — 建议行动

## 7. 建议行动计划
1. 第一步：...
2. 第二步：...
```

## 注意事项

- **本项目的 Claude 会话走 PTY 模式**：node-pty 包裹真实 claude TUI，从 JSONL 增量扫描状态
- **绝不**追踪 `@anthropic-ai/claude-agent-sdk` 版本、API、changelog —— 我们不消费它
- **绝不**追踪 `claude -p` / headless / `--sdk-url` 路径 —— 我们不走它
- **PTY 形态依赖**才是核心：JSONL 格式、hooks 协议、settings.json 字段、TUI 行为、模型矩阵
- **happy-codium 默认跟上游对齐**：上游有更新就更新，不评估其内部是否用 SDK
- 上游仓库 `slopus/happy` 是另一个维护者的 fork，分叉点 `bb7a1173`
- 依赖升级要保守：先在 dev 分支验证，跑完所有测试再合并
- 不要自动升级任何依赖或合并任何代码，只提供分析和建议
- 如果 `$ARGUMENTS` 指定了 focus，只执行对应部分，跳过其他
- 对照 `docs/UPSTREAM_TRACKING.md` 避免重复评估
