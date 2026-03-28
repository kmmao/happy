# SDK Patch: AskUserQuestion Deferred Tool 修复

## 问题背景

Claude Code SDK 从 `0.2.81` 开始引入了 **deferred tools** 机制，由服务端 GrowthBook 实验标志 (`tengu_defer_all_bn4`) 控制。当该标志开启时，非核心工具（Bash/Read/Edit/Write/Agent/Glob/WebFetch/Skill 以外的工具）会被标记为 deferred，模型需要先调用 `ToolSearch` 获取 schema 后才能使用。

**AskUserQuestion 被错误地纳入了 deferred 范围**，导致模型不再主动调用它，交互式 step tab Q&A 界面完全消失。模型转而使用 `<options>` XML 文本替代。

## 影响版本

| SDK 版本 | 状态 |
|---------|------|
| `<= 0.2.78` | 正常，AskUserQuestion 非 deferred |
| `0.2.81 - 0.2.84` | 异常，AskUserQuestion 被 deferred |
| `> 0.2.84` | 待验证，每次升级需检查 |

## 相关 Issue

- [#35125 — Remote Control renders AskUserQuestion as raw ToolSearch text](https://github.com/anthropics/claude-code/issues/35125) (Open)
- [#33625 — AskUserQuestion shows 'awaiting input' but UI missing](https://github.com/anthropics/claude-code/issues/33625) (Open)
- [#34592 — AskUserQuestion unavailable in sub-agent contexts](https://github.com/anthropics/claude-code/issues/34592) (Open)

## Patch 内容

文件：`scripts/patch-sdk-deferred-tools.cjs`

在 SDK 的 `isDeferredTool()` 函数（minified 为 `RD`）开头插入短路判断：

```javascript
// 原始
function RD(A){if(A.isMcp===!0)return!0;...}

// Patch 后
function RD(A){if(A.name==="AskUserQuestion")return!1;if(A.isMcp===!0)return!0;...}
```

通过 `package.json` 的 `postinstall` 自动执行，每次 `yarn install` 后生效。

## SDK 升级检查清单

每次升级 `@anthropic-ai/claude-agent-sdk` 时：

1. **运行 `yarn install`** — postinstall 会自动执行 patch
2. **检查控制台输出**：
   - `[patch-sdk] Patched isDeferredTool` → 正常
   - `[patch-sdk] Already patched` → 正常（重复执行）
   - `[patch-sdk] WARNING: isDeferredTool signature changed` → **需要更新 patch**
3. **如果签名变化**：
   - 检查新版 SDK 中 `isDeferredTool` 函数是否仍存在
   - 查看上游 issue #35125 是否已修复
   - 如已修复，删除 patch 脚本并移除 postinstall 中的调用
   - 如未修复，更新 `ORIGINAL` 常量匹配新签名
4. **验证**：新建会话，提问需要决策的问题，确认出现 step tab 界面

## 何时移除此 Patch

当以下任一条件满足时，可以安全移除：

- Issue #35125 被标记为 Closed/Fixed
- SDK changelog 明确提到修复了 AskUserQuestion 的 deferred 问题
- 升级后不 patch 也能正常显示 AskUserQuestion step tab 界面

移除步骤：
1. 删除 `scripts/patch-sdk-deferred-tools.cjs`
2. 从 `package.json` 的 `postinstall` 移除 `&& node scripts/patch-sdk-deferred-tools.cjs`
3. 删除本文件
