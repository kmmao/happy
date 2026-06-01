# Happy Coder 项目结构概览

## 系统架构总览

Happy Coder 是一个基于云的 AI 编程助手系统，允许用户通过移动/网页应用远程控制本地 Claude Code 或 Codex。整个系统采用 Yarn v1.22.22 单仓库架构，包含 6 个互联的 TypeScript 包。数据流向为：**移动/网页客户端（happy-app）→ Fastify 后端服务器（happy-server）→ CLI 守护进程（happy-cli）→ 本地 Claude Code/Codex**，所有传输层均使用 AES-256-GCM 端到端加密。核心类型系统由 `happy-wire` 定义，所有包共享其 Zod Schema；会话、机器、项目、任务等领域模型通过 PostgreSQL + Redis 在后端持久化，本地凭证与设置存储于 `~/.happy`（稳定版）或 `~/.happy-dev`（开发版）。

---

## 📦 包详解

### 1. happy-cli (`@kmmao/happy-coder`)

**用途**：本地 CLI 封装与守护进程，用于启动/管理 Claude Code 或 Codex 会话，支持代理循环自动化。

**入口点**：
- `bin/happy.mjs` — Node.js CLI 启动器
- `src/index.ts` — TypeScript 主逻辑
- `bin/happy-mcp.mjs` — MCP 协议桥接

**关键目录**：

| 目录 | 职责 |
|-----|------|
| `src/claude/` | Claude 后端集成（本地/远程启动器、会话管理） |
| `src/codex/` | Codex App Server 客户端、MCP 桥接、基础指令 |
| `src/daemon/` | 守护进程生命周期（启动/停止/状态）、控制客户端/服务器 |
| `src/commands/` | 顶级 CLI 命令（auth、connect、sandbox、supervisor、loop、transcript） |
| `src/agent/` | 代理核心（ACP 适配器、工厂函数、消息处理） |
| `src/automation/` | 代理循环引导与任务自动化协调 |
| `src/api/` | API 客户端与会话状态机 |
| `src/ui/` | 终端 UI（Ink React）、身份验证流、日志、消息格式化 |
| `src/sandbox/` | 沙盒环境配置与代码执行隔离 |
| `src/supervisor/` | 监督模式（自动化 bug 修复提示） |
| `src/terminal/` | 终端仿真与 PTY 管理 |
| `src/modules/` | 外部工具集成（ripgrep、difftastic、代理、任务日志） |
| `src/knowledge/` | 知识库客户端、repo 映射生成 |
| `src/webhook/` | webhook 触发的自动化与 worktree 创建 |

**技术栈**：Node.js/TypeScript、Fastify、Ink + React、Zod、Socket.io-client、node-pty、MCP SDK、ACP SDK、Anthropic SDK、Vitest

**构建与发布**：
- 构建工具：`pkgroll`（生成 CJS + ESM 双包）
- 版本管理：稳定版与开发版通过 env-wrapper.cjs 分离
- 发布：与 release-it 集成，自动生成 changelog

---

### 2. happy-server

**用途**：Fastify REST/WebSocket 后端，负责账户、机器、会话、任务、监督的管理，内置任务自动化系统。

**入口点**：
- `sources/main.ts` — 数据库初始化 → 认证 → 模块启动 → API 服务
- `sources/standalone.ts` — 独立部署变体

**关键目录**：

| 目录 | 职责 |
|-----|------|
| `sources/app/api/` | HTTP 与 WebSocket 端点（routes/、socket/、supervisor/、task/、artifact/） |
| `sources/app/` | 应用领域（auth、events、feed、github、kv、monitoring、presence、push、session、social、webhook） |
| `sources/modules/` | 可复用服务（encrypt、github、pushSend、supervisor 系统、知识管理、任务生命周期） |
| `sources/storage/` | 数据库（Prisma + PostgreSQL/PGlite）、Redis、文件处理、缓存、事务 |
| `sources/utils/` | 日志、关闭、类型助手 |
| `prisma/migrations/` | 数据库 Schema 迁移 |

**技术栈**：Fastify 5.7、Prisma 7.7、PostgreSQL + PGlite、Redis (ioredis)、Socket.io、Zod、TypeScript、Vitest、tsx、MinIO、Expo SDK

**关键特性**：
- **Supervisor 系统**：专用自动化领域，支持配置、调度、评分、限额、修复监视、使用追踪
- **文件命名约定**：实体+动作（如 `friendAdd.ts`、`sessionDelete.ts`）
- **数据库适配器**：同时支持 PostgreSQL 和 PGlite（内存 SQLite）
- **启动钩子**：DB 初始化 → encrypt/github 初始化 → 认证 → 清理 → 服务启动

---

### 3. happy-app（React Native + Expo）

**用途**：跨平台 AI 伴侣客户端（iOS/Android/Web/macOS），用于远程控制会话。

**入口点**：
- `index.ts` — Expo 应用入口
- `sources/app/_layout.tsx` — 主应用布局（auth、通知、主题、modals）
- `src-tauri/src/main.rs` — macOS Tauri 桌面应用

