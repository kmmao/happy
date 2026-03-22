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
