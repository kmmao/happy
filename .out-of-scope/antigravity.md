# Google Antigravity (agy) 后端

本 fork 暂不接入 Google Antigravity（`agy`）CLI 作为新的 agent 后端。

## 为什么超出范围

Happy 的定位是远程控制 **Claude Code 与 Codex**（外加已有的 Gemini 接入先例）。每接入一个 agent 后端，都不是加一个命令那么简单，而是要补齐一整套基础设施：

- PTY / 协议解析（每个后端的命令行交互或结构化协议都不同）
- 消息归一化（把后端输出映射到 Happy 统一的 `Message` 模型）
- session 映射、权限/审批流、流式渲染适配
- 长期维护承诺——后端每次升级都要跟进

参照现有 `gemini/` 后端的接入量级，新增一个后端的工作远超普通 enhancement。

更关键的是可行性前置条件尚不成立：截至决策时，Google Antigravity 缺乏**已证实稳定、可程序化驱动**的命令行接口/协议。在 agy 生态稳定、并出现明确可对接的接口之前，投入一整个后端的集成与持续维护不符合当前路线图重心。

这是一个**范围 + 可行性**层面的决定，不是"暂时没空"的延期。若日后 agy 提供了稳定的可编程接口、且产品上确定要纳入路线图，可删除本文件并让对应 issue 重新走正常 triage。

## 历史请求

- #112 — “[P3] feat: 支持 Google Antigravity (agy) CLI (upstream #1313)”
