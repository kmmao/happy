# Diff Visualization & Code Review

This document covers the diff rendering system and code review features in `happy-app`.

## Overview

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Basic unified diff with inline word-level highlighting | Done |
| 2 | Syntax highlighting, line numbers, DiffStatsBar | Done |
| 3 | Split view, expanded context, copy diff, DiffToolbar, EditTabBar | Done |
| 3.5 | Code review accept/reject (YOLO) + quick approve/deny (non-YOLO) | Done |

## Architecture

```
ToolView (inline card)
  ├─ EditView / MultiEditView (tool-specific inline views)
  │   ├─ ToolDiffView (wrapper with scroll/wrap logic)
  │   │   └─ DiffView (core renderer)
  │   ├─ DiffStatsBar (stats in card header)
  │   └─ EditTabBar (multi-edit only)
  └─ Review icons (accept/reject state in header)

ToolFullView (full-screen page)
  ├─ EditViewFull / MultiEditViewFull (tool-specific full views)
  │   ├─ DiffToolbar (unified/split, expand, copy)
  │   ├─ DiffView
  │   └─ EditTabBar (multi-edit only)
  └─ ReviewFooter (accept/reject buttons)
```

---

## Diff Components

### `calculateDiff.ts`

Core diff calculation engine. No UI, pure logic.

| Export | Purpose |
|--------|---------|
| `calculateUnifiedDiff(oldText, newText, contextLines=3)` | Main algorithm: line diff + hunk grouping + inline word-level tokens |
| `splitDiffLines(lines)` | Convert unified lines to side-by-side SplitRow[] for split view |
| `getDiffStatsLight(oldText, newText)` | Fast additions/deletions count (~10x faster, no full diff) |
| `formatUnifiedDiffText(oldText, newText, contextLines)` | Generate git-style unified diff text for clipboard |
| `calculateInlineDiff(oldLine, newLine)` | Word-level diff tokens using diffWordsWithSpace |
| `findBestMatch(removedLines, addedLines)` | Heuristic line pairing (30% similarity threshold + substring matching) |

Key types: DiffToken, DiffLine, DiffHunk, DiffResult, SplitRow

### `DiffView.tsx`

Main diff renderer component.

Props:
- oldText, newText: string
- contextLines?: number (default 3)
- showLineNumbers?: boolean
- showPlusMinusSymbols?: boolean
- showDiffStats?: boolean
- language?: string | null (syntax highlighting language)
- viewMode?: "unified" | "split"
- expandedContext?: boolean (show all context lines)
- collapsible?: boolean (hunk-level collapse support)
- wrapLines?: boolean
- fontScaleX?: number
- maxHeight?: number

Features:
- Hunk-level collapsing (collapsedHunks state)
- Inline diff tokens take priority over syntax tokens
- Leading whitespace rendered as mid-dot (·)
- Unified and split rendering modes
- Theme colors from theme.colors.diff.*

### `DiffStatsBar.tsx`

Compact +X -Y stats with proportional green/red bar. Returns null when total is 0.

### `DiffToolbar.tsx`

Toolbar with toggle buttons for unified/split mode, expand/collapse context, and copy diff.

Props:
- viewMode: "unified" | "split"
- onViewModeChange: (mode) => void
- expandedContext: boolean
- onExpandedContextChange: (expanded) => void
- onCopyDiff: () => void
- showSplitOption?: boolean (only shown when screen width >= 600)

### `EditTabBar.tsx`

Horizontal scrollable tab bar for multi-edit views. Each tab shows filename, +/- counts,
and active state. Returns null when items.length <= 1.

### `syntaxTokenizer.ts`

Regex-based syntax tokenizer supporting 12+ languages.

| Export | Purpose |
|--------|---------|
| `tokenizeCode(code, language)` | Full code tokenization |
| `tokenizeLine(lineText, language)` | Single-line tokenization (DiffView optimization) |
| `getSyntaxColor(type, nestLevel, theme)` | Token type to color mapping |
| `getLanguageFromPath(filePath)` | File extension to language ID |

Token types: keyword, controlFlow, type, string, number, comment, function, method,
property, operator, bracket (30+ types total). Bracket nesting cycles through 5 color levels.

### `ToolDiffView.tsx`

Wrapper around DiffView that reads wrapLinesInDiffs setting.
Split mode forces wrap (column width is limited).
Uses horizontal ScrollView when wrap is disabled.

---

## Tool Views

### Inline Views (in card)

| Component | Tool | Features |
|-----------|------|----------|
| EditView.tsx | Edit | Simple ToolDiffView wrapper, auto-detects language from file path |
| MultiEditView.tsx | MultiEdit | EditTabBar + per-edit ToolDiffView, pre-computes stats via getDiffStatsLight() |

### Full Views (full-screen page)

| Component | Tool | Extra Features |
|-----------|------|----------------|
| EditViewFull.tsx | Edit | DiffToolbar (unified/split, expand, copy diff to clipboard) |
| MultiEditViewFull.tsx | MultiEdit | EditTabBar + DiffToolbar, auto-scroll to tab, combined copy for all edits |

Split view option only shown when screenWidth >= 600.

---

## Code Review System

### Two Modes

