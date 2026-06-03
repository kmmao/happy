# Happy 项目待办

## SDK 新功能 App 端集成（2026-03-21 规划）

CLI 侧已完成 SDK 选项映射（commit aff7302c），以下三个功能需要 App 端配合开发。

### ~~1. 子 Agent 进度摘要展示~~ ✅ 已完成 (eb15b249)
- wire/cli/app 三层打通，task-progress 带 summary 时显示为聊天消息

### ~~2. 文件回退按钮~~ ✅ 已完成 (f7656779)
- 用户消息旁 [⏪] 按钮 → dryRun 预览 → 确认弹窗 → 执行回退
- 后续优化: 多会话同目录时的 git stash 安全保护

### ~~3. Plugins 设置管理~~ ✅ 已完成 (1f0e1c99)
- App 设置页 + 手动添加 + 自动发现 + CLI 自动加载到 SDK

## 多隧道 Provider 架构（2026-03-24 进行中）

统一管理 Tailscale/UPnP/Cloudflare Tunnel 等多种公网暴露方案。

### ~~Phase 1: Wire 类型~~ ✅ 已完成 (feff1527)
- TunnelEntry/TunnelProviderInfo/TunnelState schema
- DaemonState.tunnels 可选字段

### ~~Phase 2: CLI Provider 抽象~~ ✅ 已完成 (4cf05f1d)
- TunnelProvider 接口 + TunnelManager + TailscaleProvider

### ~~Phase 2.5: UpnpProvider~~ ✅ 已完成 (da506986)
- miniupnpc CLI 封装，支持检测/添加/删除/续租

### Phase 3: App 端统一 TunnelSection UI（进行中）
- [ ] 新建 TunnelSection 组件替代 TailscaleServeSection
- [ ] 按 Provider 分组显示
- [ ] 统一添加/删除/切换操作
- [ ] CLI 端注册 tunnel RPC handler
- [ ] 更新翻译

### Phase 4: Agent 同步
- [ ] 镜像 CLI tunnel 目录到 Agent

### Phase 5（未来）: 更多 Provider
- [ ] Cloudflare Tunnel
- [ ] FRP

## 项目知识库 Phase 2（2026-03-28 完成）

语义检索 + 知识演化链 + 跨项目搜索 + Supervisor 自动贡献 + 概要自动重写

### ~~Phase 2.0: 基础设施~~ ✅ 已完成 (6647e111)
- consolidate/serialize 模块提取 + embeddingService + relatedIds 字段

### ~~Phase 2.1: 语义检索~~ ✅ 已完成 (6647e111)
- pgvector/HNSW + OpenAI text-embedding-3-small + 语义 consolidate（回退关键词）

### ~~Phase 2.2: 知识演化链~~ ✅ 已完成 (4e0db01c + f80d4b93)
- Server: GET /projects/:id/knowledge/:entryId/chain
- Wire: KnowledgeChainResponse 类型
- App: EvolutionTimeline + KnowledgeEvolutionView + 路由

### ~~Phase 2.3: 跨项目搜索~~ ✅ 已完成 (6647e111 + f80d4b93)
- Server: GET /knowledge/search（语义 + 关键词回退）
- Wire: CrossProjectSearchResponse 类型
- App: useKnowledgeSearch + 搜索页 + 路由

### ~~Phase 2.4: Supervisor 自动贡献~~ ✅ 已完成 (6647e111)
- knowledgeContributor: severity 排序 → max 5/run → consolidate 去重 → inTx 写入

### ~~Phase 2.5: 概要自动重写~~ ✅ 已完成 (6647e111 + f80d4b93)
- Server: Haiku 4.5 + Zod 校验 + 3 次重试 + Prisma upsert
- App: ProfileCard 重新生成按钮

### Phase 2 验证 / 配置
- [x] Phase 1 + 2 完整链路 E2E 验证 ✅ (2026-03-28)
  - 创建 ✅ | Ollama Embedding(768维) ✅ | 语义去重(0.87) ✅ | 演化链 ✅ | 跨项目搜索(0.76) ✅ | 概要重写 ✅
- [x] Server Docker 配置 OLLAMA_URL + PROFILE_PROVIDER=ollama ✅
- [ ] （可选）配置 OPENAI_API_KEY / ANTHROPIC_API_KEY 作为云端备选
- [ ] embedding backfill 脚本在真实数据上运行
- [ ] 语义检索效果评估（积累真实数据后对比关键词匹配）

## Happy-Agent Phase 6: 高级自动化（2026-04-12 记录）

Phase 1-5 已完成并发布 @kmmao/happy-agent@0.4.0。Phase 6.1 已完成（未发布）。

### ~~6.1 AutomationScheduler（任务队列调度）~~ ✅ 已完成 (39b18f2a)
- [x] Job 队列 + 去重（dedupeKey）
- [x] 优先级排序（urgent > user > background）
- [x] 并发限制（maxConcurrentJobs=2）
- [x] 失败重试策略（maxAttempts=3, 递增退避）
- [x] 12 个单元测试覆盖

