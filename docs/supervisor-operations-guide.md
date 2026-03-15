# Project Supervisor 操作说明

> 自治 Agent 系统 — 自动分析代码健康度、发现问题、执行修复
>
> 版本：v1.0 | 更新日期：2026-03-15

---

## 目录

1. [概述](#1-概述)
2. [快速开始](#2-快速开始)
3. [三种运行模式](#3-三种运行模式)
4. [配置项详解](#4-配置项详解)
5. [分析维度](#5-分析维度)
6. [触发方式](#6-触发方式)
7. [审批工作流](#7-审批工作流)
8. [健康度评分](#8-健康度评分)
9. [报告与分析](#9-报告与分析)
10. [安全机制](#10-安全机制)
11. [常见问题](#11-常见问题)

---

## 1. 概述

Project Supervisor 是 Happy Coder 的自治 Agent 功能。它以 **只读模式** 启动独立的 Claude Code 会话来分析你的代码库，发现安全漏洞、过时依赖、架构偏移等问题，然后根据你选择的自动化级别决定是 **建议**、**半自动** 还是 **全自动** 修复。

### 系统架构

```
App (手机/Web)                 Server                      CLI Daemon
     │                          │                              │
     ├─ [立即扫描] ───────────> POST /supervisor/run           │
     │                          ├─ 创建 SupervisorRun          │
     │                          └─ 发送 ephemeral 事件 ──────> │
     │                                                         ├─ 构建分析 Prompt
     │                                                         ├─ 启动只读 Claude Code 会话
     │                                                         ├─ 会话分析代码，输出 JSON
     │                                                         └─ 回报结果 ──────────────>
     │                          ├─ 存储 Actions                │
     │                          ├─ 计算健康分                   │
     │  <── socket 通知 ─────── └─ 广播更新                     │
     │                                                         │
     ├─ 查看发现，点 [批准] ──> PATCH /actions/:id             │
     │                          └─ 发送 fix 事件 ────────────> │
     │                                                         ├─ 构建修复 Prompt
     │                                                         ├─ 启动可写 Claude Code 会话
     │                                                         ├─ 修改代码、运行测试、提交
     │                                                         └─ 回报修复状态 ──────────>
     │  <── push 通知 ───────── └─ 更新 Action 状态             │
```

### 核心原则

- **分析只读**：分析会话禁止修改任何文件
- **修复最小化**：修复会话只改动必要文件，必须通过测试
- **PR 永不自动合并**：即使在全自动模式下，合并 PR 仍需人类确认
- **日限流**：每个项目每天最多 5 次分析（可通过环境变量调整）

---

## 2. 快速开始

### 前置条件

- Happy CLI >= 0.33.0
- 项目已在 App 中注册（有 Server 端 Project 实体）
- CLI Daemon 运行中（`happy daemon status` 确认）

### 启用步骤

1. 打开 App → 进入项目详情页 → Health Tab
2. 点击右上角齿轮图标进入 **Supervisor Settings**
3. 选择运行模式（建议新手从 **Suggest** 开始）
4. 选择分析维度（默认已启用 Security + Dependencies + Architecture）
5. 可选：启用定时扫描、Push 触发、自定义规则
6. 返回 Health Tab，点击 **Scan Now** 执行首次分析

### 首次分析预期

- 分析通常耗时 1-3 分钟（取决于代码库大小和启用的维度数）
- 完成后会收到 Push 通知
- Health Tab 自动刷新，显示健康度评分和发现的问题

---

## 3. 三种运行模式

| 特性 | Suggest | Semi-Auto | Auto |
|------|---------|-----------|------|
| 代码分析 | Y | Y | Y |
| 生成报告 | Y | Y | Y |
| 创建 GitHub Issue | - | Y（supervisor 标签） | Y（auto-fix 标签） |
| 自动触发修复 | - | -（需人工批准） | Y（critical/high 自动批准） |
| **合并 PR** | **-** | **-** | **-（硬编码禁止）** |

### Suggest（建议模式）

最保守的模式。Supervisor 只分析代码、生成报告，所有发现都需要你手动审阅和决定。适合：

- 首次使用，了解系统行为
- 个人项目，想要定期健康检查
- 不确定修复建议是否合理时

### Semi-Auto（半自动模式）

在 Suggest 基础上，Supervisor 会为发现的问题自动创建 GitHub Issue。你仍然需要手动批准每个修复。适合：

- 团队项目，需要 Issue 追踪
- 想要自动记录问题但手动控制修复节奏

### Auto（全自动模式）

最激进的模式。对于 **critical** 和 **high** 级别的发现，Supervisor 会自动批准并触发修复会话。medium 和 low 仍需手动审批。适合：

- 成熟项目，有完善的测试覆盖
- 信任 Supervisor 的判断（建议先用 Suggest 运行几轮验证质量）

> **切换到 Auto 模式时，App 会弹出确认对话框**，确保你了解自动修复的含义。

---

## 4. 配置项详解

进入路径：项目详情 → Health Tab → 齿轮图标

### 4.1 运行模式（Mode）

三选一：Suggest / Semi-Auto / Auto（见上节）

### 4.2 定时扫描（Schedule）

| 选项 | 说明 |
|------|------|
| 开关 | 启用/关闭定时扫描 |
| 间隔 | 6 小时 / 12 小时 / 24 小时 / 48 小时 / 每周 |

定时扫描通过 Machine 心跳机制触发（约每 5 分钟检查一次是否到期），实际执行时间可能有几分钟偏差。

### 4.3 分析维度（Dimensions）

8 个维度的开关，详见 [第 5 节](#5-分析维度)。

### 4.4 Push 触发（Push Trigger）

启用后，每次 `git push` 事件会触发一次 **增量扫描**，仅分析变更的文件。适合持续集成场景。

### 4.5 自定义规则（Custom Rules）

自由文本输入（最多 2000 字符），会被注入到分析 Prompt 中。用于补充项目特有的检查需求。

示例：
```
- 检查所有 API 路由是否都使用了 authenticateMiddleware
- 确认 packages/happy-app 中所有用户可见文案都使用了 t() 国际化函数
- 检查是否有直接使用 console.log 的地方（应该使用 logger）
```

### 4.6 通知偏好（Notifications）

| 选项 | 说明 |
|------|------|
| 分析完成 | 每次分析结束后发送 Push 通知 |
| Issue 创建 | 自动创建 GitHub Issue 后通知 |
| PR 创建 | 自动创建 PR 后通知 |
| 错误通知 | 分析失败时通知 |

---

## 5. 分析维度

### 默认启用（3 个）

| 维度 | 检查内容 |
|------|--------|
| **Security** | `yarn audit` 漏洞扫描、硬编码 secrets、输入校验缺失、不安全的依赖 |
| **Dependencies** | `yarn outdated` 检查、deprecated 包、major 版本落后 >= 2 |
| **Architecture** | CLAUDE.md 规范遵循、缩进风格、i18n 使用、import 模式一致性 |

### 可选启用（5 个）

| 维度 | 检查内容 | 备注 |
|------|--------|------|
| **Tech Debt** | TODO/FIXME 标记、死代码、重复代码、复杂度过高的函数 | |
| **Code Quality** | ESLint 规则、TypeScript strict mode、Promise 错误处理、函数超 50 行 | 耗时较长 |
| **Test Coverage** | 测试文件存在性、关键路径覆盖、测试可运行性 | 耗时较长 |
| **Documentation** | README/CLAUDE.md 更新、API 文档、过时注释、CHANGELOG | |
| **Performance** | N+1 查询、缺失索引、同步阻塞、无边界列表查询、内存泄漏 | |

> 启用的维度越多，分析耗时越长、Token 消耗越大。建议根据项目需要逐步开启。

---

## 6. 触发方式

### 6.1 手动触发

App → 项目详情 → Health Tab → **Scan Now** 按钮

### 6.2 定时触发

在 Supervisor Settings 中启用 Schedule，设置间隔。Server 通过心跳机制每 ~5 分钟检查到期项目并触发。

### 6.3 Push 事件触发

在 Supervisor Settings 中启用 Push Trigger。每次 `git push` 后自动触发增量扫描（仅分析变更文件）。

### 触发限制

- **日限流**：每个项目每天最多 5 次（环境变量 `MAX_DAILY_SUPERVISOR_RUNS` 可调）
- **并发限制**：同一项目同时只能有一个 pending/running 状态的分析
- **计数重置**：每天 UTC 午夜自动重置

---

## 7. 审批工作流

进入路径：项目详情 → Health Tab → **Actions** 按钮（或直接点击待审批数量 badge）

### 7.1 Action 状态

每个发现（Action）有 4 种审批状态：

| 状态 | 含义 | 后续操作 |
|------|------|---------|
| **Pending** | 等待审阅 | 可批准、跳过、忽略 |
| **Approved** | 已批准修复 | 可触发修复会话 |
| **Skipped** | 本次跳过 | 下次扫描如果重现会再次出现为 Pending |
| **Ignored** | 永久忽略 | 不再提醒此类问题 |

### 7.2 操作流程

```
发现列表 (Pending tab)
  │
  ├─ 点击 [Approve] → 状态变为 Approved
  │   └─ 点击 [Fix] → 触发修复会话
  │       ├─ CLI 启动新 Claude Code 会话
  │       ├─ 执行最小化修复
  │       ├─ 运行测试
  │       ├─ 提交 commit: "fix: {问题标题}"
  │       └─ 回报结果（completed / failed）
  │
  ├─ 点击 [Skip] → 状态变为 Skipped（下次扫描可能重现）
  │
  └─ 点击 [Ignore] → 状态变为 Ignored（永久忽略）
```

### 7.3 批量操作

支持批量审批，一次最多处理 50 个 Action。

### 7.4 Auto 模式下的自动审批

当模式设为 Auto 时：
- **critical / high** 级别的发现会自动设为 Approved 并立即触发修复
- **medium / low** 级别仍需手动审批
- 自动修复触发后会发送 Push 通知

---

## 8. 健康度评分

### 评分算法

采用加权扣分制（分数越高 = 问题越多）：

| 严重程度 | 权重（每个） |
|---------|-----------|
| Critical | 10 分 |
| High | 5 分 |
| Medium | 2 分 |
| Low | 1 分 |

### 等级标准

| 等级 | 分数范围 | 含义 |
|------|---------|------|
| **A** | 0 - 5 | 健康 |
| **B** | 6 - 15 | 良好，有少量改进空间 |
| **C** | 16 - 30 | 一般，建议关注 |
| **D** | 31 - 50 | 较差，需要投入修复 |
| **F** | > 50 | 严重，有紧急问题需处理 |

### 趋势判断

对比当前与上次分析的 Action 总数：
- **Improving**：当前 < 上次
- **Stable**：当前 = 上次
- **Declining**：当前 > 上次

---

## 9. 报告与分析

### 9.1 运行历史

Health Tab 底部显示最近的运行记录，包含：
- 触发方式（手动 / 定时 / 事件）
- 运行状态和耗时
- 发现数量和健康分变化

### 9.2 对比报告

每次运行完成后，可与上一次运行对比：
- **新增问题**：本次首次出现的 Action
- **已解决**：上次存在但本次未出现的 Action
- **持续存在**：两次都出现的 Action

### 9.3 Markdown 导出

运行详情页支持导出为 Markdown 格式的完整报告，包含：
- Run Summary（时间、触发方式、健康分）
- Issues by Severity（按严重程度分类列出）
- New / Resolved / Persistent sections

### 9.4 成本统计

Health Tab 的 Cost Section 显示：
- 近 30 天的总分析次数
- 总 Token 消耗
- 总成本（USD 估算）

---

## 10. 安全机制

### 10.1 分析隔离

- 分析会话以 **只读模式** 运行（`approvedNewDirectoryCreation=false`）
- Prompt 中明确禁止：修改文件、创建 commit/branch、运行破坏性命令
- 允许的诊断命令：`yarn audit`、`yarn outdated`、`grep`、`ls` 等

### 10.2 修复约束

- 修复会话只针对 **单个已批准的 Action**
- 必须运行测试（`yarn test` / `npm test`）
- 只能提交一个 commit，格式固定为 `fix: {标题}`
- **禁止创建 branch 和 PR**（直接修改 working directory）

### 10.3 PR 合并硬限制

```
即使在 Auto 模式下，PR 合并永远需要人类手动确认。
这是系统级硬编码约束，无法通过任何配置绕过。
```

### 10.4 日限流

- 默认每项目每天 5 次（`MAX_DAILY_SUPERVISOR_RUNS`）
- 超限时手动触发返回 429 错误
- 定时触发超限时自动推迟到下一个周期

### 10.5 并发控制

- 同一项目同时只允许一个 pending/running 的分析
- 通过数据库原子操作保证（`updateMany` + status 条件）

### 10.6 数据加密

- Supervisor 配置存储在 `Project.supervisorConfig`（E2E 加密）
- Action 的详细内容（title/description/suggestedFix）存储为加密字段
- 报告通过 Artifact 系统存储（复用 E2E 加密基础设施）

---

## 11. 常见问题

### Q: 分析一直停在 "running" 状态？

可能原因：
1. CLI Daemon 未运行 → `happy daemon status` 检查
2. Machine 与 Server 的 WebSocket 连接断开 → 查看 daemon 日志
3. Claude Code 会话异常退出 → 检查 `~/.happy/logs/` 或 `~/.happy-dev/logs/`

处理：在 App 中点击运行详情 → Cancel 取消当前运行，重新触发。

### Q: 修复失败了怎么办？

修复失败不会改变你的代码。可能原因：
1. 测试未通过 → 手动检查并修复
2. 修复建议不适用 → 跳过此 Action，手动处理
3. 会话超时 → 重新触发修复

### Q: 日限流用完了？

等待 UTC 午夜自动重置，或联系管理员调整 `MAX_DAILY_SUPERVISOR_RUNS` 环境变量。

### Q: 增量扫描和全量扫描的区别？

- **全量扫描**：手动触发和定时触发默认执行全量扫描，分析整个代码库
- **增量扫描**：Push 触发时执行增量扫描，Prompt 中会注入 `changedFiles` 列表，引导 Claude 重点分析变更文件

### Q: 自定义规则写什么？

任何你希望 Supervisor 额外检查的内容。规则会被直接注入分析 Prompt。写法建议：
- 用列表形式，每条规则一行
- 描述清晰具体，避免模糊指令
- 不超过 2000 字符

### Q: 同一个问题每次都被重复发现？

系统有去重机制（通过 `category + title` 匹配）。如果之前的 Action 状态为 Pending，新发现会更新已有记录而非创建新记录。如果你 Skipped 了某个 Action，下次扫描检测到同类问题时会重新创建。如果不想再看到，使用 Ignore。

### Q: 如何查看 Supervisor 的 Claude Code 会话？

每个分析和修复都会创建独立的 Claude Code 会话。在运行详情或 Action 详情中可以看到关联的 `sessionId`，点击可跳转到对应会话查看完整交互记录。

---

## 附录

### A. 严重程度判断指南

| 等级 | 判断标准 | 示例 |
|------|---------|------|
| **Critical** | 已知 CVE (CVSS >= 7.0)、硬编码 secret、可利用的安全漏洞 | jsonwebtoken CVE-2024-xxxx |
| **High** | deprecated 包、major 版本落后 >= 2、严重架构偏移 | React 17 → 19 跨 2 个 major |
| **Medium** | minor 版本落后、轻微风格不一致、缺少错误处理 | chalk 5.3 → 5.6 |
| **Low** | patch 落后、命名偏好、非关键文档缺失 | 函数命名不符合项目约定 |

### B. 技术栈引用

| 组件 | 位置 |
|------|------|
| CLI Supervisor 模块 | `packages/happy-cli/src/supervisor/` |
| Server 路由 | `packages/happy-server/sources/app/api/routes/supervisor*.ts` |
| Server Socket 处理 | `packages/happy-server/sources/app/api/socket/supervisor*.ts` |
| Server 模块 | `packages/happy-server/sources/modules/supervisor*.ts` |
| App 页面 | `packages/happy-app/sources/app/(app)/project/[id]/supervisor-*.tsx` |
| App 组件 | `packages/happy-app/sources/components/project/Supervisor*.tsx` |
| 架构设计文档 | `docs/architecture-project-supervisor.md` |
