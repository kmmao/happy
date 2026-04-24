# Claude Control Sidebar — App UI implementation blueprint

Backend status (already shipped in this branch):

- Wire schemas: `packages/happy-wire/src/claudeControlRpc.ts`
- CLI handlers: `packages/happy-cli/src/claude/rpc/claudeControlHandlers.ts` (registered in `claudeRemoteLauncher.ts`)
- App RPC client: `packages/happy-app/sources/sync/apiClaudeControl.ts`

UI work still owed. This document is a drop-in blueprint for the six
components + their i18n keys. Follow it as written to keep the visual system
consistent with existing Happy App conventions (`Item`, `Avatar`,
`useHappyAction`, Unistyles).

---

## Component checklist

### 1. `CostBadge` — plaintext tier

- Location: `sources/components/claudeControl/CostBadge.tsx`
- Props: `{ sessionId: string; compact?: boolean }`
- Behavior:
  - On mount, call `fetchSessionCost(sessionId)` via `useHappyAction` wrapper
  - Re-fetch on 60s interval; pause when app backgrounds
  - Render `$X.XXXX` (USD) inline; `compact` collapses to just "$X.XX"
- i18n keys (`claudeControl.cost.*`):
  - `loading`: "Calculating cost…"
  - `error`: "Cost unavailable"
  - `label`: "Session cost"
- Integration point: `sources/app/(app)/session/[id]/_layout.tsx` header or a new row in Health tab

### 2. `BinaryVersionRow` — plaintext tier

- Location: `sources/components/claudeControl/BinaryVersionRow.tsx`
- Props: `{ sessionId: string }`
- Behavior:
  - One-shot `fetchBinaryVersion(sessionId)` on mount; cache result per session
  - Render via `Item` with `title={t('claudeControl.version.remoteCli')}` and `detail={version}`
- i18n keys (`claudeControl.version.*`):
  - `remoteCli`: "Remote Claude Code"
  - `happyCli`: "Happy CLI"
  - `unknown`: "Unknown"
- Integration point: session settings / diagnostics section

### 3. `SessionColorPicker` — plaintext tier

- Location: `sources/components/claudeControl/SessionColorPicker.tsx`
- Props: `{ sessionId: string; currentColor?: string; onChange: (color: string) => void }`
- Behavior:
  - Show 8–12 preset colors (align with `components/Avatar.tsx` palette) + a
    "Default" chip
  - On tap, `setSessionColor(sessionId, color)` optimistically via
    `useHappyAction`; call `onChange` for App-side persistence into session KV
- i18n keys (`claudeControl.color.*`):
  - `title`: "Session color"
  - `default`: "Default"
  - `apply`: "Apply"
- Integration point: session settings row

### 4. `FileViewer` — E2E tier

- Location: `sources/components/claudeControl/FileViewer.tsx`
- Props: `{ sessionId: string; path: string; onClose: () => void }`
- Behavior:
  - Full-screen modal (Unistyles); show `path` in header
  - Call `remoteReadFile(sessionId, path)`; while pending show spinner
  - On `result === null`, render specific error per `deniedReason`:
    - `blacklisted_path` → "This path is on the CLI safety blacklist"
    - `permission_denied` → "Claude Code denied access to this file"
    - `too_large` → "File exceeds 1 MiB limit"
    - `not_found` / `error` → generic
  - On success, render `contents` in a monospace `ScrollView` (consider
    syntax highlighting later; plain text acceptable for v1)
  - Show `truncated` banner at top if set
- i18n keys (`claudeControl.fileViewer.*`):
  - `title`: "View File"
  - `close`: "Close"
  - `loading`: "Loading…"
  - `truncated`: "Truncated to 1 MiB"
  - `denied.blacklistedPath`: "Path blocked by CLI safety policy"
  - `denied.permissionDenied`: "Access denied by Claude Code"
  - `denied.tooLarge`: "File too large"
  - `denied.notFound`: "File not found"
  - `denied.error`: "Could not read file"
- Integration point: new route `app/(app)/session/[id]/file-viewer.tsx`
  (pass `path` via query param)

### 5. `MentionPicker` — DROPPED (YAGNI, 2026-04-25)