### ~~6.2 AgentLoopCoordinator（定时循环执行）~~ ✅ 已完成 (637b67ec)
- [x] Loop 定义（interval-based, min 10s）
- [x] Loop 启动/暂停/恢复/删除
- [x] tick() 每秒轮询 + 自动 enqueue scheduler
- [x] 连续失败阻断 + 最大迭代限制
- [x] 5 个 RPC handler + 11 个单元测试
- [ ] Cron expression（后续按需）
- [ ] Webhook/CI 事件桥接（后续按需）

### ~~6.3 GuardianSessionRegistry（session 复用）~~ ✅ 已完成 (3aba05ea)
- [x] 复用已有 session（loop/project key hierarchy）
- [x] resolve/remember/forget API + 8 个测试
- [x] LoopCoordinator 自动传 --happy-session-id
- [ ] Session 健康检查 + 自动回收（后续按需）

### ~~6.4 AutomationAuditStore（审计日志）~~ ✅ 已完成 (d9ca6360)
- [x] 内存环形缓冲区（500 条上限）
- [x] job_enqueued / dispatched / completed / failed / retried 事件
- [x] query-audit-log + audit-summary RPC 查询
- [x] Scheduler onAudit 回调自动记录 + 8 个测试

### ~~6.5 Webhook 回调系统~~ ✅ 已完成 (d4208a1a)
- [x] Agent 启动微型 HTTP server（127.0.0.1 随机端口）
- [x] HAPPY_DAEMON_HTTP_PORT 全局 env 传递给子进程
- [x] /session-started POST 回调链接 sessionId → PID + guardian

### ~~6.6 TrackedSession 持久化~~ ✅ 已完成 (d4208a1a)
- [x] enablePersistence() 加载 + PID 有效性校验
- [x] 每次 track/untrack 自动 flush 到 JSON 文件

### ~~6.7 Tmux 集成~~ ✅ 已完成 (d4208a1a)
- [x] isTmuxAvailable() 检测 + 缓存
- [x] spawnInTmux() 创建/复用命名 tmux 会话
- [x] 返回 {sessionWindow, pid} 用于跟踪

## 知识库配置统一到项目级（2026-04-14 记录）

去掉设置页（Settings → Features）的知识库配置，所有配置统一到项目级 knowledgeConfig。

### 背景
- 设置页和项目级有 6 个完全重叠的字段（mode, sensitivity, trackFileEdits/ToolCalls/Tokens + 开关）
- 项目级还多 3 个生命周期字段（decay/merge/refine），功能更全
- 当前设置页的全局开关能覆盖项目级决策，设计倒置

### 改动范围
1. **CLI** (`claudeRemoteLauncher.ts`): 不再依赖 `HAPPY_KNOWLEDGE_*` 环境变量，始终创建 TurnCollector，从服务器获取项目级 config 后决定是否启用
2. **App** (`ops.ts`): 不再注入 `HAPPY_KNOWLEDGE_*` 环境变量
3. **App** (`features.tsx`): 删除知识库相关 UI
4. **App** (`settings.ts`): 删除 6 个 `knowledgeBase*` 字段
5. **Tab 可见性**: 待定（跟随项目 enabled / 始终显示 / 保留全局开关）

### 待决策
- [ ] 会话界面知识库 Tab 可见性策略

---

## Codium Claude 运行时脱钩 SDK（2026-06-04 记录）

依据 [ADR-0008](./docs/adr/0008-claude-runtime-interactive-pty-only.md)：happy 不再使用 `@anthropic-ai/claude-agent-sdk` 与 `claude -p` headless 模式。
`happy-cli` 主路径 + supervisor preflight 已在 ADR 范围内处理；**`happy-codium` 的 SDK worker 是剩下的大头**，需要单独决策。

### 待决策路线（三选一或组合）
- [ ] **C. PTY 复刻**：codium 改 spawn `claude` 交互二进制，复用 happy-cli `claude/pty/*`。需破例 codium "不依赖任何 `@kmmao/*` 内部包"约束（CLAUDE.md），或把 PTY 那套抽成独立可发布包
- [ ] **D. 收敛到 happy-cli daemon**：codium 退化为 happy-app 的桌面孪生，通过 IPC/socket 连 daemon。需要重新定位 codium 身份
- [ ] **A. 砍 Claude**：codium 只保留 Codex / 其他 plugin。最硬，需先聊 codium 定位

### 影响面参考
- 入口：`packages/happy-codium/sources/boot/main/agent-worker/worker.ts`（~500 行 SDK consume 循环）
- 兼容：`packages/happy-codium/sources/plugins/anthropic/` 现在是 API key 仓库，最终落到同一 SDK worker
- 隔离：与 happy-cli 物理隔离（nohoist），不影响 ADR-0008 第一阶段交付

---

## Auto-Option-Send 跨设备同步（2026-04-11 记录）

当前 auto-send 开关存储在 `localSettings`（device-local MMKV），不跨设备同步。
多设备同时开启同一会话的自动发送时，可能重复发送相同内容。

### 问题
1. **状态不同步**：设备 A 开了自动，设备 B 看不到
2. **重复发送**：两台设备各自倒计时并独立调用 sendMessage，导致同一条消息发两遍

### 方案思路
- 将 `autoOptionSendSessions` 从 localSettings 迁移到 synced settings 或 Session 模型字段
- 发送前检查最新消息是否已是相同文本（客户端去重）
- 或使用 sendMessage 的 `localId` 幂等机制（需 server 配合）
