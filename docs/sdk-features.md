# SDK Feature Capability Matrix

This document describes which features from the official `@anthropic-ai/claude-agent-sdk` are supported per agent backend, and how they flow through the Happy system.

## Feature Support by Agent

| Feature | Claude (SDK) | Codex | Gemini (ACP) |
|---------|:------------:|:-----:|:-------------:|
| **effort** (low/medium/high/max) | Yes | No | No |
| **thinking** (ThinkingConfig) | Yes | No | No |
| **maxBudgetUsd** | Yes | No | No |
| **promptSuggestions** | Yes | No | No |
| **setModel()** hot-swap | Yes | No | No |
| **setPermissionMode()** hot-swap | Yes (non-plan, non-bypass) | No | No |
| **initializationResult()** (model list + capabilities) | Yes | No | No |
| **interrupt()** | Yes | No | No |
| **stopTask()** | Yes | No | No |
| Basic session protocol (messages, tool calls) | Yes | Yes | Yes |
| Permission mode (default/acceptEdits/bypassPermissions/plan) | Yes | Mapped (read-only/safe-yolo/yolo) | Yes |

## Data Flow: SDK → App

```
SDK Option (queryAdapter.ts)
  → Official SDK (claude-agent-sdk)
    → claudeRemote.ts (onMessageReceived / initializationResult)
      → Session Protocol (happy-wire)
        → Server (eventRouter.ts)
          → App (storage + AgentInput.tsx)
```

### effort / thinking / maxBudgetUsd

Set once at query start via `mapOptions()` in `queryAdapter.ts`. Cannot be hot-swapped — changes require a cold restart (detected by `coldModeHash` in `claudeRemoteLauncher.ts`).

### promptSuggestions

- **CLI**: Enabled by default (`promptSuggestions: true` in `claudeRemote.ts`)
- **Protocol**: `{ t: "prompt-suggestion", suggestion: string }` event via happy-wire
- **App**: Extracted from session envelope, displayed as a pressable chip in `AgentInput.tsx`, cleared on user send

### Model Capabilities (supportsEffort, supportedEffortLevels, supportsAdaptiveThinking)

- **Source**: `initializationResult().models[]` from the SDK after session init
- **Forwarded via**: `onInitialized` callback → `updateMetadata()` → App storage
- **App usage**: `AgentInput.tsx` dynamically shows/hides effort selector and thinking toggle based on model capabilities

## Hot-swap vs Cold Restart

| Change | Mechanism |
|--------|-----------|
| Model change | Hot-swap via `setModel()` — no restart |
| Permission mode (default ↔ acceptEdits) | Hot-swap via `setPermissionMode()` |
| Permission mode (to/from plan or bypassPermissions) | Cold restart required |
| effort / thinking / maxBudgetUsd | Cold restart required |
| fallbackModel / systemPrompt / allowedTools / disallowedTools | Cold restart required |

Cold restart detection uses `coldModeHash()` in `claudeRemoteLauncher.ts` to compare the hash of non-hot-swappable fields between turns.

## Key Files

| File | Role |
|------|------|
| `packages/happy-cli/src/claude/sdk/queryAdapter.ts` | Maps adapter options → official SDK options |
| `packages/happy-cli/src/claude/sdk/types.ts` | Adapter type definitions (QueryOptions, etc.) |
| `packages/happy-cli/src/claude/claudeRemote.ts` | SDK session loop with hot-swap and init result handling |
| `packages/happy-cli/src/claude/claudeRemoteLauncher.ts` | Outer loop with cold restart and message forwarding |
| `packages/happy-wire/src/sessionProtocol.ts` | Protocol schema (prompt-suggestion event, etc.) |

## SDK Version

Current: `@anthropic-ai/claude-agent-sdk@0.3.143`

### Version History
- **0.3.143**: Major version bump (0.2→0.3). New exports: `deleteSession()`, `getSessionInfo()`, `getSessionMessages()`, `listSessions()`, `renameSession()`, `tagSession()`, `resolveSettings()`, `startup()`. New `Query` methods: `applyFlagSettings()`, `setMcpServers()`, `reconnectMcpServer()`, `toggleMcpServer()`, `mcpServerStatus()`, `reloadPlugins()`, `seedReadState()`. New Options: `toolAliases`, `tools`, `hooks`, `includePartialMessages`, `sessionId`, `resumeSessionAt`, `skills`, `sandbox`, `sessionStoreFlush`. New message types: `SDKTaskUpdatedMessage`, `SDKRateLimitEvent`, `SDKToolUseSummaryMessage`, `SDKPartialAssistantMessage`, `SDKNotificationMessage`. `EffortLevel` adds `'xhigh'`. New sub-modules: `bridge`, `assistant`, `browser` (not used by happy).
- **0.2.140**: `SDKPermissionDeniedMessage` (auto-denied tool calls), `Query.backgroundTasks()`, hook `args`/`continueOnBlock`, `defaultView` setting
- **0.2.133**: `forwardSubagentText` option for complete subagent conversation flows
- **0.2.119**: `title`, `planModeInstructions`, `sessionStore`, `toolConfig`, model capabilities (`supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`)
