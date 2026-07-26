# /Users/sangreal/Documents/GitHub/jpcr

归档自 ProjectKnowledge，共 10 条 active 条目。


## 前端组件测试驱动开发：无测试基建下的实施策略

*fix · medium · 2026-04-10*

在前端项目缺乏现成测试基建的情况下，采用测试驱动开发（TDD）的实施策略：先读懂现有组件代码，将展示逻辑的改动点明确标记（钉住），然后以最小化实现的方式逐步推进。这种方法避免了过度设计，通过理解组件的显示行为作为测试基线，确保改动不会破坏现有功能。适用于缺乏自动化测试框架或测试覆盖不足的前端项目。


## Akamai WAF绕过实现方案：行为评分核心解决与多层次技术方案

*decision · high · 2026-04-29*

Akamai WAF的检测机制核心是**行为评分**而非JS指纹检测。sensor.js持续收集鼠标移动、点击坐标、滚动轨迹等动态行为数据，当行为分低于阈值时触发拦截。

**关键检测信号：**
1. 缺失鼠标事件：仅有JS点击和evaluate导航导致行为分动态波动，第一次通过后续降到阈值以下被拦截
2. 代码检测：evaluateOnNewDocument中对document.hidden/visibilityState的getter替换可被Object.getOwnPropertyDescriptor识别
3. navigator.webdriver标志：--disable-blink-features=AutomationControlled flag可使其返回false，但不是拦截根因

**多层次解决方案（按成本-效果比优先级）：**

**方案1：鼠标行为模拟（强烈推荐首选）**
- 核心实现：在点击前使用贝塞尔曲线模拟真实鼠标移动轨迹，替代page.click()为page.mouse.move()+click的组合
- 这是Akamai行为评分最关注的指标，成本最低效果显著
- 实现要点：
  • 不均匀移动间隔（8-28ms）
  • 轨迹弯曲噪声
  • 随机步数（20-35步）
- 首页预热后添加真实鼠标轨迹模拟，使用page.mouse.move()而非JS scroll

**方案2：移除检测信号**
- 删除evaluateOnNewDocument中对document.hidden和document.visibilityState的getter替换（在非headless模式下无必要）
- 避免代码被直接识别为自动化脚本

**方案3：编译层修补（效果优于stealth-plugin）**
- Patchright/undetected-playwright：在编译层面而非JS层面修补自动化痕迹
- Node.js项目可用rebrowser-puppeteer
- 若鼠标模拟效果不足，再考虑采用

**方案4：指纹浏览器（成本高，效果有限）**
- GoLogin/AdsPower：可通过CDP接入现有Puppeteer代码，但只解决静态特征，不能解决行为评分问题
- 月费$49+，不推荐作为主要方案

**方案5：内核替换（检测率低但稳定性需验证）**
- Camoufox：Firefox内核方案，检测率低于Chromium-based爬虫，因Akamai的Firefox规则库相对薄弱

**建议实施路径：**
优先实现鼠标行为模拟+移除检测信号，验证效果后再视需要采用Patchright或更换内核。


## JPCR v1.18.1: Distributed Worker Monitoring and Queue Management System

*fix · high · 2026-05-17*

## Overview
Completed implementation of distributed worker monitoring and queue management features for JPCR (Japanese e-commerce automated purchasing system) in v1.18.1. System tracks real-time worker status, manages purchase queues, and provides comprehensive monitoring via React UI components.

## Worker Status Monitoring
**API Implementation** (`app/api/distributed/route.ts`): Monitor mode GET responses now attach a `workers` array containing worker objects with:
- `chromePort`: Worker instance identifier
- `status`: "idle" or "busy" state
- `currentTask`: Product details when busy

**UI Component** (`components/MonitorStatusPanel.tsx`): `DistributedStatus` interface extended with `workers` field. Worker chips render below QUEUE block with:
- **Idle state**: Green dot indicator (`W:[port] ●`)
- **Busy state**: Yellow indicator with truncated product name (15 chars max) (`W:[port] ⚡ [product]`)
- **Hover tooltip**: Full product name displays via title attribute

## Queue Management
**Queue Backend** (`src/core/purchase-queue.ts`):
- `getQueueLength()`: Returns total queue message count by summing all Redis Stream lengths (XLEN)
- `purgeAllStreams()`: Clears all streams (XTRIM MAXLEN 0) and unlocks products in "purchasing" status back to "idle"

**Queue API** (`app/api/monitor/queue` route):
- GET: Returns queue message count
- DELETE: Executes queue purge operation

**Queue UI** (`components/MonitorStatusPanel.tsx`):
- Polls queue status every 5 seconds
- Displays yellow QUEUE badge with pulse animation when tasks exist
- Shows "Clear Queue" button (non-worker mode, queue > 0) with confirmation dialog

