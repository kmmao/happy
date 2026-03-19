# Changelog

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