**关键目录**：

| 目录 | 职责 |
|-----|------|
| `sources/app/` | Expo Router 文件路由结构 |
| `sources/components/` | 可复用 React Native 组件（session、settings、markdown、terminal、git、tools） |
| `sources/sync/` | 核心状态同步引擎（数据压缩、加密、git 解析、工作流编排） |
| `sources/auth/` | 身份验证模块（token 存储、二维码认证、应用锁、密钥备份） |
| `sources/hooks/` | 自定义 React hooks（useHappyAction、useStyles） |
| `sources/modal/` | 模态对话框管理 |
| `sources/text/` | i18n 翻译（9 种语言：英文、俄文、波兰文、西班牙文、加泰罗尼亚文、意大利文、葡萄牙文、日文、简体中文） |
| `sources/encryption/` | Libsodium 加密工具 |

**技术栈**：React 19.2、React Native 0.83.6、Expo 55、Expo Router、TypeScript、Tauri 2.8.1、Zustand、Unistyles、LiveKit、Libsodium、Vitest

**关键特性**：
- **多变体构建**：development/preview/production 通过 APP_ENV 切换
- **OTA 更新**：EAS Update 支持
- **强制 i18n**：所有用户界面字符串必须使用 `t('key')`
- **样式系统**：Unistyles + Tailwind 风格（twrnc）
- **桌面支持**：`yarn tauri:dev` 支持 macOS 热重载

---

### 4. happy-agent (`@kmmao/happy-agent`)

**用途**：远程专用 CLI 客户端，通过 HTTP API 与 WebSocket 控制 Happy Coder 代理，支持端到端加密。

**入口点**：
- `bin/happy-agent.mjs` — CLI 启动器
- `src/index.ts` — 核心逻辑

**关键目录**：

| 目录 | 职责 |
|-----|------|
| `src/api/` | HTTP 客户端与 RPC 处理（httpClient、sessionClient、RpcHandlerManager） |
| `src/daemon/` | 代理执行守护进程（tmux 会话、事件循环、审计日志、webhook、任务调度） |
| `src/tunnel/` | NAT 穿透（Tailscale、Caddy、UPnP 提供者） |
| `src/` | 核心 CLI 逻辑（认证、凭证加密、AES-256-GCM、配置、输出格式化） |

**技术栈**：TypeScript、ESM、Commander.js、Socket.IO、NaCl/TweetNaCl、Zod、Axios、pkgroll、Vitest、Chalk

**特点**：
- 使用 `@kmmao/happy-wire` 共享消息类型
- 端到端 AES-256-GCM 加密
- 文件日志记录（无 console 输出）
- 会话前缀匹配 CLI 命令

---

### 5. happy-wire

**用途**：共享消息 Wire 类型与 Zod Schema，被所有其他包作为依赖。

**入口点**：`src/index.ts` — 统一导出所有类型

**关键目录**：

| 目录 | 职责 |
|-----|------|
| `src/` | 22 个模块覆盖：消息、协议（session/legacy）、机器类型、知识库、技能、任务、语音、MCP 注册表、Codex 后端选择 |
| `dist/` | 编译输出（CJS + ESM 双包 + TypeScript 声明） |

**技术栈**：TypeScript、Zod 4、pkgroll、Vitest、cuid2

**关键特性**：
- **双包**：同时导出 CJS 和 ESM
- **模块化**：22 个源模块，均通过 index.ts 重新导出
- **后向兼容性**：作为上游依赖，版本管理至关重要

---

### 6. happy-codium

**用途**：Electron + Vite + React 桌面 IDE 客户端，模拟 Codex Desktop UI/UX。

**入口点**：
- `sources/main.tsx` — 渲染进程根
- `sources/boot/main/index.ts` — Electron 主进程
- `sources/boot/preload/index.ts` — Preload 桥接
- `electron.vite.config.ts` — 构建配置

**关键目录**：

| 目录 | 职责 |
|-----|------|
| `sources/boot/main/` | Electron 主进程：窗口/IPC、chat 持久化、OAuth、worktree、agent/happy worker |
| `sources/boot/main/agent-worker` | worker thread 托管 @anthropic-ai/claude-agent-sdk |
| `sources/boot/main/happy-worker` | worker thread 托管 Happy 客户端认证/状态 |
| `sources/app/` | 渲染 UI：页面（NewChat、Chat、Settings）、布局、workspace store、chat 运行器 |
| `sources/app/components/` | UI 组件（ThemeSwitcher、ModelPicker、Toolbar、SearchDialog）|
| `sources/app/chat/` | Chat 逻辑：store (jotai atoms)、runner、持久化 |
| `sources/plugins/` | 推理引擎桥接（anthropic、codex、happy） |
| `sources/theme/` | Chrome 主题管道（55+ Codex 预设） |

**技术栈**：Electron 41、Vite 8、React 19.2、Tailwind CSS v4、Radix UI、jotai、@anthropic-ai/claude-agent-sdk 0.3.157、Lexical、ProseMirror、TypeScript、Vitest

