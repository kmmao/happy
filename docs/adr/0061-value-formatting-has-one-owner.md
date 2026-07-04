---
status: accepted
---

# App value formatting (model / cost / tokens / duration) has one owner

## Context

How the App renders a handful of primitive values — a model id, a USD cost, a
token count, a duration — was scattered as local `function format*` copies across
many components, with subtle, drift-prone differences:

- **token count**: `formatUsage.ts` already owned `formatTokenCount`
  ("1.2K tokens", with suffix) and `formatTokenCountShort` ("1.2K", uppercase K).
  Yet `MessageView`, `TurnTimelineMessageView`, `HappyUpdateProgressView`, and
  `TaskView` each redefined their OWN local `formatTokenCount` — most using a
  *lowercase* "k" and no suffix, one with adaptive decimals, one missing the M
  branch entirely.
- **model name** (strip trailing `-\d{8}` date): byte-identical local copies in
  `MessageView` and `TurnTimelineMessageView`, plus an inline `.replace(...)` in
  `TaskView`. (`sessionModelLabel` and `modelModeOptions.formatModelName`
  *prettify* — "Opus (1M)", "GPT-5" — a genuinely different operation.)
- **cost**: `<0.01?4dp:2dp` copied byte-identically in `MessageView` and
  `TurnTimelineMessageView`; an always-4-decimals variant in `UsagePanel` and the
  supervisor-run screen.
- **duration**: `MessageView` and `TaskView` shared "Xm Ys / X.Xs";
  `TurnTimelineMessageView` added a sub-second "Xms" branch; `formatDurationMs`
  is a third, floor-based h/m/s clock form.

A change to "how we show tokens" (or a decision to make `k`/`K` consistent) had
to be found and edited in ~8 places, and the copies had already drifted.

## Decision

`utils/formatUsage.ts` is the single owner of primitive value formatting. It
exposes each *intentional* presentation as a distinct named export, and the
byte-identical local copies are deleted and re-imported:

- `formatModelName(model)` — raw date-strip (NOT the prettified label).
- `formatCostUsd(cost)` — adaptive 4/2-decimal cost.
- `formatTokensCompact(count)` — lowercase-k, no-suffix token style.
- `formatDurationCompact(ms)` — "Xm Ys" / decimal-seconds.
- (existing `formatTokenCount`, `formatTokenCountShort`, `formatDurationMs`
  stay — they are different presentations, now documented alongside the rest.)

Migrated: `MessageView` (model/tokens/duration/cost), `TurnTimelineMessageView`
(model/tokens/cost), `TaskView` (model/tokens/duration).

## Intentionally NOT unified (documented, not drift)

- `TurnTimelineMessageView.formatDuration` keeps its extra sub-second "Xms"
  branch — kept local with a comment pointing here.
- `MessageView.formatTokensShort` (2-decimal M, `toLocaleString` under 1000) —
  the compact-boundary bubble's own style; left local (already carries an
  explanatory comment).
- Always-4-decimals cost in `UsagePanel` / supervisor-run detail screens — a
  "precise" presentation for detail views, not the adaptive inline one.
- `sessionModelLabel` / `modelModeOptions.formatModelName` — prettified labels,
  a different operation from the raw date-strip.
- `HappyUpdateProgressView.formatTokenCount` — adaptive-decimal variant, left
  local.

## Consequences

- One edit changes a shared presentation everywhere it is shared; the remaining
  local variants are explicitly the ones that must differ, each annotated.
- `TaskView`'s token display gains the M branch it was missing (≥1M now renders
  "1.2M" instead of "1234.5k") — a small correctness improvement folded in.
- The owner is unit-tested (`formatUsage.test.ts`); the presentation contracts
  are pinned without mounting components.
- New value formatting goes to `formatUsage.ts`; a new local `function format*`
  in a component is the smell that this ADR is being re-litigated.
