# happy-codium CLAUDE.md

Electron + Vite + React 桌面 IDE 客户端，模仿 Codex Desktop 的视觉与交互。
从 upstream `slopus/happy` 的 `packages/codium` 整体迁移过来，包名改为 `@kmmao/happy-codium`。

## 启动 & 构建

```bash
# 从仓库根目录
yarn codium                         # 启动 Electron dev 模式（hot reload）
yarn workspace @kmmao/happy-codium build       # 生产构建
yarn workspace @kmmao/happy-codium typecheck   # 类型检查（main + renderer 两份 tsconfig）
yarn workspace @kmmao/happy-codium test        # vitest
yarn workspace @kmmao/happy-codium rebuild     # 手动 rebuild native modules
```

`yarn install` 时会自动跑 `postinstall: electron-rebuild -f -w better-sqlite3,node-pty`，把 native binding 重建到匹配 Electron 的 ABI。

## 技术栈与本地约定

- **Electron 41 + electron-vite 5 + Vite 8**（package.json peer dep 警告无害，实测兼容）
- **React 19 + Tailwind v4 + Radix UI** （renderer 进程）
- **Lexical**（composer 富文本编辑器）— 不是 ProseMirror
- **better-sqlite3 / node-pty / @wterm/react**（native）
- **TypeScript 6**（其他包仍是 5.x，所以 nohoist 隔离）
- **vitest 4**（其他包用 vitest 3，同样 nohoist 隔离）

为了避免和其他包的依赖版本冲突，整个 `@kmmao/happy-codium/**` 在根 `package.json` 的 `nohoist` 列表里 — codium 的依赖**全部安装在 `packages/happy-codium/node_modules/`**，不参与 hoist。

## 与其他包的关系

- **不依赖任何 `@kmmao/*` 内部包**（不引用 wire / cli / server / app）
- **不会被其他包引用**（private package, 不发 npm）
- 是独立运行的 Electron 应用，技术栈、构建链、ABI 与 monorepo 其他包完全隔离

## 目录结构

```
sources/
├── boot/                # Electron 进程入口
│   ├── main/            # Main process（含 worker hosts、IPC、auth、worktree）
│   └── preload/         # Preload bridge
├── app/                 # Renderer：UI（页面 / 组件 / chat / workspace）
├── agents/              # Agent runtime
├── happy/               # Happy 协议层
├── plugins/             # 推理插件（anthropic / codex / happy）
├── shared/              # Renderer ↔ main 共享类型
├── theme/               # Chrome theme pipeline（仿 Codex .asar 提取的 55+ presets）
└── index.html / index.css / index.tsx
```

## 写代码时注意

- 缩进 **4 spaces**（和 server/app 一致，不要照搬 cli 的 2 spaces）
- 路径别名 `@/*` → `./sources/*`
- 改 native module 依赖（better-sqlite3、node-pty 等）后必须 `yarn workspace @kmmao/happy-codium rebuild` 或重新 `yarn install`
- localStorage 命名空间继承自 upstream：`codium:*` / `codium.theme.*` / `codium.plugin.*`，**不要改**（会造成本地数据丢失）
- Electron app userData 目录用 `codium-chats.json` 等文件名 — 同上原因不要改
- Codex 集成 originator 字段保留 `codium`（用于 Codex Responses API 识别）

## 同步 upstream codium 更新的流程

upstream `slopus/happy` 仍在持续开发 `packages/codium/`。需要 pull 时：

```bash
git fetch upstream
git checkout upstream/main -- packages/codium  # 临时拉到旧路径
# 手动对照 diff，把变更合并进 packages/happy-codium
rm -rf packages/codium  # 清理临时路径
```

或用 `git diff upstream/main:packages/codium HEAD:packages/happy-codium` 做对照。

## 已知差异（kmmao 相对 upstream）

| 项 | upstream | kmmao |
|---|---|---|
| 包名 | `codium` | `@kmmao/happy-codium` |
| 目录 | `packages/codium` | `packages/happy-codium` |
| 包管理器 | pnpm | yarn 1 + nohoist |
| Native rebuild | 未声明 | 自带 `postinstall` 钩子 |
| 终端示例文案 | `pnpm --filter codium typecheck` | `yarn workspace @kmmao/happy-codium typecheck` |
