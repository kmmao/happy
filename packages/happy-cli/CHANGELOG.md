# Changelog

## 0.100.8 - 2026-06-18

Follow-up dead-code sweep after the 0.100.6/0.100.7 auto-compact cleanup. Scanned every package for `@deprecated`, `legacy`, `TODO: remove`, and similar markers; most were intentional public-API back-compat (e.g. server's `/v1/sessions/:id/restore` alias, wire's legacy message schemas, `CODEX_MCP_LEGACY_BACKEND` fallback) and were left alone. One CLI symbol was actually orphaned:

- **`serverConnectionErrors.ts`** — removed the `@deprecated printOfflineWarning(backendName?)` helper. The function's only callers were its own test suite, the production codepaths had already migrated to `connectionState.fail(...)` for dedup + context tracking, and no other package in the monorepo (or `dist`) referenced the export. Test suite shrank from 28 → 26 cases; the `connectionState` / `logger` imports it pulled in were dropped too.

Companion app-side cleanup (no version bump for the app — single-line alias removal):
- **`packages/happy-app/sources/sync/ops.ts`** — dropped `export const sessionRestore = sessionUnarchive;`. Zero consumers across app/agent/codium/cli, and the `happy-app` rule ("No backward compatibility code ever") makes this a textbook case.

## 0.100.7 - 2026-06-18

Strips the auto-compact cooldown machinery that 0.100.6's hint-only path left orphaned. The cooldown latch, the "auto-compact paused" event, the launcher-side `onCompactNoOp` consumer, the source-conditional `maybeRedeliverStrandedPrompt` branch, the `armCooldown` reducer action — all existed to guard the auto-pushed `/compact` from re-firing into a `/compact/compact/compact…` loop. With the auto-push gone, every one of these branches is unreachable.

- **`apiSession.ts`** — removed `autoCompactCooldownArmed`, `autoCompactCooldownNotified`, `armAutoCompactCooldown()`, `clearAutoCompactCooldown()`, the cooldown-clearing call in `dispatchUserMessage`, the below-threshold hysteresis re-arm, and the "Auto-compact paused — the previous /compact did not reduce context…" one-shot event. Threshold check is now a single straight-line: per-turn latch + replay skip + enabled-flag + ≥ 150K → invoke handler.
- **`claudeRemoteLauncherCore.ts`** — dropped the three `armAutoCompactCooldown()` call sites (post-`compact_boundary`, strand-redeliver skip branch, `onCompactNoOp` consumer), simplified the strand stalled-prompt event to a single unconditional "re-sending your message…" copy (no more `source === "auto-compact"` branch), and trimmed the `inFlightPrompt.source` docstring to drop the auto-compact-specific paragraph.
- **`claudeRemote.ts`** — removed the `onCompactNoOp?: () => void` callback type and the `case "armCooldown"` arm in the turn-end reducer switch. The reducer now produces a single output kind (`emitCompletion`), so the switch collapses to a straight loop.
- **`claudeTurnReducer.ts`** — removed `{ t: "armCooldown" }` from the `ReducerOutput` union and from the turn-end "skipped" path. Comments updated to point at runClaude's hint-only path as the live auto-compact owner.
- **`claudeTurnReducer.test.ts`** — dropped the `armCooldown` expectations in the two "Compaction skipped" test cases. All 8 reducer tests + 12 autoCompact resolver tests + the rest of the 1423-test happy-cli suite still pass.

No behavior change for users — every removed branch was already dead after 0.100.6. The diff is a code-shape cleanup that bounds the auto-compact surface to: ApiSessionClient detects the threshold ↦ `runClaude` formats a hint ↦ `session.sendSessionEvent` ships it to the App. The user runs `/compact` when they're ready.

## 0.100.6 - 2026-06-18

Auto-compact at the 150K (75%) threshold no longer dispatches `/compact` on the user's behalf — it now only surfaces a hint and leaves the actual command to the user. Reported in-the-wild: the queued `/compact` isolate could race an in-flight user input, land mid-typing in the Claude TUI, merge with whatever the user was composing, and silently eat the pending message. Hint-only path removes the collision entirely.

- Stripped the `messageQueue.pushIsolateAndClear("/compact", …)` call (and the dead `EnhancedMode` closure that fed it) from `runClaude.ts`'s `onAutoCompactRequest` handler. The handler now logs + sends a single `session.sendSessionEvent({ type: "message", message: "Context reached XK tokens — consider running /compact to free room." })`.
- The per-turn dedup latch and enabled-flag gate inside `ApiSessionClient` are unchanged, so the AUTO toggle still controls whether the hint fires (off ⇒ 1M premium window with no hint).
- Dead branches that handle `source === "auto-compact"` (cooldown latch, redeliver suppression, stalled-prompt interrupt copy) are intentionally left in place; they are inert without the push and removing them would expand scope into the strand/cooldown machinery for no gain. Worth a follow-up cleanup once the new behaviour ships.
- App-side i18n bumped in parallel: `agentInput.context.autoCompactHintOn` rewritten across all 11 translation files from "Auto-compact on at 75%…" to "Hint to /compact at 75%…" so the chip label matches the new behaviour.

