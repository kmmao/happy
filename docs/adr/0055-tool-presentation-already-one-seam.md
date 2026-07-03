---
status: accepted
---

# Tool presentation already lives behind one seam — knownTools stays a registry

## Context

An architecture review proposed a "ToolPresentation interface" to consolidate
tool title/subtitle/icon rules, claiming the rules were scattered across
`knownTools.tsx`, `codexBashPresentation.ts`, `ToolView.tsx`, and per-tool
views with no tests. Verifying the claim against the code disproved it:

- **The formatters are already one module with tests.**
  `codexBashPresentation.ts` owns icon/title/description/meta-label rules for
  Codex bash summaries; `codexBashPresentation.test.ts` pins them. Its three
  consumers (`knownTools.tsx`, `ToolView.tsx`, `CodexBashView.tsx`) all
  import the same functions — the "4 inconsistent call sites" were consumers
  of ONE implementation, not re-derivations.
- **The tools cluster is not an untested cluster.** 16 test files pin the
  pure logic (`toolProvider`, `toolVisibility`, `shouldHideToolCall`,
  `toolChromeTheme`, `codexCommandUtils`, `codexDiffUtils`,
  `codexPatchUtils`, …). What has no tests is JSX rendering, which this
  codebase deliberately does not unit-test (no DOM test environment).
- **`knownTools.tsx` (2.4k lines) is a registry, not a grab-bag.** One
  declarative entry per tool — title rule, icon, Zod input/result schemas,
  visibility flags — behind a lookup interface (`knownTools[name]`,
  `isMutableTool`). By the deletion test it earns its keep: deleting it
  scatters every tool's display rules into its view. "Adding a tool" is one
  entry in one file — that locality is the point; splitting per-tool files
  would trade it for 50 small shallow modules.

## Decision

No ToolPresentation abstraction. `knownTools.tsx` stays a single declarative
registry; `codexBashPresentation.ts` stays the owner of Codex bash display
rules; per-tool views keep consuming both. A future review proposing to
"consolidate tool formatters" or "split knownTools" should verify against
this ADR first.

## Consequences

- New tools keep registering in one place.
- If a SECOND provider grows bash-summary presentation rules (a real second
  adapter), extracting a shared presentation interface becomes worth
  revisiting — that, not file size, is the trigger.
