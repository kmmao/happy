# Changelog

## 0.97.2 - 2026-06-15

Progress lists no longer accidentally merge unrelated TaskCreate batches into a single chip.

- Fixed `TaskMirrorState` indefinitely accumulating every `TaskCreate`/`TaskUpdate` it had ever seen — Claude Code (Opus 4.6+) keeps completed runtime tasks alive across turns, so the mirror's emitted todo set grew without bound. The downstream Jaccard overlap check in `applyHappyProgressUpdate` then saw near-full overlap on every emit and silently appended new-topic tasks to the prior progress list (visible in the App as one chip containing 24 items from 8+ unrelated work sessions).
- Added a batch-freeze hook: when a fresh user prompt arrives (no `tool_use_result`, no `tool_result` blocks) and every live task is already `completed`, freeze the current batch. Frozen entries are excluded from `getTodos()` / `hasTasks()` and `TaskUpdate` no-ops on them, so the next `TaskCreate` emits only fresh items and the existing boundary detector archives the prior list and starts a new one. Same-topic continuations (complete A → create B inside one turn) still merge — the freeze only fires at turn boundaries.

## 0.88.1 - 2026-06-02

Three more Claude Code 2.1.x hook events wired through the hook server, with tool-permission denials surfaced to the App.

- Subscribed `InstructionsLoaded`, `PermissionDenied`, and `PostToolBatch` in the generated `--settings` hook block. Event names and payload shapes were verified against Claude Code 2.1.157's `HookEvent` / `*HookInput` types; the payload interfaces are hand-mirrored (snake_case on the wire) with **no** `@anthropic-ai/claude-agent-sdk` dependency — the CLI drives Claude via PTY. The hook server's typed dispatch table routes each event by name; `InstructionsLoaded` and `PostToolBatch` are logged only for now.
- Surfaced `PermissionDenied` through `session.metadata` (no new wire envelope): `recentPermissionDenials` keeps a head-deduped ring buffer (capped at 10) of tool calls that Claude's own permission system denied — distinct from Happy's MCP-driven approval prompts in `agentState`. The App renders these as a "Recent Permission Denials" list on the Session Info screen.

## 0.87.0 - 2026-05-31

Claude Code 2.1.x hook surface — happy now subscribes to four new session-state hooks and tightens the existing two-hook injection. Sessions started against Claude Code 2.1.121+ will surface live working-directory changes, file activity, and Claude-managed worktree events all the way through to the App; older CLIs ignore the extra hook keys and keep working unchanged.

- Subscribed `CwdChanged` (2.1.121+), `FileChanged` (2.1.121+), `WorktreeCreate` and `WorktreeRemove` (2.1.157+) in the generated `--settings` hook block. The hook server's dispatch table was rewritten with typed payloads — previously every event except `StopFailure` silently fell through to the `SessionStart` handler and could quietly poison the session id; now each known event has a dedicated route and unknown events still fall through for forward compat.
- Surfaced the new hooks through `session.metadata` (no new wire envelope): `activeCwd` reflects the live cwd, `lastWorktreeEvent` records the most recent worktree create/remove, and `recentFileChanges` keeps a head-deduped ring buffer (capped at 20) so autosave bursts can't blow up the encrypted metadata payload.
- Switched the hook injection itself to Claude Code 2.1.139+ exec form `{command: "node", args: [...]}`. The old shell-string form `"node \"<path>\" <port>"` worked but was vulnerable to misparsing whenever the forwarder path contained spaces, quotes, `$()`, backticks, or semicolons. The new form runs `execvp` directly with no shell.
- Marked happy's own MCP servers (`happy`, `happy-knowledge`) with `alwaysLoad: true` (Claude Code 2.1.121+). This opts them out of tool-search deferral so the App's permission prompts and sync tools stay attached when Claude reloads its tool set across `/clear`, plan-mode swaps, or skill activations. Older CLIs ignore the field.

## 0.86.11 - 2026-05-30

Consistent turn and subagent lifecycle across Claude and Codex sessions.

- Unified the Turn/Subagent lifecycle that had silently drifted between the Claude and Codex session protocols into a single shared reducer, so both providers now open turns, start subagents exactly once, and close turns identically.
- A turn that ends (or a session that aborts mid-stream) now always stops any still-active subagent first, so the App no longer shows a dangling subagent after the turn is over.

## 0.86.0 - 2026-05-26

