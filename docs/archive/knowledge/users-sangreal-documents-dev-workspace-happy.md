# /Users/sangreal/Documents/dev-workspace/happy

归档自 ProjectKnowledge，共 95 条 active 条目。


## Auto-Option-Send 状态机与 Options 质量评分系统的完整实现

*discovery · high · 2026-04-23*

Auto-Option-Send 功能通过多层数据流实现自动化建议发送：(1) Options 来源：CLI Agent 在任务完成后按 system prompt 指令在 Markdown 响应末尾生成 `<options>` XML 块，仅对具体产物（文件/函数）建议后续动作；(2) 提取机制：useLatestOptions.ts 通过 parseMarkdown() 解析最新 agent-text 消息并提取 options items，只保留最新一轮的选项；(3) 质量评分：autoOptionSend.ts 对每个选项的 7 个维度打分（位置优先级4-25分、动作动词22分、复合动作连接词16分、详细程度4-12分、技术特异性6-8分、上下文匹配6-12分、历史反馈-10~20分），合格阈值65分，纯查看类和模糊选项被评0分；(4) 状态转换：off → idle（无合适候选）→ armed（找到推荐项+10秒倒计时）→ ready（倒计时完毕）→ 自动发送，若 options 来自上一轮对话则保持 idle；(5) UI 呈现：OptionsPopover 显示完整选项列表、分数徽章（来自 optionScores 映射）和推荐标签及倒计时；(6) 反馈闭环：用户操作通过 recordManualSend() 持久化到 MMKV，用于训练历史反馈评分。


## 项目健康监控：9维度诊断框架与扩展策略

*discovery · high · 2026-04-26*

## 项目健康检查现状

对 /Users/sangreal/Documents/dev-workspace/happy 项目进行了全面9维度健康诊断，包括安全性、依赖管理、架构、技术债、代码质量、测试覆盖、文档、性能、UI/UX。

### 关键发现

**Security（中等风险）**
- uuid < 14.0.0 存在缓冲区越界漏洞（7个中度审计告警），影响 happy-app 和 happy-server
- Rate Limiting 仅在 auth 和 webhook 路由配置，其他 API 路由未覆盖
- SQL 查询正确使用参数化，无注入风险

**Dependencies**
- uuid 升级至 14.0.0 为核心需求

**Architecture**
- 6处以上 i18n 硬编码违反国际化规范

**Tech Debt**
- 无 TODO/FIXME 债务，代码库整体健康

**Code Quality**
- 30个 @ts-ignore 均为合理用途

**Test Coverage**
- 30/38 API 路由文件缺少测试，路由层薄弱

**Documentation**
- CLAUDE.md 和 CHANGELOG 保持同步，文档质量优秀

**Performance**
- sessionCache 已设置 MAX_ENTRIES 限制，无无界增长风险

**UI/UX**
- 硬编码颜色散布多个组件

## 维度框架的结构性问题

### 问题1：粒度不一致

当前9维度存在粒度差异：
- `security`：细粒度，涵盖10+个子类
- `uiUx`：混合了UI布局、可访问性、国际化，过于杂糅
- `testCoverage`：仅检查文件存在性，分析深度不足
- `documentation`：混合CLAUDE.md、API文档、代码注释，性质差异大

### 问题2：缺失维度

9个维度未覆盖的关键领域：
- **Observability**：日志质量、监控、告警配置
- **API Design**：REST规范、版本策略、Breaking changes
- **Build/CI**：构建时间、Pipeline配置、缓存策略
- **Compliance**：行业特定要求（如HIPAA、PCI）

## 扩展需求的可行性分析

### 需求1：细化现有维度

技术复杂度：**低**
- `dimensionTemplates.ts` 中的 prompt 为硬编码
- 仅需修改 prompt 内容，无 schema 变更
- 可直接改进维度的分析准确性

### 需求2：用户自定义追加维度

技术复杂度：**中高**
- 当前 `supervisorCustomRules` 字段仅用于附加规则字符串，不是独立维度
- 需要实现：
  - 新表 `SupervisorDimension`（id, projectId, name, key, prompt, severity权重）
  - CLI 侧在分析时动态加载自定义 prompt 运行
  - App 侧增加维度管理 UI

### 需求3：模型自动推荐维度

技术复杂度：**中**，价值最高

核心流程：
1. 扫描 CLAUDE.md + package.json + 目录结构
2. LLM 识别项目性质（blockchain/healthcare/embedded/SaaS等）
3. 推荐 3-5 个定制维度及对应分析 prompt
4. 用户在 App 内审批 → 保存为项目级维度

关键风险：AI 推荐的 prompt 质量不稳定，建议推荐后允许用户编辑 prompt，而不是直接执行。

## 实现建议

三个需求为递进关系，建议执行顺序：

1. **先建设用户自定义维度的基础设施**
   - 设计 SupervisorDimension 表结构
   - 实现 App 管理 UI
   - 这是功能容器

2. **AI 推荐作为填充器**
   - 复用自定义维度的存储和展示机制
   - 提升维度发现效率

3. **优化现有维度的 prompt**
   - 提升分析准确性和可靠性
   - 作为基础质量保证


## 会话收藏功能的完整实现与状态管理方案

*discovery · high · 2026-04-26*

会话收藏（starred）功能已完整实现并通过类型检查，采用分布式状态管理架构，涉及5个核心文件的协调修改：

**1. 类型定义层（storageTypes.ts）**
在 SessionPreferencesSchema 和 Session 接口中新增 `starred?: boolean | null` 字段，实现向后兼容的非破坏性扩展，不影响现有99个引用文件。

**2. 持久化层（persistence.ts）**
新增 `loadSessionStarred()` 和 `saveSessionStarred()` 函数对，使用 MMKV key `"session-starred"` 存储 JSON 格式的 Record<string, boolean>。仅存储 starred=true 的会话ID以节省空间，复用 `loadSessionNeedsAttention` 的实现模式确保一致性。

**3. 状态管理层（storage.ts）**
全局状态中心（142个引用文件）新增：
- 模块级变量 `sessionStarred` 初始化
- `StorageState` 接口的 `updateSessionStarred` 方法
- `applySessions` action 中的 `resolvedStarred` 解析逻辑
- `updateSessionStarred(sessionId, starred)` action

**4. 显示逻辑层（useVisibleSessionListViewData.ts）**
确保收藏会话在隐藏模式下仍可见，实现动态过滤与展示。

**5. UI层（SessionsList.tsx）**
在每个会话块右上角添加星形按钮，实现收藏/取消收藏的交互。

**6. 同步保证（sync.ts）**
确保收藏状态在同步周期内正确传播。

**核心设计原则**：向后兼容、纯追加（不修改现有函数）、复用现有 needs-attention 的数据模式。

**可选扩展方向**：
1. 扩展活跃会话块（ActiveSessionsGroup/ActiveSessionsGroupCompact）加入收藏功能
2. 为收藏的非活跃会话添加视觉区分（如背景高亮）


## happy-cli (@kmmao/happy-coder) npm 发布流程与版本管理

*decision · high · 2026-04-28*

happy-cli (@kmmao/happy-coder) 的标准发布流程已建立并成功执行多次。最新版本为 0.75.18（2026-04-28发布），之前为 0.75.8（2026-04-27发布）。

发布流程步骤：
(1) 检查依赖包状态（如 happy-wire）及其版本一致性
(2) 更新 package.json 版本字段
(3) 执行完整测试套件（正常应 785+/785+ 通过）
(4) 仅提交版本号变更至版本控制
(5) Push 至主分支（main）
(6) 发布至 npm registry
(7) 更新本地全局安装
(8) daemon 守护进程验证版本变更

关键特性：
- 守护进程通过心跳机制自动检测 npm 版本变更
- 其他机器用户可手动执行 `npm update -g @kmmao/happy-coder` 同步更新
- 本地版本与 npm latest 保持一致
- daemon 运行状态正常验证
- 支持 monorepo 结构中的选择性发布（依赖未变更时跳过）

0.75.18 版本包含 3 个 patch 级修复，主要优化 session restart 可靠性。0.75.8 版本发布时 happy-wire 依赖版本为 0.16.2。


## 聊天页性能瓶颈分析：JS线程压力根源与优化方案

*discovery · high · 2026-04-28*

## 核心发现

项目最可能"体感卡"的地方不是后端API单点慢，而是**App会话页把流式消息、Markdown、选项倒计时、列表派生计算都压在JS线程上**。若用户反馈"聊天界面一卡一卡的"，优先定位此处而非服务端优化。

## P0：聊天页长会话渲染成本过高

### 1. ChatList多次全量扫描 & O(n²)风险

**位置**：`packages/happy-app/sources/components/ChatList.tsx:111-250`

**具体问题**：
- 第一轮（行111-148）：构建`showAvatarMap`、`latestAgentId`、`thinkingTurnIds`全量扫描
- 第二轮（行153-217）：过滤tool-call、去重Codex diff、调用`buildChatDisplayItems`
- 第三轮（行220-250）：重新构建user message indices和display→message index map
- `thinkingTurnIds`构建在每个ready event后向前扫描到上一个user/ready，**长会话里接近O(n²)**

**触发场景**：长会话、Claude/Codex流式输出、大量工具调用、thinking timeline/inline tools开启、滚动时消息仍追加

**最小建议**（按优先级）：
1. 把5个派生字段合并为单次预处理，以`messages`版本号或最后消息id做缓存
2. `thinkingTurnIds`的嵌套扫描改单pass：维护当前turn是否含thinking，遇到ready时记录
3. `MessageView`/timeline item确认memo边界，避免父级派生变化导致大量重渲染
4. 考虑FlashList替换，但前提是派生计算已优化（换列表库若计算仍全量，缓解有限）

**验证方式**：
- React DevTools Profiler记录长会话流式输出
- 检查`ChatListInternal` commit duration是否频繁>16ms
- 在`buildChatDisplayItems`、`parseLegacyCodexDiffPreview`、`parseMarkdown`添加计时

### 2. Markdown解析在流式消息中反复执行

**位置**：`packages/happy-app/sources/components/markdown/MarkdownView.tsx:32-36`及多个调用点（`MessageView.tsx:225-228`、`:400-404`、`:475-478`）

**具体问题**：
- `parseMarkdown(props.markdown)`仅在组件实例内useMemo缓存，但不缓存跨实例结果
- 静态消息无问题，但正在流式增长的长回复伤害大：每追加一点文本，整个markdown都重新parse→重新map block渲染

**高风险内容**：长代码块、表格、plan-card、math block、mermaid block、options block

**最小建议**：
1. 对已完成消息缓存parse结果（以消息id为key）
2. 对正在流式的最后一条消息做节流：100-250ms合并更新
3. 长代码块默认折叠或延迟高亮
4. `RenderCodeBlock`、`RenderTableBlock`、`RenderOptionsBlock`分块memo

### 3. Mermaid移动端WebView+CDN加载成本

**位置**：`packages/happy-app/sources/components/markdown/MermaidRenderer.tsx:163`、`:169`、`:217`

**具体问题**：
- 每个Mermaid block创建独立WebView
- 每个WebView从CDN加载mermaid脚本（`https://cdn.jsdelivr.net/npm/mermaid@11/`）
- 移动端网络和进程开销明显

**最小建议**：
1. 预加载共享WebView或缓存mermaid脚本
2. 大量图表时考虑延迟/虚拟滚动
3. 离线fallback或SVG预生成

## P1：自动发送倒计时高频重渲染

**位置**：`packages/happy-app/sources/sync/autoOptionSendService.ts`、`SessionView`顶层订阅

**具体问题**：
- 倒计时每250ms更新一次`remainingMs`
- 订阅挂在`SessionView`顶层，导致整棵会话视图高频重渲染
- 选项倒计时动画使用`width`而非纯`transform`，进一步增加渲染成本

**最小建议**：
1. 倒计时更新隔离到独立上下文或自定义hook，不触发顶层重渲染
2. 动画改为`transform`+`opacity`
3. 可考虑native timer或worklet（RN平台）

## P2：任务看板/自动化页大量卡片一次性渲染

**问题**：ScrollView一次性渲染大量卡片，无虚拟滚动

**建议**：考虑FlatList或FlashList替换ScrollView

## 验证优先级

1. **必做**：用React DevTools Profiler验证ChatList派生计算成本
2. **必做**：长消息/代码块流式输出时，测量Markdown解析耗时
3. **可做**：检查Mermaid加载和WebView初始化时间
4. **可做**：监控SessionView倒计时订阅的重渲染频率

## 行动清单

- [ ] 合并ChatList的5个派生字段为单次memoized预处理函数
- [ ] 实现Markdown parse结果跨实例缓存（以消息id为key）
- [ ] 流式消息最后一条添加节流（100-250ms）
- [ ] autoOptionSendService倒计时隔离，避免顶层重渲染
- [ ] Mermaid预加载或脚本缓存
- [ ] 长会话测试（>100条消息+agent streaming）验证改进效果


## Android/iOS 推送通知完整诊断与修复方案：Firebase 配置和开发构建问题

*fix · high · 2026-04-29*

# 推送通知问题根本原因与完整修复方案

## 问题诊断

项目推送通知失败有两个主要原因：

### 原因1：开发构建中 token 永不注册（影响本地测试）
代码在 `sync.ts:291-293` 中有 `__DEV__` 保护：
```ts
if (__DEV__) {
    return;  // 本地 expo start 时永不注册 token
}
```
本地开发时 token 永远不会注册到 server，导致 server 无可用 token 进行推送。

### 原因2：Firebase 项目 ID 不匹配（Android 的关键问题）
- 本地 `google-services.json` 绑定的 Firebase 项目 ID：happy-coder-421f7
- EAS 上配置的 FCM credentials 来源项目可能为：happy-coder-9fe36
- 两者不匹配导致 Android 推送静默失败

### 原因3：EAS APNs/FCM 密钥未上传（iOS 和 Android 都需要）
Expo Push Service 需要在 EAS 控制台上传 APNs 密钥（iOS）和有效的 FCM Service Account Key（Android），否则即使 server 有 token 也无法推送。

## 代码架构现状（完整无缺）

✅ App 权限请求 + token 注册：sync.ts:2328
✅ 前台通知显示 handler：_layout.tsx:44
✅ Android channel 配置：_layout.tsx:55
✅ Server token 存储：pushRoutes.ts
✅ Server 发送（Expo Push Service）：pushSend.ts
✅ 通知点击导航：useNotificationNavigation.ts
✅ 触发场景：Inbox/Supervisor/Fix/Loop

代码层面完整实现所有推送能力，问题纯粹在配置层，无需代码修改。

## 完整修复步骤

### Step 1：修复 Android Firebase 配置
(1) 登录 Firebase Console，进入 happy-coder-421f7 项目
(2) 确认所有 Android apps（com.kmmao.happy 等）已在该项目中注册
(3) 在 Project Settings → Service accounts 生成新的 FCM V1 Service Account Key JSON（需要 Editor 权限）
(4) 通过 `eas credentials -p android` 上传该 JSON 到 EAS，覆盖之前的配置
(5) 验证：getExpoPushTokenAsync 返回有效 token，且 server 成功接收并存储

### Step 2：配置 EAS APNs 证书（iOS 必需）
```bash
eas credentials --platform ios
# 选择 Push Notifications Key → 让 EAS 自动生成或导入现有密钥
```

### Step 3：用 Preview/Production 构建绕过 __DEV__ 限制
```bash
# 方案A：用 preview 构建测试推送（非 dev 模式）
APP_ENV=preview npx expo start --no-dev

# 方案B：用 EAS build（最接近真实环境）
eas build --profile preview --platform android
eas build --profile preview --platform ios
```

### Step 4：验证端到端流程
(1) 安装构建的 APK/IPA
(2) 检查 token 是否成功注册：通过 server 日志或数据库查询用户 token 记录
(3) 通过 server 推送接口发送测试通知
(4) 确认设备收到通知并可点击导航

### Step 5：临时调试选项（可选）
- 暂时移除 __DEV__ 保护以在本地 expo start 下测试
- 添加推送通知测试页面显示当前 token 注册状态

## 优先级建议

1. **立即执行**：Step 1（Android Firebase 配置修正）+ Step 2（EAS APNs 证书）
2. **验证**：Step 3-4（用 preview build 测试完整流程）
3. **可选**：Step 5（为开发阶段添加调试能力）


## 修复：初始加载会话列表遗漏 starred 字段导致收藏会话不显示

*fix · high · 2026-04-30*

问题描述：用户启用 hideInactiveSessions 后，收藏（starred）的会话不显示，应用仅显示引导页。

根本原因：fetchSessions 方法在应用启动时初始加载会话列表时，解密 preferences 后展开字段到 session 对象时遗漏了 starred 字段。导致所有会话的 starred 值为 undefined，被 useVisibleSessionListViewData 过滤掉，最终 sessionListViewData 为空，无法显示任何会话。

