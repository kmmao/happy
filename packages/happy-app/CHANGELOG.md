# Changelog

## 2.20.0 - 2026-05-09

This release expands the World Shell search bar with quick commands and local filtering, adds Trigger event display and Knowledge Base entry events to the event stream, and fixes duplicate "Context was reset" messages after /clear.

### World Shell
- Added local event stream filtering in the World Shell search bar — type to instantly filter events without a network request
- Added slash command support in the World Shell search bar (`/sessions`, `/knowledge`) for quick navigation
- Added Trigger events to the event stream — Cron and Webhook task invocations now appear with a `trigger.*` prefix
- Added Knowledge Base entry events (`memory.created`) to the event stream, with tap-to-navigate to the knowledge base entry

### Fixes
- Fixed "Context was reset" appearing twice after /clear — corrected message dedup in both the cache restore path and the event stream processor

## 2.19.0 - 2026-05-08

This release brings the World Shell event dashboard, improved subagent conversation rendering, structured error feedback, and a wave of session UX improvements.

### World Shell
- Added World Shell — a Matrix-themed global event stream interface that displays real-time events across all active agent sessions
- Added Chain Mode in World Shell — groups tasks by project with progress indicators and click-to-expand details
- Added inline verdicts in the event feed (Approve / Skip / Read / Dismiss) without leaving World Shell
- Added Definition Panel for editing World Laws and Policy directly in World Shell
- Added Filter Chips with friendly project path labels for filtering events by project
- Added "+" button in the World Shell header to create new sessions instantly
- Added click-to-navigate on task and session event cards — jumps directly to the relevant session
- Improved World Shell with a Matrix-themed welcome state when the event stream is empty
- Improved World Shell with full-screen fade animation and disabled gesture-back for immersive focus

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