## Implementation Details
**Files Modified**:
1. `app/api/distributed/route.ts` - Worker status endpoint
2. `components/MonitorStatusPanel.tsx` - UI rendering for workers and queue
3. `src/core/purchase-queue.ts` - Queue operations (getQueueLength, purgeAllStreams)
4. `app/api/monitor/queue` - Queue monitoring endpoint
5. `package.json` - Version 1.17.0 → 1.18.1
6. `CHANGELOG.md` - Release notes
7. `messages/zh-CN.json`, `messages/en.json`, `messages/ja.json` - i18n keys: labelQueue, btnClearQueue, confirmClearQueue, and systemStable version

**Status**: All type checking passed. Version synchronized across all files. Committed to main branch.

## Architecture Notes
- Uses Redis Streams for queue management
- Real-time status updates via polling intervals
- Distributed worker tracking without centralized lock conflicts
- Internationalization support across three language packs (Chinese, English, Japanese)
- Status bar integration: displays SEAT, QUEUE, and WORKER chips in sequence


## Worker 无头模式配置迁移：从环境变量到数据库管理

*fix · high · 2026-05-18*

完成了 Worker 无头模式的配置系统迁移，将原有的硬编码环境变量检查改为数据库驱动配置。

## 核心改动

**account-browser-manager.ts**
- 将 USE_HEADLESS 环境变量的硬编码检查替换为查询 system_config 表的 worker_headless 字段
- 数据库配置值优先级高于环境变量 fallback，保证配置优先级一致性
- 共 2 处修改点

**DistributedSettings.tsx（UI 层）**
- 在 Worker 设置区新增 workerHeadless 复选框控件
- 4 处修改：组件 state、fetchSettings 数据拉取、事件 handler、UI 渲染
- 交互模式与现有 workerProxyEnabled 保持一致

**国际化支持**
- 添加英文、中文、日文三语言 i18n 字符串
- 字符串 key：workerHeadless（标签）、workerHeadlessDescription（描述）
- 更新三个 messages JSON 文件

**版本与文档**
- package.json 版本号升至 1.15.1
- CHANGELOG.md 记录此次功能变更

## 配置优先级
1. 数据库 system_config.worker_headless 配置（最高）
2. 环境变量 USE_HEADLESS fallback

此改动完善了分布式系统配置管理，使无头模式可在运行时通过 UI 动态调整，无需重启应用。


## 批量购买失败根因诊断：加入购物车按钮缺失问题

*discovery · high · 2026-05-18*

问题现象：批量同时触发三个商品购买时，全部报错'未找到加入购物车按钮，且未检测到已加入购物车'。单个购买正常，批量失败，表现为并发干扰症状。

根本原因排查：
1. 并发执行确认无误——PQueue设置concurrency=1确保购买串行执行，信号消费流程（claimFromStreams→processTask→executePurchase）也是串行化处理，排除购买执行层的并发问题
2. 问题定位在商品页面加载阶段——页面既未出现'カートに入れる'按钮也无'已在购物车'提示
3. L967代码缺陷——page.click('#jpcr-product-link')直接使用page.click()而非clickAndNavigate，缺少JS fallback保护机制，但日志显示跳转成功（5007ms），说明导航成功但页面本身异常

可能根因（待截图确认）：
• WAF频率限制——同一session短时间内连续访问多个商品页触发Akamai限制，返回空白或拦截页
• 商品售罄——ジャンク品/中古品属性，信号发出后执行购买前数秒内被他人抢购
• 页面加载不完全——多标签页占用资源，后续标签页加载缓慢导致按钮未渲染完成

已部署诊断措施：Worker失败时自动保存截图至logs/目录（addcart-fail-{timestamp}.png），支持直观确认页面状态。建议部署后进行批量测试验证根因，可考虑加入购买间冷却时间作为WAF限制的临时缓解方案。


## CloakBrowser 启动预检与孤儿进程清理机制

*fix · high · 2026-05-18*

为避免运行时出现难以理解的错误，在 CloakBrowser 启动前实施两层预检机制：

**1. 启动预检（ensureCloakBrowserReady）**
位置：browser-factory.ts，由 Monitor/Worker/Standalone 启动时立即执行。
职责：
- 验证 npm 包可导入（失败则自动 npm install）
- 调用 ensureBinary() 确认 Chromium 二进制已下载
- 启动失败则阻止并给出清晰错误提示