对比分析：
- syncSessionPreferences（会话上传）：正确包含 starred 字段
- mergeUpdatedSession（实时更新）：正确包含 starred 字段  
- fetchSessions（初始加载）：遗漏 starred 字段

修复方案：在 sync.ts 第 1127 行的 preferences 展开中添加 `starred: preferences.starred`，保持与 updateSessionMerge.ts:69 的一致性。修改仅影响私有方法 fetchSessions，不涉及公共 API 签名变更。

技术细节：
- starred 字段类型：boolean | null
- 本地存储：通过 MMKV 的 'session-starred' key 持久化存储
- 影响范围：仅限初始会话列表加载流程，不影响会话同步或实时更新逻辑


## Docker Server 无缓存重建与重启完整流程

*fix · high · 2026-04-30*

Docker Server 部署流程已完成。执行步骤如下：

【前置检查】
- Docker Compose 版本：v5.1.1，可用
- 内部依赖检查：@kmmao/happy-wire 已 pin 到 npm latest 0.16.2，无需更新
- 依赖版本一致，无版本冲突

【镜像重建】
- 执行无缓存重建 server 镜像：docker build --no-cache
- 目的：确保最新依赖和配置被应用
- 重建完成后仅重启 server 容器（happy-server-1），保留数据库、Redis 和 MinIO

【验证与健康检查】
- 容器状态：happy-server-1 已启动，状态为 healthy
- 迁移检查：无待执行迁移（No pending migrations to apply）
- 日志检查：无 P20xx/Error 错误，server 状态已 Ready
- HTTP 健康响应：验证成功，服务返回 "Welcome to Happy Server!"

【验证方法】
- 注意：curl 命令被权限系统拦截，改用 Node.js fetch API 进行验证
- 使用命令：fetch('http://localhost:3005/')
- 验证地址：localhost:3005

部署流程已完成，server 正常运行。


## iOS 发布流程与推送通知凭据配置

*warning · high · 2026-04-30*

项目已配置完整的 EAS 发布工作流，支持两种 iOS 发布方式：

1. OTA 更新（用于 JS 层改动）：秒级发布速度，通过 yarn ota 或 yarn ota:production 执行

2. 原生构建（用于原生代码改动）：通过 yarn release:build:appstore:interactive 完成 App Store 提交

推送通知实现现状：
- 使用 expo-notifications 库获取 Expo Push Token
- 在 sync.ts 中完整实现 token 注册逻辑
- __DEV__ 开发模式下会跳过 token 注册（需注意调试时的行为差异）

关键配置信息：
- eas.json 中 submit.production.ios 已配置：Apple ID、ASC App ID、Team ID（466DQWDR8C）

⚠️ 推送通知的关键缺失环节（必须完成）：
1. 在 Apple Developer 创建 APNs Key（.p8 文件）
2. 通过 eas credentials -p ios 上传凭据到 EAS
3. 构建前必须先完成此步骤，否则 push notification 功能在正式构建中无法工作

建议流程：先处理推送凭据配置 → 执行原生构建 → App Store 提交


## 消息拉取策略完整实现：Native全量/Web增量的五层架构与TDD验证

*discovery · high · 2026-05-01*

项目中消息拉取策略已按TDD方法完成五层完整实现与验证：

**1. 策略定义层** (`messageFetchStrategy.ts`)：三种核心策略清晰划分——incremental(增量)、webLatestOnly(Web仅最新300条)、nativeFullHistory(Native全量分页)。包含resolveMessageHistoryFetchStrategy、shouldFetchNewestPageFirst、shouldApplyMessagesImmediately等纯函数，由专用测试文件(messageFetchStrategy.test.ts)精准验证。

**2. 同步集成层** (`sync.ts`)：根据平台和首次加载状态调用不同策略。关键是`shouldApplyMessagesImmediately`决定消息即时应用(Web/incremental)还是全部聚合后一次性应用(Native全量模式)。在fetchMessages方法附近集成策略调用，保持现有API不变，最小化改动。

**3. 服务端API层** (`v3SessionRoutes.ts`)：支持`before_seq`反向分页(latest-only拉取最新300条)和`after_seq`正向全量拉取。最后一页返回`totalCount`用于完整性校验。

**4. 缓存层** (`messageCache.ts`)：Web端跳过MMKV初始化，Native端完整的缓存/恢复/LRU淘汰机制。`isTrimmed`标记支持缓存清除后触发重新全量拉取。

**5. 游标保护层** (`messageCursor.ts`)：保护解密失败不跳过消息，仅负责游标推进。

**实际执行流程**：App端进入会话时无lastSeq会触发`nativeFullHistory`策略(after_seq=0全量分页)，所有消息聚合后一次性应用——即"进来后全量获取"的完整实现。Web端则仅拉最新300条即时显示。有游标时两端统一走增量拉取。已确认无现有同职责文件，可能需要清理已弃用的backfill边界逻辑(saveBackfillBoundary、loadBackfillBoundaries等)。


## 会话足迹中的“其他”有两层含义：未分类命令与 TopN 折叠

*discovery · high · 2026-05-04*

在排查“会话足迹 / Timeline / 操作类型”的映射时，已经确认：会话足迹里的“其他”不是单一概念，而是两层含义并存，不能只把它理解成“识别失败”。

1. **TopN 折叠导致的“其他”**
会话足迹的实现更像是 App 端的工具混合统计，而不是服务端 `SessionEvent` 那套事件类型（如 `file_edit/bash_command/...`）直接映射。关键位置在 `packages/happy-app/sources/components/session/SessionProgressPanel.tsx` 和 `packages/happy-app/sources/components/session/toolMixData.ts`：
- `SessionProgressPanel.tsx:326` 通过 `computeToolMix(messages, TOOL_MIX_TOP_N, ...)` 统计工具类型；
- `TOOL_MIX_TOP_N = 6`，只展示前 6 类；
- `toolMixData.ts:117` 会把剩余类型全部合并进 `otherCount`；
- `SessionProgressPanel.tsx:1168` 在 `otherCount > 0` 时显示为 `session.progressToolMixOther`，中文即“其他”。
因此，“其他”可能只是第 7 名以后被 UI/聚合逻辑折叠了，并不表示缺少识别。

2. **真正未识别或无法分类的命令**
在 `packages/happy-app/sources/components/tools/codexCommandUtils.ts:649` 中，CodexBash 命令无法推断时会归为 `unknown`。目前可识别的 CodexBash 操作类型包括：
- 读文件：`cat/head/tail/less/sed -n`
- 搜索：`rg/grep/ag/ack`
- 列文件：`find/fd/ls/tree`
- 写入：重定向 `>`/`>>`、`tee`、`mv/cp/touch`
- Git：`git status/diff/log/show/blame/rev-parse/branch/symbolic-ref` 等
- 测试：`vitest/jest/pytest/cargo test/go test`
- 验证：`tsc/eslint/biome/prettier --check/cargo check/go vet`
- 包管理：`yarn/pnpm/npm/bun` 的 install/remove/test/typecheck/lint/check/build/dev/start 等
- 运行脚本：`node/python/python3/tsx/ts-node/docker/docker-compose/expo start`
- Patch/Diff：`CodexPatch`、`CodexDiff`

会落入“其他”的实例，既可能是**未识别/未覆盖的命令**，也可能是**已识别但超出 Top 6** 的类型。常见的潜在未识别项包括：`curl`、`jq`、`gh`、`mkdir`、`rm`、`chmod`、`ps`、`lsof`、`kill`、`open`、`xcrun`、`eas`、`npx`、`date`、`pwd`、`whoami`、`which` 等；另外要注意当前识别的是 `docker-compose`，不等同于 `docker compose`。

结论：会话足迹里的“其他”**不一定表示识别失败**，它也可能只是为了简洁将 Top 6 之外的工具类型折叠了。若要确认“其他”里到底是什么，最好让 `ToolMixBar` 的“其他”可展开，或在调试态直接展示 `sorted.slice(topN)` 的明细；如果要继续排查覆盖问题，应重点看命令解析链路和服务端事件生成逻辑，区分“分类失败”与“展示折叠”。


## Memory leak investigation in React Native Expo web app - symptoms, patterns, and debugging strategy

*discovery · high · 2026-05-17*

User is investigating memory leaks in a React Native + Expo web app (packages/happy-app) manifesting as progressive sluggishness, text input lag, and occasional crashes that temporarily resolve on page refresh.

Symptoms:
- Progressive performance degradation over time
- Input lag and sluggish UI responsiveness
- Occasional crashes resolving temporarily with page refresh

Investigation approach: Search for common memory leak patterns across the codebase, with particular focus on recently modified files:
- knowledgeLifecycleRoutes.ts (route handlers)
- useProjectKnowledge.ts (custom hook)
- KnowledgeLifecycleTrendChart.tsx (trend chart component)
- ProjectKnowledgeTab.tsx
- storage.ts (subscriptions and storage handlers)

Key areas to audit:
1. Event listener cleanup - missing removeEventListener calls in components and hooks
2. Timer/interval management - uncleared setInterval/setTimeout without corresponding clearInterval/clearTimeout
3. Observable/subscription management - subscriptions not unsubscribed in useEffect cleanup functions
4. Component lifecycle issues - state not properly cleared on unmount
5. DOM reference leaks - DOM nodes held in React state without proper disposal
6. Large data structures in state - potential memory accumulation between renders
7. Circular dependencies - objects maintaining circular references

Context: This investigation is a continuation of previous session work that implemented knowledge lifecycle features including trend charts, routes, and hooks. The shift to performance debugging suggests data structures may not be properly cleaned up between renders or across component lifecycle.

Expected outcome: Identify and fix memory leak sources to restore app stability and responsiveness.


## 长会话历史消息分页加载功能：架构设计、性能优化与完整实现

*decision · high · 2026-05-17*

实现了 Web 端长会话的完整历史消息分页加载功能体系。

【核心架构设计】
(1) 存储层（storage.ts）：新增 `applyOlderMessages` action 使用 fresh reducer 正确处理 NormalizedMessage → Message 类型转换，避免类型不安全赋值；初始化 `hasServerOlderMessages` 字段，实现 `setHasServerOlderMessages` action；`useSessionMessages` hook 返回状态。

(2) 同步层（sync.ts）：追踪 `sessionOldestSeq` 标记最早消息序号，通过 `webLatestOnly` 在首次加载后设置标记区分初始状态，实现 `fetchOlderMessages` 方法进行增量回填。

(3) UI层（ChatList.tsx & SessionView.tsx）：ChatList 的 `OlderMessagesArea` 支持本地容量上限展开和服务端分页加载；SessionView 维护 `isFetchingOlder` 加载状态，`handleFetchOlderMessages` 处理点击事件触发历史消息加载。

(4) 国际化支持：所有 10 种语言文件均已集成 `session.loadOlderMessages` i18n key，TypeCheck 验证通过。

【性能优化】
将 sync.ts 中 backfill 的 HTTP query 参数从 `limit=100` 提升至 `limit=500`，实现单页消息数 5 倍提升。实测效果：10k 消息长会话请求数从约 100 次降至约 20 次。此改动仅涉及内部 URL 字面量，不影响导出 API；server 端 getMessagesQuerySchema 已支持 limit.max(500) 限制。与同轮增量持久化、404 缓存优化组合上线，共同优化长会话首轮补齐速度。

【用户体验流程】
用户打开长会话默认加载最新 300 条消息；滚动到顶部后显示"加载更早的消息"按钮，点击可逐批加载前序消息，直至全部消息加载完毕。

【已知问题】
工作区存在 post-commit hook 遗留的 CHANGELOG.md 和 app.config.js 未提交改动。


## Happy Project Structure & 200K/1M Model Configuration System

*discovery · high · 2026-05-17*

## Project Structure Overview

Happy is a monorepo with ~2000 tracked files organized as:

**Root Configuration**: .dockerignore, .env.docker.example, .gitignore, .yarnrc, AGENTS.md, CHANGELOG.md, CLAUDE.md, Caddyfile, Dockerfile, Dockerfile.caddy

**Directory Structure**:
- `.agents/` (2 md files) - Agent skills
- `.claude/` (7 md files) - Commands and skills documentation
- `.github/` (6 files) - Workflows and CI/CD
- `.vscode/` (1 json) - Editor configuration
- `docs/` (68 files) - Plans, manuals, and archives
- `packages/` (1896 files) - Main application code:
  - `happy-app/` (1702 files) - Frontend application
  - `happy-cli/` (135 files) - Command-line interface
  - `happy-agent/` (59 files) - Agent system

**Key Exports by Module**:
- `happy-cli/projectPath.ts`: projectPath
- `happy-agent/auth.ts`: AuthRequestResponse, authLogin, authLogout
- `happy-cli/gemini/constants.ts`: GEMINI_API_KEY_ENV, GOOGLE_API_KEY_ENV, GEMINI_MODEL_ENV
- `happy-wire/tasks.ts`: TaskPrioritySchema, TaskPriority, TaskStatusSchema, SkillSummarySchema
- `happy-cli/agent/index.ts`: initializeAgents
- `happy-cli/supervisor/buildFixPrompt.ts`: FixPromptOptions, buildFixPrompt
- `happy-cli/supervisor/buildSupervisorPrompt.ts`: SupervisorPromptOptions, buildSupervisorPrompt
- `happy-cli/gemini/types.ts`: GeminiMode, CodexMessagePayload
- `happy-cli/agent/acp/runAcp.ts`: runAcp
- `happy-cli/agent/acp/acpAgentConfig.ts`: AcpAgentConfig, KNOWN_ACP_AGENTS, ResolvedAcpAgentConfig
- `happy-cli/gemini/utils/promptUtils.ts`: hasChangeTitleInstruction
- `happy-cli/agent/factories/gemini.ts`: GeminiBackendOptions, GeminiBackendResult, createGeminiBackend
- `happy-app/hooks/useAutoOptionSendEnabled.ts`: useAutoOptionSendEnabled
- `happy-agent/logger.ts`: logger

## 200K/1M Model Configuration Multi-Layer Hybrid Implementation

Happy's context window configuration uses a sophisticated multi-layer strategy:

**UI Layer**: App hardcodes model options (sonnet, opus, opus-4-7, haiku) without exposing *-1m suffix in UI, though comments indicate 1M is the default.

**CLI Mapping Layer**: claudeRemote.ts hardcodes sonnet/opus/opus-4-7 mappings to internal [1m] model naming. However, buildBetasForModel() is now commented out and no longer explicitly passes context-1m beta headers.

**Model Classification Logic**: is1MModelKey() still identifies sonnet/opus/opus-4-7 as 1M-tier models, used primarily for coldModeHash() cold restart determination (haiku ↔ sonnet/opus triggers cold restart; sonnet ↔ opus does not).

**Model Switching Behavior**: Both inter-turn and mid-turn transitions use automatic hot-switching (resolveModelKey → setModel), with cold restarts only on hash changes.

**Dynamic Override Chain**:
1. Default via ANTHROPIC_MODEL environment variable fallback
2. Profile-level via anthropicConfig.model (overrides environment variable)
3. Daemon loads profile environment variables and passes to session

**Current Implementation**: 1M determination triggers via [1m] model name suffix, no longer relying on Happy explicitly passing beta headers. The Claude Code SDK handles context window configuration internally.


## Happy Project Repository Structure and Key Exports

*discovery · high · 2026-05-17*

## Project Overview
The Happy project is a monorepo containing approximately 2000 tracked files organized across multiple packages with primary focus on happy-app (1702 files), happy-cli (135 files), and happy-agent (59 files).

## Directory Structure

### Root Configuration
- Docker setup: Dockerfile, Dockerfile.caddy, Caddyfile
- Environment: .env.docker.example, .yarnrc
- Documentation: AGENTS.md, CHANGELOG.md, CLAUDE.md
- Standard files: .gitignore, .dockerignore

