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
| **applyFlagSettings()** hot-swap | Yes | No | No |
| **setMcpServers()** hot-swap | Yes | No | No |
| **listSessions()** / **getSessionInfo()** | Yes | No | No |
| **deleteSession()** / **renameSession()** | Yes | No | No |
| **getSessionMessages()** | Yes | No | No |
| **includePartialMessages** (streaming) | Yes | N/A (native) | N/A (native) |
| **hooks** (lifecycle callbacks) | Yes | No | No |
| **toolAliases** (tool name redirection) | Yes | No | No |
| **sessionId** (explicit session UUID) | Yes | No | No |
| **resumeSessionAt** (positional resume) | Yes | No | No |
| **sessionStoreFlush** (eager/batched) | Yes | No | No |
| **persistSession** (disable persistence) | Yes | No | No |
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

### includePartialMessages (Real-time Streaming)

- **CLI**: Enabled by default (`includePartialMessages: true` in `claudeRemote.ts`)
- **SDK**: Emits `SDKPartialAssistantMessage` (`type: 'stream_event'`) for each API SSE chunk
- **Mapping**: `streamEventMapper.ts` extracts `content_block_delta` events:
  - `text_delta` → `{ t: "text-delta", stream, delta, thinking: false }`
  - `thinking_delta` → `{ t: "text-delta", stream, delta, thinking: true }`
  - Other event types (message_start/stop, content_block_start/stop, input_json_delta) → silently dropped
- **Transport**: Envelopes sent directly via `sendSessionProtocolMessage()`, bypassing the JSONL log pipeline
- **App**: Already renders `text-delta` events (built for Codex/ACP backends); no App changes needed
- **State**: `StreamEventMapperState` assigns unique stream IDs per content block; reset per turn

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
| allowedTools / disallowedTools | Hot-swap via `applyFlagSettings({ permissions })` (SDK 0.3.142+) |
| MCP servers add/remove/toggle | Hot-swap via `setMcpServers()` (SDK 0.3.142+) |
| effort / thinking / maxBudgetUsd | Cold restart required |
| fallbackModel / systemPrompt | Cold restart required |
| hooks / toolAliases | Cold restart required (Options-level, set at query start) |
| sessionId / resumeSessionAt | Cold restart required (session construction) |

Cold restart detection uses `coldModeHash()` in `claudeRemoteLauncher.ts` to compare the hash of non-hot-swappable fields between turns.

### applyFlagSettings()

The `Query.applyFlagSettings()` method (SDK 0.3.142+) merges partial `Settings` into the running session's flag settings layer. Flag settings sit above user/project/local settings and below managed policy settings.

**Integrated hot-swap fields:**

| EnhancedMode field | Settings path | Notes |
|-------------------|---------------|-------|
| `allowedTools` | `permissions.allow` | Permission allow rules |
| `disallowedTools` | `permissions.deny` | Permission deny rules |

**Not hot-swappable** (require cold restart): `thinking`, `effort`, `maxBudgetUsd`, `taskBudget` — these are `Options`-level fields, not `Settings`-level.

The hot-swap is triggered in `claudeRemote.ts` when a new turn arrives with different `allowedTools`/`disallowedTools`. The launcher's `coldModeHash` excludes these fields so they don't trigger a process restart.

**App-side RPC:** The App can also push settings changes directly via `applySettings()` → `claude-control:apply_settings` RPC, which delegates to the same `Query.applyFlagSettings()`. This is used for ad-hoc Settings updates from the sidebar UI.

## MCP Server Management (SDK 0.3.142+)

The SDK provides `Query.setMcpServers()` for hot-swapping MCP server configurations at runtime. Happy wraps this with a dual-write architecture:

1. **Persistent Registry** — KV store via `/v1/mcp/servers` REST API (server-side), accessed through `mcpRegistry` (App-side)
2. **Runtime Hot-load** — RPC via `claude-control:add_mcp_server` / `remove_mcp_server` → `mcpServerManager.ts` → `Query.setMcpServers()`

The protected server (`happy`) cannot be added/removed/overwritten by App RPCs.

| RPC Method | Action | Notes |
|-----------|--------|-------|
| `set_mcp_servers` | Replace all user MCP servers | Full sync from registry |
| `add_mcp_server` | Add single server | Validates transport, merges with existing |
| `remove_mcp_server` | Remove single server | Rejects protected names |

App-side orchestration (`mcpServerOps.ts`) implements persist-then-load: registry write is authoritative, runtime loading is best-effort.

## Hooks (SDK 0.3.142+)

The SDK `Options.hooks` field allows in-process TypeScript callbacks at agent lifecycle points. Happy exposes this through `QueryOptions.hooks` as a transparent pass-through.

**Relationship to RPC:** Hooks and RPC are complementary:
- **Hooks** — in-process, low-latency, synchronous interception (tool auditing, custom stop logic)
- **RPC** — cross-device, network-based, async (App remote control, permission approval)

