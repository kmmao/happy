# Changelog

## Version 3 - 2026-03-01

语音交互全面升级，新增 Worktree 支持、工具分组与简洁模式，大幅优化会话管理与 UI 体验。

### 语音助手
- 全新语音管线：Edge TTS 语音合成、Web VAD 语音活动检测、状态动画
- 新增 WebSocket 实时语音转文字服务
- Haiku 模型智能纠错 STT 结果，提升识别准确率
- 修复移动端 Web 中文转写问题
- 降低语音交互延迟，支持 TTS 打断
- 移除 Claude Code 完成后多余的"Done"语音提示

### Worktree
- 新增 Worktree 检测与会话元数据支持
- Worktree 会话类型移出实验性功能
- 新增 9 语言 i18n 翻译
- 修复合并冲突时自动中止、命令注入漏洞及生命周期管理

### 工具与权限
- 新增工具分组显示与简洁模式
- 分组工具内自动批准权限，TodoWrite 排除在外
- 未知工具不再显示审核按钮
- 新增 dontAsk 权限模式与 opusplan 模型支持

### 会话管理
- 会话列表支持滑动归档与删除
- 会话偏好（权限模式、模型模式）同步至服务端
- 新增会话 Profile 追踪与持久化
- 远程模式下注册 getCompactionSummary RPC
- 新增实时会话排序开关

### UI/UX
- 改进代码块交互与工具描述展示
- Task 工具卡片显示 Agent 类型、实时副标题与 Copilot 图标
- 新增 Modal.toast 自动消失通知
- 工具栏窄屏自动换行
- 用量面板宽度约束

### CLI
- 修复 Shell 命令结果无法在 App 中显示
- App 语言偏好传递给 Claude 系统提示
- 升级 SDK 至 0.2.62
- CLI 版本升级至 0.29.27

### 安全
- 修补 22 个 Dependabot 安全漏洞

## Version 2 - 2026-02-27

Fixed session resume to reuse the same Happy session instead of creating a new one, preserving message history and session identity.

- Fixed session metadata showing as unknown after resume by detecting encryption key changes and reinitializing the encryptor
- Fixed session title reverting to project name after resume by preserving the summary field during metadata updates
- Added session resume V2 support — resume now reconnects to the same session instead of creating a new one

## Version 1 - 2026-02-27

Happy Coder 2.0 — 基于上游 Happy Coder 深度定制的移动端 AI 开发助手，支持远程控制 Claude Code 与 Codex，全链路端到端加密。

- 支持通过手机远程控制 Claude Code 和 Codex，随时随地发起 AI 编程会话
- 全链路端到端加密（AES-256-GCM / NaCl secretbox），确保会话内容完全私密
- QR 码扫描与 URL 手动输入两种方式快速认证设备
- Daemon 模式常驻运行，手机一键即可启动远程开发会话
- 智能语音助手，支持 15+ 语言的自然对话交互
- GitHub 与 Claude 账户连接，统一管理开发者身份
- 多设备实时同步，在线/离线状态一目了然
- 深色模式与外观自定义，自动跟随系统主题
- 聊天中 Markdown 表格渲染，代码高亮显示
- 精简设置页面，移除上游相关链接，开始维护自有更新日志
- 支持 iOS、Android 和 Web 三端
