# Changelog

## 2.41.0 - 2026-06-17

The Caveman skill badge above the input is now always visible so you can toggle the skill on or off from any device — previously it only appeared after Caveman was already active, which made the off→on direction invisible from the App.

### Caveman skill toggle
- Added an always-on Caveman badge next to the connection status. Inactive state renders as a hollow capsule with a `textSecondary` outline; active state fills with `theme.colors.success` (green) so the mode is unmistakable at a glance.
- Improved the press behavior to be bi-directional: pressing the badge while inactive sends `/caveman` straight through (no confirm — enabling has no side effects), while pressing it while active still shows the existing confirm modal before sending `stop caveman`.

## 2.40.2 - 2026-06-17

### Context window control
- Fixed the AUTO/1M toggle disappearing when the input box was expanded. The expanded view uses a different progress component (`ContextProgressBar`) which 2.40.1 didn't reach — wire the same toggle there too so the chip is reachable in both collapsed and expanded states.

## 2.40.1 - 2026-06-17

### Context window control
- Fixed the new AUTO/1M toggle being hidden until usage crossed 90%. The chip was nested inside the existing "low-context warning" block, so on a fresh session it never appeared. The toggle now renders unconditionally next to the context-usage area whenever the session is autoCompact-aware, while the percentage label still respects the previous "show when ≤ 10% left or settings opt-in" rule.

## 2.40.0 - 2026-06-17

Standalone "Make Recurring" now forces you to pick a project before the schedule can be saved — previously, leaving it blank quietly sent `projectId=null` to the server, which fell back to a literal `~` directory string and created a `./~/` folder on the daemon's working directory. Cron-fired sessions now land in the right place.

### Recurring schedules
- Added a project picker to the standalone Make Recurring modal, cascading off the machine pick. Submit is blocked until you pick a project so the cron runner never falls back to the wrong directory.
- Fixed the server-side fallback for legacy / third-party schedules with no `projectId`: the runner now uses `os.homedir()` instead of the literal string `"~"`, so existing rows that still slip through stop creating `./~/` folders on the daemon host.

## 2.39.0 - 2026-06-17

A new AUTO/1M toggle next to the context-usage chip in the session header lets you choose between the 200K compress mode (default, with happy auto-pushing `/compact` at 75% usage) and the full 1M premium context. The toggle is per-session, takes effect on the next user message, and rides a streamlined cold-restart path so the switch is seamless even on large sessions.

### Context window control
- Added an AUTO/1M toggle next to the context-usage chip. AUTO (default) keeps Claude at the 200K window and auto-runs `/compact` at 150K tokens (75%) so the session never hits the wall. Tap to switch to 1M premium context — happy stops auto-compacting and the TUI's own ~80% compact takes over.
- Improved the cold-restart path that fires when you flip the toggle (or trigger any model/mode swap): a 5s grace window after the new PTY spawns no longer mistakes Claude TUI's `--resume` history replay for a real first response, so a stalled session is detected at 45–90s instead of 138s and the original prompt is auto-redelivered.

### Stability
- Fixed a class of "No response for 138s" freezes after plan-mode `ExitPlanMode` or slash commands like `/deploy-server`. Lost continuation prompts now re-deliver automatically instead of disappearing silently.

## 2.38.0 - 2026-06-12

Picker alerts now reach you on web: when Claude's terminal blocks on a numbered picker or fires a notification, the web app raises a native browser notification, and blocked sessions are highlighted directly in the sessions list on every platform.

### Picker & notification alerts
- Added native browser notifications on web for terminal picker prompts and notification signals — switch tabs freely; you'll still know when a session needs your input.
- Added an in-page highlight for session rows whose terminal is blocked on a picker, on all platforms.

### Stability
- Improved the chat rendering pipeline — message visibility filtering, duplicate-diff cleanup and tool-call grouping now run through one shared, fully tested module.
- Improved the data-sync layer: server-driven state updates are now strictly separated from local UI mutations, preventing a class of state-consistency bugs.

## 2.37.0 - 2026-06-12

Session subtitles now show what Claude is doing in real time. PTY-mode sessions stream their TUI status surface (spinner verb, elapsed time, token counter, progress) to the app, so you can see "Reasoning… · 12s · 1.2k tokens" at a glance without opening the raw terminal — across the main sessions list, recent sessions, machine detail, and the chat header.

### Live session status
- Added a live TUI status line for running sessions — the spinner verb, elapsed seconds, output-token counter and progress percentage from Claude's terminal now replace the static path/title in session subtitles while a turn is running, and fall back automatically when it ends.
- Added a notification when Claude's terminal is blocked on a numbered picker waiting for keyboard input — the banner shows the captured prompt so you know to open the raw terminal and answer.
- Added ConEmu-style progress reporting (OSC 9;4): determinate progress from hooks/builds is tracked per session and shown as a percentage in the live status line.
- Added the same live status line to the chat header — while running, the subtitle switches from `Process ID · cwd` to the live activity line.

### Session panel
- Fixed the Claude tab not rendering in the mobile session panel sheet.

### Models
- Added end-to-end support for Claude Fable 5 (claude-fable-5).

### Stability
- Reworked the sync update ingest pipeline into a single seam (ADR-0026) for more predictable live-message handling.

## 2.36.8 - 2026-06-09

Small readability fix for the Footprint panel: long tool names in the operation-mix legend were being cut off with an ellipsis (e.g. `mcp__codegraph__c...`, `mcp__happy__chang...`), so users couldn't tell which MCP tool a colored segment actually represented.

### Footprint panel
- Fixed long tool names being truncated in the operation-mix legend. Removed the `numberOfLines={1}` + `maxWidth: 120` constraints on legend entries; long names like `mcp__codegraph__codegraph_files` or `mcp__happy__change_title` now render in full. The legend container already wraps, so longer entries simply flow to the next row instead of crowding a single line.

## 2.36.7 - 2026-06-09

Closed the last UX gap from the post-2.36.5 review: the queue-preview overlay used to stay open showing a stale snapshot when the user explicitly drained the previewed item from outside the overlay (chip ▶ or header "Send now" pill). 2.36.5 had removed the auto-close-on-vanish effect to stop it from wiping in-progress edits during auto-dispatch — but that left explicit user actions also unhandled. This release threads that needle.