**2. 孤儿进程清理（cleanStaleChromeLocksSync）**
位置：account-browser-manager.ts，每次 launchChrome() 前主动执行。
流程：
- 检查 profile 目录的 SingletonLock 文件
- 从符号链接提取 PID
- 若进程存活则发送 SIGKILL 终止（因为新启动同profile浏览器，旧进程必为孤儿）
- 若进程已死则直接清理锁文件

**问题根源与解决方案**
当 Worker 被 kill -9 时，browser.close() 无法执行，导致孤儿进程残留。原有逻辑检测到进程存活就不清理，但这些进程已无控制者。改进方案：主动终止孤儿进程而非等待其自动清理。

**验证流程**
预检通过 → 发现并清理孤儿进程 → 正常启动 → 自动登录


## JPCR 项目 Puppeteer 与 CloakBrowser 的 WAF 绕过能力对比及集成方案评估

*decision · high · 2026-05-18*

JPCR 项目当前采用 spawn Chrome + puppeteer.connect() + puppeteer-extra-plugin-stealth 方案，在 Akamai WAF 防护下存在多个检测瓶颈：

【现有方案的主要漏洞】
- CDP 自动化痕迹暴露
- TLS/JA3 指纹识别
- navigator.webdriver 属性检测
- 行为评分（鼠标轨迹异常）
- Canvas/WebGL/Audio 指纹识别
- 冷启动零 Cookie 状态触发检测

【CloakBrowser 解决方案】
CloakBrowser 通过源码级补丁提供编译器级别的深度伪装：
- CDP 输入伪装和协议混淆
- 编译级 TLS 指纹一致性保证
- 源码层禁用 webdriver 标志
- 贝塞尔曲线鼠标轨迹和真实键盘延迟注入
- 渲染层指纹噪声添加
- 持久化会话和 Cookie 支持

【集成方式】
1. 直接替换方案：使用 CloakBrowser JS SDK 替换 spawn+connect()
2. CDP Server 模式：作为独立服务保持现有架构兼容性

【关键限制与建议】
- 二进制体积约 200MB
- Akamai 检测建议采用 headed（有头）模式
- 多账号隔离需配置 per-connection fingerprint seed
- 许可：二进制免费自用，禁止分发和商业化
- 需评估与现有 puppeteer-extra-plugin-stealth 的兼容性


## JPCR Project Structure and Key Exports

*discovery · high · 2026-05-19*

## Project Overview
JPCR is a TypeScript/React application with 204 tracked files organized into functional modules. The project uses Next.js patterns with middleware, internationalization (i18n), and database integration.

## Directory Structure