Reliability and performance improvements for PTY-mode (remote) Claude sessions, plus a richer context-usage panel and an optional deep MCP health check.

- Subagent (Task/Agent) tool results now surface within tens of milliseconds instead of waiting up to 15s — each session's `subagents/` directory gets its own file watcher, so incremental subagent log writes no longer depend on the periodic poll.
- More robust plan-mode auto-approval in Yolo/bypass mode: the ExitPlanMode picker is now detected from the terminal's current screen snapshot (not just future output), so a picker already on screen before detection starts is approved immediately rather than via the blind 2s fallback.
- Reduced CPU/IO on long sessions: the session scanner now incrementally parses only newly appended log bytes (tracking a per-file byte offset and buffering any half-written trailing line) instead of re-reading and re-validating the whole file on every update.
- Context-usage panel now breaks the conversation into three buckets — Cached context, Cache write, and New input — derived from the model's own token-usage fields, replacing the single "Conversation" bucket.
- Added an optional deep MCP status probe: set `HAPPY_MCP_HANDSHAKE_PROBE=1` to verify stdio MCP servers with a real `initialize` JSON-RPC handshake (timeout via `HAPPY_MCP_HANDSHAKE_TIMEOUT_MS`, default 3s) instead of only PATH-resolving the command. A successful handshake is cached for 5 minutes; a failed or timed-out handshake degrades to the PATH-resolve result. Off by default.

## 0.78.0 - 2026-05-13

Upgraded Claude Agent SDK and added background tasks support.

- Upgraded `@anthropic-ai/claude-agent-sdk` from 0.2.133 to 0.2.139
- Added `SDKPermissionDeniedMessage` type export for auto-denied tool call events
- Added "Move to background" button in App input bar (visible during thinking/waiting state), allowing users to convert foreground Bash commands and subagents to background tasks via `Query.backgroundTasks()` — equivalent to Ctrl+B in the CLI
- Registered `backgroundTasks` RPC handler for remote control from App

## 0.71.39 - 2026-04-18

- Added per-list file change attribution: Edit/Write/MultiEdit/NotebookEdit tool calls now record their `tool_use.id` into the currently active progress list's `toolCallIds`. The App can render a per-list file change summary (file count, edits, line adds/deletes) that matches the existing side panel "代码" tab style, so users can see which tab touched which files. Requires `@kmmao/happy-wire@^0.11.9`.

## 0.71.38 - 2026-04-18

- Fixed auto-mirror TodoWrite list boundary detection: now reads SDK-native `oldTodos`/`newTodos` from `user.tool_use_result` instead of `assistant.tool_use.input.todos`. New lists are detected by content-set intersection (zero overlap = new list) rather than the old `priorAllDone` gate, so starting a brand-new topic while the previous list still has in-progress items correctly archives the old list (preserving its un-completed state) and opens a fresh one.
- Auto-mirror now refreshes list label when the first todo content changes (previously label stayed frozen on first creation, causing stale chip titles).
- `verificationNudgeNeeded` from SDK is now carried into `metadata.progress.lists[].todos[].verificationNudgeNeeded` so the App can surface verification prompts.

## 0.56.1 - 2026-04-03

- Fixed machine WebSocket RPC: register `bootstrap-profile-*` handlers so the mobile app can list/create/update Bootstrap profiles (was returning `RPC method not available`).

## 0.44.4 - 2026-03-21

- Fixed session restore causing messages to become unresponsive and cleared after 10 minutes

## 0.44.2 - 2026-03-20

- Fixed multiple supervisor loop issues

## 0.44.1 - 2026-03-19

- Fixed security issue: prevent remote users from extracting model config and API keys
- Updated dotenv from 16.x to 17.x
- Pinned claude-agent-sdk to exact version

## 0.44.0 - 2026-03-19

- Added Supervisor Loop Mode (autopilot analyze→fix→re-analyze cycles)
- Extracted shared supervisor utils with concurrency limits for fix/analysis sessions

## 0.43.0 - 2026-03-18

- Added preflight sync before supervisor analysis/research
- Fixed retry session spawn during build to prevent dist/ race condition

## 0.42.6 - 2026-03-17

- Replaced console.log with logger in CLI daemon-context code

## 0.42.5 - 2026-03-17

- Research actions now verified against codebase before creation

## 0.42.4 - 2026-03-16

- Research reports now generate actionable tasks

## 0.42.2 - 2026-03-16

- Fixed cold-restart on context window tier change (200K ↔ 1M)