## 0.98.2 - 2026-06-15

Stops the "5 ghost sessions appear at once" effect when the daemon restarts.

- Reworked `AutomationScheduler.recover()` to NOT requeue in-flight jobs at daemon restart. Pre-0.98.2 every in-flight automation job whose `sessionId` couldn't be reattached to a live tracked session was set back to `status="queued"` and `pump()` immediately re-dispatched it, fresh-spawning a new happy process for every iteration. In practice the `recoveredRunningSessionIds` snapshot was taken before the existing child processes had a chance to re-register with the new daemon over webhook, so they were all considered "lost" and we spawned a small flock of duplicates under each loop / supervisor / task row in the workflow list.
- The fallback branch now marks those jobs `cancelled` with `errorMessage = "Cancelled at daemon restart — next scheduler tick will re-trigger naturally"`. `agent_loop` and `supervisor` jobs are picked up by the next cron tick (within minutes). `task` / `webhook` jobs that were genuinely in flight are forfeited at restart, matching the semantics of a server-side crash mid-request.
- Added `AutomationRecoveryResult.cancelledOnRestart` counter (the legacy `requeued` field is preserved as a permanent zero for any external readers). Doctor log line at startup now reports `cancelledOnRestart=...` instead of `requeued=...`.

## 0.98.1 - 2026-06-15

Follow-up to 0.98.0: the `metadata.automationContext` write was wired into the codex / gemini launchers via `createSessionMetadata`, but the **claude launcher** (`runClaude.ts`) builds its own inline `Metadata` literal and never went through that helper — so every claude-flavored automation session (which is the vast majority) was still landing with no `automationContext` field. The App's Workflow IA grouping silently fell through and the sessions appeared in the Ad-hoc tab.

- Extracted `parseAutomationContextEnv()` from `createSessionMetadata.ts` into `utils/parseAutomationContextEnv.ts` so it can be reused.
- Wired `...parseAutomationContextEnv()` into the claude metadata literal in `runClaude.ts` next to the existing optional spreads (worktree, claudeSessionId, …). Terminal-started claude sessions stay unaffected — the spread is a no-op when the env var is absent.
- Verified end-to-end: on the next loop iteration after this build, the spawned happy claude process now stamps `metadata.automationContext = {kind: "agent_loop", loopId, projectId, …}` and the App groups the session under its owning Loop row.

## 0.98.0 - 2026-06-15

Sessions spawned by automation now carry their provenance through to the App's Workflow IA, and the daemon can resume an externally-adopted session on the next trigger.

- Added `metadata.automationContext` to `Metadata` (`{kind, trigger?, projectId?, runId?, loopId?, dedupeKey?}`) and updated `createSessionMetadata` to reconstruct it from the daemon-injected `HAPPY_AUTOMATION_CONTEXT_JSON` env var. Previously, AgentLoop / supervisor / webhook / task sessions all spawned with this context known to the daemon (`SpawnSessionOptions.automationContext`) but it was never written to session metadata, so the App's `useWorkflows()` grouping fell through and every automation-spawned session ended up in the "Ad-hoc" tab.
- Added a new `finalSessionEnv` injection in `startDaemon.spawnSession` that JSON-encodes `automationContext` into `HAPPY_AUTOMATION_CONTEXT_JSON` whenever the spawn carries one. All four automation runners (AgentLoopRunner, supervisor handler, webhook handler, TaskRunner) benefit automatically — no per-runner env wiring needed.
- Wired a `session-adopted` ephemeral handler in `apiMachine` and `startDaemon` (Phase 2 sessionAdopt §A6). When the user binds an existing Session to an automation owner in the App, server pushes this ephemeral to the daemon; the daemon calls `guardianSessionRegistry.rememberByKey({key, projectId, loopId?, sessionId})` so the **next** trigger for that loop/schedule reuses the adopted Session instead of spawning a fresh one. Best-effort: if the daemon is offline at adopt time the view-layer grouping still works (server returns the context to the client), the next trigger just spawns fresh.
- Added `happy issue {create|comment|close}` — a minimal outbound write-back so an Agent that ran inside a loop / webhook trigger session can close the feedback loop on the same Git host that triggered it. Supports both `github.com` and Gitea-style REST APIs (auto-detected from `git remote get-url origin`; override with `--provider`). Tokens come from `GITHUB_TOKEN` / `GITEA_TOKEN` env vars (webhook triggers already inject these) or `--token`.

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