**.agent/** - Agent workflows (1 file)
**.github/** - GitHub Actions workflows (1 file)
**.shared/** - Shared UI/UX utilities (18 CSV/Python files, ui-ux-pro-max module)
**docs/** - Documentation (12 markdown/PNG files + 1 spreadsheet)
**app/** - Next.js app directory (31 TypeScript/React/CSS files)
  - api/ (26 files) - API routes
  - [locale]/ (3 files) - Localization routes

**components/** - React components (22 TSX files)
  - product/ (4 components)
  - ui/ (4 components)

**context/** - React Context providers (2 files)
  - NotificationContext.tsx
  - ThemeContext.tsx

**src/** - Core application logic (30 TypeScript files)
  - core/ (18 files) - Core functionality including DB, monitoring, Puppeteer integration, logging
  - lib/ (9 files) - Utility libraries for sound, purchases, etc.
  - i18n/ (2 files) - Internationalization setup including routing
  - types/ (1 file) - TypeScript type definitions

**hooks/** - Custom React hooks (1 file: useSoundNotification)
**messages/** - Message/translation files (3 JSON files)
**scripts/** - Build/utility scripts (21 shell/TypeScript/JavaScript files)
  - debug/ (3 scripts)
  - migrations/ (1 script)

**docker/** - Docker configuration (1 SQL file for MySQL)
**tests/** - Test files (36 TypeScript files)

**Root Files**: Configuration files (.env examples, .npmrc, .gitignore) and documentation (README, QUICKSTART, CHANGELOG, CLAUDE, PROGRESS, AGENTS)

## Key Exports and Functionality

**Middleware & Routing**
- middleware.ts: config export
- src/i18n/routing.ts: routing configuration

**Database & Storage**
- src/core/db-writer.ts: dbWriter for database operations
- src/core/log-persistence.ts: setupLogPersistence for logging

**Notifications & Audio**
- context/NotificationContext.tsx: NotificationProvider, useNotification hook
- hooks/useSoundNotification.ts: SoundConfig, shouldAttachAutoUnlockListeners, useSoundNotification
- src/lib/sound.ts: SoundType, unlockAudio, isAudioUnlocked functions

**Theme Management**
- context/ThemeContext.tsx: ThemeProvider, useTheme hook

**Browser Automation & Monitoring**
- src/core/nojima-puppeteer.ts: isExecutionContextDestroyedError, hasStableNavigationProbe, shouldAbortOnPreConfirmContextError
- src/core/monitor-browser-recovery.ts: MONITOR_CLEAR_BROWSER_DATA_ON_ACCESS_ERROR_KEY, shouldClearBrowserDataOnAccessError, chooseAccessErrorRecoveryLevel

**Web Scraping**
- src/core/nojima-list-crawler.ts: formatEmptyListParseDiagnostics, parseListItemsFromHtml, crawlListPage

**E-commerce/Purchase Features**
- src/lib/purchase-recorder.ts: RecordInput, recordSuccess, recordFailure
- src/core/purchase-executor.ts: purchaseExecutor

**UI Components**
- components/LanguageSwitcher.tsx: LanguageSwitcher component

**System**
- instrumentation.ts: register function for monitoring/tracing

The project appears to be a Next.js-based application combining web automation (Puppeteer), e-commerce functionality, browser data recovery, multi-language support, and audio notifications.


## 列表监控的DOM模板识别限制：非路径限制而是解析器硬编码问题

*fix · high · 2026-05-19*

列表监控功能存在严重的页面识别限制，但根本原因不是URL路径限制，而是解析器只硬编码支持特定DOM模板结构。

**现状分析：**

1. **URL校验极为宽松** (app/api/list-monitors/route.ts:59)
   - 仅检查是否包含 `nojima.co.jp`
   - 理论上任何nojima页面（商品页、活动页等）都能被添加到监控列表

2. **真正限制在抓取解析阶段** (src/core/nojima-list-crawler.ts:27)
   - 当前解析器只识别 `.shouhinlist` 卡片容器
   - 强制要求卡片内必须同时存在：
     - `a[href*="/commodity/"]` 链接
     - `.textOverflowShohinmei` 商品名元素
     - `.price` 价格元素
     - `.lcogreen/.lcored/.lcodefault` 库存状态类
   - 这实质上是在**硬编码某一版本的分类页模板**
   - 即使页面是真实列表页，但DOM结构与模板不符就无法解析出商品

3. **注释与实现不符** (src/core/nojima-list-crawler.ts:8-10)
   - 注释声称支持"分类页/搜索页"，实际仅支持"特定模板的分类页"
   - 等待选择器包含 `.commoditylistitem` (第151行)，但parseListItems()根本不处理此选择器

**无法识别的页面类型示例：**
- 搜索结果页DOM结构与分类页不同
- 专题/活动列表页的商品卡片使用不同class命名
- 商品名称/价格/库存节点使用不同选择器
- 需要滚动/懒加载才显示商品的列表页

**调试方式：**
scripts/debug/test-category-page.mjs 可打印目标页面的商品链接、CSS类名、价格元素等DOM结构，用于诊断失败URL。

**优先级修复建议：**

1. **增强URL类型识别** - 使用 `new URL(url).pathname` 明确区分 `/category/`、`/search/` 等路径，对不支持的页面在创建时直接报错

2. **扩展多模板解析兼容性** - 改进解析策略：先查找 `a[href*="/commodity/"]`，再向上查找最近的商品卡片容器，使用选择器组合兼容多种DOM结构（commodity/item/card/result/search等）

3. **改进错误提示** - 返回明确的失败原因：页面可访问但未识别支持的列表结构、检测到0个商品链接、检测到链接但缺失价格等信息


## Raw CDP 基础设施完全移除，三阶段迁移至 CloakBrowser 引擎完成

*fix · high · 2026-05-19*

完成了从 Raw CDP 到 CloakBrowser 引擎的三阶段迁移工作。

**Phase 3 成果：**
- 删除了 347 行 Raw CDP 核心代码，包括：ensureMonitorChrome、rawCdpWafCount、findOrCreateTab、waitAndExtract、extractViaRawWs、EXTRACTION_JS、crawlViaRawCDP、crawlListViaRawCDP
- list-crawler 无账号列表爬取改为直接使用共享浏览器，删除了 21 行 Raw CDP 分支代码
- 无账号的 monitor/standalone 路径统一改为：createPage(undefined, ...) → initBrowser() → CloakBrowser

**质量保证：**
- 所有类型检查通过，仅保留预存 tsconfig.json 弃用警告，无新增代码错误
- puppeteer-extra 和 stealth 插件保留作为回退引擎，可通过 BROWSER_ENGINE=puppeteer-stealth 环境变量激活

**迁移价值：**
- 代码库简化，删除了大量遗留 Raw CDP 基础设施
- 统一使用 CloakBrowser 作为主浏览器引擎
- 保留了灵活的引擎切换机制以应对特殊场景