| Mode | Trigger | UI Location | Action |
|------|---------|-------------|--------|
| Quick Approve/Deny (non-YOLO) | tool.permission.status === "pending" | ToolView header | sessionAllow() / sessionDeny() |
| Code Review (YOLO) | tool.state === "completed" + isMutableTool() | ToolView header + ReviewFooter | Accept (mark) / Reject (revert msg) |

The two modes never overlap: isReviewable excludes permission.status === "pending",
and the pending override in ToolView runs after the completed switch case.

### `useToolReview.ts`

Shared hook for ToolView (inline) and ReviewFooter (full view).

```
useToolReview({ tool, messageId?, sessionId? }) => {
  isReviewable: boolean;
  reviewState: "accepted" | "rejected" | undefined;
  onAccept: () => void;
  onReject: () => void;
}
```

isReviewable conditions (all must be true):
1. tool.state === "completed"
2. isMutableTool(tool.name) — Edit, Write, MultiEdit, etc.
3. tool.permission?.status !== "pending" — no conflict with quick approve
4. sessionId exists
5. messageId exists

Accept: storage.getState().setToolReview(messageId, "accepted") — visual feedback only.

Reject:
1. Modal.alert() confirmation with file path
2. setToolReview(messageId, "rejected")
3. sync.sendMessage(sessionId, revertMessage) — asks Claude to revert the edit

### `ReviewFooter.tsx`

Full view component rendered at the bottom of ToolFullView.
Two vertical buttons with left-border styling:
- Pending: Colored text (green for accept, red for reject)
- Accepted: Left border highlight, reject button dimmed (opacity 0.3)
- Rejected: Left border highlight, accept button dimmed

### State Management (in storage.ts)

```
// State (in-memory, not persisted)
reviewedTools: Record<string, "accepted" | "rejected">

// Action (immutable update)
setToolReview: (messageId: string, state: "accepted" | "rejected") => void

// Reactive hook (with useShallow for performance)
useToolReviewState(messageId?: string): "accepted" | "rejected" | undefined
```

State is keyed by messageId (from ToolCallMessage.id), not by tool call ID
(which doesn't exist on ToolCall).

---

## i18n Keys

All keys must exist in _default.ts + 10 translation files
(en, zh-Hans, zh-Hant, ja, ru, es, pt, it, pl, ca).

```
// Diff toolbar
diff.toolbar.unified
diff.toolbar.split
diff.toolbar.expand
diff.toolbar.collapse
diff.toolbar.copyDiff
diff.toolbar.copied

// Code review
codeReview.accept
codeReview.reject
codeReview.accepted
codeReview.rejected
codeReview.rejectConfirmTitle
codeReview.rejectConfirmMessage     // ({ filePath }) => string
codeReview.rejectConfirm

// Multi-edit
tools.multiEdit.editNumber          // ({ index, total }) => string
tools.multiEdit.replaceAll
```

---

## Known Limitations & Future Optimization Ideas

1. **DiffToolbar discoverability** — Split View, Expand Context, and Copy Diff are only
   accessible in the full-screen view. Users must tap into a tool card to see them.
   Consider adding a compact toolbar or hints in the inline view.

2. **Review state is in-memory only** — Refreshing the app resets all review states.
   This is intentional (lightweight), but could be persisted if users want
   cross-session review tracking.

3. **useToolReview called for all tools** — The hook runs in every ToolView instance,
   including read-only tools (Read, Grep, etc.). The useShallow selector minimizes
   re-renders, but skipping the hook for non-mutable tools could further optimize.

4. **Reject sends free-text message** — The revert request relies on Claude understanding
   natural language. A more reliable approach could use a structured command/API
   if one becomes available.

5. **Split view minimum width** — Split mode requires screenWidth >= 600.
   On narrow screens, only unified mode is available.

6. **Syntax tokenizer is regex-based** — Works well for common languages but may miss
   edge cases. A tree-sitter integration would be more accurate but significantly heavier.

7. **No batch review** — Users must accept/reject each tool call individually.
   A "review all" or "accept remaining" feature could speed up review of large sessions.

---

## File Index

| File | Type | Purpose |
|------|------|---------|
| components/diff/calculateDiff.ts | Logic | Core diff algorithm |
| components/diff/DiffView.tsx | UI | Main diff renderer |
| components/diff/DiffStatsBar.tsx | UI | +/- stats bar |
| components/diff/DiffToolbar.tsx | UI | View mode / expand / copy toolbar |
| components/diff/EditTabBar.tsx | UI | Multi-edit tab selector |
| components/diff/syntaxTokenizer.ts | Logic | Regex syntax highlighting |
| components/tools/ToolDiffView.tsx | UI | DiffView wrapper with settings |
| components/tools/views/EditView.tsx | UI | Inline single edit view |
| components/tools/views/EditViewFull.tsx | UI | Full single edit view |
| components/tools/views/MultiEditView.tsx | UI | Inline multi-edit view |
| components/tools/views/MultiEditViewFull.tsx | UI | Full multi-edit view |
| components/tools/ReviewFooter.tsx | UI | Full view review buttons |
| components/tools/useToolReview.ts | Hook | Review state + actions |
| components/tools/ToolView.tsx | UI | Inline tool card (review icons) |
| components/tools/ToolFullView.tsx | UI | Full view container (ReviewFooter) |
| sync/storage.ts | State | reviewedTools + setToolReview + useToolReviewState |
| text/_default.ts | i18n | Default English strings |
| text/translations/*.ts | i18n | 10 language translations |