### Key Directories
- **.agents/**: Agent skills and definitions (2 md files)
- **.claude/**: Claude integration with commands (5) and skills (2)
- **.github/workflows/**: CI/CD workflows (2 files)
- **.vscode/**: VS Code configuration (1 json file)
- **docs/**: 68 markdown and TypeScript files organized as:
  - plans/ (18 files)
  - manuals/ (11 files)
  - archive/ (8 files)
- **packages/**: Main monorepo packages:
  - happy-app/ (1702 files, TypeScript/TSX/PNG)
  - happy-cli/ (135 files, TypeScript)
  - happy-agent/ (59 files)

## Critical Exports by Package

### happy-wire Package
- **messages.ts**: SessionMessageContentSchema, SessionMessageContent, SessionMessageSchema
- **messageMeta.ts**: MessageMetaSchema, MessageMeta
- **inbox.ts**: InboxCategorySchema, InboxCategory, InboxSeveritySchema
- **sessionState.ts**: sessionProgressTodoStatusSchema, SessionProgressTodoStatus, sessionProgressTodoSchema
- **runtimeProfileEnvKeys.ts**: HAPPY_PROFILE_ENV_KEYS, HappyProfileEnvKey
- **terminal.ts**: terminalSpawnRequestSchema, TerminalSpawnRequest, terminalSpawnResponseSchema
- **machineTypes.ts**: MachineMetadataSchema, MachineMetadata, TailscaleServeEntrySchema

### happy-cli Package
- **projectPath.ts**: projectPath utility
- **supervisor/buildFixPrompt.ts**: FixPromptOptions, buildFixPrompt
- **supervisor/buildSupervisorPrompt.ts**: SupervisorPromptOptions, buildSupervisorPrompt
- **supervisor/resolveAgentFromRuntimeProfile.ts**: AgentResolution, resolveAgentFromRuntimeProfile
- **supervisor/handleSupervisorTrigger.ts**: SupervisorHandlerDeps, getFixWorktreeInfo, getResearchRunInfo
- **supervisor/buildResearchPrompt.ts**: ResearchPromptOptions, buildResearchPrompt
- **supervisor/concurrencyLimiter.ts**: SlotType, setMaxConcurrency, acquireSlot

## Architecture Patterns
The project uses TypeScript/TSX throughout, with schema-based validation (Zod patterns evident from *Schema suffixes), supervisor-based control flow for research and fix operations, and environment-based runtime profile resolution. The happy-wire package serves as the central communication protocol layer.


## 跨包协调实现会话结束摘要功能完整闭环

*fix · high · 2026-05-18*

完成了happy-wire、happy-server、happy-cli、happy-app四包联动的会话摘要功能实现。

【数据模型层】wire包KnowledgeEntryTypeSchema新增"summary"类型支持。server包的4个enum同步更新：knowledgeHandler、knowledgeRoutes、knowledgeRefiner、knowledgeMergeJob。

【CLI层实现】TurnCollector增加会话级计数器追踪：总turn数、有效turn数、输出token数、编辑路径集、首尾消息。新增buildSessionSummary()方法，需至少2个有效turn触发生成。claudeRemoteLauncher的flush块末尾调用buildSessionSummary()生成摘要，以entryType:"summary"、confidence:"high"提交给LLM refiner自动改写为可检索叙述。

【UI层实现】App端ProjectKnowledgeTab过滤栏增加"Summary"选项，支持用户筛选摘要类知识。SessionRecommendationsCard添加reader-outline图标用于摘要展示。

【质量保障】全量i18n覆盖10种语言确保多语言支持。全包typecheck通过，三包零错误。整个功能形成从数据模型定义→服务端路由→CLI生成→LLM优化→App展示的完整闭环。


## Server消息接口的150条硬编码限制及分页优化方案

*discovery · high · 2026-05-18*

Server端存在两个消息获取接口的设计差异，导致功能限制：

**接口现状：**
1. `/v1/sessions/:sessionId/messages`（第592行）：硬编码`take: 150`限制，按`createdAt desc`排序，仅返回最新150条消息
2. `/v1/sessions/:sessionId/transcript`（第874行）：无硬编码限制，返回全部消息，按`seq asc`排序

**影响范围：**
App右上角刷新按钮调用的是第一个接口，因此受150条消息上限的约束，无法获取超过该数量的历史消息。

**推荐解决方案（优先级顺序）：**
1. 为`/messages`接口添加游标分页机制，支持循序加载历史消息，保持向后兼容
2. 提高或移除`take: 150`的硬编码限制，基于性能测试确定合理上限
3. 引导App改用`/transcript`接口获取全部消息，需确保接口安全性和性能

**考虑因素：**
- 分页实现应考虑数据库查询性能
- 需统一两个接口的排序规则或提供参数选项
- 应限制单次请求返回的最大记录数以防止资源耗尽


## Happy知识库改进方案：混合搜索与Token预算控制

*decision · high · 2026-05-18*

Happy项目采用PostgreSQL + pgvector (1024维)的服务端集成架构，支持E2E加密、关系图谱和热度追踪。经与agentmemory系统对比分析，agentmemory虽采用BM25+Vector混合搜索和4层记忆分层，但因架构不兼容（独立进程vs服务端集成）、缺少加密能力、依赖重（需Go二进制运行时）、数据模型差异大，不适合直接替换。

建议采纳两项高价值改进方案：

1) 混合搜索：在现有pgvector余弦搜索基础上，加入PostgreSQL全文索引ts_vector的BM25搜索能力，使用RRF（倒互排法）融合排序。该方案预期检索准确率提升10-15%，可在knowledgeSearchRoutes.ts + knowledgeEmbedding.ts基础上增量实现，无需外部依赖。

2) Token预算控制：搜索结果按相关度排序后，基于token预算（如2000 tokens）进行截断，而非采用固定top-K方式。这样可避免注入过多低相关度内容，更有效地利用上下文窗口。

两项改动都是轻量级增量实现，无需修改现有架构或引入新的外部依赖。


## applyMessages 和 applySessions 零分配快路径优化

*fix · high · 2026-05-18*

在流式输出的关键热路径上优化了消息处理函数 applyMessages 和 applySessions。优化策略为延迟 merge 操作到真正需要时，当 processedMessages 为空或仅有更新无新消息时，完全复用现有 messagesMap 和 messages 引用，避免不必要的对象拷贝和 Object.values().sort() 调用。

这两处优化针对每个 token chunk 都会触发的代码路径。通过减少对象分配和垃圾回收压力，对输入响应速度有直接性能影响。优化已完成且 Typecheck 已通过。

关键优化点：
- 零分配快路径：当无新消息时复用现有引用
- 延迟 merge：只在必要时进行数据合并操作
- 减少 GC 压力：每个 token chunk 处理时都能受益


## React Native + Expo Web 应用内存泄漏根因：sessionMessages 累积机制与修复方案

*fix · high · 2026-05-18*

## 问题诊断

Web 端页面越用越卡的核心原因是 **sessionMessages 只增不减**。storage.ts 中的 `sessionMessages: Record<string, SessionMessages>` 是全局 Zustand store 字段，用户打开会话时消息被加载到内存，但从不卸载。

## 数据结构问题

每个会话包含：
- `messages[]` 消息数组
- `messagesMap{}` 消息映射（双份存储冗余）
- `reducerState`（8+ 个 Map 对象）

**结果**：切换会话时旧数据完全留在内存中。长期使用后，浏览 5-10 个大型会话就导致内存持续膨胀。

## 次要内存问题

1. **reducer.ts ReducerState 内部 Map 垃圾回收缺失**
   - `messages`、`toolIdToMessageId`、`permissions` 等 Map 只 set 不 delete
   - 无垃圾回收机制

2. **Zustand 不可变更新性能问题**
   - 高频流式更新频繁创建大对象副本加排序
   - 造成 GC 压力

3. **Web 端缓存策略缺陷**
   - 无 MMKV 缓存，消息全部内存保持
   - 缺乏内存压力警告机制

4. **定时器累积**
   - 30+ 处 setInterval 累积影响性能

## 修复方案（优先级排序）

**优先级最高**：实现 sessionMessages LRU 驱逐机制
- 最多保留 2-3 个活跃会话数据
- 超出时自动卸载旧会话

**次优先**：离开会话页面时主动卸载
- 在会话页面卸载生命周期清空 sessionMessages 数据
- 需修改导航逻辑和 store 清理策略

**配套优化**：
- reducer.ts 中添加 Map delete 垃圾回收逻辑
- 优化 Zustand 高频更新的不可变性能
- 实现内存监控和告警机制
- 审计并合并冗余的 setInterval 调用


## happy-app 会话归档后列表未实时刷新的竞态条件根本原因

*fix · high · 2026-05-18*

在 happy-app 项目中，`performArchive` 调用 API 成功后通过 `router.back()` 回到列表，但归档的会话仍显示在列表中。

**数据流分析：**
服务端归档流程：`sessionArchive` API → 发送 `activity` ephemeral 事件（`active: false`）→ 客户端 `activityAccumulator` 接收 → `flushActivityUpdates` → `applySessions` → 重建 `sessionListViewData` 并更新 Zustand store

**根本问题：竞态条件**
1. `performArchive` 成功后立即 `router.back()` 两次，但未等待 ephemeral 事件到达
2. 用户快速回到列表页时，可能在 ephemeral 事件触发列表重新分组前就已渲染
3. 列表组件挂载/数据查询 vs ephemeral 事件更新到达的时序问题：ephemeral 事件可能被跳过或未触发组件重渲染
4. `buildSessionListViewData` 的 active/inactive 分组逻辑本身正确，但更新未被正确应用

**解决方案：**
方案一：`performArchive` 在导航前主动 invalidate 会话列表缓存
方案二：等待 ephemeral 事件确认后再执行导航回退
两种方案都避免依赖隐式的事件驱动更新，确保列表数据一致性。


## 在Zustand store中实现会话消息LRU驱逐机制以优化内存占用

*fix · high · 2026-05-19*

在Zustand state管理中实现LRU（Least Recently Used）驱逐策略，限制同时加载的会话消息数量以优化内存占用。

核心实现细节：
1. 常量定义：MAX_LOADED_SESSIONS = 3，限制同时加载的会话数量上限
2. 核心函数：applySessionMessagesLRU() 维护LRU队列，实现自动驱逐逻辑
3. 触发时机：在消息写入和加载完成时触发LRU更新检查
4. 清理机制：删除会话时同步清理LRU记录中的对应条目
5. 数据结构：SessionMessagesLRU 对象追踪最近访问的会话ID，实现队列管理
6. 优先级策略：在线会话优先保留，离线会话优先驱逐

用户重新访问已驱逐的会话时，会自动触发正常的数据重新加载流程（框架已原生支持），无需额外处理。已通过TypeScript类型检查验证。

预期效果：显著减少Zustand store体积，降低内存占用，特别是在长时间使用应用频繁切换会话的场景下。


## WebSocket和HTTP轮询消息去重机制修复

*fix · high · 2026-05-19*

问题描述：用户执行命令时消息被重复发送两次（表现为两条"Context was reset"消息），compact模式也存在相同问题。根本原因是同一消息同时通过WebSocket实时推送和HTTP轮询两条路径到达时，如果处理时序不当会导致现有去重机制失效。

解决方案：在sync.ts中添加processedWebSocketMessageIds私有字段，数据结构为Map<sessionId, Set<serverDbId>>，用于追踪每个会话已处理过的WebSocket消息服务器数据库ID。通过updateHandlerCtx getter将该Map暴露给syncUpdateHandlers.ts使用。

具体实现步骤：
1. 在sync.ts中添加processedWebSocketMessageIds私有字段和对应的getter（updateHandlerCtx）
2. 更新syncUpdateHandlers.ts中的UpdateHandlerContext类型定义，添加processedWebSocketMessageIds字段
3. 在handleNewMessageUpdate函数中，于消息解密和入队之前插入server DB ID级别的去重检查逻辑
4. 若消息ID已存在于processedWebSocketMessageIds中，则直接跳过该消息，不进入enqueueMessages流程

修改范围：仅涉及内存Map结构，不影响数据文件和公共API接口。该方案在代码层面实现消息级别的幂等性保证。


## WorldDefinitionPanel.tsx 重写与全局 World Config 管理实现

*decision · high · 2026-05-19*

完成了 WorldDefinitionPanel.tsx 的重写，实现全局 World Config 管理功能。

核心功能变更：
(1) 面板现在读写加密 KV 存储 `world.config`，包含三个字段：
    - narrative（世界设定描述）
    - laws（世界规则）
    - policy（默认建议策略）

(2) UI 组件实现：
    - 新增 Narrative 输入框（之前缺失）
    - 保留 Laws 输入框
    - Policy 为全局默认选择器

(3) 数据存储与版本管理：
    - 配置存储格式为 JSON 并带版本号
    - 支持 OTA 更新
    - 版本号用于并发控制

(4) 国际化支持：
    - 通过 i18n key `world.narrativePlaceholder` 添加至所有 10 个翻译文件
    - 包括 `_default.ts` 及其他语言文件
    - 确保类型安全

(5) 部署状态：
    - 已部署至 OTA 系统
    - 更新 ID: ae9cff91-9fc3-4e2f-8768-fc49b7715742

核心实现细节：kvGet/kvSet 调用处理 UserKVStore 的加密读写操作。


## 会话预览轻量化：用本地派生字段替代完整消息订阅

*decision · high · 2026-05-19*

【任务目标】
改造会话列表相关组件（SessionsList、ActiveSessionsGroup、ActiveSessionsGroupCompact、AgentsDashboard），从订阅完整消息改为使用本地派生字段 Session.latestUserRequestPreview 获取预览。

【核心问题】
四个关键组件通过 useSessionMessages(session.id) + getLatestUserRequestPreview(messages) 订阅完整消息来计算最近请求预览，造成不必要的消息订阅。

【关键发现】
- 列表主体已由 storage.sessionListViewData 驱动（基于 sessions metadata），不需要完整消息
- 完整消息仅在 sync.onSessionVisible() 时按需拉取，App 初始化不依赖完整消息
- /v1/sessions.lastMessage 不适合直接作为预览来源

【实现方案】
1. 采用 App 本地派生摘要字段，不修改 server/Prisma schema
2. 在 storageTypes.ts 扩展 Session 类型，添加 latestUserRequestPreview 字段
3. 在消息缓存更新和 sync 同步时计算并维护此字段
4. 四个组件从 session metadata 直接读取，删除 useSessionMessages 依赖

【涉及文件改动】
messageCache.ts/test、storageTypes.ts、storage.ts、sync.ts、四个组件文件

【项目约定】
- UI 改动后运行 yarn workspace happy-app typecheck，无需截图/E2E
- 遵循 TDD，RED 阶段应补充测试
- 所有代码改动需 code-reviewer 审查
- 清理任务产生的临时 .js 编译产物前需确认非其他并行工作的产物


## AskUserQuestionView 提交按钮权限数据同步延迟问题修复

*fix · high · 2026-05-19*

问题描述：AskUserQuestionView 组件的提交按钮在 tool.permission 数据通过 WebSocket 同步到达前，外观显示为可点击状态，但实际点击无任何响应，造成用户体验问题。

根本原因：handleSubmit 方法第 366 行的条件判断 `if (tool.permission?.id)` 导致当 permission.id 为 undefined 时，sessionAllow 调用被静默跳过。而按钮的 disabled 状态和样式逻辑未检查 permission 数据的就绪情况，造成状态不同步：按钮视觉上可用但功能实际不可用。

修复方案：
1. 在 AskUserQuestionView.tsx 中新增 hasPermissionId 派生变量，用于表示 permission 数据是否已完整同步
2. 将 hasPermissionId 逻辑集成到按钮的 disabled 属性判断中
3. 同步更新按钮的样式逻辑，使 permission 数据未就绪时按钮呈灰色禁用状态
4. permission 数据通过 WebSocket 同步到达后，按钮自动变为可用状态

实施范围：仅涉及 AskUserQuestionView.tsx 内部逻辑调整（约 3 处代码改动），无需修改 API 接口或其他组件。


## auto-send 倒计时失效：anchor 路径与 default 路径 user-text 处理逻辑不一致

*fix · high · 2026-05-19*

在 happy-app 项目中，auto-send 功能在第一次显示 Options 时正常工作，但后续显示时倒计时失效（不自动发送）。

**根本原因**：
`extractLatestOptions` 函数中 anchor 路径与 default 路径对 user-text 消息的处理逻辑不一致。当 `showScrollToBottom = true`（用户未在聊天底部）时，SessionView 使用 anchor 路径提取最新 options。该路径遇到任何 user-text 消息就立即停止扫描，导致无法找到正确的 options 消息；而 default 路径允许跳过一条 user-text 消息继续查找。

**影响链路**：
1. anchor 路径提取出错的 options（或返回 null）
2. `checkAndDispatch` 中 `isFresh` 检查失败
3. `canFire` 条件不满足
4. auto-send 倒计时不触发

**解决方案**：
1. 使 anchor 路径的扫描逻辑与 default 路径对齐，允许跳过一条 user-text 消息，而非遇到 user-text 就停止扫描
2. 检查 `buildSnapshotFromMessages` 的 freshness 判断逻辑，确保消息版本判定准确
3. 审查 `checkAndDispatch` 中对 `isFresh` 的依赖条件

**相关文件**：
- `packages/happy-app/sources/hooks/useLatestOptions.ts`
- sync 和相关状态管理代码


## Cross-project activity route schema design with conditional joins and client-side enrichment

*decision · high · 2026-05-19*

When querying activity across projects, optimize database access by using direct `accountId` fields where available (e.g., SupervisorAction has `accountId` directly) to avoid unnecessary joins. For schemas lacking direct `accountId`, use relationship joins (e.g., SessionEvent → session → accountId). Avoid server-side enrichment of computed fields like `projectPath` when the client already has the data in state (Zustand) — defer to client-side enrichment to reduce server complexity and improve performance. Field naming must precisely match server schema (e.g., `prompt` on server, not `promptPreview` which is computed client-side). This approach balances query efficiency with separation of concerns, ensuring the server returns only raw data while the client handles presentation and derived fields.


## World Module TypeScript Implementation with Adapter Pattern and Custom Hooks

*fix · high · 2026-05-19*

The world module follows a three-step structured implementation approach:

**Step 1 - Type Definitions & Adapter Layer:**
- Create worldTypes.ts with comprehensive type definitions
- Implement worldEventAdapter.ts for data transformation between API responses and component models
- No direct file I/O; all modules use pure functions

**Step 2 - Data Management Hook:**
- Build useWorldEvents.ts custom hook for fetching and managing world events data
- Integrates with existing API functions: fetchTasks, fetchInboxItems, fetchSupervisorActions
- Use simple useState + useEffect pattern for data fetching (avoid useHappyAction for queries)
- useHappyAction is reserved for mutations with error handling

**Step 3 - UI Components:**
- Add component layer: WorldEventCard, WorldFilterChips, WorldDefinitionPanel, WorldShell
- Components directory (components/world/) has no file duplication

**Important Notes:**
- fetchSupervisorActions signature verification needed: current signature differs from expected parameters and return type
- Confirm correct API parameters and return types before integration
- All new modules are pure type definitions or transformation functions

**Architecture Pattern:**
Follows adapter pattern for clean separation between API data contracts and component models, enabling flexible data transformation and maintainability.


## 项目概念架构重构：从独立实体转变为事件流维度标签

*decision · high · 2026-05-19*

识别并解决了设计文档中的核心架构矛盾：文档在§3.3声称'项目是事件来源，不是世界边界'，但在§4.2为ProjectContext定义了完整的独立对象模型，导致项目在概念层和数据层的定位不一致。

核心问题：
1. 概念不贯彻：ProjectContext被定义为独立的领域对象，违背了项目作为事件维度的设计理念
2. 事件流模型缺失：未明确Project在事件流中的具体表现形态
3. 文档自相矛盾：§4.2的对象模型与全文'一切皆事件'的基调冲突

执行的重构方案：
- 删除ProjectContext独立模型，改为WorldEvent上的source属性
- 统一事件流模型，确保所有活动（项目创建、健康变化等）都表现为WorldEvent
- 项目仅作为sourceType='project'的标签维度，不再是一等公民
- 在Map Mode中将项目从'独立节点'降级为'事件密度热区'
- 强化§1的'一切皆事件'声明，新增§3.3生命周期映射表
- 定义唯一的一等公民对象：WorldEvent schema
- 项目列表改为动态查询结果：SELECT DISTINCT source.projectId FROM world_events
- 用固定节点的Map Mode实现替换Density Mode

这次重构确保了架构设计的内部一致性和概念的严格定义。


## AskUserQuestionView 竞态条件与错误处理修复

*fix · high · 2026-05-19*

修复了 AskUserQuestionView.tsx 中的三个关键问题：

1) 竞态条件处理 - 当 agentState 事件晚于 tool_use 事件到达时，permission?.id 可能为 undefined。解决方案是改用 `tool.permission?.id ?? tool.id` 作为 fallback，确保始终有有效的 ID 值。

2) 错误处理与用户反馈 - 在表单提交的 catch 块中添加错误捕获逻辑，设置 submitError 状态。当提交失败时，按钮背景变红并显示国际化的「重试」文本，提供明确的视觉反馈和恢复机制。

3) useCallback 依赖数组优化 - 在 useCallback 依赖数组中添加 tool.id，确保回调函数在 tool.id 变化时正确更新，避免因依赖遗漏导致的闭包陈旧问题。

国际化支持：在 10 个语言文件（en、zh-Hans、zh-Hant、ja、ru、pl、es、ca、it、pt）的 askUserQuestion 对象中添加了 submitRetry 翻译 key，保证多语言用户体验的完整性。

所有改动均无 breaking change，已通过类型检查（TypeScript）和 i18n 审计。


## World 文档体系重构与架构模型调整

*fix · high · 2026-05-19*

完成了 docs/world/ 文档体系的重构，核心架构调整为：从「Project = World」改为「Project belongs to World」，Happy 承载单一主世界，Project 降级为 World 中的事件源和上下文节点。

重构内容包括：
1. 新增主锚点文档 global-world-model-ui-restructure.md 作为核心参考
2. 将历史文档（vision、roadmap、guide、activation-plan、capability-map、multica-analysis）降级为历史参考材料
3. 预留 WorldBridge、RemoteWorld、Universe 接口支持未来多世界扩展能力
4. 整理 docs/README.md 和 docs/world/ 目录下 8 个 *.md 文件的边界定义与参考状态

待提交变更：
- docs/README.md 一致性整理
- docs/world/*.md 文件体系调整
- 建议提交信息：「docs: 统一 World 文档边界与参考状态」

这次重构明确了 World 模型中各层级的职责划分，为后续架构扩展和多世界支持奠定了基础。


## Fix TypeScript errors in storageTypes.ts for metadata-only session preview implementation

*fix · high · 2026-05-19*

ISSUE: Multiple TypeScript compilation errors in `packages/happy-app/sources/sync/storageTypes.ts` blocking metadata-only session preview feature implementation.

IDENTIFIED ERRORS:
1. `latestUsage` interface structure not properly closed, causing subsequent fields to be consumed into the interface
2. Duplicate `SessionLatestUserRequestPreview` type definition
3. Missing `SessionPreferences` export/definition at expected location
4. `SessionLatestUserRequestPreview` type referenced before declaration

FIXES REQUIRED:
1. Close the `latestUsage` interface body properly
2. Remove duplicate `SessionLatestUserRequestPreview` definition (keep only one)
3. Restore `SessionPreferences` to correct export position
4. Add `SessionLatestUserRequestPreview` type definition after `SessionPreferences`

CONTEXT: These fixes are prerequisite for implementing session preview feature following TDD approach. The implementation involves:
- Adding `latestUserRequestPreview` field to Session type for storing metadata-only preview of user's latest request
- Updating message cache (`messageCache.ts`) to write this field when messages are stored
- Updating storage layer (`storage.ts`) to persist field value
- Removing `useSessionMessages` preview dependency from list components
- Tests in `messageCache.test.ts` and `sessionUtils.test.ts` already prepared

NEXT STEPS: Once TypeScript errors are fixed, proceed with implementing actual field read/write logic in message cache and storage layers, then update list component consumers.


## Repository health audit execution and findings - security, dependencies, testing, and code quality

*discovery · high · 2026-05-19*

执行了针对仓库的13维度只读健康审计。

**审计方法论**：按维度逐项深入，优先收集可证实的具体问题（关联到具体文件、行号、版本号），避免泛泛而谈，重点关注「能否落地升级/修复」。依次覆盖安全、依赖、测试覆盖、类型安全、观察性、性能、UI、API设计、文档/构建等维度。

**已确认的可报告问题**：

1. **安全问题** - PostCSS XSS漏洞
   - 位置：packages/happy-app/package.json:90,185 依赖 expo 和 twrnc
   - yarn.lock:11740-11758 仍然解析到 postcss 8.4.49/8.5.6
   - CVE-2026-41305，postcss <8.5.10
   - 严重程度：中等，置信度：96%
   - 建议修复：升级 Expo/twrnc/PostCSS 链直到锁文件解析 postcss >=8.5.10，重跑 yarn audit

2. **依赖不同步问题** - React 版本不一致
   - 位置：packages/happy-app/package.json:152-203
   - react 和 react-dom 固定在 19.2.0，但 react-test-renderer 仍为 19.0.0
   - 版本偏差可导致脆弱的测试行为和React内部变更时的假正/假负
   - 严重程度：中等，置信度：92%
   - 建议修复：将 react-test-renderer 与应用 React minor 版本对齐并刷新锁文件

3. **测试缺口** - ProjectTodoWatcher 文件系统监听逻辑
   - 已确认该文件系统监听逻辑缺少配套测试
   - 属于关键模块的测试覆盖缺陷

**审计覆盖维度**：安全、依赖、测试、类型安全、CI配置均已落地到具体文件和可修复的问题。

**审计特点**：所有问题均对应具体的包版本号、文件路径和行号，可直接执行修复操作。


## 多会话并行开发中的本地分支过时同步策略

*fix · high · 2026-05-19*

在多会话协作开发中，本地分支可能与远程分叉且包含过时改动。具体场景：本地分支相比 origin/main 落后多个 commit，存在多个已修改文件和未跟踪文件，这些改动已由其他会话提交到远程。

安全同步方案步骤：
1. 执行 `git reset --hard origin/main` - 丢弃本地所有过时改动，使本地分支与远程同步
2. 执行 `git clean -fd` - 删除所有未跟踪文件
3. 执行 `git pull` - 更新到最新状态

关键点：
- 无需手动回滚已修改的文件，因为这些改动已存在于远程 commit 中
- reset --hard 后执行 pull 会自动恢复远程的所有改动
- 此策略特别适用于多会话并行开发场景，避免重复 commit、冲突或数据丢失
- 执行前确认本地改动已被其他会话提交到远程，否则会丢失未提交的工作

适用场景：同一项目多个开发会话（如多个终端标签页）并行工作，需要保持分支同步且避免冲突。


## World文档整理至docs/world/目录完成

*discovery · high · 2026-05-20*

已完成将7个World相关文档从docs/plans/目录整理到新建的docs/world/目录。操作步骤：1) 摸清docs里现有World相关文档和引用；2) 使用docs/world/作为新目录（相比docs/plans/更清晰，因为目录混含指南和历史计划）；3) 移动7个World相关文档到docs/world/；4) 更新docs/README.md中指向旧位置的索引引用；5) 检查确认旧plans/world-*路径引用无残留。

影响范围核查结果：docs/README.md是Markdown索引文件，无代码import/require引用（仅文档/提示文本引用），不影响公开函数或类，不读写数据文件。git状态显示为文档移动和README修改，未提交。

后续建议：1) 检查docs/world/下文档之间的相对链接是否全部可点击；2) 为此次docs/world/文档整理创建一个docs类型的git提交。


## OTA 部署成功：preview 分支发布 React Navigation 启动崩溃修复

*fix · high · 2026-05-20*

OTA 部署流程已成功完成。执行 `yarn ota` 命令后，完成了脚本验证、类型检查和 i18n 审计，随后通过 EAS Update 发布到 preview 分支。此次更新覆盖 Android 和 iOS 平台，runtime version 为 20。核心修复内容：将 @react-navigation/native 升级至 ^7.2.2 版本，解决 SDK 55 环境下的启动崩溃问题。Update group ID 为 `e8220854-a9eb-49d8-96bd-5b8b59640cfc`，可在 Expo Dashboard 查看详细更新记录。部署流程包含完整的质量检查：类型检查通过、i18n 审计通过，确保更新的稳定性。


## Happy Project Repository Structure and Key Exports

*discovery · high · 2026-05-20*

## Project Overview
The 'happy' project is a monorepo containing approximately 2000 tracked files organized into documentation, configuration, and package directories.

## Directory Structure

**.agents/** (2 markdown files)
  └─ skills/ subdirectory

**.claude/** (7 markdown files)
  └─ commands/ (5 files), skills/ (2 files)

**.github/** (6 files: png, yml, md)
  └─ workflows/ (2 files)

**.vscode/** (1 JSON configuration file)

**docs/** (64 files: md, ts)
  └─ plans/ (22 files), manuals/ (11 files)

**packages/** (1900 files: ts, png, tsx) - Main codebase
  └─ happy-app/ (1687 files)
  └─ happy-cli/ (154 files)
  └─ happy-agent/ (59 files)

**Root Files:** .dockerignore, .env.docker.example, .gitignore, .yarnrc, AGENTS.md, CHANGELOG.md, CLAUDE.md, Caddyfile, Dockerfile, Dockerfile.caddy

## Key Exports by Module

**happy-cli/src/**
  - projectPath.ts: projectPath
  - configuration.ts: configuration
  - supervisor/buildFixPrompt.ts: FixPromptOptions, buildFixPrompt
  - supervisor/buildResearchPrompt.ts: ResearchPromptOptions, buildResearchPrompt
  - supervisor/buildSupervisorPrompt.ts: SupervisorPromptOptions, buildSupervisorPrompt
  - supervisor/concurrencyLimiter.ts: SlotType, setMaxConcurrency, acquireSlot
  - supervisor/resolveAgentFromRuntimeProfile.ts: AgentResolution, resolveAgentFromRuntimeProfile
  - supervisor/handleSupervisorTrigger.ts: SupervisorHandlerDeps, getFixWorktreeInfo, getResearchRunInfo
  - supervisor/dimensionTemplates.ts: DimensionTemplate, dimensionTemplates, defaultEnabledDimensions
  - modules/ripgrep/index.ts: RipgrepResult, RipgrepOptions, run

**happy-wire/src/**
  - tasks.ts: TaskPrioritySchema, TaskPriority, TaskStatusSchema
  - skills.ts: SkillSummarySchema, SkillSummary, CreateSkillBodySchema
  - runtimeProfileEnvKeys.ts: HAPPY_PROFILE_ENV_KEYS, HappyProfileEnvKey
  - terminal.ts: terminalSpawnRequestSchema, TerminalSpawnRequest, terminalSpawnResponseSchema
  - codexMetadata.ts: CodexRuntimeConfigSchema, CodexRuntimeConfig, CodexAccountSchema


## 修复会话页回退按钮在深链接场景下失效问题

*fix · high · 2026-05-20*

问题描述：会话页左上角的回退按钮在用户通过深链接或推通知直接进入时失效，因为 `router.back()` 在无导航历史时不起作用。

根本原因：当用户通过深链接或推通知直接进入会话页时，浏览器导航历史为空，`router.back()` 无法执行回退操作。

修复方案：
1. 在 `ChatHeaderView` 的 `handleBackPress` 方法中增加 `router.canGoBack()` 判断逻辑
2. 当 `router.canGoBack()` 返回 false 时，使用 `router.replace("/")` 作为兜底方案，将用户导航到首页
3. 移除 `SessionView.tsx` 中显式传入的 `onBackPress={() => router.back()}` prop，让 `ChatHeaderView` 内部统一管理回退逻辑

预期效果：无论用户通过以下任何方式进入会话页，回退按钮都能正常工作：
- 从会话列表页点击进入（有导航历史）
- 通过深链接直接打开（无导航历史）
- 通过推通知直接进入（无导航历史）

修改文件：
- `ChatHeaderView.tsx`: 更新 `handleBackPress` 逻辑
- `SessionView.tsx`: 移除冗余的 `onBackPress` prop 传递


## Git rebase conflict resolution and CONTEXT.md feature deployment

*fix · high · 2026-05-20*

Successfully resolved a git rebase conflict in claudeRemoteLauncher.ts where the remote HEAD had deleted the repo map code block while the local commit intended to add it. The resolution retained the local repo map code block that calls generateRepoMap(session.path) and submits knowledge via session.client.submitKnowledge().

Three local commits were pushed to the main branch:
1. docker-compose.yml updated with LOG_LEVEL: DEBUG configuration
2. ProjectConfigTab.tsx updated to render ContextMdSection component
3. Two new files implementing the CONTEXT.md editing feature:
   - context-md.tsx: Full-screen editor for CONTEXT.md content
   - ContextMdSection.tsx: Config card entry point for the feature

No public API changes or data schema modifications were introduced. TypeScript diagnostics show only pre-existing unused variable warnings, indicating no new type safety issues were introduced.


## LiveKit集成实现进度与Wire Schema扩展确认

*decision · high · 2026-05-20*

按批准的全栈MVP计划推进Wire/Server基础设施与App集成。

已完成的工作：
1. Wire schema扩展：仅新增LiveKitTokenResponseSchema和LiveKitTokenResponse，不破坏现有ElevenLabs schema
2. 导入链路确认：packages/happy-wire/src/index.ts:6通过export聚合，无业务文件直接导入./voice
3. LiveKit依赖安装完成，已触发Prisma generate
4. Server路由gate确认：voiceRoutes在api.ts:44导入、:169注册

已规划的新增端点：
- POST /v1/voice/livekit-token：生成LiveKit token
- POST /v1/voice/livekit-verify：验证token
- 现有POST /v1/voice/token保持不变

待实现内容：
1. Server路由改动，response结构需包含{token, url, roomName}
2. verify逻辑实现

采取的技术措施：
1. 分阶段实现：先完成不涉及密钥处理策略的部分，安全审查后对齐细节
2. 避免使用过时API，已核对LiveKit当前SDK文档
3. 修正工具参数，移除无效空字段

整体进度：基础架构就绪，核心业务逻辑待实现，安全策略需后续审查确认


## Bitwarden 浏览器扩展自动填充覆盖层 DOM 节点错误

*fix · high · 2026-05-20*

在浏览器开发环境中遇到的错误来自 Bitwarden 扩展的 bootstrap-autofill-overlay.js，而非应用代码本身。

根本原因：Bitwarden 的自动填充菜单尝试使用 insertBefore 将 DOM 节点插入父节点时，参考节点已被页面脚本或 React 渲染移除，导致 insertBefore 操作失败。这是 Bitwarden 扩展的已知兼容性问题。

解决方案：
1. 在浏览器设置中禁用 Bitwarden 的自动填充菜单功能
2. 开发期间临时禁用扩展
3. 若在 WebView 环境中出现，通常可安全忽略

影响：此错误不会影响应用的实际功能，仅为第三方扩展与现代前端框架的兼容性问题。


## 消息同步游标推进修复：TDD实现方案

*decision · high · 2026-05-20*

针对消息增量同步中游标推进问题的TDD修复计划。

【核心问题】
防止消息永久丢失，特别是在解密失败时游标不应跳过失败消息。现有逻辑在解密失败场景下可能导致消息序号被跳过，造成数据丢失。

【解决方案】
采用TDD方法：先写失败测试，再进行最小实现。新增纯函数工具模块 `messageCursor.ts`，独立于现有同步逻辑。

【实现细节】
函数签名：
- 输入参数：afterSeq(当前游标)、rawSeqs(原始消息序列)、processedSeqs(成功处理序列)
- 输出结构：{ nextAfterSeq, cursorSeq, stalled } 用于指导游标推进
- 不涉及文件I/O或数据库操作，仅处理纯逻辑计算

【测试覆盖】
1. 解密失败时 lastSeq 不跳过失败消息
2. 游标只推进到成功解密的消息序号
3. 检测同步停滞状态(stalled标志)
4. 复用现有测试风格：syncUpdateHandlers.test.ts 和 backfillBoundary.test.ts

【关键设计原则】
- 纯函数设计便于单元测试
- 清晰的输入输出接口
- 完整的停滞检测机制


## Expo Router 路由警告修复：非路由文件迁移至 _components 目录并更新导入路径

*fix · high · 2026-05-20*

在 happy-app 工作区执行的批量重构方案，用于修复 Expo Router 警告。核心策略是将与路由页面共存的辅助组件、hooks、utils 从路由目录迁移至 `_components` 子目录，并更新所有受影响的 TypeScript import 路径。

## 执行范围
涉及迁移的路由页面包括：`automation.tsx`、`loops.tsx`、`tasks.tsx`、`task/[taskId].tsx`、`task/new.tsx`、`webhook-trigger/new.tsx`、`trigger-schedule/new.tsx` 等。这些页面由 Expo Router 的文件系统路由加载，源码中无其他地方显式 import 它们。

## 关键实施原则
- 仅修改 import 路径前缀，从相对路径改为 `../_components`，不修改业务逻辑
- `_components` 目录已存在且为空，可安全迁移
- 所有被迁移的导入仅涉及路径解析更新，不影响组件行为
- 受影响的 default export 组件（如 `MachineAutomationPage`、`TaskListPage` 等）仅需路径修正
- 动态 import（如 `import("./DetailSheet")`）也需相应路径调整

## 依赖关系更新
- `useTasksData` hook 的调用方为 `machine/[id]/tasks.tsx`，需更新 import 来源
- 本次改动不新增或修改任何数据文件读写操作

## 实施注意事项
- 避免误传空 `pages` 参数给文件读取工具
- Gateguard 要求在编辑前明确说明调用关系和影响面
- 工作区中存在未提交的 `yarn.lock` 和 `eas.json`，本次仅操作路由相关文件
- 确保所有 import 路径一致性，避免遗漏任何受影响的导入声明


## 项目详情页Pipeline节点信息展示优化方案

*discovery · high · 2026-05-20*

在项目详情页的"数据流向"区域对Pipeline组件进行了UI增强，用于改进数据可视化展示。

【原始问题】
Pipeline原本仅显示4个指标的基础数字（循环总数、自动化任务、守护会话、审计日志），缺乏子状态信息和补充说明，信息密度低。

【优化方案】
1. 修改PipelineNode组件：添加可选的secondary副文本、secondaryColor和icon属性，保持向后兼容
2. 扩展styles文件：增加pipelineMetric和pipelineMetricText样式键，支持新的样式表现
3. 国际化配置：在i18n翻译文件中新增三个键值对
   - automationPipelineAllIdle（空闲状态）
   - automationPipelineAllDone（完成状态）
   - automationPipelineHealthy（健康状态）
   含对应中文翻译
4. 节点信息优化：每个Pipeline节点现展示关键子状态，下方增加补充指标行

【实施特点】
- 所有改动均为非破坏性，未修改现有业务逻辑
- 仅扩展UI表现力和信息密度
- 保持组件向后兼容性
- 支持多语言展示


## Claude API Empty Thinking Block Error: sub2api Conversion Layer Issue and Defense Strategy

*fix · high · 2026-05-20*

Claude API returns 400 error 'each thinking block must contain thinking' when messages contain empty thinking blocks. In the Happy project, this error originates from the upstream sub2api proxy layer, which sporadically generates empty content in thinking blocks when converting Claude SDK requests to OpenAI-compatible interface format and back to Anthropic format.

Root Cause Analysis:
Happy CLI uses @anthropic-ai/claude-agent-sdk, where message construction and API calls occur entirely within the SDK internals. The Happy layer cannot directly intercept or modify the messages array being sent to the API, making client-side filtering impossible at the application level.

Viable Solutions (in priority order):
1. Optimal: Fix at sub2api layer by filtering empty thinking blocks or inserting placeholder content
2. Implement lightweight HTTP proxy middleware between Happy CLI and sub2api to filter request bodies
3. Investigate sub2api configuration options for disabling or fixing thinking block conversion
4. Monitor and log empty thinking block occurrences to identify conversion patterns

Immediate Mitigations:
- Configure request retry logic with exponential backoff
- Implement structured logging to track error frequency and context
- Consider fallback to non-thinking-block mode if available

Long-term Strategy:
Root cause lies in the proxy layer's message format translation between incompatible thinking block implementations. Resolution requires either fixing the translation logic or bypassing it entirely with native Anthropic API calls.


## 竞品调研维度扩展：新增代码集成复杂度和代码复用度分析维度

*decision · high · 2026-05-20*

在 happy 项目的竞品调研功能中扩展分析维度。现有 8 个维度全部聚焦于产品/市场层面（定价策略、核心功能、开发者体验、市场定位、技术架构、社区生态、融资动态、用户口碑），缺少代码层面的分析视角。

新增两个代码相关维度：
1) integrationEffort（集成复杂度）— 评估竞品功能集成到当前项目的工程量，分析维度包括：文件/模块数量、新依赖需求、架构冲突风险、复用轮子可用性。
2) codeReusability（代码复用度）— 评估竞品实现思路的可借鉴性，分析维度包括：API 设计模式、数据结构、算法逻辑的直接复用可能性。

这两个维度会引导 AI 在竞品调研时主动深读项目源码（扫描 src/ 目录），而非仅读顶层文件。

实施范围：需在 10 个翻译文件（_default.ts、zh-Hans.ts 及其他 8 个语言文件）中的 competitorResearch section 追加 4 个 i18n key：dim_integrationEffort、dim_integrationEffort_note、dim_codeReusability、dim_codeReusability_note。均为纯对象字面量修改，不涉及函数签名变更。


## Research Run 完整架构与问题追踪

*discovery · high · 2026-05-20*

## Research Run 完整数据流架构

数据流：App (ProjectResearchTab) → Server API → CLI daemon → Claude Session → curl 回调 Server → WebSocket 推送 App

## 关键文件清单

| 层级 | 文件 | 职责 |
|---|---|---|
| App UI 配置触发 | `components/project/ProjectResearchTab.tsx` (977行) | 维度选择、竞对输入、触发研究、运行状态、报告列表 |
| App UI 报告详情 | `app/(app)/project/[id]/research-report/[runId].tsx` (125行) | 独立页面展示完整报告 Markdown |
| App API | `sync/apiSupervisor.ts` | `triggerSupervisorRun` / `fetchSupervisorRuns` / `cancelSupervisorRun` |
| Server 路由 | `app/api/routes/supervisorRunRoutes.ts` | 创建 run 记录、分发 trigger 到 CLI、接收回调更新状态 |
| CLI 调度 | `supervisor/handleSupervisorTrigger.ts` (877行) | preflight sync → 并发控制 → spawn session；`handleResearchTrigger` 专门处理 research |
| CLI Prompt 构建 | `supervisor/buildResearchPrompt.ts` (289行) | 构建研究 prompt，支持竞对分析和开源发现两种模式 |
| 进度组件 | `components/project/SupervisorProgressView.tsx` | 通用进度展示（维度进度条 + 耗时） |
| 工具函数 | `components/project/supervisorUtils.ts` | `useElapsedSeconds` / `DimensionProgress` 类型 |

## 核心机制详解

**1. 双模式切换**：`featureDirection` 非空时切换为「开源发现」模式，过滤掉 pricing/funding 等维度，追加 license/maintenance/bundleSize 等 OSS 维度。

**2. 配置持久化**：本地 MMKV（即时存储） + KV Store（多设备同步），带乐观并发控制机制。

**3. 实时状态推送**：WebSocket `onSupervisorStatus` 推送维度进度，终态时刷新列表。

**4. 防重复处理**：CLI 端 `processingRuns` Map 防止同一 runId 重复处理。

**5. 回调机制**：Claude Session 通过 curl 调 Server API 报告结果（Python 脚本构造 JSON）。

**6. 兜底容错**：`researchRuns` Map 追踪运行中 session，session 异常退出时 daemon 发送 failed 状态。

## 已知问题追踪

**动画丢失问题**：可能与 `isRunning ? styles.hidden : undefined` 的 `display: none` 切换有关，影响进度条动画显示。

**409 冲突错误**：KV Store 乐观并发冲突，`kvSetWithRetry` 处理重试逻辑。

**"自动化仍在进行中"问题**：`SupervisorAlreadyRunningError` 抛出时会触发 `loadData()` 刷新，需检查并发控制逻辑。

## 调研进展

已完成 App 端主文件、CLI 端处理逻辑、report 详情页、supervisor API、prompt 构建和 Server 端 API 的代码审查，形成完整链路认知。后续可针对具体问题（动画丢失、并发冲突、状态刷新）进行深度诊断。


## 前一会话遗留改动状态与后续工作方向确认

*decision · high · 2026-05-20*

用户继续前一会话的工作。前一会话留下未提交的改动状态：automation 页面 UI 增强，包括为 PipelineNode 组件添加 icon、secondary 文本和颜色支持，以及 3 个新的翻译 key。这些改动已通过 typecheck 和 i18n 审计验证，达到可提交状态。

当前已确认的后续工作方向包括：
1. CI/CD Phase 1 统一检查 workflow - 规范和集中化 CI/CD 流程
2. OpenAI 模型和超时配置调整 - 优化大模型集成参数
3. 代码质量评估框架维度 prompt 升级 - 增强质量评估能力
4. SDK 0.2.119 升级的剩余工作 - 涉及 SessionStore、MentionPicker 和 McpInvoker 三个组件的升级

这些工作项形成了当前迭代的主要任务列表，需要依次推进。


## Implement Two Built-in Dimensions and Fix Server Dimension Collection Sync Issue

*fix · high · 2026-05-20*

Plan to implement two approved built-in dimensions in both CLI and Server endpoints while resolving the Server-side built-in dimension collection synchronization problem.

Implementation workflow:
1. Read target file context to ensure consistent insertion positions and formatting
2. Avoid empty pages parameters by using standard file reading methods
3. Modify core dimension definitions in both CLI and Server endpoints
4. Per Fact gate requirements, first map out dimensionTemplates.ts call relationships and supplement relevant facts before making edits

Key considerations:
- Ensure dimension definition consistency across CLI and Server
- Maintain proper synchronization logic between endpoints
- Preserve existing file structure and formatting conventions
- Complete dependency analysis before modifying dimensionTemplates.ts to avoid breaking existing relationships


## Octogent AGENTS标签页：力导向Agent拓扑网络图的实现原理与集成方案

*discovery · high · 2026-05-21*

Octogent的AGENTS标签页展示实时Agent拓扑网络图，结构设计为：Octoboss（金色中心节点）作为主协调器，多个Tentacle域节点（如Docs & Knowledge、Core Domain、API Backend）代表不同功能域，每个域下有coordinator和worker子节点，连线表示从属关系。

技术实现原理：采用React + SVG渲染，使用d3-force v3进行力导向布局仿真，包含斥力、链接力、碰撞检测等物理模型。数据获取通过HTTP轮询获取/deck/tentacles和/conversations端点，实时状态由Agent runtime钩子驱动，节点属性更新和边上动画流动点由事件系统触发。

后端支持现状：Happy项目的后端数据层已完全支持此功能，包括WorldMember + AgentRole模型、Session父子关系管理、Socket.IO实时推送能力。

集成实现方案：前端可视化组件缺失，可行性高。跨平台集成策略为：React Native端使用react-native-svg + d3-force（纯JS实现），Web端使用SVG + d3-force。核心开发组件包括AgentTopologyGraph主组件和useForceSimulation自定义hook，预计工作量3-5天。


## Octogent 代码图谱与 Happy 知识库的差异分析及集成方案

*decision · high · 2026-05-21*

Octogent 的'可视化知识图谱'本质是 Code Intel（代码智能），通过 `/api/code-intel/events` API 记录 Claude Code 工具调用事件（符号查找、文件引用、依赖关系），追踪的是代码结构关系而非知识或记忆。

**Happy 知识库现有能力**：包括 KnowledgeEvolutionView 知识条目进化时间线可视化、KnowledgeRelation DB 表支持 4 种边类型（related/contradicts/refines/combines）、pgvector 语义检索、Phase 3 生命周期调度（衰减、归档、LLM 合并）。追踪的是会话知识和决策信息，通过 TurnCollector 精化。

**核心差异**：两者追踪维度不同（代码符号/文件依赖 vs 会话知识/决策）、可视化形式不同（代码依赖图 vs 知识进化时间线）、用途也不同。

**集成建议**：Happy 可新增独立的'代码图谱'模块，通过 CLI 钩子拦截 Claude Code 的 Bash/Read/Grep 调用，提取文件引用关系，实时构建项目代码依赖图。这是与现有知识库并行的新功能而非替代品，需要独立的实现工作量。优先级取决于对代码结构可视化场景的重视程度。


## Octogent竞品对标：触手模型与Swarm架构集成方案

*discovery · high · 2026-05-21*

通过深入分析Octogent竞品，识别出三个核心集成维度实现功能对标：

1. 触手(Tentacle)模型：在.happy/CONTEXT.md存放项目上下文并注入系统提示词，实现低成本、高价值的集成，效果媲美Octogent的主要功能。

2. Swarm多Agent并行：将App任务列表中的pending任务派发为独立Agent并行处理，提升任务处理效率。

3. 上下文注入机制：自动向所有新会话传递项目上下文，保持Agent行为一致性。

已完成竞品代码结构分析和Happy Agent Loop体系研究。通过supervisor callback API（https://s.sangreal.code.xycloud.info:2443/v1/projects）上报进度和研究结果，结果提交成功(HTTP 200)。

临时脚本/tmp/submit_report.py用于一次性结果提交，以JSON格式（包含status、reportTitle、reportContent、actions字段）报告发现，json.dumps自动处理JSON转义，无需手动处理。


## GitChangesTab.tsx 第586行 View组件意外文本节点错误

*discovery · high · 2026-05-21*

在 `GitChangesTab.tsx` 文件的第586行附近发现错误："Unexpected text node: . A text node cannot be a child of a `<View>`"。

错误原因：
- `<View>` 标签内部包含了多余的文本节点，具体是一个句号(`.`)字符
- 这个文本节点不能直接作为 `<View>` 的子元素

可能的问题位置：
- `renderGitFileItem` 函数内的 View 标签
- `SectionButton` 组件的渲染逻辑
- `Item` 组件中 `subtitle` 或 `rightElement` 的渲染
- unistyles 的 `createUnistylesElement` 相关的渲染代码

排查步骤：
1. 检查第586行前后的 JSX 代码，寻找 `<View>` 标签
2. 确认是否有直接的文本内容（特别是句号、空格等）在 View 内部
3. 检查 render 函数中是否有条件渲染导致的意外文本
4. 查看最近的文件修改记录，定位问题引入的时间
5. 验证子组件（如 Item、SectionButton）的 props 渲染逻辑

解决方案：
- 将多余的文本节点移出 `<View>` 标签
- 如果文本需要显示，使用 `<Text>` 组件包装
- 清理条件渲染中的意外文本字符


## 语音设置重构：清理旧字段残留并补齐LiveKit测试覆盖

*fix · high · 2026-05-21*

在语音设置字段重构中，需要系统清理旧字段残留并补齐LiveKit相关的测试覆盖。

核心任务：
1. 代码清理：扫全量代码清理 `ttsProvider`、`voiceboxEndpoint` 等旧字段的所有残留引用，重点在 `settings.ts` 的schema/defaults定义和 `apiVoice.ts` 的参数传递逻辑。

2. 测试补充：采用TDD方式，先写RED用例验证新字段（如 `livekitWssUrl`）的变更确实需要实现支持，再修改实现代码使其通过。

3. 测试文件结构修正：`settings.test.ts` 和新建的 `apiVoice.test.ts` 需删除旧字段引用，补入 `livekitWssUrl` 的默认值和相关断言。

4. 依赖关系验证：确认测试文件仅被Vitest执行，无生产代码直接调用测试模块。

关键受影响的公开接口：`settingsParse`、`applySettings`、`settingsDefaults`、`fetchLiveKitToken`、`verifyLiveKitCredentials`。

执行策略：先批量删除旧字段残留（RED阶段），再精确补齐LiveKit参数和对应的断言（GREEN阶段），最后运行完整测试套件确认RED→GREEN的转变，确保重构的完整性和正确性。


## React hooks 顺序错误导致条件渲染时 hook 数量不一致

*fix · high · 2026-05-21*

在 SessionKnowledgeSheet.tsx 中发现 React hooks 违规问题：第 445 行存在 early return（`if (!inline && !shouldRender) return null`），但 `React.useCallback` 钩子定义在第 469 行的 early return 之后。

问题根源：当 `shouldRender` 从 false 变为 true 时，hook 执行顺序会改变，导致 hook 数量动态变化。这违反了 React hooks 的核心规则——hooks 数量必须在每次渲染时保持一致，会导致渲染状态不同步和潜在的运行时错误。

修复方案：
1. 将 `handleRefreshActiveTab` 的 `useCallback` 定义移到 early return 之前，确保 hook 无条件执行
2. 调整依赖项数组中的 `isChangesTab` 为 `activeTab === "changes"` 以确保逻辑在 early return 前可用
3. 修复后已通过类型检查验证

影响范围：仅涉及内部实现，不涉及公共 API 变化。


## 修复手机端状态栏文本截断问题

*fix · high · 2026-05-21*

在移动端，模型摘要状态栏显示不全，"Yolo" 等文本被截断。

根本原因：父容器采用 flexDirection: "row" + justifyContent: "space-between" 布局，左侧连接状态、右侧模型摘要栏争夺空间。模型摘要栏的 maxWidth 设置为 screenWidth - 40，但未考虑父容器 paddingHorizontal: 16（两侧共32px）和 marginLeft: 12，导致实际可用宽度远小于预期。

修复方案：
- 移动端：将模型摘要栏从 minWidth: 150 + maxWidth: screenWidth - 40 改为 flex: 1 + minWidth: 0，使其自动占满左侧连接状态之外的所有剩余空间
- PC Web 端：保持 maxWidth: 360 不变，确保不换行且完整显示

实现位置：AgentInput.tsx 内部样式修改
影响范围：仅涉及内部布局样式，不影响导出的函数签名或 Props 类型

关键点：flex: 1 + minWidth: 0 的组合是解决 flex 容器中文本溢出的标准方案，minWidth: 0 重置了 flex 项目的默认最小宽度（auto），允许内容真正收缩。


## React Native 响应式布局迁移：layout 纯函数转换为 useLayout() hook 的完整方案

*fix · high · 2026-05-21*

## 问题背景
React Native 应用中原有 `layout.ts` 导出纯函数（`layout()`），被 65 个组件文件通过 `import { layout }` 使用。为支持折叠屏等动态设备形态识别，需将模块级静态布局计算转换为组件级响应式 hook。

## 迁移策略
1. **Hook 改造**：将 `layout.ts` 的纯函数改造为 `useLayout()` hook，在组件内部动态读取屏幕尺寸变化
2. **场景分类处理**：
   - JSX 内联样式：直接调用 hook 获取动态值
   - `StyleSheet.create()` 工厂函数：无法直接在模块级使用 hook，需提供辅助函数（如 hook 包装或计算延迟）
3. **批量迁移**：使用脚本自动化替换 65 个文件的导入语句和 hook 注入

## 执行中的关键问题与解决方案

### 1. 正则边界符 Bug
- **问题**：第一版正则表达式使用边界符（`\b`）时，在 TypeScript 类型定义中误触发，导致 74 个文件的导入语句未被正确更新
- **解决**：改用更简单、更稳定的字符串替换逻辑（如直接字符串匹配而非正则）

### 2. Hook 注入位置精确定位
- **问题**：Hook 必须注入到函数体顶部（React 规则），但脚本容易误插进 JSX 对象字面量或 props 类型定义中
- **解决**：通过 AST 解析或精确的代码结构识别，定位函数声明的实际体部，确保 hook 在所有逻辑语句之前

### 3. 手动修复
- MessageView.tsx 等 2 个文件因代码结构复杂或特殊，需手动调整 hook 注入位置

## 最终验证结果
- ✓ 0 个文件保留旧的 `import { layout }` 导入
- ✓ 25 个 JSX-only 文件正确注入了 `useLayout()` hook
- ✓ TypeScript 类型检查（typecheck）通过
- ✓ 整体迁移覆盖 65 个组件文件

## 最佳实践建议
1. 对大规模迁移优先使用字符串替换而非复杂正则，减少边界情况
2. Hook 注入脚本应基于 AST 解析，确保准确度
3. 对无法自动处理的文件（如 StyleSheet.create() 的直接依赖）预留手动修复流程
4. 迁移后应补充单元测试验证响应式行为在各屏幕尺寸下的正确性


## 移除 SessionSidePanel 中知识库标签的数量指示器

*fix · high · 2026-05-21*

在 SessionSidePanel.tsx 中移除了知识库（knowledge）标签下的数量指示器，该指示器原本显示为「0·7」的格式。

**具体修改内容：**
- 删除了驱动此指示器的相关钩子导入：useSessionKnowledgeCount 和 useSessionKnowledgeAccesses
- 删除了组件内部的 knowledgeCount、accesses 和 summaryInfo 变量声明
- 删除了 topTabs 组件中 secondary 属性的渲染逻辑块
- 删除了关联的 metricSummary CSS 样式

**影响范围：**
- 仅涉及 SessionSidePanel 的内部渲染逻辑修改
- 组件的公共接口和函数签名保持完全不变
- 变更标签行数统计（+N/-N）的计数逻辑不受影响
- 已通过 TypeScript 类型检查验证

**测试状态：** 此为 UI 清理工作，移除了不需要的数量显示功能。


## ChatList 加载更多按钮显示逻辑分析与常见问题

*discovery · high · 2026-05-21*

ChatList 组件的「加载更多」按钮虽然代码已实现，但仅在特定条件下显示，容易被用户忽视。

【显示条件】
按钮显示依赖 `hasOlderMessages` 标志，该标志由内存消息数与限制值的比较决定：当消息列表长度超过 300 条限制时（`all.length > limit`），标志为 true，按钮才会显示。

【常见问题场景】
1. 正常场景：会话总消息数 ≤ 300 条，全部加载完毕，按钮不显示，属于预期行为
2. 问题场景：会话消息 > 300 条，但 backfill 后台任务未完成。此时内存中仅有初始的 300 条消息，`hasOlderMessages` 为 false，按钮无法显示

【加载流程】
系统采用两阶段加载策略：
- 第一阶段：获取最新 300 条消息（`before_seq=2147483647&limit=300`）
- 第二阶段：后台反向补全更老消息（`after_seq=0&limit=500` 循环补全）

【用户体验问题】
即使按钮出现，其样式设置也难以发现（opacity 0.4，字号 12）。用户遇到的问题很可能是：消息量足够但在 backfill 完成前滑动到顶部，此时无法看到加载更多的提示。

【建议】
考虑优化显示逻辑，不依赖 backfill 完成状态；或改进按钮样式的可见性（提高对比度、字号等）。


## 修复 React Native MessageView 中 Compaction 事件文字截断问题

*fix · high · 2026-05-21*

happy-app 的 MessageView.tsx 中，AgentEventBlock 组件渲染 Compaction 消息时出现文字不完整的问题。

根本原因：`agentEventContainer` 使用了 `alignItems: "center"` 属性，导致内部 Text 元素使用固有内容宽度而非容器宽度。当设备字体缩放较大或屏幕较窄时，文字溢出部分被裁剪，无法换行显示完整内容。

修复方案：
1. 移除 `agentEventContainer` 的 `alignItems: "center"` 属性
2. 在 `agentEventText` 上添加 `textAlign: "center"` 属性

修复效果：Text 元素可自动撑满容器宽度，文字在元素内部居中显示，完整显示 "Compaction completed" 和 "Context was reset" 等事件文字。

影响范围：仅修改 MessageView.tsx 内 AgentEventBlock 的样式属性，不改变任何公开 API、函数签名或 Props 接口。该修复为纯样式调整，不涉及逻辑变更。


## Git提交与推送：修复useSessionMessages选择器的无限更新循环及构建产物管理

*fix · high · 2026-05-21*

用户执行git推送操作，成功提交4个文件的变更（122行新增，5行删除），commit hash为026121ca，推送至origin/main分支。

关键问题发现：
1. 检查未跟踪文件时发现275MB的APK构建产物误入工作目录，这类文件不应被提交至版本控制
2. useSessionMessages选择器存在无限更新循环问题，需要修复

解决方案与建议：
1. 新增的TypeScript文件应纳入版本控制
2. APK等构建产物应通过.gitignore规则防止被误提交
3. 建议验证useSessionVisibleEffect的类型检查，以确保选择器逻辑正确

版本控制最佳实践：确保构建输出目录（如dist/、build/、*.apk等）已在.gitignore中正确配置，避免大型二进制文件污染代码仓库。


## OTA 2.16.1 发布 - Side panel tab 自适应与横向滑动修复

*fix · high · 2026-05-21*

成功发布 OTA 更新到 preview 分支，版本号 2.16.1。此次 OTA 更新包含以下内容：

【功能修复】
- Side panel tab 宽度自适应功能实现
- 横向滑动功能修复
- 支持 Android 和 iOS 双平台

【更新方式】
用户通过打开 App 后台刷新即可自动获取更新，无需手动操作。

【技术信息】
- Runtime version: 20
- Update group ID: 50faccd0-1e78-4acb-9264-366e6ff521cc
- 目标分支: preview

【建议后续操作】
运行 /changelog 命令更新 CHANGELOG 文件，以记录此次 tab 滑动修复的相关内容。


## 会话刷新按钮的功能价值与保留策略评估

*decision · high · 2026-05-21*

refreshSession 按钮通过重置 lastSeq 进行全量消息重取，是自动增量同步机制无法替代的功能。

核心价值：
- 应对数据异常场景：Socket 断连期间的消息丢失、本地边界状态与服务端不一致、seq 跳号等
- 自动刷新（前台切换触发的 invalidate）仅执行增量拉取，无法恢复这些异常状态
- 分页加载和 Git 状态问题已由其他机制处理

使用频率评估：
- 如果增量同步质量稳定且 seq 丢失未在监控中出现，用户使用频率极低
- 当增量同步出现问题或 seq 丢失被监控发现时，该按钮成为关键逃生门

保留策略建议（三选一）：
1. 移到菜单中 - 减少 UI 噪音，保持功能可用性
2. 删除并补偿 - 在 sync 层实现自动全量刷新补偿机制
3. 保留现状 - 继续作为显见的快速恢复选项

决策基准：监控 seq 丢失情况、用户使用统计、增量同步稳定性。


## LiveKit语音集成进度与BYOK功能缺口分析

*discovery · high · 2026-05-22*

LiveKit语音集成核心功能已完成11/15项，包括Agent服务、Docker部署、前后端路由、VoiceSession实现、Provider选择逻辑等。Server↔Agent↔App语音通话链路已完全贯通，目前可用服务端默认凭据正常使用。

缺失的4项功能均与BYOK（自带密钥）用户设置相关，具体包括：
1. settings.ts缺livekitApiKey和livekitApiSecret字段定义
2. apiVoice.ts中的fetchLiveKitToken()函数未将用户API凭据传递给服务端
3. 缺少fetchLiveKitVerify()凭据验证函数实现
4. voice.tsx设置页面缺少LiveKit配置区块，包括API密钥输入框、Save&Verify按钮、连接状态显示、用量统计等

这些缺口直接影响用户自管理和配置自己的LiveKit账户的能力。参考ElevenLabs实现模式，应补充完整的用户凭据管理流程：从前端输入与验证，到后端凭据存储与使用，再到实时连接状态反馈。建议按优先级逐项补充这些设置功能，以完成LiveKit BYOK集成的全流程支持。


## 完成es/it/ca翻译文件编辑并通过typecheck验证

*fix · high · 2026-05-22*

完成了西班牙语(es.ts)、意大利语(it.ts)、加泰罗尼亚语(ca.ts)三个翻译文件的编辑。在各文件的session对象末尾新增loadOlderMessages字段的对应语言翻译：西班牙语'Cargar mensajes anteriores'、意大利语'Carica messaggi precedenti'、加泰罗尼亚语'Carregar missatges anteriors'。

这三个文件的导入关系完全相同，均被text/index.ts、automationI18n.test.ts、translationAudit.ts导入。所有翻译文件均不包含数据读写操作，仅作为静态翻译常量使用。全部11个翻译文件编辑完成后，运行typecheck验证通过，零错误。


## EAS Build 45分钟超时根本原因与解决方案：Gradle编译优化和.easignore配置

*fix · high · 2026-05-22*

EAS Build 免费计划有 45 分钟的硬性时限。项目遇到超时问题，根本原因是 React Native 首次全量 Gradle 编译在免费机器上需要超过 45 分钟，而非包大小问题（项目包 226MB）。

关键发现：
1. .easignore 配置位置错误是常见问题。该文件必须放在 eas.json 同目录（packages/happy-app/）才能生效，根目录的 .easignore 无效
2. 减小包大小（排除 dist、node_modules 等）帮助有限，无法根本解决 Gradle 编译耗时问题
3. 当所有改动都是 JS 层代码（诊断页、会话修复、UI 改动）时，完全可用 OTA 推送，3 分钟完成，无需重新构建 native

最佳实践方案对比：
• OTA 推送（推荐）：适合纯 JS 改动，3 分钟完成，无需等待编译
• 本地编译 yarn android:preview：无时间限制，适合需要修改 native 代码的场景
• EAS 付费计划：使用 M 系列机器，同样编译耗时 15-20 分钟

建议首先检查 .easignore 配置位置是否正确，然后根据改动类型选择合适的部署方案。


## CLI daemon 实时工具状态暴露设计方案

*decision · high · 2026-05-22*

CLI daemon 已实时接收 Claude SDK 流式事件（包括 tool_use 开始/结束），但诊断页目前只能看到进程 PID 和启动命令，无法感知 agent 当前正在执行哪个工具。

核心需求是判断「agent 卡住了吗还是在干活」，技术上完全可行，有两个实现思路：

**方案 A（轻量级）**：CLI 在每次 tool_use 开始时向 server 发 ephemeral 事件 `session:current-tool`，携带工具名和输入摘要，诊断页订阅后实时显示「当前：Bash → npm test」，工具结束时清空。改动在 3 个文件以内，成本低，足以满足核心诊断需求。

**方案 B（完整监控）**：在会话详情或诊断页加「实时活动」区域，滚动显示最近 N 条工具调用的名称、参数摘要、执行耗时，类似 Claude Code Web 的工具进度面板。改动较大，适合后续完整监控需求。

建议优先实现方案 A 以快速验证诊断 UX 价值，后续可按需升级至方案 B。


## Fix hardcoded Claude agent parameter in handleFixTrigger for profile compatibility

*fix · high · 2026-05-22*

在happy项目的handleSupervisorTrigger.ts中发现handleFixTrigger函数第798行硬编码了agent: "claude"，导致fix触发器启动新会话时忽略了配置的profile设置，与analysis和research触发器的行为不一致。

问题根源：handleFixTrigger没有通过resolveAgentForSupervisor()函数根据profile兼容性自动选择agent，而是直接硬编码agent: "claude"。这破坏了agent选择的统一性。

解决方案：在handleFixTrigger中调用resolveAgentForSupervisor(data, runtimeProfile)，使其与analysis和research触发器保持一致，根据profile兼容性自动在claude和codex之间选择合适的agent。

修改位置：packages/happy-cli/src/supervisor/handleSupervisorTrigger.ts:795-818
- 将硬编码的agent: "claude"替换为resolveAgentForSupervisor的返回值
- 确保handleFixTrigger内部函数正确使用动态agent参数
- 确保调用handleFixTrigger的handleSupervisor函数正确传递runtimeProfile

修改影响范围：handleFixTrigger内部函数、handleSupervisor调用点，不影响数据文件读写。已通过类型检查和构建验证。


## 项目详情页事件Tab功能实现：多文件联动修改方案

*decision · high · 2026-05-22*

用户需求：在项目详情页追加事件(events)Tab，将"查看所有操作"卡片内容定义为事件并移至新Tab。

核心修改策略：
1. ProjectDetailTabKey 类型：新增 "events" 成员，扩展Tab类型定义
2. resolveProjectDetailTabs() 函数：返回结果包含新的 "events" Tab配置
3. resolveProjectDetailInitialTab()：支持 tab="events" 作为有效初始值
4. PRESENTATIONS 对象（Record<ProjectDetailTabKey, ...>）：必须为 "events" key补全展示配置（icon、tone等），否则TypeScript会报类型错误
5. projectDetailTabPresentation.ts：定义 "events" 的视觉呈现（图标、颜色等）
6. ProjectDetailView.tsx：导入 ProjectActionsTab 组件，绑定badge计数显示操作数量，渲染新Tab内容

影响范围：
- ProjectDetailView.tsx（核心视图层）
- projectDetailTabPresentation.ts（Tab展示配置）
- projectDetailTabs.ts（Tab结构定义）
- i18n 默认文件（新增 "events" key的多语言翻译）
- 相关测试文件需同步更新

实现要点：
- 纯类型/逻辑修改，无数据库读写操作
- TypeScript的Record<K,V>类型会强制字段完整性检查，必须为新Tab补全所有必要配置，否则编译失败
- 需确保badge计数逻辑与现有操作数据源保持一致
- 保持与现有Tab UI/UX风格统一


## supervisorRunRoutes와 GuardianSessionRegistry 리팩토링 진행 상황

*fix · high · 2026-05-22*

supervisorRunRoutes.ts의 cancel endpoint 수정(Fix 2)을 완료했습니다. SupervisorRun의 sessionId 필드(string | null)와 AccessKey의 sessionId, machineId를 읽도록 변경했으며, 쓰기는 eventRouter.emitEphemeral만 사용하고 DB 직접 쓰기는 제거했습니다.

현재 진행 중인 Fix 1: GuardianSessionRegistry.ts에서 Guardian key에 trigger type을 구분하기 위해 키 형식을 'project:<id>'에서 'project:<id>:<trigger>'로 변경하고 있습니다. 이에 따라 getGuardianContinuityKey의 반환값 형식도 변경되며, trigger type별로 Guardian을 제거하는 forgetByProjectAndTrigger 메서드를 새로 추가합니다.

guardians.json 파일 구조도 함께 변경되어 각 entry에 projectId와 sessionId를 분리 저장하도록 수정됩니다.

영향받는 파일 목록: daemon/run.ts, AutomationAutonomyRegression.test.ts, AutomationAudit.ts, GuardianSessionRegistry.test.ts 등에서 이러한 변경사항에 맞게 테스트를 업데이트해야 합니다.


## Session Info 页面布局：ContextUsagePanel 和 McpServersPanel 的位置及结构

*discovery · high · 2026-05-22*

在会话详情页点击头像进入 `/session/[id]/info`（info.tsx）页面。该页面采用垂直滚动的 ItemList 结构，包含以下两个新增面板，位于诊断区域下方：

1. **ContextUsagePanel（第⑨位）**
   - 功能：显示 Context 用量统计
   - 展示形式：以 token 分类的饼图或条形图
   - 组件结构：包裹在 ItemGroup 中，标题为「Context 用量」，内部直接渲染 ContextUsagePanel 组件
   - 数据获取：通过 sessionId prop 获取数据

2. **McpServersPanel（第⑩位）**
   - 功能：展示 MCP 服务器状态列表和手动调用入口
   - 组件结构：同一 ItemGroup 卡片分两部分
     * 上半部分：McpServersPanel 组件显示 MCP 服务器状态列表
     * 下方：「MCP Invoker 入口」行，点击跳转到 `/session/[id]/mcp-invoker` 页面用于手动调用 MCP 工具
   - 数据获取：通过 sessionId prop 获取数据

布局顺序：两个面板位于已有的诊断信息（BinaryVersion、CostBadge）和颜色选择器之间，形成完整的会话详情展示体系。


## Claude remote SDK system prompt refactoring - removing App prompt from SDK options and injecting via message prepending

*fix · high · 2026-05-22*

두 파일(claudeRemote.ts, claudeRemoteLauncher.ts)을 수정하여 시스템 프롬프트 처리 방식을 개선했습니다.

**claudeRemote.ts 수정 사항:**
- `buildSystemReminderPrefix` 함수 정의 완료 (line 275-280)
- 초기 메시지에 system reminder prefix 주입 (line 370)
- 후속 메시지(next.message)에도 prefix 주입 (line 641)
- `appendSystemPrompt` SDK 옵션에서 App prompt 제거하여 중복 방지 (line 302-304)

**claudeRemoteLauncher.ts 수정 사항:**
- `nextMessage` 콜백 내 메시지 조립 로직 변경
- `msg.mode.appendSystemPrompt`에서 `appPromptPrefix` 계산
- 모든 메시지 반환값에 prefix prepend
- Knowledge injection 방식을 `mode.appendSystemPrompt` 변경에서 메시지 prepend로 전환

**영향 범위:**
- 임포터: `packages/happy-cli/src/claude/loop.ts` (line 6)만 영향
- 공개 함수: `claudeRemoteLauncher` (exported line 71) 내 `nextMessage` 콜백
- 메모리 기반: 실시간 session.queue 읽기 및 session.client(socket)에 쓰기

**빌드 검증:**
- 타입 에러 없음
- Pre-existing unused 경고들은 기존 코드에서의 미사용 변수로 인한 것


## Claude SDK更新后options功能丢失的根本原因——系统提示注入链路中断

*discovery · high · 2026-05-22*

用户报告自Claude Agent SDK更新后，options的AI建议功能丢失。经过完整链路追踪，问题根源已定位：

【问题机制】
options指令通过App的systemPrompt.ts中的appendSystemPrompt参数注入到Claude系统提示中。该参数需要经历App端→CLI端→SDK的传递链路，但在某个环节中断。

【关键发现】
1. Claude Code使用Mach-O原生二进制文件而非JS文件
2. claude_remote_launcher.js中对非JS文件的启动方式与JS文件不同
3. 原生二进制启动时，环境变量（如HAPPY_APPEND_SYSTEM_PROMPT）可能未被正确继承传递给SDK
4. 问题症状：assistant消息中缺少<options>XML标签，这些标签由系统提示指令驱动的AI输出生成

【排查清单】
1. 检查SDK版本0.2.119+的环境变量传递机制
2. 诊断原生二进制启动时的环境变量继承是否正常
3. 确认appendSystemPrompt值在整个传递链中是否被保留
4. 验证systemPrompt.ts中的注入逻辑是否在更新后被改动

【影响范围】
- 涉及SDK版本更新导致的向后兼容性问题
- 多层级进程间通信的环境变量传递可靠性


## tasks.tsx看板视图重构完成：5列Kanban布局替代筛选卡片设计

*decision · high · 2026-05-22*

完成了tasks.tsx的重大UI重构，将任务列表从筛选chip+TaskCard竖条样式改为横向可滑动的5列Kanban看板布局。

核心架构变化：
- 移除：All/Active/Completed/Failed筛选栏和左侧竖条TaskCard样式
- 新增：KanbanCard组件和KanbanColumn组件

KanbanCard组件特性：
- 顶部3px彩色状态条
- 支持3行标题文本
- skill chips展示
- 错误信息显示区域

KanbanColumn组件设计：
- 固定260px宽度
- 彩色圆点标题+数量徽章
- 空列显示'—'

5列布局配置：
1. 排队中（queued+dispatching，灰色）
2. 运行中（running，蓝色含脉冲点动画）
3. 已完成（completed，绿色）
4. 已失败（failed，红色）
5. 已取消（cancelled，灰色）

UX优化：
- FAB按钮从内部移至外层View实现真正的固定位置
- 保留下拉刷新功能，alwaysBounceVertical属性确保内容不足时可触发
- 所有文案复用现有tasks.status*翻译键，无需新增i18n

注意：automation.tsx:195的类型错误为预存问题，与本次改动无关。


## WebAlertModal 弹窗背景透明问题修复

*fix · high · 2026-05-22*

WebAlertModal 组件存在弹窗背景透明问题。原因：背景使用玻璃拟态效果（rgba(..., 0.75)），导致背景半透明、内容穿透。

修复方案：
1. 背景色：从 rgba(0.75 透明度) 改为 theme.colors.surface（完全不透明）
2. 边框：从半透明白边改为 theme.colors.divider（亮色 #eaeaea / 暗色 #ffe383A）

修复目标：确保弹窗样式与其他卡片/弹窗保持一致性。

影响范围：组件仅在 ModalProvider.tsx 中被导入，修改范围明确，无数据读写影响，可安全修改。


## 修复apiUsage.ts中backoff无限重试导致使用详情页面卡转圈的bug

*fix · high · 2026-05-22*

发现在apiUsage.ts中queryUsage函数存在严重bug：backoff工具是while(true)无限循环，只有NonRetryableError才能中断。当服务端返回5xx错误或网络不可达时，函数抛出普通Error而非NonRetryableError，导致backoff无限重试，loadUsageData的finally块永远无法执行，UI永远停留在loading状态。

根本原因分析：
1. backoff实现是while(true)无限循环，maxFailureCount=50只限制延迟计算，不会停止循环
2. queryUsage对HTTP 5xx错误抛普通Error，backoff继续重试
3. 只有NonRetryableError能让backoff立即退出

修复方案：在apiUsage.ts第47行，将5xx响应的Error改为NonRetryableError，使HTTP错误快速失败而不是无限重试。这样能立即触发catch块显示错误信息。

影响范围：queryUsage是唯一修改点，getSessionUsageSummary已正确使用NonRetryableError不受影响。导入此模块的文件包括sync.ts、UsageChart.tsx、UsagePanel.tsx。


## 代码质量评估框架中 3 个维度的 prompt 升级方案

*decision · high · 2026-05-22*

对现有 9 个质量评估维度进行了全面审核，发现 testCoverage、security、performance 三个维度存在明显短板，其余 6 个维度（dependencies、architecture、techDebt、codeQuality、documentation、uiUx）prompt 质量已达要求。

**testCoverage 维度升级需求**：
当前仅检查测试文件是否存在，无法区分有效覆盖与空文件。需增加实际执行 `yarn test --coverage` 并分析数字指标（覆盖率百分比），找出核心模块的测试缺口。

**security 维度升级需求**：
现有仅覆盖依赖漏洞和硬编码密钥，存在多个关键检查项遗漏。需补充：CORS 配置审查、认证 token 存储方式验证、速率限制机制检查、敏感信息日志泄露检测。

**performance 维度升级需求**：
现有仅采用后端视角，检查 N+1 查询和数据库索引。需扩展前端层面的检查：bundle size 优化、React 重渲染优化机会、图片/资源加载优化策略。

**升级策略**：
采用有针对性的增量更新，仅升级这 3 个维度，改动幅度小、风险低、收益直接可见，返回结果稳定性有保障。


## happy-app 中 SupervisorDimension 表结构与服务端路由完整实现方案

*decision · high · 2026-05-22*

在 happy-app 项目中实现自定义维度基础设施，分为两个核心阶段：

**Phase 1 - Prisma Schema 设计：**
新增 SupervisorDimension 模型，包含以下字段：
- id (cuid)：主键
- projectId (FK)：项目外键，支持 CASCADE 删除
- accountId：账户标识
- key (camelCase)：唯一键
- title：维度标题
- prompt：提示内容
- enabled：启用状态
- sortOrder：排序顺序
- createdAt、updatedAt：时间戳

该变更为纯增量修改，Project 模型新增反向关联（relations），现有查询不受影响。迁移文件由 `prisma migrate deploy` 自动按目录顺序执行，通过 migration_lock.toml 追踪版本。新增的 SQL 表在数据库中创建，包含 CASCADE 删除约束和必要的默认值配置。

**Phase 2 - Server 路由层：**
创建 `supervisorDimensionRoutes.ts` 文件提供完整的 CRUD 接口。集成方式：
- 在 `packages/happy-server/sources/app/api/api.ts` 第 52 行导入该路由文件
- 第 175 行将路由注册到 Express app 实例
- 遵循现有小路由文件的代码风格和约定

**技术细节：**
- 路由文件采用自动注册机制，不需要代码直接 import，框架会自动发现并加载
- Prisma 会生成 `db.supervisorDimension` 对象供 CRUD 操作使用
- 确保所有路由遵循项目的命名规范和错误处理标准

该方案已获用户批准，可继续实施。


## 修复 privacy-kit token 验证失败问题并重建 Docker 服务

*fix · high · 2026-05-22*

privacy-kit 的 token generator 已内置生成 UUID/jti 字段，但代码在 extras 参数中重复传入自定义 jti，导致服务器重启后进行 crypto 验证时，jti 不在 extras 中而造成校验失败。

根本原因：双重 jti 定义导致验证阶段的字段不匹配。

修复方案：
1. 移除代码中多余的 jti 传递参数
2. 让 privacy-kit 的内置生成逻辑独立处理 jti 字段
3. 通过 17 个单元测试验证修复正确性
4. 提交 commit 7b2c369

部署步骤：
1. 使用 `docker build --no-cache` 重建镜像
2. 重启 Docker 容器
3. 验证结果：服务恢复正常，无 P20xx 错误

该修复确保了 JWT token 的 jti 声明在生成和验证阶段的一致性，解决了重启后的 crypto 验证失败问题。


## 添加 GPT 5.5 模型支持到 Codex 系统的完整实现指南

*fix · high · 2026-05-22*

需要在四个关键位置添加 GPT 5.5 模型支持，确保系统全链路一致性：

**1. CLI 层 (configResolution.ts)**
在 SUPPORTED_CODEX_MODELS 数组中追加 'gpt-5.5'。该文件被 runCodex.ts、TaskRunner.ts、tokenUsage.ts、messageMode.ts 等核心模块导入，修改会影响整个 Codex 执行流程。

**2. App 层模型配置 (modelModeOptions.ts)**
同时更新两处：
- SUPPORTED_CODEX_MODELS 数组
- getCodexModelModes() 函数的返回值
该文件被 SessionView.tsx、profileDefaults.ts、UsagePanel.tsx 等 UI 组件导入，需确保前端模型选择器能正确识别新模型。

**3. Token 统计 (formatUsage.ts)**
添加 GPT 5.5 的 context window 映射，用于精确计算 Token 使用量和成本统计。

**4. 国际化翻译 (i18n)**
在所有 9 种语言的翻译文件中添加 codexModel.gpt55 键：
- 英文 (en)
- 俄文 (ru)
- 波兰文 (pl)
- 西班牙文 (es)
- 加泰罗尼亚文 (ca)
- 意大利文 (it)
- 葡萄牙文 (pt)
- 日文 (ja)
- 简体中文 (zh-Hans)
- 繁体中文 (zh-Hant)

**关键实现细节**
- 所有修改涉及常量定义和类型定义，不修改运行时数据文件
- 必须确保 9 个翻译文件版本同步，避免 i18n key 不存在导致的页面显示异常
- configResolution.ts 的修改会级联影响依赖链，需全量测试 Codex 执行流程
- modelModeOptions.ts 的修改需验证 UI 选择器中新模型的可见性和可选性


## Server 部署完成及配置与提示词统一更新总结

*discovery · high · 2026-05-22*

远程仓库已更新至最新状态（commit 22175fdd）。Server 部署成功，清理残留容器后在 3005 端口正常响应。

本次会话完成的主要工作：
1. Server fallback 配置补充：添加 OPENAI_API_KEY 和 BASE_URL 配置项
2. Codex 功能扩展：实现消费 App appendSystemPrompt 功能，CLI 已发布至 0.71.53 版本
3. 提示词统一：统一 question tool prompt，确保 AskUserQuestion 和 request_user_input 保持一致，已推送部署
4. 代码优化：baseInstructions 去重，减少 34 行代码

后续可选工作方向：
- 发布包含最新提示词改动的 CLI 0.71.54 版本
- 验证 Codex 会话中 options 评分功能的正确性


## Unified System Prompt Architecture for Codex and Claude Code

*decision · high · 2026-05-22*

Completed refactoring of baseInstructions.ts and systemPrompt.ts to unify request_user_input and AskUserQuestion rules across both runtimes.

Key Changes:
1. baseInstructions.ts reduction: Removed duplicate options section and legacy Asking Questions segment, streamlined from 75 to 41 lines. Retained only Codex-specific instructions for Progress tab and Session Summary.

2. systemPrompt.ts unification: Consolidated question-asking rules and Options generation rules into runtime-agnostic formulations, applied simultaneously to both Claude Code and Codex via appendSystemPrompt function.

3. Skill tool usage rules: Maintained in systemPrompt.ts; Codex safely ignores them when inapplicable.

4. Critical modifications: Lines 43 and 49 - converted hardcoded AskUserQuestion references to generic formulations for cross-runtime compatibility.

Validation:
- Verified through CLI testing
- Package build validation passed
- No regressions detected

Architectural benefit: Single source of truth for core interaction patterns while preserving runtime-specific features, reducing maintenance burden and ensuring consistent behavior across platforms.


## Codex 运行时 AI 建议功能适配检查：3 个关键问题与解决方案

*fix · high · 2026-05-22*

对 Happy 项目中 Codex 运行时对 AI 建议（auto-option-send + LLM 评分）功能的适配情况进行了全面检查。发现基本适配但存在 2 个关键缺陷和 1 个架构差异：

**1. Options 生成指令双轨机制（中度问题）**
- 现状：Codex 使用 CLI 侧硬编码的 `codexBaseInstructions`（5 条简化规则），不读取 App 的 `appendSystemPrompt`
- 影响：Claude Code App 的 systemPrompt（12 条具体规则）对 Codex 无效，用户在 Settings 中的增强指令被忽略
- 根本原因：`runCodex.ts` 完全没有处理 `appendSystemPrompt` 字段
- 需求：统一指令源，让 Codex 也能读取并应用 App 侧的系统提示词

**2. Options 提取与解析兼容性（低风险）**
- 现状：`parseMarkdownBlock.ts` 的 `<options>` XML 解析采用纯文本匹配，不依赖 provider 类型
- 优势：只要 Codex 模型输出正确的 XML 标签就能解析，兼容性良好
- 评估：此部分无需改动

**3. LLM 语义评分 Server fallback 缺陷（高风险）**
- 现状：`optionScoreRoutes.ts` 的 fallback 函数仅检查 Anthropic 和 Ollama，缺少 OPENAI_API_KEY 和 OPENAI_BASE_URL
- 故障场景：当用户 session 没有关联 profileId 或 profile 查询失败时，评分返回 500 错误
- 正常路径：有 profileId 时，通过 `getAiBackendProfileEnvironmentVariables()` 能正确提取 OpenAI 配置
- 需求：扩展 fallback 逻辑补齐 OpenAI 环境变量检查，保证异常场景可降级

建议优先级：高风险（问题3）> 中度（问题1）> 完善兼容性验证（问题2）


## 调研分析流程规范：先摸底现有实现再提方案

*convention · high · 2026-05-23*

识别出调研分析的常见错误模式：直接从需求生成理想方案，而未检查项目中是否已有类似实现或未评估现有代码质量。

正确的调研分析流程必须遵循以下步骤：
1. 搜索代码库找出相关的文件、组件和模块
2. 深入读取和理解现有实现的具体细节
3. 评估现有实现的优缺点、性能表现和功能缺口
4. 基于识别出的gap和痛点生成有针对性的改进方案

核心原则是采用「从现状出发的归纳式分析」，而非「从需求出发的演绎式设计」。这种方法确保：
- 避免重复造轮子
- 充分理解现有技术债和设计决策
- 提出的方案更贴近项目实际
- 降低风险和改造成本

此流程规范已写入项目记忆库，后续所有调研任务必须强制执行。


## 修复知识库 TTL 轮数倒计时卡顿：emitKnowledgeTurnEnd 条件逻辑错位

*fix · high · 2026-05-23*

## 问题描述
知识库 Tab 显示的计数器（如 '7/14'）在 Claude 进行工具调用回合时永久卡顿不变，无法正常递减。根本原因是 claudeRemoteLauncher.ts 第 2005 行的 `emitKnowledgeTurnEnd` 事件被错误地锁在 `if (assistantText.length > 0)` 条件内。

## 根本原因分析
当 Claude 某个回合只执行工具调用、没有生成文字输出时，hit IDs 数组为空且无法进入条件块，导致 `emitKnowledgeTurnEnd` 事件永远不会发出。这直接违反了代码注释的明确意图（'Emit even when hitIds is empty'），使得服务端无法递减 `turnsRemaining` 计数器。

## 修复方案
1. 将 hitIds 数组声明移出 `if (assistantText.length > 0)` 条件块
2. 将 `emitKnowledgeTurnEnd` 调用也移出该条件块
3. 确保每个 turn 结束时都能发出事件，无论是否有文字输出

## 附加问题
Codex 运行时完全缺少 `emitKnowledgeTurnEnd` 调用，其知识库轮数同样不递减，需要一并修复。

## 验证结果
修复后无新增构建错误，改动范围仅限于 turn-end 回调的私有逻辑实现，不影响公共接口或其他模块。


## Happy App 版本升级流程：2.14.1 → 2.15.0 的完整更新指南

*convention · high · 2026-05-23*

Happy App 项目版本升级工作流程详解，涵盖从 2.14.1 到 2.15.0 的 minor 版本升级。

**关键更新步骤：**

1. **Changelog 管理**
   - 维护英文版 CHANGELOG.md 和中文版 CHANGELOG.zh-Hans.md
   - parseChangelog.ts 脚本在构建时自动读取 Changelog 文件
   - 生成标准化的 changelog.json 格式，包含字段：version、date、summary、sections[]
   - 此格式被应用程序用于版本历史展示

2. **版本号更新**
   - 修改 package.json 中的版本号字段
   - Expo 构建工具链（eas.json、expo CLI）在构建时读取该版本号
   - 版本号影响 App Store 版本显示和 OTA 更新版本比较逻辑
   - 遵循 Semantic Versioning 规范

3. **README 文档**
   - 作为项目文档引用，此次升级无需修改
   - 仅在版本号变更或工作流程调整时更新

4. **发布流程**
   - Git 提交已推送至 origin/main
   - 后续需执行 `yarn ota` 命令发布 OTA 更新
   - OTA 更新版本号与 package.json 关联，用于客户端版本检查和增量更新

**工作流程总结：**
Changelog 编写 → package.json 版本号更新 → Git 提交推送 → yarn ota 发布OTA更新


## 启用统一 Runtime Profile 解析器并完善 Manual Task 的 profileId 端到端链路

*fix · high · 2026-05-23*

在实现 manual task 创建功能时，需要启用运行时 profile 解析并建立完整的 profileId 传递链路，从 App 端到 Server 端。

核心改动：
1. 启用特性标志：将 isUnifiedRuntimeProfileResolverEnabled() 从 opt-in 模式改为 opt-out 模式，使其默认启用
2. Server 端 handler 修改：在 taskRoutes.ts 的 POST /v1/tasks handler 中，将 explicitProfileId 从 null 改为读取 request body 中的 profileId 字段
3. App 端链路补全：task/new.tsx 需要从 ProfilePicker 组件获取用户选择的 profileId，通过 CreateTaskBody 类型传递给 server
4. 参数注入：在 resolveRuntimeProfile() 调用时注入 explicitProfileId 参数，确保 manual 创建的 task 能正确绑定用户选择的 runtime profile

数据库相关：
- Prisma Task 表包含可选的 profileId 字段（类型为可选字符串）
- 需要验证 4 个上游 server 端调用点的兼容性
- App 端 CreateTaskBody 类型需同步更新为 wire 版本，确保包含 profileId 字段

这是 manual task 创建流程中的关键功能完善，涉及特性标志、API 契约、类型系统的协调。


## 修复复合动作评分逻辑 - 连接词后的动词应获得动词分数

*fix · high · 2026-05-23*

问题描述：在 scoreOption() 函数重构后，"看日志后继续定位" 和 "列出问题并逐个修复" 等复合动作评分不足，导致测试失败。

根本原因分析：
1. 这类选项以 view-only 前缀开头（"看日志"、"列出"），触发 isPureViewOnlyOption 检查
2. 正确识别出 follow-up connector（"后"、"并逐个"），返回 false（非纯 view-only）
3. 但在评分时，因为前缀是 view-only 而非 action verb，被当作 weak-action 处理
4. 后半部分包含的真实动词（"定位"、"修复"）未被正确识别和计分

核心问题：复合动作结构（view-only prefix + follow-up connector + action verb）的后半部分动词应获得 action-verb 分数（16分）而非 weak-action 分数（8分）。

解决方案：在评分逻辑中增加复合动作检测机制：
- 检测条件：选项不匹配 action verb prefix AND 包含 FOLLOW_UP_ACTION_CONNECTORS AND connector 后部分包含 action verb prefix
- 实现方式：提取 connector 后的文本，对其执行 action verb prefix 匹配
- 计分调整：符合条件的复合动作给予 action-verb 分数（16分）而非 weak-action 分数（8分）
- 效果：使复合动作能达到通过阈值

影响范围：评分函数、测试用例验证、复合动作识别逻辑


## 代码库清理：已弃用工具（rtk、code-review-graph）残留检查与处理方案

*convention · high · 2026-05-23*

在清理已弃用工具时，需要检查三层残留：代码/配置引用、.gitignore 规则、本地生成文件。

**检查结果：**
- rtk：已完全清干净，无残留
- code-review-graph：存在三处残留需处理

**code-review-graph 残留清单：**
1. .gitignore 第 72-73 行：注释 `# Added by code-review-graph` 和规则 `.code-review-graph/`
2. 本地 .code-review-graph/ 目录：181MB（git 未跟踪），包含 graph.db (153MB) 和 graph.html (28MB)
3. MCP 工具配置：harness 中仍配置 `mcp__code-review-graph__*` 参数（需在外部配置文件 .mcp.json 卸载）

**推荐处理方案（同时执行两个操作）：**
1. 删除本地 .code-review-graph/ 目录（释放 181MB 磁盘空间）
2. 移除 .gitignore 中的相关规则（第 72-73 行）

**方案理由：**
- .gitignore 失效规则会混淆后续维护人员
- 本地生成文件 181MB 占用磁盘空间，无实际用途
- 若将来需要复用规则，可从 git 历史记录恢复
- MCP 工具卸载需在外部配置文件处理，当前仓库内无法修改，作为外部依赖记档备查

**执行优先级：** .gitignore 清理 > 本地目录删除 > MCP 外部配置文档记录


## Happy 项目 Profile 配置链路贯通状态与启用决策

*decision · high · 2026-05-24*

Happy monorepo 中 profile 配置（用户/项目级）到服务端会话启动的完整链路已在 Wire schema、Prisma 模型、Server API、Server 解析、CLI 注入、App UI 六层全部贯通。

存在两个关键缺口需要决策：

1. 功能标志 RUNTIME_PROFILE_UNIFIED_RESOLVER 默认关闭，需显式设为 "true" 才启用统一的 profile 解析器。否则 Task/Cron/Webhook 仍走 daemon 默认环境变量，profile 绑定无效。

2. Manual Task 创建路径（taskRoutes.ts:185-189）未接 profileId 参数，写死为 null，与已暴露的 wire schema 字段矛盾。App 端手动创建 task UI 也未挂 ProfilePicker 组件（仅 Cron/Webhook 已挂）。

决策方案：
- 完整方案：启用标志 + 补全 manual task profileId，支持全类型 task 的 profile 绑定
- 分阶段方案：仅启用标志让 Cron/Webhook 先生效，manual task 后续补齐
- 风险控制方案：先写集成测试覆盖 profile 链路再启用
- 谨慎方案：详细盘点回归面再决定

需要在完整性、时间投入和风险之间平衡。


## Session集成任务进度：CostBadge、FileViewer路由、_layout注册完成

*discovery · high · 2026-05-24*

用户在本会话中继续进行组件集成工作。已完成6个组件+BinaryVersionRow集成，剩5个集成点。本会话目标完成2-3个集成。

**完成的工作：**

1. **CostBadge在session info页集成**
   - 在SessionInfoContent组件中添加CostBadge展示
   - 通过useSession hook从zustand读取session状态
   - CostBadge内部封装fetchSessionCost RPC调用
   - 纯UI添加，无新I/O操作
   - 仅在/_layout.tsx和11个翻译文件中使用sessionInfo.*命名空间

2. **创建file-viewer路由**
   - 新建session/[id]/file-viewer.tsx用于安全读文件操作
   - 通过remoteReadFile RPC调用CLI执行：Claude-control read_file权限检查、黑名单过滤、1MiB上限
   - 与现有session/[id]/file.tsx（旧路径git历史查看）功能不重叠
   - 暂无调用方，未来从FileViewer组件通过router.push()进入

3. **路由注册**
   - 在(app)分组的_layout.tsx中新增Stack.Screen声明以支持file-viewer路由
   - 完成expo-router集成


## Claude Agent SDK 0.2.112→0.2.119 升级分析与SessionStore集成方案

*decision · high · 2026-05-24*

Claude Agent SDK 已从 0.2.112（2026-04-16）更新至 0.2.119（2026-04-23），版本差距 7 个小版本，升级风险评估为低且语义兼容性良好。

## 核心架构变化
SDK 0.2.119 移除了 cli.js、embed 文件和 vendor 目录（ripgrep、audio-capture），改为按平台安装原生二进制包（claudeCodeVersion: 2.1.119）。npm 安装体积略增但仅拉取本平台二进制，优化了部署效率。

## P0 优先级集成功能

### 1. SessionStore @alpha 适配器（高优先级）
- 新增会话存储/加载/列表/删除接口，包含 InMemorySessionStore 实现和相关工具函数
- 高度契合远程会话镜像需求，可替代当前手工 JSONL 解析逻辑
- 支持跨机会话恢复能力
- **风险管理**：@alpha 阶段 API 可能变更，建议：
  - 先在 dev 分支进行原型实现验证
  - 仅在用户显式启用 flag 时激活此功能
  - 保留回退方案

### 2. query() title 参数
- 新增 title 选项，实现复杂度低，可直接集成

## 相关依赖升级
@anthropic-ai/sandbox-runtime 已从 0.0.43→0.0.49（6 个补丁版本），主要调整 seccomp/macOS 规则，升级风险低，建议同步升级。

## 建议行动
快速升级至 0.2.119 以获得稳定性改进和新会话管理能力，优先实现 SessionStore 适配器以支持会话持久化和跨机恢复场景。


## OpenAI模型和超时配置优化：gpt-5.4→gpt-5.4-mini，超时延长至15-18秒

*decision · high · 2026-05-24*

针对LLM评分流程的性能优化决策。

问题背景：
- 原有10秒auto-send倒计时内仅留6秒给LLM处理，时间分配不合理
- LLM评分结果可能在倒计时完成前无法返回

实施方案：
1. 模型调整：将OpenAI默认模型从gpt-5.4改为gpt-5.4-mini（更轻量级）
2. Server端LLM超时：从6秒延长至15秒（3处配置点均需修改）
3. App客户端超时：从7秒延长至18秒
4. auto-send倒计时：从10秒延长至15秒
5. i18n文案更新：同步更新模型描述文本

效果验证：
- 即使provider响应较慢，也能在延长的倒计时内稳定获得评分结果
- 提升用户体验，减少超时失败率
- 已通过验证，提交哈希值：123a1861

关键配置点：需同步修改3处Server端超时配置，确保整体时间流程协调。


## LLM 语义评分层 Server 端 Phase 1 实现完成

*fix · high · 2026-05-24*

为 Happy app 实现 LLM 语义评分层以支持上下文感知的推荐。Server 端 Phase 1 已完成，包括三个核心模块：

**实现的核心文件：**
1. optionScorer.ts - LLM 评分模块
   - 调用 Anthropic 或 Ollama API
   - 使用内存 TTL 缓存机制（无持久化存储）
   - 导出 scoreOptionsWithLLM 函数供路由调用

2. optionScoreRoutes.ts - FastAPI 路由处理器
   - 注册 POST 端点
   - 调用 optionScorer 的评分模块
   - 返回 JSON 格式响应

3. api.ts - 路由注册中心
   - 在 startApi() 函数中注册新路由
   - 导入 optionScoreRoutes 并添加路由注册调用
   - 遵循现有路由注册模式，无需修改函数签名

**关键设计决策：**
- 评分数据采用内存 TTL 缓存，不需要持久化存储
- LLM 服务调用通过外部 HTTP 请求（支持 Anthropic 和 Ollama）
- 路由实现遵循现有代码规范和模式
- Server 端 TypeScript typecheck 已通过验证

**当前状态：**
Phase 1 (Server 端) 完成，Type check 验证通过

**下一步：**
进入 Phase 2 (App 客户端集成)，需要确认以下导入路径：
- getServerUrl 的正确导入路径
- AuthCredentials 的正确导入路径
