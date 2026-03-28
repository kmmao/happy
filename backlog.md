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
