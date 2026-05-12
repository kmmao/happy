# Changelog

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
