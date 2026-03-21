# Happy 项目待办

## SDK 新功能 App 端集成（2026-03-21 规划）

CLI 侧已完成 SDK 选项映射（commit aff7302c），以下三个功能需要 App 端配合开发。

### ~~1. 子 Agent 进度摘要展示~~ ✅ 已完成 (eb15b249)
- wire/cli/app 三层打通，task-progress 带 summary 时显示为聊天消息

### 2. 文件回退按钮
- **优先级**: P1
- **现状**: CLI 已启用 `enableFileCheckpointing: true`，SDK Query 有 `rewindFiles(messageId)` 方法
- **要做**:
  - CLI: 新增 `rewindFiles` RPC handler（先 dryRun 获取影响范围，确认后执行，执行前 git stash）
  - Wire: 新增 rewind RPC 类型
  - App: 用户消息旁加 [⏪] 按钮，点击后显示确认弹窗（影响文件数、行数变化）
- **安全**: 多会话同目录时需警告，执行前自动 git stash
- **涉及**: `claudeRemoteLauncher.ts`, wire RPC 类型, `MessageView.tsx`

### 3. Plugins 设置管理
- **优先级**: P2
- **现状**: CLI 已映射 `plugins` 到 SDK，App 设置页有成熟模式
- **要做**:
  - App: 设置页新增 Plugins 管理页面（列表展示、添加/删除、启用/禁用）
  - CLI: 启动会话时从 settings 读取 plugins 配置传入 SDK
  - 考虑: CLI 端扫描已安装 plugins 列表上报给 App（解决 App 无法浏览远程文件系统的问题）
- **涉及**: `settings.ts`, 新增 `plugins.tsx`, `daemon/run.ts`