The originally-planned MentionPicker component + `claudeControl.mention.*`
i18n keys have been removed. Reason: the App already ships an equivalent
`@` autocomplete pipeline wired via `AgentInputAutocomplete` +
`autocompletePrefixes={["@", "/"]}` (see `SessionView.tsx`) and
`suggestionFile.ts` (sessionRipgrep + Fuse.js fuzzy cache). That pipeline
was discovered after MentionPicker was written; they overlap UI-wise and
the existing Fuse-based matcher beats the claude-control RPC's substring
match for typing ergonomics.

`fetchFileSuggestions` (App-side RPC wrapper), the CLI handler, and the
server rate limit are intentionally kept — they are cheap idle
infrastructure and may be reused for a future non-composer surface (e.g.
a file picker in FileViewer). If a later audit confirms no surface plans
to use them, drop the chain wholesale as a separate commit.

### 6. `McpInvoker` — permission-gated tier

- Location: `sources/components/claudeControl/McpInvoker.tsx`
- Props: `{ sessionId: string; initialTool?: string; onClose: () => void }`
- Behavior (security-critical — follow exactly):
  1. Form step 1: pick MCP server + tool (fetch available list from the
     existing session's `mcpServerStatus` if already exposed; fall back to
     free-form input)
  2. JSON editor for `arguments` (Monaco or Textarea)
  3. "Review" step (step 2 of the 2-step confirm): show a summary modal
     with tool name + arguments diff. Require user to tap a "I understand"
     checkbox before "Invoke" button enables
  4. On invoke, call `generateMcpConfirmToken()`, then
     `invokeMcpCall(sessionId, { tool, arguments, clientConfirmToken: token })`
  5. Handle response: `not_whitelisted` → show explainer with the env var
     `HAPPY_SIDEBAR_MCP_WHITELIST` instructions; `server_unavailable`
     (current default stub) → show "MCP invocation stubbed"; success →
     render result as formatted JSON
- i18n keys (`claudeControl.mcp.*`):
  - `title`: "Invoke MCP Tool"
  - `stepSelect`: "1. Select tool"
  - `stepConfirm`: "2. Confirm"
  - `reviewHeading`: "Review before invoking"
  - `confirmCheckbox`: "I understand this will run an MCP tool directly"
  - `invoke`: "Invoke"
  - `result`: "Result"
  - `error.notWhitelisted`: "MCP server not whitelisted on the remote CLI"
  - `error.serverUnavailable`: "MCP server unavailable"
  - `error.toolNotFound`: "Tool not found on server"
  - `error.invalidArguments`: "Invalid arguments"
  - `error.permissionDenied`: "Permission denied"
  - `error.unknown`: "Unknown error"
- Integration point: new route `app/(app)/session/[id]/mcp-invoker.tsx` or
  modal from session settings

---

## i18n rollout

All new keys live under the `claudeControl.*` top-level section. Add them to
**all eleven translation files** in this order (to satisfy
`TranslationStructure` derived from `_default.ts`):

1. `packages/happy-app/sources/text/_default.ts` — defines the shape (EN baseline)
2. `packages/happy-app/sources/text/translations/en.ts`
3. `packages/happy-app/sources/text/translations/zh-Hans.ts`
4. `packages/happy-app/sources/text/translations/zh-Hant.ts`
5. `packages/happy-app/sources/text/translations/ja.ts`
6. `packages/happy-app/sources/text/translations/es.ts`
7. `packages/happy-app/sources/text/translations/it.ts`
8. `packages/happy-app/sources/text/translations/pt.ts`
9. `packages/happy-app/sources/text/translations/ca.ts`
10. `packages/happy-app/sources/text/translations/pl.ts`
11. `packages/happy-app/sources/text/translations/ru.ts`

Running `yarn workspace happy-app typecheck` will fail until each file has
matching keys. Use `check:i18n:strict` to find untranslated additions.

---

## Known follow-ups (CLI-side)

1. **`SessionCostTracker` recording**: currently always returns 0. Hook into
   the SDK result-message stream in `claudeRemoteLauncher.ts` — fold each
   `SDKResultMessage` via `sessionCostTracker.record({ model, usage, total_cost_usd })`.

2. **`mcp_call` invocation**: CLI whitelist passes through to
   `server_unavailable` stub. Wire into the SDK's
   `query.setMcpServers()` / `mcpServerStatus()` / reconnect flow to
   actually dispatch the tool call.

3. **Rate limits on new RPCs**: `read_file` (20/min/user) and
   `file_suggestions` (60/min/user) are not yet configured. Add per-method
   rate limits on the server when exposing this to external users.