### Queued messages
- Fixed the chip ▶ button leaving the preview overlay open when it targets the same item the user is previewing. The chip ▶ explicitly reorders that item to the front and interrupts the AI to drain it next, so the overlay now closes too. Chip ▶ on a DIFFERENT item leaves the preview alone (you're not draining that item).
- Fixed the queue-banner "Send now" pill leaving the preview overlay open when it would drain the previewed item. The pill drains the queue head; if the previewed item is currently at the head, the overlay closes. Items further back in the queue do not trigger a close.
- Kept V6's no-auto-close behavior for the auto-dispatch effect itself — auto-dispatch shifting an item still leaves the overlay open (so in-progress edits are not silently wiped). Only EXPLICIT user actions on a drain-this-item path close the overlay.

## 2.36.6 - 2026-06-09

Closed two correctness gaps in the queued-message "Save & Send" path that the post-2.36.5 review caught: a multi-send race with the auto-dispatch effect, and a silent message-loss path when the send pipeline rejected after the item had already been removed from the queue.

### Queued messages
- Fixed a race where "Save & Send" on one queued item could also silently ship the NEXT queued item. The handler now sets the auto-dispatch in-flight gate (and arms the same 15 s safety-net timer the dispatch effect uses) BEFORE interrupting the running session or sending — so the dispatch effect can't slip in during the interrupt-ack window and fire the next item.
- Fixed silent message loss when the underlying send pipeline rejected after the item was removed from the queue. The item is now removed only AFTER `sync.sendMessage` confirms it accepted the message; on rejection or throw the item is kept in the queue, the dispatch gate is released, and an alert tells the user the send failed so they can retry.
- Changed `sync.sendMessage` to return `Promise<boolean>` (was `Promise<void>`). `true` = message entered the local pipeline (queue or outbox); `false` = no progress was possible (missing encryption / session). Existing callers that ignored the return value continue to work unchanged.

## 2.36.5 - 2026-06-08

Cleaned up the remaining edge cases in the queued-message editor that surfaced in the post-2.36.3 code review. Editing now round-trips file attachments without losing their filename hint, the preview re-renders saved content immediately instead of showing the pre-edit snapshot, and Save / Save & Send no longer fail silently when the item gets auto-dispatched out from under the user.

### Queued messages
- Fixed the edit overlay showing pre-save content after a successful Save. The parent now refreshes the previewed item with the saved message + image count + display-text so preview mode, re-entering edit, and the Cancel button all see the latest state.
- Fixed Save & Send being silently swallowed when the item had already been auto-dispatched. The Save / Save & Send callbacks now return a boolean; on `false` the overlay surfaces the "this message has already been sent" banner and stays open instead of animating closed with no feedback.
- Fixed Save & Send doing nothing when the queue was paused. It now pops the edited item out of the queue and sends it directly (bypassing both the pause flag and the auto-dispatch effect), since the user's explicit intent should win over a queue-wide pause.
- Fixed file-attachment filename hints being permanently stripped on edit round-trip. `[image: /path | filename.pdf]` previously parsed to just `/path` and re-serialised without the filename; segments now carry the optional filename and emit it verbatim.
- Fixed the Save / Save & Send buttons silently no-op'ing when the edit had no text and no images. The buttons are now disabled (dimmed) when the edit is empty, so the failure state is visible.
- Fixed the overlay closing mid-edit when auto-dispatch shifted the item being edited. The auto-close-on-vanish effect is gone; the overlay stays open and surfaces a stale-error if the user tries to save against a now-missing item. Explicit cancel (chip ×) still closes the overlay.
- Fixed leftover internal state (stale error, edit buffers) bleeding across items. The overlay now remounts cleanly when the user opens a different queued item (keyed on localId).
- Fixed inner chip action buttons (✏️, ▶, ×) also opening the preview overlay on web. The inner Pressables now stop propagation so the outer chip's tap handler doesn't fire too.

## 2.36.4 - 2026-06-08

Closed the remaining "two rapid sends still burst onto the wire" gap from 2.36.3. The composer's onSend (and the floating-option / bookmark senders) used to take a fast path that called sync.sendMessage directly when isRunning was false, bypassing the queue entirely. Two taps inside the ~50 ms window before the server pushed back `running=true` would both take that fast path. Now every send funnels through the queue and the auto-dispatch effect is the only thing that calls sync.sendMessage, so the race is unrepresentable.

### Queued messages
- Fixed all user-initiated send paths (input bar, floating option, bookmark) to always enqueue instead of branching on isRunning. The auto-dispatch effect drains one-at-a-time; the visible "queued chip" flash when the AI is idle is at most one render tick.
- Fixed a duplicate-localId race where sync.sendMessage's internal "session is running → re-enqueue" guard would push the just-shifted item right back into the queue with the same localId, and the dispatch effect would then try to send the duplicate. Auto-dispatch now passes a local-only `bypassRunningCheck` flag so the guard only applies to user-initiated sends.
- Fixed the auto-dispatch safety-net timer being silently cleared by every effect re-run during an in-flight dispatch. The 3 s timer was returned from useEffect; React's cleanup cleared it on the very next length-change. Now the timer is held in a ref so it survives re-runs, is cleared only when `isRunning` truly rises (or the component unmounts), and is bumped to 15 s.

## 2.36.3 - 2026-06-08

Polished the queued-message bar that appears while the AI is busy: queued items now drain one-at-a-time (a race that could fire several at once after an interrupt is fixed), each item can be edited in place before it sends, and image-bearing messages get a clear camera badge plus a cleaner preview sheet.

### Queued messages
- Fixed a dispatch race where two or more queued messages could be sent back-to-back as soon as the AI went idle. The auto-dispatcher now waits for the AI to actually enter the running state before releasing the next item, with a 3-second safety fallback if the dispatch never lands (offline / rejected).
- Added a "Pause queue / Resume" toggle in the queue banner header. When paused, queued items stay put even after the AI becomes idle — the user has to use the chip ▶ button or the header "Send now" to release them one at a time.
- Added in-place editing for queued items. Each chip now has a ✏️ button, and the preview sheet has an Edit toggle. You can rewrite the text and remove individual images before the message goes out; "Save" updates the queued item, "Save & send" jumps it to the front and triggers an interrupt. Edits that race with auto-dispatch surface a friendly "already sent" notice.
- Improved how queued messages are labelled. Items containing images now show a small camera badge (with a count for multi-image messages) and the original text preview together, instead of being silently replaced by "Sent an image". Messages that are images only still get the synthesised label, but rendered in the accent color.
- Improved the preview sheet layout — multi-image messages render as a 2-column grid, text segments get a left accent bar so they're easier to scan, and the header now shows quick "N images · M chars" metadata.

## 2.36.2 - 2026-06-05

Tightened the chat header by folding Claude's live working directory into the existing "Process ID" subtitle line, so what used to be a faint third row is now part of a single subtitle like `Process ID 99118 · gs-frontend`. The cwd label is now always shown — including when Claude is still in the directory you launched from — so you can see "where am I" at a glance without an extra row stealing vertical space.

### Chat header
- Improved chat header layout — folded the live working directory into the existing Process ID line as `Process ID N · <cwd>`, removing the dedicated third row introduced in 2.36.0. Saves one row of vertical space on every session screen.
- Improved cwd display to always render something when path data is available — falls back to the launch directory's basename (e.g. `gs-frontend`) when Claude has not moved out, instead of hiding the label entirely. When Claude has moved, you still see the compact relative form (`./src/app` for subdirs, `…/parent/name` for siblings).
- Improved long-subtitle handling — `Process ID · cwd` tail-truncates inside the header subtitle's single line; the underlying chip components removed in this change are no longer rendered above the chat content.

### Behind the scenes
- Added `formatSessionCwdLabel` helper alongside the existing `formatActiveCwd` — picks the best label across activeCwd / launchPath with a strict basename fallback so callers always get a short, render-safe string. Covered by 18 unit tests (10 existing + 8 new) for POSIX / Windows / sibling / missing-path cases.
- Removed the `SessionCwdBadge` component and `launchPath` / `activeCwd` props from `ChatHeaderView` — the header is now strictly two-line (`title` + `subtitle`), and the cwd composition lives where the rest of the subtitle is built (in `SessionView.tsx`).

## 2.36.1 - 2026-06-03

Fixed a Web-only paste bug where the input box still pasted the previous screenshot — even though the OS clipboard already held the newer one — when you took a screenshot in another app and immediately switched back to the browser to paste.

### Chat input
- Fixed pasted images sometimes being the previous screenshot on Web. Chrome's OS-clipboard sync runs asynchronously after the page regains focus, so both `e.clipboardData` and an immediately-issued `navigator.clipboard.read()` can return the stale snapshot. The paste handler now waits a brief tick before reading and retries once if the first read returns a blob the exact size of the synchronous fallback (a strong stale-snapshot signal), so the newest screenshot lands in the input even when you switched windows fast.

## 2.36.0 - 2026-05-31

Sessions running against Claude Code 2.1.121+ now surface live workspace activity right in the chat — you can see when Claude has moved out of the directory you launched it from, what worktrees it has spun up, and which files it has touched recently, all without leaving the session.

### Voice
- Removed the LiveKit realtime voice backend, the BYOK LiveKit Cloud configuration UI, and the `voice-agent` Docker service. ElevenLabs is now the only realtime voice backend — voice settings drop the backend picker and surface ElevenLabs configuration directly.

### Chat header
- Added a third faint header line that shows Claude's live working directory whenever it differs from the directory the session was launched in — collapsed as `./relative` when Claude has just `cd`-ed inside the project, or `…/parent/name` when it has wandered elsewhere on disk. Older Claude Code CLIs that don't emit the `CwdChanged` hook leave the header at its original two lines.

### Session Info
- Added a "Worktree Activity" section that records the most recent Claude-managed worktree create/remove event with a relative timestamp and color-coded icon. Coexists with the existing Happy-managed Worktree Info section above it — these are now two distinct flavors of worktree state.
- Added a "Recent File Changes" section that lists Claude's last few file touches (added / modified / deleted) with per-event icons and a relative timestamp. Capped at ten visible rows; the underlying ring buffer holds up to twenty.

### Behind the scenes
- Subscribed the CLI to four new Claude Code session-state hooks (`CwdChanged`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`) and surfaced them through `session.metadata` so no new wire envelope was needed — see happy-coder 0.87.0 for the full hook-server rewrite.
- Switched the CLI's `--settings` hook injection to Claude Code 2.1.139+ exec form (`{command, args[]}`) so a forwarder script path with spaces, quotes, or shell metacharacters can no longer break or smuggle through the shell.
- Marked Happy's own MCP servers as `alwaysLoad: true` so the App's permission prompts and sync tools stay attached when Claude reloads its tool set across `/clear`, plan-mode swaps, or skill activations.
- Lifted the timeline's relative-time helper into a shared utility (`formatTimeAgo`) so future surfaces can reuse the same buckets and translation keys.

## 2.35.0 - 2026-05-30

Adds an experimental "Session Fork & Duplicate" feature that lets you branch a chat from any of your earlier prompts, plus a perf pass across sidebar / streaming / code-changes views, the new Opus 4.8 model option, and a faster Web build served from production nginx instead of dev metro.

### Session Fork & Duplicate (experiment)
- Added an Experiments setting "Session Fork & Duplicate" — when on, every user message in your chats becomes a possible rewind point
- Added long-press on your own messages to instantly fork a new session truncated at that point
- Added a "Duplicate from message…" entry on Session Info that opens a picker listing all your earlier prompts so you can pick any rewind anchor without scrolling the chat
- Added a fork badge in the chat header on forked sessions — tap it to jump back to the source

### Models
- Added Opus 4.8 model option across the model picker (App / CLI / Codium)

### Streaming and rendering
- Improved Skill tool arguments — they now render as proper Markdown instead of raw JSON
- Improved SidePanel performance during streaming — fewer wholesale re-renders during heavy chat traffic
- Improved Timeline page with FlatList virtualization so very long timelines stay responsive
- Improved Session "Code changes" view (both legacy and Codex variants) with FlatList virtualization

### Sidebar performance
- Fixed the sidebar re-rendering its whole visible window on every navigation — the data array is now stable across pathname changes, only the previously and newly selected rows re-render
- Fixed a rules-of-hooks violation in the sidebar that would have crashed if the tablet / non-tablet branch ever flipped at runtime

### Recovery
- Added a "Restart Session" button on the Stop Failure banner so you can recover from a failed turn without leaving the chat

### Behind the scenes
- Updated the Anthropic SDK to 0.100 in the CLI (happy-coder 0.86.12) — picks up Opus 4.8, the thinking-token-count beta, mid-conversation system blocks, and the new cache diagnostics path
- Added Claude message UUID plumbing through the wire envelope so the fork picker can target the exact Claude message you tapped
- Added smart push notification routing on the server — when you already have the app open on another device, supervisor notifications skip the push and rely on realtime updates instead
- Improved CLI SessionStart hook handling — a hook's sessionTitle output now surfaces in the App sidebar without a manual rename
- Released @kmmao/happy-wire 0.24.0 and @kmmao/happy-agent 0.7.2 to carry the new fork-anchor field through to all clients

### Web build
- Web app now ships from a production nginx container (expo export) instead of the dev metro process — faster first paint and more reliable through unstable network conditions

## 2.34.1 - 2026-05-28

Fixes a remaining case where a question or permission option card could still appear above the assistant text that introduced it, when the card and the conclusion arrived in separate streaming batches (common in PTY/Yolo mode).

### Chat ordering
- Fixed AskUserQuestion and permission cards still rendering above the assistant's conclusion when the card was created in an earlier batch and the prose only arrived later — the card is now re-anchored to the latest preceding text instead of being anchored only once at creation time
- Fixed the chat list not re-sorting after such a re-anchor — the reducer now signals storage to rebuild message order, because the incremental fast-path could not observe a timestamp change on an already-existing message

## 2.34.0 - 2026-05-28

Adds App Lock — an optional PIN or biometric gate that keeps this device's app contents private. It's a local privacy deterrent: the PIN only controls access to the app's UI on this device and never touches your account's end-to-end encryption keys.

### App Lock
- Added App Lock, enabled from Settings → App Lock (mobile only): require a 6-digit PIN, with optional Face ID / Touch ID / fingerprint unlock
- Added a configurable re-lock timeout (Immediately / 30s / 1m / 5m / Never) — "Never" keeps the app unlocked in the background, but a cold start still requires the PIN
- Added a manual "Lock now" action to lock the app on demand
- Added escalating cooldowns after 5 failed PIN attempts (30s → 1m → 5m) with no data wipe
- Added a "Forgot PIN?" path that resets the lock by logging out and back in — there is no backdoor
- Added an app-switcher mask so the app contents are hidden in the recent-apps preview while locked
- Improved privacy by storing only a salted SHA-256 hash of the PIN in the device secure store; the lock settings stay device-local and are never synced

## 2.33.2 - 2026-05-26

Fixes the question/permission option card rendering above the assistant text that introduced it. The conclusion now always comes first, with the choices below it, matching natural reading order — both when the text and its tool call share a timestamp and in PTY/Yolo mode where the picker request carried an earlier timestamp.

### Chat ordering
- Fixed AskUserQuestion and permission option cards appearing above the assistant message text — when the text and the card it spawns share a timestamp, the tie-breaker now keeps the text on top in the inverted chat list
- Fixed the `ask_user` picker in PTY/Yolo mode jumping above the assistant's analysis — its request timestamp could predate the surrounding prose, so the card is now anchored to render at or below the latest preceding text
- Improved message-ordering maintainability by extracting the stable comparator into a dedicated `messageOrdering` module covered by unit tests

## 2.33.1 - 2026-05-26

Web crashes now survive a reload. The error boundary saves every crash to local storage and replays it into the in-app dev logs on the next launch, so render errors are no longer wiped the moment you tap Reload.

### Crash diagnostics (web)
- Added crash persistence to the web error boundary — render errors, uncaught errors, and unhandled promise rejections are now saved to local storage (last 10, ring-buffered), not just an in-memory log that the reload cleared
- Improved post-crash debugging: persisted crashes are automatically replayed into the dev logs page on the next launch, including the error message and the component/error stack
- Added `window.__happyCrash.dump()` and `window.__happyCrash.clear()` console helpers to inspect or reset the saved crash trail

## 2.33.0 - 2026-05-25

Brings the History tab's commit-file view in line with the Changes tab — the same diff/file layout with collapsible hunks, side-by-side line numbers, and inline syntax highlighting — and fixes opening commit files whose names contain non-ASCII characters.

### Git history & diffs
- Improved the commit-file diff to share the Changes-tab renderer: stats header, collapsible hunks, side-by-side line numbers, and inline syntax + diff highlighting
- Added an in-panel commit-file diff in the side panel, with a back button instead of full-screen navigation
- Fixed opening a commit file whose name contains non-ASCII characters (Chinese, accents, emoji) — tapping it no longer fails to open the diff
- Fixed loading commit diffs for files whose names contain special characters

### Markdown
- Fixed Mermaid diagram text being invisible — node labels now render as SVG `<text>` instead of HTML inside `<foreignObject>`, which the SVG sanitizer was stripping
- Fixed Mermaid diagrams with poor contrast — switched to the light theme on a white card so node text, arrows, and custom `classDef` colors all stay legible

## 2.32.0 - 2026-05-24

Hardens the new `mcp__happy__ask_user` picker pipeline end-to-end after the PTY migration — fixes duplicate cards, ghost approve/deny footers, missing decline path, and a deadlock on the native `AskUserQuestion` tool — and ships an Inbox "Clear All" action plus build metadata in Settings.

### mcp__happy__ask_user — picker UX hardening
- Fixed duplicate picker cards by deduping the synthetic ToolCall path against the tool_use envelope so the App only renders one card per request
- Fixed the "needs permission" chip opening a generic approve/deny PermissionSheet on top of the picker — `AskUserQuestion` and `mcp__happy__ask_user` now share a single `toolsWithBuiltinSubmitUI` whitelist
- Removed the duplicate question subtitle that appeared above the single-question picker
- Removed the redundant `PermissionFooter` approve/deny row that overlaid the picker
- Added a "Decline" button to the picker (mcp variant only) — taps call `sessionAskUserResponse({ canceled: true })`, and happy-cli ≥ 0.85.10 rejects the pending MCP invocation so Claude falls back to plain-text Q&A instead of hanging
- Moved the decline button out of the last-step branch so multi-step prompts can be declined from any step (back/decline on the left, next/submit on the right)
- Added `askUserQuestion.decline` i18n keys across all 10 languages

### AskUserQuestion in PTY mode
- Fixed the native `AskUserQuestion` tool deadlocking every PTY-mode session — the App can never deliver an answer because Claude TUI owns the in-terminal Q&A UI
- happy-cli now force-disables `AskUserQuestion` in the PTY argv so Claude falls back to plain-text numbered options inside the App composer
- Added a "Cancel and continue" escape hatch on the picker's submit-error path that fires `sessionInterrupt` (Ctrl-C through the PTY) to unstick sessions stuck on the pre-fix behaviour
- Updated system + plan-mode prompts to teach Claude the plain-text fallback contract
- Added `cancelStuckHint` / `cancelStuckAction` i18n keys across all 10 languages

### Inbox
- Added a destructive "Clear All" action in the inbox header, gated by a confirm dialog and backed by `DELETE /v1/inbox` (account-scoped, idempotent); UI updates optimistically before the network round-trip

### Settings
- Surfaced build metadata (commit, time, branch) on the Settings page to speed up "which build is the user on" triage

### Bug Fixes
- Fixed assistant replies from prior turns replaying with a typewriter animation every time the user sent a new prompt — the "already rendered as Markdown" check now derives from `message.createdAt < session.thinkingAt` instead of a remount-fragile React ref

## 2.31.0 - 2026-05-24

Removes the obsolete "move to background" button from the Claude session input bar. The button was a holdover from the SDK era when Happy CLI ran Claude through a programmatic SDK and could relocate foreground Bash/sub-agent calls to the background on demand. After the move to PTY mode, the CLI no longer has a programmatic hook for that action and the button became a silent no-op.

### Cleanup
- Removed the background-tasks button from the input bar — it has had no effect since the PTY migration
- Removed the related `onBackgroundTasks` prop on `AgentInput` and the `sessionBackgroundTasks` op so dead code paths don't quietly drift
- Kept the CLI's `backgroundTasks` RPC handler as a no-op stub so older app builds still get a clean response instead of an unknown-RPC error

### Background-Task Bar (unchanged)
- Preserved the separate floating Background Task Bar above the input — which surfaces running Bash background processes and sub-agents — untouched; only the SDK-era "send to background" button is gone

## 2.30.0 - 2026-05-22

Internal robustness pass on the background-task pipeline. No new features in this release — the change makes race conditions and out-of-order SDK events in the floating task bar fail loudly during development instead of silently leaving a task showing the wrong status.

### Background-Task Stability
- Added an explicit BackgroundTaskStatus state machine (`running` → `completed` / `failed` / `stopped`, all three terminals absorbing) — defines the lifecycle in one place instead of leaving it implicit in scattered string comparisons
- Improved task-end handling — status transitions in the task registry are now validated against the state machine, so an out-of-order second `task-end` event can no longer silently flip a finished task into a different terminal status
- Improved offline cleanup of running tasks — when a session goes offline, the "mark stale tasks as stopped" path is now double-guarded by the same state machine behind the existing running-only filter
- Documented the one reducer path that intentionally bypasses validation (a `task-start` arriving after `task-end` for the same task is a legitimate wire-level out-of-order SDK event, not a reducer bug)

### Code Health
- Removed the unused state-machine API from the sub-agent status helper — sub-agent lifecycle is derived purely from the underlying tool call and has no mutable storage, so the parallel container/transition API was dead code outside of tests; the asymmetry with background tasks is now documented in source for future contributors

## 2.29.0 - 2026-05-22

Surfaces running sub-agents in the floating task bar and fixes a misleading "Successfully completed" status when a sub-agent finishes with no output.

### Sub-Agent Visibility
- Added a sub-agent chip in the BackgroundTaskBar above the input — Agent/Task tool calls that are still running now show alongside Bash background tasks with an "AGENT" tag, elapsed time, and the sub-agent type/description, so a sidechain investigation in flight stays visible even after the timeline has scrolled away
- Added click-to-scroll on the sub-agent chip — tapping a running sub-agent now scrolls the chat to its tool-call card so its progress is one tap away
- Added a `scrollToMessage` API on ChatList to support jumping to a specific message in either the inline list or a tool group

### Sub-Agent Status
- Fixed sub-agent tool cards showing "Successfully completed" with a green checkmark when the run ended with `result: null` — these now display "No output (likely failed to start)" in the error color, so a sub-agent that crashed at startup is no longer disguised as a success
- Introduced an explicit `SubagentStatus` enum (`running` / `exited` / `zombie`) modeled on Unix process states — used by both the BackgroundTaskBar derivation and the tool-card status row, so "what counts as still in flight" and "what counts as a zombie completion" are defined in exactly one place


Major stability and performance improvements for web, plus full session message loading across all platforms.

### Full Message Loading
- Added full session message loading — all messages are now fetched at once instead of being limited to the latest page, with support for sessions of any size
- Added loading percentage indicator — displays "Loading X% (loaded/total)" while session messages are being fetched and decrypted
- Improved fetch batch size from 300/500 to 2000 messages per request, reducing server round-trips

### Web Stability
- Fixed white screen crash caused by infinite retry loops — backoff now caps at 100 retries before stopping
- Added global Error Boundary for web — catches render errors and shows a recovery UI instead of a blank page
- Fixed terminal component not cleaning up on initialization failure
- Added tab visibility protection — activity updates are paused while the tab is hidden and flushed on return, preventing background CPU bursts

### Performance
- Added parse caching for plan and diff preview parsing — prevents redundant string parsing on every render cycle
- Improved session messages LRU cache capacity from 3 to 5 sessions
- Increased display message cap from 300 to 10,000 and native cache from 350 to 5,000

### Context Usage & Tools
- Added knowledge lifecycle trends visualization
- Added task description display in progress panel
- Improved tool UI with new tool view components

## 2.27.0 - 2026-05-12

This release adds Turn separators, message metadata badges, smart auto-send improvements, and fixes message queue reliability across sessions and clients.

### Turn Separators
- Added Turn start/end separators in chat — each AI turn now shows a clear boundary with usage stats (tokens, cost, duration) and thinking mode badge (Adaptive/Enabled)
- Improved Turn-end badge to always display — removed the hasStats skip logic that hid badges in certain conditions

### Message Metadata
- Added model/mode/reasoning metadata badge on user message bubbles — see which model, permission mode, and thinking setting was used for each request

### Message Queue
- Fixed message queue lost when switching sessions — queue is now stored globally and survives tab/session switches
- Fixed message queue lost on page refresh — queue is now persisted to local storage
- Fixed cross-client message queueing — messages sent from App while AI is running on Web now correctly queue instead of sending directly
- Improved queue chip text to show full content without truncation

### Auto-Send
- Added AI-powered option scoring — options with 2+ choices automatically get LLM scoring with ✨ badge showing which model ranked them
- Added auto-sent message badge — messages sent by auto-send now display a ✨ indicator in the chat
- Fixed auto-send not triggering after toggle — resolved turn dedup and stale options blocking generation
- Fixed auto-send firing heuristic recommendation instead of LLM-ranked best option
- Improved generation cooldown from 120s to 10s for faster option availability

### Progress Panel
- Added inline session summary below each checklist tab — summary follows tab selection instead of showing in a popup
- Fixed checklist labels no longer truncated — full content is always visible
- Improved tab count display to use badge style instead of plain numbers

### Queue Preview
- Added slide-up/down animation for queue message preview overlay
- Fixed preview auto-closing when the previewed message is cancelled from the queue

### Fixes
- Fixed sync auth race condition — added 3s retry when credentials are not yet available

## 2.26.0 - 2026-05-10

This release improves the session permission experience.

### Session
- Fixed "Needs Permission" label — tapping the permission chip in the session status bar reliably opens the permission approval sheet
- Added permission sheet — tapping the "Needs Permission" chip in a session now opens a permission-approval sheet directly, instead of requiring you to navigate into the session to resolve it
- Fixed "Needs Permission" status bar label to be tappable — the label in the session status bar now responds to taps in the same way as the chip

## 2.21.0 - 2026-05-09

This release fixes session message queueing for mid-session sends.

### Session
- Fixed message queueing during active AI sessions — messages sent while the AI is running are now locally buffered, delivered in order once idle, with the option to send each message immediately if needed

## 2.20.1 - 2026-05-09

This patch resolves a duplicate /compact dedup edge case.

### Fixes
- Fixed an edge case where /compact lifecycle messages could appear twice in the event stream processor

## 2.20.0 - 2026-05-09

This release fixes duplicate "Context was reset" messages after /clear.

### Fixes
- Fixed "Context was reset" appearing twice after /clear — corrected message dedup in both the cache restore path and the event stream processor

## 2.19.0 - 2026-05-08

This release brings improved subagent conversation rendering, structured error feedback, and a wave of session UX improvements.

### Session UX
- Added queued-message floating banner while AI is running — tap "Send Now" to interrupt and deliver immediately
- Added "Show full content" expand button on compressed message bubbles
- Added paste preview — pasted content shows a preview block before sending
- Added automatic language detection and syntax highlighting when pasting code or log output
- Added code block folding for long assistant responses
- Added log-format syntax highlighting (log language)
- Added content refresh button in the session header
- Improved footprint panel with Bash sub-classification and full operation type coverage
- Fixed session list refreshing immediately after archive or delete (optimistic update)
- Fixed duplicate display of /clear and /compact command responses

### Agent Error Feedback
- Added structured error labels in the session-stopped banner — billing errors now show a "Check Billing" link; rate limit errors show an automatic-retry notice
- Improved StopFailure error type display with localized labels across 10 languages

### Subagent Support
- Improved subagent conversation rendering — text and thinking blocks from sub-agents are now forwarded as full messages, enabling richer nested conversation display

### Auto-Send
- Added LLM model name badge on recommendation chips so you know which model scored the suggestion
- Improved auto-send scoring — LLM takes full responsibility for recommendation ranking when auto-send is active
- Fixed auto-send not triggering the countdown when follow-up options arrive

### Voice
- Improved LiveKit verification flow — shows project info, participant count, and Cloud Dashboard link on success
- Fixed audio auto-play and microphone noise-cancellation configuration on web

### Multi-Agent
- Added multi-session dashboard (Octogent-style overview of concurrent agents)
- Added automatic Worktree creation per task with full lifecycle management
- Added one-click parallel agent dispatch from the task list

### Fixes
- Fixed SessionView infinite update loop
- Fixed input box image preview disappearing after switching sessions
- Fixed AskUserQuestion submit button race condition
- Fixed Yolo mode permission requests not cleaning up on mode switch

## 2.18.0 - 2026-04-29

This release adds responsive foldable screen support and fixes several UI issues.

### Voice
- Added a realtime voice backend selector with LiveKit support alongside the existing ElevenLabs flow
- Added LiveKit realtime session plumbing that uses server-managed LiveKit Cloud credentials and avoids storing LiveKit API secrets in app settings

### Foldable Screen Support
- Added responsive layout switching for foldable devices — the app now adapts between phone and tablet layouts when folding or unfolding the screen, powered by Unistyles C++ breakpoint detection
- Improved layout width calculations to react dynamically to screen size changes instead of using static values computed at startup

### Settings
- Fixed settings overlay scroll issues on Android and smaller screens by replacing the floating overlay with a centered modal

### Stability
- Fixed Firebase configuration for push notifications on Android
- Fixed a potential crash when the scroll anchor exceeded the message list bounds
- Improved message history loading reliability on app restart

## 2.17.0 - 2026-04-29

This release improves the experience when opening long chat sessions and fixes several rendering and layout issues.

### Chat
- Added a loading indicator at the top of the chat list while older messages are being fetched in the background — you'll now see a spinner instead of a silent wait when opening a session with a long history
- Fixed a bug where the message loading system could enter an infinite update loop under certain conditions

### Performance
- Reduced rendering overhead in chat sessions, improving scroll smoothness

### Side Panel
- Fixed tab bar width adapting correctly to content size on both iOS and Android
- Fixed horizontal scrolling in the Side Panel tab row so all tabs are reachable

## 2.16.1 - 2026-04-28

Minor reliability improvement to the chat sync system.

### Chat
- Removed the manual reload button from the session header — the sync system now automatically detects and recovers from any message gaps without user intervention

## 2.16.0 - 2026-04-28

This release significantly improves chat performance for long sessions and adds an Events tab to the project view, real-time diagnostics, and several Android UI refinements.

### Performance
- Improved chat performance in long sessions — the message list now stays smooth regardless of conversation length by capping the rendered window to the 300 most recent messages
- Added "Load earlier messages" to the top of the chat list, with automatic loading when scrolling up

### Project
- Added Events tab to the project view with a real-time badge showing pending action count

### Diagnostics
- Added real-time tool activity display in session diagnostics with process linkage
- Improved diagnostics UI layout and cleanup messaging

### Profiles & Webhooks
- Added profile picker to webhook route configuration — each webhook can now run under a specific runtime profile

### Session
- Added session process ID display in the chat header

### Android
- Fixed model summary text and RPC status pill layout to prevent truncation on smaller screens
- Fixed chip border and shadow rendering on Android

## 2.15.1 - 2026-04-28

Fixed an issue where archiving a session would fail with an error when the CLI daemon was offline or the process had already exited.

### Session Management
- Fixed archive action now falls back to a server-side endpoint when the killSession RPC cannot reach the daemon — ensures sessions are always archived even if the process is already gone

## 2.15.0 - 2026-04-25

This release brings full profile-per-trigger binding, a restored Git tab, LLM-weighted option scoring, and several session management improvements.

### Profile & Trigger Management
- Added ProfilePicker to Cron and Webhook edit pages — each trigger can now run under a specific runtime profile
- Added runtime-profile preview in Supervisor settings so you can verify which profile a trigger will use before it fires
- Improved profile label on triggers to be tap-to-edit when the source is a saved profile
- Added health and research profile overrides in Supervisor settings

### Project
- Restored Git tab to the project detail view
- Added Config tab to project detail, consolidating project-level knowledge and settings in one place
- Added Smart Clean button to machine diagnostics for one-tap stale-data cleanup

### Session
- Added one-tap CLI version upgrade button in the session header and info page — no confirmation dialog
- Added stale session detection with selective cleanup RPCs to recover from stuck sessions
- Fixed session messages not refreshing when returning to the app from the background

### Auto-Send & Options
- Improved option score badges to reflect LLM-weighted scores when semantic re-ranking was applied, with a "+" indicator to show LLM influence

### SDK & Integrations
- Updated Claude Agent SDK to 0.2.119
- Added claude-control sidebar components (file viewer, tool calls, session info) for richer in-session visibility

### Bug Fixes
- Fixed message backfill not resuming correctly after session interrupts
- Fixed security vulnerability in the `uuid` dependency (buffer overflow, GHSA-w5hq-g745-h8pq)
- Fixed Math and Mermaid rendering when content contains HTML-like syntax

## 2.14.1 - 2026-04-24

Restored the XHigh reasoning option for Opus 4.7 sessions, and fixed long-session message loading so refreshes on PC Web reliably fill in all history.

### Fixed
- Fixed the XHigh effort option going missing when the Claude SDK did not report `supportedEffortLevels` — it is now force-surfaced for Opus 4.7 (including the 1M variant)
- Fixed long sessions never finishing their initial load on PC Web: the backfill cursor is now persisted after each batch so interrupted fetches resume instead of restarting from scratch, and forward pagination stops at the edge of the already-loaded newest batch instead of re-walking the tail
- Fixed transient "session not found" retries caused by read-replica lag — the server's 404 cache window dropped from 30 seconds to 3 seconds

### Improved
- Clarified the XHigh description across all nine languages to call out the supported models (Opus 4.7 · Codex GPT-5 only), so users on Sonnet / Opus 4.6 / Haiku understand why the option is not offered
- Sped up first-load of long sessions about 5x by raising the message page size from 100 to 500 (the server cap)

## 2.14.0 - 2026-04-21

Redesigned session progress panel with glass UI, a unified side-panel with dedicated code-changes view, per-turn knowledge lifespan with hot/evicted badges, unarchive without restart, a rebuilt AI profile settings UI, and final visual polish for loading / error / empty states across core app surfaces.

### Session Progress Panel
- Added redesigned progress panel with glass UI, activity timeline, and MCP-sourced checklist/summary synced into the Progress tab
- Added multi-list progress with `activeForm` labels and a verification nudge surfaced from Claude's todo stream
- Added per-list file change summary aggregating Edit/Write hits into the progress panel
- Added auto-summary trigger on checklist completion (CLI prompts the agent to sync via MCP when all items are done)
- Added per-status tap menu on checklist items (verify / continue / report issue) that templates a prompt back to the input

### Session Side Panel
- Merged Progress and Code tabs into a single **session** tab and hid the Knowledge tab when the project knowledge base is disabled
- Added **Code Changes** view with per-file stats bar and expandable diffs
- Added dedicated Codex tool views (plan preview, patch, diff) and a Codex progress panel
- Improved `Update Progress` tool cards with clearer explanation/focus/checklist hierarchy, collapsible long explanations, default checklist truncation with expand-all, a structured checklist timeline, explicit update time, duration badges, and optional token badges when real usage data is available
- Improved chat rendering so turns with visible thinking plus tool calls can collapse into a single chronological timeline instead of two disconnected blocks
- Improved turn timeline cards with the same default truncation/expand-all behavior as Progress cards while keeping unfinished tool steps visible by default
- Added **Expand diffs by default** appearance setting applied across Edit/Write/GeminiEdit/CodexPatch
- Added a new column layout for the InputFAB with a dedicated buttons row for better reach

### Visual Consistency
- Added a shared tri-state state view for loading / error / empty surfaces and applied it across sessions, inbox, usage, preview, timeline, process manager, and OpenClaw
- Unified the OpenClaw sessions route and tab wrapper so they share the same state presentation instead of drifting apart
- Fixed localized usage fallbacks so the chart and usage panel no longer drop back to hardcoded English empty/error copy
- Extended the same tri-state system across project, git, friends, and artifacts surfaces including additional project subviews, knowledge evolution, issues, PRs, and artifact detail/edit screens
- Added a shared collection-state helper so remote list pages stop reimplementing slightly different loading/error/empty branching
- Fixed artifact detail deep-link loading so the page now fetches missing artifact data instead of failing immediately when storage is cold

### Knowledge Base
- Added per-session turn-based lifespan for injected knowledge entries — cold entries evict automatically while proven-useful ones bank extra turns
- Added HotBadge on References showing budget/hit count (fresh / proven / evicted) with long-press explanations
- Added a 4-tab knowledge console — Changes / References / Evicted / Archive — with one-tap Evict and Re-inject actions
- Added realtime knowledge-access updates so Summary and References refresh the moment an entry is hit
- Added `· N hit · M hot` suffix on the Summary row when TTL data is present
- Reordered Summary to the first tab position across desktop and mobile panels
- Fixed References sticking at 7/14 forever — re-injection no longer resets TTL on an active row

### Archive & Session Lifecycle
- Added unarchive-without-restart flow — reactivate an archived session in resume or unarchive mode without rebuilding the connection
- Added SessionProviderTag and reusable `rpcSummaryVisualState` helpers for consistent provider badges
- Added `codexThreadId` in the Codex info panel

### AI Profiles & Supervisor
- Rebuilt profile settings UI around shared built-ins (Anthropic / DeepSeek / Z.AI) with clearer editing
- Added supervisor request-profile flow and session metadata recovery for resilient supervisor runs
- Unified supervisor trigger dispatch (scheduler + webhook) so scheduled and push-driven runs share the same profile resolution path

### Removed
- Removed Request Timing Diagnostics — the feature never collected data for Claude sessions (CLI attached to turn-end envelopes, App read from never-emitted `ready` events). Pipeline removed entirely across App/CLI/Wire

## 2.13.0 - 2026-04-17

Claude Agent SDK upgrade with Opus 4.7, new XHigh effort tier, and smarter session events for memory recall and API request status.

### Claude Models & Effort
- Added Opus 4.7 as a selectable model (Latest, 1M context default)
- Merged 200K/1M variants: Sonnet and Opus now default to 1M context (legacy `-1m` keys preserved for pinned sessions)
- Added XHigh reasoning effort tier (Opus 4.7 only) with native SDK support — no longer silently remapped to Max
- Rewrote effort level descriptions across all 9 languages to clarify real task fit (Low vs Medium now have distinct guidance)
- Only exposes XHigh when the active model reports native support; other Claude models fall back to Max/High/Medium/Low

### Session Events
- Added memory recall event: App now shows which memories were surfaced into a turn ("Recalled N notes")
- Added Requesting status ping before each API call (surfaced as a lightweight session event)
- Added support for shouldQuery=false messages that append to the transcript without triggering an assistant turn

## 2.12.0 - 2026-03-30

Dev environment management with live log streaming, project-level Knowledge Base configuration with lifecycle UI, task display overhaul with colored badges and collapsible results, and extensive background task stability fixes.

### Agent Loops
- Fixed false **Working directory is required** error after adopting a suggestion when the loop form path was empty (refresh now uses each suggestion’s directory)
- Added per-recommendation **Adopt** on the one-click confirm step so each suggested loop can be created individually without selecting the whole repository
- Added optional one-click toggle to create Bootstrap + Auto-Dream profiles from inferred repo root when deploying recommended loops
- Added automation section quick action to create missing Bootstrap / Auto-Dream profiles from existing loop working directories
- Fixed Web/Tauri alert menus with many actions clipping the bottom options (e.g. loop delete); loop action sheet now lists delete before view-file entries for quicker access

### Dev Environment Management
- Added `/dev` skill for scanning and generating project dev configurations
- Added Dev configuration page with service cards, Start All and per-service start/stop buttons
- Added live log streaming for running services
- Added file browser popup for selecting config files
- Added Docker container stop preserves container for reuse (no auto-remove)
- Added Rescan button that deletes and regenerates dev.yml from scratch
- Fixed Dev config page re-detects services on every entry
- Fixed Chinese character encoding in Dev config page
- Fixed dev.yml save failures with base64 encoding workaround

### Knowledge Base Configuration
- Added project-level Knowledge Base configuration and lifecycle management UI
- Added per-project feature toggles independent from .env global settings

### Task Display
- Added colored badge statistics for task status overview
- Added inline metrics for subtasks (progress indicators)
- Added collapsible result sections for subtask output summaries
- Added collapsible result display for sub-agent summaries
- Improved session list cards to show the latest sent request preview under status so auto-running sessions are easier to identify
- Improved auto option send request previews with purple glow so list items distinguish automatic sends from manual requests
- Fixed active session cards and compact active session rows to also show the latest request preview under status

### Background Task Stability
- Refactored background task kill to use SDK native stopTask RPC
- Added dismissed task state persisted to MMKV (survives page refresh)
- Added panel deduplication — only shows latest task per command
- Added automatic task-end message for idle tasks on stop
- Added fallback kill when stopTask fails on idle tasks
- Fixed background task panel disappearing after page refresh
- Fixed Bash tool permanently showing running state after completion
- Fixed task-start entry creation from existing tool message data
- Fixed old session stale tasks incorrectly showing as running
- Fixed task-end message lost when normalizer discards turnless envelopes
- Fixed backgroundTaskId processing skipped by state guard

### Web & UI
- Improved Machine Loops page with a quick-action overview and modal-based loop, bootstrap, and Auto-Dream editors to reduce scroll-heavy setup flows
- Added automatic vertical button layout for alerts with more than 2 buttons (iOS ActionSheet style)
- Removed microphone STT voice-to-text input feature
- Fixed Codex YOLO sessions auto-approve flow so GPT/Codex permission requests no longer stall on manual review
- Fixed voice debug logging flooding console in non-voice mode

## 2.11.0 - 2026-03-30

Unified voice input to use native system speech recognition across all platforms, removed Docker STT/TTS services, added ElevenLabs voice configuration UI improvements, and refactored background task panel to SDK event-driven architecture.

### Background Task Panel
- Refactored task tracking from message scanning to SDK event-driven registry (task-start/progress/end)
- Added AI progress summary display in task bar (from task-progress events)
- Added automatic cleanup when session goes offline — stale tasks marked as stopped
- Added `stopped` status with distinct label and color across 11 languages
- Fixed stale tasks persisting after page refresh or session reconnect
- Fixed old session tasks permanently showing as running
- Fixed log sheet staying open after task ends or session disconnects

### Voice Input
- Removed Docker Whisper STT service — all platforms now use native speech recognition (iOS Siri, Android Google, Web Speech API)
- Removed Haiku-based voice transcript correction feature (sttCorrection setting)
- Removed Edge TTS service and all related code
- Simplified web speech-to-text from 475 lines to 45 lines

### Voice Settings
- Added save button and configuration status feedback on voice settings page
- Added ElevenLabs account balance and usage display
- Added user-provided ElevenLabs API Key support

### Voice Stability
- Fixed ElevenLabs client crash on missing error_event
- Fixed contextual update and text message sent to inactive voice session
- Fixed handleErrorEvent patch to silently ignore rather than disconnect

## 2.10.0 - 2026-03-28

Project Knowledge Base with semantic search and evolution tracking, drag-and-drop file uploads, interactive AskUserQuestion step UI restored, and container management improvements.

### Knowledge Base
- Added Project Knowledge Base (experimental) — automatic extraction and storage of session insights
- Added semantic search with vector embeddings (Ollama/OpenAI) and HNSW index for fast retrieval
- Added knowledge evolution timeline — view how insights evolve across sessions
- Added cross-project global knowledge search from project list header
- Added profile summary auto-rewrite powered by Haiku 4.5
- Added configurable sensitivity presets and trigger condition toggles
- Added tab auto-refresh with timestamp display and manual refresh button
- Fixed knowledge entry title generation and duplicate entry race condition

### File Uploads
- Added drag-and-drop file/image upload with frosted glass overlay and drop hint
- Added file paste support when creating new sessions
- Added attachment button with camera/photo library/file picker options
- Fixed copied image files being misidentified as documents
- Fixed new session image preview by adding .jpg extension to IDs

### Interactive Q&A
- Restored AskUserQuestion step tab interface — patched SDK deferred tools mechanism that prevented the model from calling this tool since SDK 0.2.81
- Fixed generic permission footer showing under AskUserQuestion in YOLO mode (it has its own submit UI)

### Container Management
- Added container card collapse with online status detection and one-tap restart
- Added container resource limits configuration (memory/CPU/sudo)
- Added remote CLI version upgrade button on device page
- Added automatic container status refresh every 15 seconds
- Added automatic Docker container rebuild on token restore

### SDK Integration
- Added Claude Code SDK 0.2.84 features — taskBudget UI, seedReadState, workflowName
- Added CLI installation guide in Settings > About

### Permissions & UI
- Fixed dark mode white-on-white text and hardcoded colors
- Fixed default permission mode to show review list instead of auto-approve
- Added approved operation revert-to-pending support
- Added requires_action status triggering needs_attention reminder
- Improved profile configuration page layout

## 2.9.0 - 2026-03-26

Full Docker container lifecycle management with one-tap provisioning, HTTPS reverse proxy, network isolation, and AI Profile environment variable fix.

### Docker Container Management
- Added one-tap container creation from machine detail page with automatic Caddy HTTPS reverse proxy
- Added Web Terminal (ttyd) with HTTP Basic Auth password protection — username and password displayed as copyable fields
- Added Web Terminal LAN address display alongside HTTPS URL for direct internal access
- Added automatic port allocation with Docker + system dual scan to find first available port (7001-7099)
- Added container hostname matching container name for clear identification in device list
- Added non-root user (coder) to fix Claude Code refusing `--dangerously-skip-permissions` as root
- Added automatic cleanup of stale daemon state on container restart to prevent PID mismatch

### HTTPS & Caddy
- Added automatic Caddy site file generation per container (`t-{name}.code.xycloud.info`)
- Added wildcard TLS certificate for `*.code.xycloud.info` — new subdomains are instant, no certificate wait
- Added reusable `cloudflare_tls` snippet to reduce Caddyfile duplication
- Added dynamic site files persisted in Docker volume, surviving Caddy restarts
- Added automatic Caddy site cleanup on token revoke/delete

### Security
- Improved container network isolation — removed from `happy_default`, cannot directly access PostgreSQL/Redis/MinIO
- Improved API key handling — removed hardcoded keys from Dockerfile, passed at runtime via docker run or AI Profile
- Added API configuration as persistent settings on provision page (set once, reused for all containers)
- Added Docker availability detection — provision entry hidden on machines without Docker
- Fixed AI Profile environment variables being stripped in Docker containers where daemon has no pre-set API keys

### Rendering
- Added LaTeX math formula rendering with KaTeX for inline (`$...$`) and block (`$$...$$`) expressions
- Added math formula support in table cells alongside inline Markdown

### Provision Token
- Added token restore/reactivate functionality with confirmation dialog
- Added permanent delete with confirmation (separate from revoke)
- Improved revoked tokens displayed as individual cards with revoke timestamp

### RPC & Connectivity
- Improved machine status to three-color indicator (ready/online/offline) based on RPC handler registration
- Fixed RPC disconnect recovery with automatic retry on App side and fast re-registration on CLI/Agent side

## 2.8.0 - 2026-03-25

Unified network services management, Provision Token for Docker containers, supervisor analysis mode, and extensive UI polish.

### Network Services
- Added unified network services page combining Tailscale Serve/Funnel, Caddy HTTPS reverse proxy, and UPnP port mapping into one management interface
- Added Caddy multi-domain HTTPS support with auto Let's Encrypt certificates via DNS-01 validation
- Added UPnP port mapping with owner labels (Tailscale, Happy, etc.) and add/remove from the app
- Added Tailscale Serve/Funnel management with path support and funnel toggle
- Improved machine detail page with a summary entry that navigates to the full network services page

### Provision Token
- Added Provision Token for Docker container auto-authentication without QR code scanning
- Added daemon auto-start and ttyd Web terminal integration for provisioned containers
- Improved Provision Token moved to machine detail page, bound to specific device

### Supervisor
- Added analyzed tab to separately display completed analysis actions
- Added supervisor analysis mode with agent API module and session cleanup optimization

### Background Tasks
- Added foreground task panel with clickable process monitoring
- Added Docker container support with reliable liveness detection via docker inspect
- Added marquee scrolling for long log lines in BackgroundTaskBar
- Fixed task deduplication and stale state handling

### UI & Quality
- Fixed 576+ hardcoded color values breaking the theme system
- Fixed multiple hardcoded user-visible strings not using i18n
- Fixed session preview Dev Servers list now respects hidden process filter
- Improved active session card layout with smaller icons and titles
- Added session upgrade prompt when CLI version mismatch detected
- Fixed KV Store cross-device sync and save state indicator

## 2.7.0 - 2026-03-22

Plugin marketplace, port detection & web preview, background task manager, favorite command reordering, and environment variable i18n.

### Plugin Marketplace
- Added plugin install/uninstall/enable/disable with available plugin browsing
- Added plugin detail page with installed plugins and marketplace source display
- Added marketplace source recommendations and "Add Market" feature
- Fixed plugin update errors, detail modal, and enable Switch
- Fixed hardcoded i18n strings and color values in plugin UI
- Added empty state hint when search returns no results

### Port Detection & Web Preview
- Added multi-strategy port detection — lsof/ss/netstat fallback + Docker + curl probing
- Added Web/non-Web port differentiation with parallel curl detection
- Added process name enrichment via ps — turns "node" into "next dev", "vite", etc.
- Added dev server linked preview with unified task close interaction
- Added port list auto-refresh every 10 seconds
- Added custom URL and refresh moved to top with smart process name extraction
- Added port list chip layout
- Added step-by-step progress hints during port detection
- Fixed duplicate port display and case-insensitive process name matching
- Fixed preview screenshot path permission denied issue
- Fixed strict HTTP detection — only mark as Web when first line matches HTTP/

### Background Task Manager
- Added background process manager — globally view/kill/preview web services
- Added background task panel UI with smart labels, log viewer, stop and status sync
- Added background task metadata passing and hooks
- Added per-project CWD port filtering — only show services from current working directory

### Favorite Commands
- Added favorite command reordering with up/down arrows in command list
- Fixed favorite commands to only show commands supported by current session
- Added command descriptions and favorite button short names in command list

### Other Improvements
- Added environment variable card i18n with Chinese display support
- Fixed session list device name to update in real-time with displayName
- Updated MiniMax profile model version M2.5 → M2.7 and timeout to 50 minutes
- Fixed project Git info not displaying and theme type errors
- Hidden Claude Code connection item in settings page
- Removed console.log debug logs from production code
- Fixed loading indicator style inconsistency

## 2.6.0 - 2026-03-22

Plugin management, file revert, sub-agent progress, fix session auto-recovery, foldable keyboard fix, and extensive code quality improvements.

### Plugins
- Added Plugins settings page — manually add or auto-discover MCP plugins from CLI
- CLI auto-loads configured plugins into the SDK at session start

### File Revert
- Added per-message file revert button to undo file changes at message level

### Sub-Agent Progress
- Added sub-agent progress summaries with duration, token count, and tool usage metrics
- Fixed crash when task-progress event has no usage data

### Fix Session Recovery
- Added automatic fix status detection when fix sessions exit abnormally
- Added server-side stale fix watchdog (5-minute heartbeat check)
- Added manual "Mark Complete" / "Mark Failed" buttons for stuck fix actions

### Supervisor
- Added time-sorted action list with status change timestamps
- Added real-time sync between Actions tab and Health tab
- Added max findings per run configuration UI
- Moved fixStatus filtering logic from server to app side

### Foldable & Responsive
- Fixed keyboard flash-dismiss on foldable devices in web browser
- Fixed web split-screen / foldable not switching layout in real-time

### Code Quality
- Fixed 50+ hardcoded colors to use theme tokens
- Added React.memo wrappers to 54 page components
- Fixed 20+ hardcoded strings with i18n translations
- Fixed memory leak from uncleared AppState event listeners
- Removed console.log statements from production code
- Improved error handling and accessibility labels across components

## 2.5.0 - 2026-03-20

Improved session management with active/archived grouping and restore, added file browser with @reference in input bar, branch switching in Git tab, health analytics day range selector, and multi-locale changelog support.

### Session Management
- Added active/archived session grouping with section headers and action buttons
- Added session restore API to reactivate archived sessions
- Added "Delete Archived Sessions" button at top of archived group

### File Browser & Git
- Added file browser button in input bar with @reference insertion
- Added branch switching modal in project Git tab with local/remote branches
- Fixed file browser to show dotfiles (.claude/, .github/, .gitignore, etc.)

### Health Analytics
- Added day range selector (3d/7d/14d/30d) for cost and trend sections
- Fixed cost calculation to include failed/cancelled runs
- Lowered trend API minimum from 7 to 1 day for 3-day view

### AI Suggestions
- Added recommended badge with sparkles icon on first AI suggestion option
- Added comet shimmer animation on recommended option border

### Internationalization
- Added multi-locale changelog support with automatic locale discovery
- Added full Chinese (zh-Hans) changelog translation for all versions
- Changelog page now displays in user's language with English fallback

### Cleanup
- Removed unused batch approve and action card from health tab

## 2.4.0 - 2026-03-20

Added Supervisor Loop Mode for autonomous analyze-fix-reanalyze cycles, project configuration tab, redesigned Research tab, and numerous supervisor and UI improvements.

### Supervisor Loop Mode
- Added Loop Mode — autonomous cycles that analyze code, apply fixes, and re-analyze until issues are resolved
- Added Loop config panel with stepper controls for max iterations and concurrency
- Added Loop detail page with timeline view showing each cycle's actions and results
- Added Loop history section in Health Tab for reviewing past loop executions
- Added configurable severity levels for semi-auto and auto supervisor modes
- Added smart needsAttention detection based on AI response content

### Project Config Tab
- Added project configuration tab with basic settings
- Added project alias — custom display name that overrides the default folder name
- Added default model selection for new sessions per project
- Added archive/unarchive project toggle
- Added read-only project info display (path, machine, created date)

### Research Tab Redesign
- Redesigned Research tab with unified config panel and modal report viewer
- Added custom analysis rules support
- Added multi-device config sync via KV Store
- Added research progress UI with loading indicators

### Supervisor Enhancements
- Added concurrency limits for analysis and fix sessions
- Improved Supervisor Actions with sorting, filtering, and severity display
- Added supervisor action restore capability
- Added loading indicators to supervisor action buttons

### UI/UX Improvements
- Moved profile selector from input bar to dropdown menu above input
- Updated Claude model pricing — 200K and 1M context now same price
- Added version numbers to model name display
- Added UI/UX dimension to supervisor health monitoring

### Project Management
- Added auto-create Project when a new session is created
- Added manual project add/delete support

### Bug Fixes
- Fixed default path in new session to resolve worktree to parent repo
- Fixed multiple hardcoded English strings missing i18n
- Fixed model selector UI and status bar model display
- Fixed IssueFilterBar/PRFilterBar using Alert module instead of Modal
- Fixed cached daemon models for new session with reset on agent switch
- Isolated health/research tab runs to prevent cross-contamination

## 2.3.1 - 2026-03-18

Upgraded Claude Agent SDK to 0.2.78 — added StopFailure error banner and improved hook server reliability.

### StopFailure Hook
- Added StopFailure error banner showing error details when Claude session stops unexpectedly
- Added expandable last assistant message section for debugging context
- Added local dismiss with auto-reset on new errors
- Added automatic stopFailure state clearing at turn start

### Reliability
- Fixed HTTP hook server timeout causing double-write Node.js exception (replaced setTimeout with AbortController)
- Added port range validation in session hook forwarder script

## 2.3.0 - 2026-03-18

Integrated Claude Agent SDK 0.2.77 features — fork sessions, cancel queued messages, MCP server input, API retry status, and enhanced plan viewing.

### Session Fork
- Added fork session button in session info to branch from current context
- Added full fork flow: CLI creates SDK fork, App spawns new session and navigates to it

### Cancel Queued Messages
- Added cancel button on queued messages to remove them before execution
- Improved cancel flow to confirm server-side cancellation before updating UI

### MCP Elicitation
- Added MCP server input banner for handling authentication and configuration requests
- Added form mode with JSON Schema field rendering for structured input
- Added URL mode with protocol-validated link opening
- Added push notifications when MCP servers request user input

### API Retry Status
- Added real-time API retry indicator showing attempt count, max retries, and delay
- Added automatic clearing of retry status when requests succeed

### Plan File Viewing
- Improved ExitPlanMode to display full plan content from file with refresh button
- Added race-condition-safe plan file reading with in-memory content fallback

### Security & Reliability
- Added elicitation action validation and abort cleanup to prevent memory leaks
- Added URL protocol validation restricting to http/https only
- Added NaN guard for numeric elicitation inputs
- Restricted supervisor action deletion to dismissed states only
- Batched supervisor action dedup writes to reduce database round-trips

## 2.2.0 - 2026-03-14

Added full Pull Request management for mobile AI DevOps workflow — browse PRs, review diffs, check CI status, and merge from your phone.

### PR List & Navigation
- Added PR tab in Git section with badge showing open PR count
- Added PR card with state icons, branch info, diff stats, labels, and draft badge
- Added filter bar with Open/Closed/All states and sort options
- Added infinite scroll pagination and 60-second auto-polling
- Added multi-repository PR aggregation

### PR Detail & Diff Review
- Added PR detail sheet with full metadata, branch info, and description
- Added unified diff patch viewer for reviewing file changes
- Added collapsible changed files section with per-file diff rendering
- Added CI Checks detail view showing individual check run status
- Added Reviews section with author, state badge, and review body
- Added Comments section with full comment history

### PR Actions
- Added merge with method selection (merge commit, squash, rebase)
- Added approve and close PR actions
- Added comment posting with text input
- Added open in browser action

### Platform Support
- Supported GitHub via `gh api` CLI
- Supported Gitea via REST API with token auth
- Added i18n translations for all 10 languages

## 2.1.2 - 2026-03-14

Added copy-to-input button for AI suggestion options, allowing users to edit suggestions before sending.

- Added copy-to-input icon on AI suggestion options to append text to input field for editing
- Added copy-to-input icon in options popover and bookmarks popover

## 2.1.1 - 2026-03-13

Bug fixes for message loading, usage charts, session management, and CLI thinking state. Updated README with fork disclaimers.

- Fixed message loss during pagination and backfill when switching between sessions
- Improved usage trend chart with gap filling for missing dates and better layout
- Fixed CLI thinking state accuracy in local mode to correctly reflect model status
- Fixed server rejecting heartbeats for archived sessions to prevent ghost connections
- Updated README to remove upstream branding and add fork disclaimers
- Fixed collapsible input collapse button not responding due to stale closure

## 2.1.0 - 2026-03-09

GitHub/Gitea issue management, tablet sidebar, animated AI avatar, and major session loading performance improvements.

### Issues Integration
- Added GitHub and Gitea issues integration with Git Hosts settings
- Added multi-repository issue aggregation and detail sheet
- Added issue session automation with CRUD management and completion lifecycle
- Added issue tags display in session lists with clickable links and URL preview
- Fixed issue session completion race condition and PR merge status checking
- Fixed comma-separated labels and authors in auto-issue config
- Fixed block archive/delete when issue has open PR

### Tablet & Layout
- Added collapsible sidebar with icon rail for tablet
- Added foldable inner screen detection as tablet for sidebar layout
- Fixed split-screen not switching from tablet to phone layout
- Improved SidebarNavigator and SidebarView components

### UI/UX
- Replaced AI avatar with animated status dot and improved AskUserQuestion UI
- Added Claude Code-style turn metrics with animated tokens display
- Added FAB action buttons with disabled state and pulse animation
- Added expand tools setting for detailed tool view
- Enhanced plan mode feedback with multiline input and image support
- Enhanced kanban UI with pill selectors and board polish
- Added project tab feature toggle in settings

### Performance
- Optimized session message loading with local cache and progressive rendering

### Auth & Settings
- Added secret key login option and navigate to login after logout
- Removed Happy logo from settings page

### CLI
- Upgraded CLI to v0.29.36
- Fixed plan mode permission handling (require manual approval for ExitPlanMode)
- Fixed interrupt fallback when no active query

## 2.0.3 - 2026-03-05

Fixed intermittent image upload failures.

- Fixed multi-image upload failures by serializing uploads to avoid concurrent large file transfer timeouts

## 2.0.2 - 2026-03-01

Major voice interaction upgrade, Worktree support, tool grouping with compact mode, and significant session management and UI improvements.

### Voice Assistant
- Added full voice pipeline: Edge TTS synthesis, Web VAD activity detection, status animations
- Added WebSocket real-time speech-to-text service
- Added Haiku model intelligent STT correction for improved recognition accuracy
- Fixed mobile Web Chinese transcription issues
- Reduced voice interaction latency with TTS interruption support
- Removed unnecessary "Done" voice prompt after Claude Code completion

### Worktree
- Added Worktree detection and session metadata support
- Moved Worktree session type out of experimental features
- Added i18n translations for 9 languages
- Fixed merge conflict auto-abort, command injection vulnerability, and lifecycle management

### Tools & Permissions
- Added tool grouping display with compact mode
- Added auto-approve permissions within tool groups (TodoWrite excluded)
- Removed review button for unknown tools
- Added dontAsk permission mode and opusplan model support

### Session Management
- Added swipe-to-archive and swipe-to-delete in session list
- Added session preferences (permission mode, model mode) sync to server
- Added session Profile tracking and persistence
- Registered getCompactionSummary RPC for remote mode
- Added real-time session sorting toggle

### UI/UX
- Improved code block interaction and tool description display
- Added Agent type, real-time subtitle, and Copilot icon to Task tool cards
- Added Modal.toast auto-dismiss notifications
- Added toolbar auto-wrap on narrow screens
- Added usage panel width constraints

### CLI
- Fixed Shell command results not displaying in App
- Added App language preference forwarding to Claude system prompt
- Upgraded SDK to 0.2.62
- Upgraded CLI to v0.29.27

### Security
- Patched 22 Dependabot security vulnerabilities

## 2.0.1 - 2026-02-27

Fixed session resume to reuse the same Happy session instead of creating a new one, preserving message history and session identity.

- Fixed session metadata showing as unknown after resume by detecting encryption key changes and reinitializing the encryptor
- Fixed session title reverting to project name after resume by preserving the summary field during metadata updates
- Added session resume V2 support — resume now reconnects to the same session instead of creating a new one

## 2.0.0 - 2026-02-27

Happy Coder 2.0 — a deeply customized mobile AI development assistant based on upstream Happy Coder, supporting remote control of Claude Code and Codex with end-to-end encryption.

- Added remote control of Claude Code and Codex from mobile, enabling AI coding sessions anywhere
- Added end-to-end encryption (AES-256-GCM / NaCl secretbox) for fully private session content
- Added QR code scanning and manual URL entry for quick device authentication
- Added Daemon mode for persistent background running with one-tap remote session launch
- Added intelligent voice assistant supporting 15+ languages for natural conversation
- Added GitHub and Claude account connection for unified developer identity management
- Added multi-device real-time sync with online/offline status indicators
- Added dark mode and appearance customization with automatic system theme following
- Added Markdown table rendering and code syntax highlighting in chat
- Streamlined settings page, removed upstream links, started maintaining own changelog
- Supported iOS, Android, and Web platforms
