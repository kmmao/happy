# Happy 项目待办

## SDK 新功能 App 端集成（2026-03-21 规划）

CLI 侧已完成 SDK 选项映射（commit aff7302c），以下三个功能需要 App 端配合开发。

### ~~1. 子 Agent 进度摘要展示~~ ✅ 已完成 (eb15b249)
- wire/cli/app 三层打通，task-progress 带 summary 时显示为聊天消息

### ~~2. 文件回退按钮~~ ✅ 已完成 (f7656779)
- 用户消息旁 [⏪] 按钮 → dryRun 预览 → 确认弹窗 → 执行回退
- TODO: 多会话同目录时的 git stash 安全保护（后续优化）

### 3. Plugins 设置管理
- **优先级**: P2
- **现状**: CLI 已映射 `plugins` 到 SDK，App 设置页有成熟模式
- **要做**:
  - App: 设置页新增 Plugins 管理页面（列表展示、添加/删除、启用/禁用）
  - CLI: 启动会话时从 settings 读取 plugins 配置传入 SDK
  - 考虑: CLI 端扫描已安装 plugins 列表上报给 App（解决 App 无法浏览远程文件系统的问题）
- **涉及**: `settings.ts`, 新增 `plugins.tsx`, `daemon/run.ts`
