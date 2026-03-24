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
