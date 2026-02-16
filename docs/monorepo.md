# Monorepo 架构

本项目采用 **Monorepo**（单仓多包）架构，使用 **Yarn v1.22.22 Workspaces** 在一个 Git 仓库中管理四个独立的包。

---

## 什么是 Monorepo

Monorepo 是一种代码仓库组织方式：**一个 Git 仓库里放多个相关的项目/包**。与之相对的是 Multirepo（每个项目独立仓库）。

```
# Multirepo：每个项目一个仓库
happy-cli/       ← Git Repo A
happy-server/    ← Git Repo B
happy-app/       ← Git Repo C
happy-agent/     ← Git Repo D

# Monorepo：一个仓库管所有项目
happy/                        ← 唯一的 Git Repo
├── packages/
│   ├── happy-cli/            ← 包 1
│   ├── happy-server/         ← 包 2
│   ├── happy-app/            ← 包 3
│   └── happy-agent/          ← 包 4
├── package.json              ← 根配置（Yarn Workspaces）
├── docker-compose.yml
└── docs/
```

---

## 工作区配置

根目录 `package.json` 声明了工作区：

```json
{
  "name": "monorepo",
  "private": true,
  "workspaces": {
    "packages": [
      "packages/happy-app",
      "packages/happy-agent",
      "packages/happy-cli",
      "packages/happy-server"
    ],
    "nohoist": [
      "**/zod",
      "**/react",
      "**/react-dom",
      "**/react-native",
      "**/react-native/**",
      "**/react-native-edge-to-edge/**",
      "**/react-native-incall-manager/**"
    ]
  },
  "packageManager": "yarn@1.22.22"
}
```

### `packages` — 工作区列表

告诉 Yarn 哪些目录是独立的包。Yarn 会将它们的依赖统一安装到根目录的 `node_modules/`，并在根 `node_modules/` 中创建符号链接指向各个包。

### `nohoist` — 不提升的依赖

某些包（尤其是 React Native 相关）要求依赖必须在自己的 `node_modules/` 中，而不是根目录。`nohoist` 列表指定这些依赖保留在各自包的 `node_modules/` 下。

这在 `happy-app`（Expo/React Native）中尤为重要，因为 Metro bundler 需要依赖位于特定路径才能正确解析。

---

## 四个包概览

| 包名 | 路径 | 用途 | 发布 |
|------|------|------|------|
| **happy-cli** | `packages/happy-cli` | CLI 守护进程，连接 Claude Code/Codex | npm: `@kmmao/happy-coder` |
| **happy-server** | `packages/happy-server` | Fastify 后端 + Prisma + PostgreSQL + Redis | 私有（Docker 部署） |
| **happy-app** | `packages/happy-app` | React Native + Expo 移动/Web 客户端 | 私有（App Store） |
| **happy-agent** | `packages/happy-agent` | 远程控制 Agent 的 CLI 工具 | npm: `@slopus/agent` |

### 包之间的关系

```
happy-app (移动/Web) ←→ happy-server (后端) ←→ happy-cli (用户电脑上的 CLI)
                                               happy-agent (远程 Agent CLI)
```

各包**不互相引用代码**（没有 `import ... from 'happy-server'` 这种），而是通过网络协议（HTTP + WebSocket）通信。Monorepo 的好处体现在：共享开发工具链、统一版本管理、原子提交。

---

## 日常开发命令

### 安装依赖

在**仓库根目录**执行一次即可，Yarn 会为所有包安装依赖：

```bash
yarn install
```

### 运行特定包的命令

使用 `yarn workspace <包名> <命令>` 格式：

```bash
# CLI 相关
yarn workspace @kmmao/happy-coder build
yarn workspace @kmmao/happy-coder test
yarn workspace @kmmao/happy-coder dev

# Server 相关
yarn workspace happy-server build
yarn workspace happy-server test
yarn workspace happy-server dev

# App 相关
yarn workspace happy-app typecheck
yarn workspace happy-app start
yarn workspace happy-app ios

# Agent 相关
yarn workspace happy-agent build
yarn workspace happy-agent test
```

### 根目录快捷脚本

```bash
yarn cli          # → yarn workspace happy-coder cli
yarn web          # → yarn workspace happy-app web
yarn release      # → node ./scripts/release.cjs
```

---

## 依赖管理

### 给特定包添加依赖

```bash
yarn workspace happy-server add axios
yarn workspace happy-app add expo-camera
yarn workspace @kmmao/happy-coder add --dev vitest
```

### 给根项目添加开发依赖

```bash
yarn add -W -D <package>
```

`-W` 表示 "workspace root"，允许在根目录安装。

### 依赖提升机制

Yarn Workspaces 默认将所有包的依赖**提升**到根 `node_modules/`，避免重复安装。例如四个包都用了 `typescript`，只会在根 `node_modules/typescript` 安装一份。

`nohoist` 中列出的例外（如 `react-native`）会保留在各自包的 `node_modules/` 下。

---

## 各包技术差异

虽然在同一个仓库，但每个包有自己的技术约定：

| 维度 | CLI / Agent | Server | App |
|------|-------------|--------|-----|
| 缩进 | 2 空格 | 4 空格 | 4 空格 |
| 源码目录 | `src/` | `sources/` | `sources/` |
| 测试后缀 | `.test.ts` | `.spec.ts` | `.test.ts` |
| 打包工具 | pkgroll | tsx (运行时) | Metro (Expo) |
| 模块系统 | ESM | ESM | Expo |
| 路径别名 | `@/*` → `./src/*` | `@/*` → `./sources/*` | `@/*` → `./sources/*` |

---

## Monorepo 的优势（对本项目而言）

1. **原子提交**：改了 CLI 的协议格式 + Server 的协议处理，可以在一个 commit 里完成，保证一致性
2. **共享依赖**：`typescript`、`zod`、`vitest` 等只装一次
3. **统一 CI/CD**：一条流水线可以跑所有包的构建和测试
4. **开发便利**：改完 Server 代码，CLI/App 连本地 Server 就能立即联调，无需发版
5. **文档集中**：`docs/` 目录覆盖所有包的架构说明

---

## 常见问题

### Q: 新增一个包怎么做？

1. 在 `packages/` 下创建目录，初始化 `package.json`
2. 在根 `package.json` 的 `workspaces.packages` 数组中添加路径
3. 运行 `yarn install` 让 Yarn 识别新包

### Q: 为什么不用 pnpm / Turborepo / Nx？

本项目使用 Yarn v1 Workspaces，配置简单且满足需求。四个包体量适中、无复杂的包间依赖，Yarn Workspaces 足够胜任。

### Q: `nohoist` 是什么意思？

React Native 的 Metro bundler 要求某些依赖（如 `react`、`react-native`）必须在包自己的 `node_modules/` 下。`nohoist` 告诉 Yarn 不要把这些依赖提升到根目录，而是保留在 `packages/happy-app/node_modules/` 下。

### Q: 各个包能互相 import 吗？

技术上可以，但本项目的包之间**不直接引用代码**。它们通过网络协议（HTTP API + Socket.IO）通信。这种设计让各包可以独立部署和升级。
