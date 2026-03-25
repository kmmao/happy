# Changelog

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