Currently no built-in hooks are registered by default. The field is available for future extensions (e.g. PostToolUse audit logging, TaskCompleted notifications).

## Key Files

| File | Role |
|------|------|
| `packages/happy-cli/src/claude/sdk/queryAdapter.ts` | Maps adapter options → official SDK options |
| `packages/happy-cli/src/claude/sdk/types.ts` | Adapter type definitions (QueryOptions, etc.) |
| `packages/happy-cli/src/claude/claudeRemote.ts` | SDK session loop with hot-swap and init result handling |
| `packages/happy-cli/src/claude/claudeRemoteLauncher.ts` | Outer loop with cold restart and message forwarding |
| `packages/happy-cli/src/claude/rpc/claudeControlHandlers.ts` | RPC handlers including `apply_settings` → `applyFlagSettings()` |
| `packages/happy-app/sources/sync/apiClaudeControl.ts` | App-side RPC client for claude-control methods |
| `packages/happy-cli/src/claude/utils/streamEventMapper.ts` | SDK stream_event → text-delta session protocol mapping |
| `packages/happy-cli/src/claude/utils/applyFlagSettings.ts` | Unified entry for `applyFlagSettings()` with state tracking |
| `packages/happy-cli/src/claude/utils/settingsParser.ts` | Whitelist-based settings validator for App RPC |
| `packages/happy-cli/src/claude/utils/mcpServerManager.ts` | MCP server lifecycle (validate, add, remove, sync) |
| `packages/happy-wire/src/mcpRegistry.ts` | MCP registry schemas and helpers |
| `packages/happy-wire/src/sessionProtocol.ts` | Protocol schema (prompt-suggestion event, etc.) |
| `packages/happy-server/sources/app/api/routes/mcpServerRoutes.ts` | Server REST API for MCP server registry CRUD |
| `packages/happy-app/sources/sync/mcpRegistry.ts` | App-side MCP registry manager (cache + REST API) |
| `packages/happy-app/sources/sync/mcpServerOps.ts` | App-side dual-write orchestration (persist + hot-load) |
| `packages/happy-app/sources/sync/apiMcpServers.ts` | App-side REST client for `/v1/mcp/servers` |

## Session Management (SDK 0.3.143+)

The SDK exports standalone functions for managing session JSONL files on the local filesystem. These are exposed via `claude-control:` RPC so the App can browse, rename, and delete CLI-side sessions remotely.

| RPC Method | SDK Function | Needs Query? | Notes |
|-----------|-------------|:------------:|-------|
| `list_sessions` | `listSessions()` | No | Paginated, optional dir filter |
| `get_session_info` | `getSessionInfo()` | No | Returns null if not found |
| `delete_session` | `deleteSession()` | No | **Destructive** — permanent |
| `rename_session` | `renameSession()` | No | Sets `customTitle` in JSONL |
| `get_session_messages` | `getSessionMessages()` | No | Paginated, optional system messages |

**Important:** These operate on the SDK's local JSONL session files, NOT on Happy server sessions. The `targetSessionId` parameter refers to the Claude Code session UUID, which is separate from the Happy session ID used for transport.

App-side client functions are in `apiClaudeControl.ts`:
- `listRemoteSessions(sessionId, options?)` — list all CLI sessions
- `getRemoteSessionInfo(sessionId, targetSessionId)` — get one session's info
- `deleteRemoteSession(sessionId, targetSessionId)` — delete a session
- `renameRemoteSession(sessionId, targetSessionId, title)` — rename a session
- `getRemoteSessionMessages(sessionId, targetSessionId, options?)` — read messages

## SDK Version

Current: `@anthropic-ai/claude-agent-sdk@0.3.143`

### Version History
- **0.3.143**: Major version bump (0.2→0.3). New exports: `deleteSession()`, `getSessionInfo()`, `getSessionMessages()`, `listSessions()`, `renameSession()`, `tagSession()`, `resolveSettings()`, `startup()`. New `Query` methods: `applyFlagSettings()`, `setMcpServers()`, `reconnectMcpServer()`, `toggleMcpServer()`, `mcpServerStatus()`, `reloadPlugins()`, `seedReadState()`. New Options: `toolAliases`, `tools`, `hooks`, `includePartialMessages`, `sessionId`, `resumeSessionAt`, `skills`, `sandbox`, `sessionStoreFlush`. New message types: `SDKTaskUpdatedMessage`, `SDKRateLimitEvent`, `SDKToolUseSummaryMessage`, `SDKPartialAssistantMessage`, `SDKNotificationMessage`. `EffortLevel` adds `'xhigh'`. New sub-modules: `bridge`, `assistant`, `browser` (not used by happy).
- **0.2.140**: `SDKPermissionDeniedMessage` (auto-denied tool calls), `Query.backgroundTasks()`, hook `args`/`continueOnBlock`, `defaultView` setting
- **0.2.133**: `forwardSubagentText` option for complete subagent conversation flows
- **0.2.119**: `title`, `planModeInstructions`, `sessionStore`, `toolConfig`, model capabilities (`supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`)
