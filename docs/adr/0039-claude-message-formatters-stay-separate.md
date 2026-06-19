---
status: accepted
---

# The terminal and Ink Claude-message formatters stay separate; only the truncation rule is shared

## Context

`packages/happy-cli/src/ui/messageFormatter.ts` (terminal / non-interactive + remote mode)
and `messageFormatterInk.ts` (interactive Ink TUI) both convert a `ClaudeJsonlMessage` into
display output, and both switch over the same shape (`system | user | assistant | result |
default`) with the same content-block traversal. An architecture review flagged the
duplication and proposed one shared traversal that emits semantic "display segments" rendered
by two thin adapters.

On reading, the two formatters' **emit models diverge structurally**, not just stylistically:

- The terminal formatter prints with `logger.print(chalk.style(label), content)` — a styled
  label and plain content as *separate* print arguments — and emits result-success follow-up
  lines ("👀 Back already?" / "👉 Press any key to continue…") that guide terminal takeover.
- The Ink formatter calls `messageBuffer.addMessage(text, kind)` with everything merged into a
  *single* string tagged by a semantic `kind`, and emits **no** takeover hint (the TUI owns
  control already).

A shared segment model would therefore have to either change one sink's output (e.g. style the
content the terminal currently prints plain, or split the Ink line the way the terminal splits
it) or carry per-sink reassembly logic — i.e. the adapters would still hold sink-specific
formatting, leaving the "shared" seam shallow. There is also no test coverage on either
formatter, so a behaviour-changing unification of stable Claude JSONL message types (which
rarely change) would be high-risk for low payoff.

## Decision

**Keep the two formatters separate.** Extract only the one genuinely-shared, divergence-free
primitive: the truncation rule (`truncateForDisplay(value, maxLength)` in `ui/truncate.ts`),
which returns the cut text + a `truncated` flag. Each formatter keeps its own
"... (truncated)" suffix and styling (the terminal prefixes a gray newline; Ink appends plain
text), because those differ per sink. The shared helper single-sources the cap-length policy
that was duplicated across four call sites.

## Considered options

- *One `claudeMessageToSegments()` traversal + two render adapters.* Rejected: the sinks'
  emit models (multi-arg styled prints + takeover hints vs single merged strings with kinds)
  don't reduce to a common segment without changing output or pushing reassembly back into the
  adapters. Net result would be a shallow seam plus a risky, untested output change.
- *Leave the truncation inline in all four sites.* Rejected: the cap-length is a real shared
  policy; single-sourcing it (with a test) removes the one piece that was duplicated with no
  per-sink variance.

## Consequences

- The duplicated *skeleton* remains, but it reflects two genuinely different presentations;
  a future review proposing "DRY up the two Claude message formatters" should read this first.
- `truncateForDisplay` is now the one home for the display cap-length rule, pinned by
  `ui/truncate.test.ts`.