**关键特性**：
- **双 worker 架构**：agent-worker (SDK) + happy-worker (auth) 运行在 `node:worker_threads`
- **原生模块隔离**：better-sqlite3、node-pty 通过 nohoist 按 Electron ABI 重建
- **Jotai 原子状态**：sidebarOpenAtom、modelAtom、effortAtom 等
- **本地存储命名空间**：codium:* / codium.theme.* / codium.plugin.*

---

## 🔗 包之间的依赖关系

### happy-wire 是唯一的真实来源

`@kmmao/happy-wire` 定义所有共享 Zod Schema，被其他所有包消费：

| Schema | 文件 | 消费者 |
|--------|------|--------|
| `MachineMetadataSchema` | `machineTypes.ts` | CLI、Agent、Server、App |
| `DaemonStateSchema` | `machineTypes.ts` | CLI、Agent、Server、App |
| `TailscaleInfoSchema` | `machineTypes.ts` | CLI、Agent、Server、App |
| `SessionMessageSchema` | `messages.ts` | CLI、Agent、Server、App |
| `UpdateMachineBodySchema` | `messages.ts` | CLI、Agent、Server、App |

### 发布顺序（必须遵守）

```
1. @kmmao/happy-wire   (共享类型 — 必须第一个)
2. @kmmao/happy-coder  (CLI — 依赖 wire 作为 devDependency，pkgroll 内联)
3. @kmmao/happy-agent  (Agent — 依赖 wire 作为运行时依赖)
```

### 依赖图

```
happy-wire (shared types)
    ↓
    ├── happy-cli (imports as devDependency)
    ├── happy-agent (imports as runtime dependency)
    ├── happy-server (imports as runtime dependency)
    └── happy-app (imports as runtime dependency)

happy-cli + happy-agent
    ↓
    happy-server (后端)
    ↓
    happy-app (前端)

happy-codium (独立桌面客户端)
    ↓
    imports happy-wire, @anthropic-ai/sdk
```

### 修改共享类型时的步骤

1. 编辑 `packages/happy-wire/src/` 中的类型
2. 构建 wire：`yarn workspace @kmmao/happy-wire build`
3. 验证下游构建：CLI、Agent、Server、App
4. 发布 wire，然后发布下游包

---

## 🔧 常用命令速查

```bash
# 安装所有依赖
yarn install

# 每个包的构建、测试、开发命令
yarn workspace @kmmao/happy-coder build    # CLI
yarn workspace @kmmao/happy-coder test
yarn workspace @kmmao/happy-coder dev

yarn workspace happy-server dev            # Server
yarn workspace happy-app start             # App (Expo)
yarn workspace @kmmao/happy-agent build    # Agent
yarn codium                                # Codium (Electron dev)
```

---

## 📝 代码规范总结

| 规范 | CLI/Agent | Server | App |
|-----|-----------|--------|-----|
| **缩进** | 2 空格 | 4 空格 | 4 空格 |
| **源目录** | `src/` | `sources/` | `sources/` |
| **测试后缀** | `.test.ts` | `.spec.ts` | `.test.ts` |
| **文件命名** | 自由 | 函数名=文件名 | 自由 |
| **捆绑器** | pkgroll | tsx (运行时) | Metro (Expo) |
| **模块系统** | ESM | ESM (CommonJS tsconfig) | Expo |

### 所有包通用

- TypeScript strict 模式强制
- 函数式编程优先，避免类
- 路径别名 `@/*` → `./src/*` (CLI/Agent) 或 `./sources/*` (Server/App)
- 所有导入放在文件顶部
- 优先使用命名导出
- Zod 运行时校验
- Vitest 测试，无 mocking (CLI 测试调用真实 API)

---

## 📚 关键文档

架构与设计决策详见 `/docs/` 目录：
- `cli-architecture.md` — CLI 与守护进程设计
- `protocol.md` — 网络协议详解
- `encryption.md` — AES-256-GCM 与 NaCl 加密方案
- `backend-architecture.md` — Server 内部设计
- `api.md` — REST/WebSocket API 参考
- `CONTEXT.md` — 领域模型与术语
- `docs/adr/` — 架构决策记录

每个包都有自己的 `CLAUDE.md`，包含包特定的规则（详见各包目录）。

---

## 🚀 项目亮点

1. **端到端加密**：Daemon ↔ Server ↔ App 全层次 AES-256-GCM 加密
2. **多客户端支持**：Mobile (iOS/Android)、Web (Expo)、Desktop (Tauri macOS + Electron)、CLI (happy-agent)
3. **任务自动化**：内置 supervisor 系统支持定时任务、webhook、嵌套执行、评分限额
4. **类型安全**：Zod Schema + TypeScript strict mode，所有客户端共享单一真实来源
5. **DevX 优化**：RTK 令牌优化、file-based logging 不污染会话、Docker Compose 一键本地开发
6. **可扩展性**：支持多 AI 后端（Claude、Codex、Gemini）、NAT 穿透（Tailscale/Caddy/UPnP）、webhook 驱动自动化
