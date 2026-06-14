---
status: accepted
---

# Scope `<options>` / question heuristic to real decision points

## Rule

In `packages/happy-cli/src/claude/utils/systemPrompt.ts`, replace the upstream "almost always end your response with either a question or `<options>`" heuristic with **scoped end-of-response behavior** plus a **separate tool-call-time announce rule for irreversible actions**.

**End with question / `<options>` ONLY when a real decision is needed** — a trade-off where user preference materially changes the outcome AND Claude doesn't already know it. Positive examples: "Use Postgres or MongoDB for the new analytics table?", "Return 404 or 200+empty when this resource is missing?". Negative examples (NOT real decisions): "should I continue?", "want me to run tests?", "ready for the next batch?".

**Skip end-of-response chips in 4 ordered cases** (first match wins):

1. **Mid-plan** — partway through an agreed multi-step plan (Batch 1..N, Phase 1..N, ordered Todo list, roadmap they signed off on). Emit a `→ next: Batch N` pointer; continue silently. Stop only on: **planned checkpoint** (prose summary + pause, layer Q/`<options>` only if a real decision exists at the checkpoint), **unplanned discovery** (surface in prose; Q only if input needed), **staleness signal** (3+ unrelated user turns elapsed OR topic shifted away and back; brief re-confirm "Resuming Batch 5 — still good?"), or an **irreversible action ahead** (see two-layer rule below).
2. **Post-answer** — user just answered; carry it out, do not re-confirm.
3. **One-shot answer** — factual reply, no decision; stop after answering.
4. **Self-contained task complete** — brief summary; `<options>` only IFF a natural next direction exists. Explicitly excludes a single batch/phase completing inside a multi-step plan (that case is **Mid-plan**).

**Two-layer separation for irreversible actions.** Decided INDEPENDENTLY of the end-of-response decision: before any operation that makes external/persistent state changes you can't trivially reverse (`npm publish`, `git push --force` / `--force-with-lease` to a shared branch, mass deletion of files Claude didn't create this session, sending data to a third-party service, production deploys, migrations against a shared database, paid API calls, notifications to real users), announce in plain prose in the same response that calls the tool. The Anthropic streaming window is the user's Ctrl+C escape hatch. Do NOT bury the action inside an `<options>` picker — the user authorized the plan, not each operation inside it. If a single response contains multiple irreversible tool calls, each one is announced before its call: the Ctrl+C window only protects tools that haven't returned yet.

## Trigger

Observed pain: completing Batch 4 of a 7-batch plan → Claude offered 3 options → user picked "continue Batch 5" → Claude restarted exploration from scratch (~2m14s / 2.5k tokens wasted) before any productive work resumed. The upstream heuristic optimizes for chat-UI liveness but penalizes user-authorized batch workflows where continuation IS the only sensible move.

## Scope

**Claude PTY only.** This is the runtime where `<options>` emission is prompt-driven and modifiable via `--append-system-prompt`.

- **Gemini** — `<options>` is **code-driven** in `packages/happy-cli/src/gemini/utils/optionsParser.ts` (`formatOptionsAsXml`). Changing prompt text has no effect. A separate audit of every `formatOptionsAsXml` call site is required if Gemini sessions exhibit the same pain. Tracked in `backlog.md`.
- **Codex** — Happy-side has no `<options>` support for Codex: no parser, no formatter, no prompt instruction. If the underlying Codex model spontaneously emits the block, App would still render chips, but that path is unobserved and unmanaged today. N/A for this ADR's scope.

The cross-provider inconsistency is deliberate and acceptable because (a) Claude is the primary runtime per ADR-0008, (b) Gemini's mechanism is a different code path requiring a different audit, and (c) extending now without observed Gemini pain expands blast radius without proportional value.

## Considered alternatives

- **Leave the upstream heuristic.** Rejected — observed pain is recurring across batch-style work and worsens with plan size.
- **Suppress `<options>` entirely.** Rejected — chips at true decision points (architecture choices, API design, post-task natural next direction) are useful UX; the App's chat UI is designed around them.
- **Cross-provider rewrite in the same change.** Rejected — Gemini is code-driven, requires separate audit; bundling expands blast radius without proportional value. See Scope.
- **Encode behavior in `CLAUDE.md` instead of `systemPrompt.ts`.** Rejected — `CLAUDE.md` is project-scoped and only loads when working in this repo; `systemPrompt.ts` makes the behavior global to every Happy CLI Claude session, including unrelated projects.
- **Even stricter "no chips at all unless explicitly asked".** Rejected — over-corrects; loses the legitimate UX value of chips at true decision points and after self-contained completions with a natural next direction.

## Consequences

- **App chat may feel quieter between agreed-on plan steps.** The `→ next: Batch N` pointer keeps minimal liveness, but users habituated to a chip after every response may notice the change. Revisit if feedback says "cold".
- **"Real decision" judgment is model-side heuristic.** Positive (Postgres/MongoDB; 404/200+empty) and negative ("should I continue?" etc.) examples anchor the definition, but mis-classification at the margin is possible.
- **"Staleness signal" 3+ unrelated turns is approximate.** Relies on model judgment of "unrelated".
- **Gemini sessions retain the upstream behavior.** Cross-provider inconsistency is **known and documented**; the audit (above) is the path to convergence if needed.
- **+~4.9 KB / ~1.4k tokens** to every PTY Claude session's system prompt (6.6 KB → 11.5 KB for `systemPrompt.ts`; predominantly prompt-body additions with a small JSDoc share). Cached by the Anthropic prompt cache (5-min TTL) so amortized cost is negligible; only cold start pays the full delta. In tension with ADR-0003 Minimal scheme (~15k saved) — proportional cost ≈ 9% of those savings. Accepted because each avoided chip-restart cycle (observed at ~2.5k tokens / 2m+ per restart in the Trigger anecdote) recovers the added per-session cost after one to two such avoidances.

## Affected

`packages/happy-cli/src/claude/utils/systemPrompt.ts` — sole edit point. The exported `systemPrompt` flows into every PTY Claude session via `claudeLocal.ts:231` and `claudeRemote.ts:709` (passed as `--append-system-prompt`). Test coverage at `claudeLocal.test.ts:39` mocks the export to `'test-system-prompt'`, so prompt-text changes do not affect tests — behavior must be validated by dogfooding.

## Re-evaluate when

- App user feedback that chat feels "cold" between batches → consider relaxing **Mid-plan** to allow non-blocking chips at batch boundaries.
- Gemini sessions reported with the same batch-interruption pain → trigger the `formatOptionsAsXml` call-site audit referenced in Scope.
- Upstream Claude Code adds native batch-aware or mid-plan-aware behavior → re-evaluate whether the injected rule still adds value (and consider removing to reclaim the ~1.4k tokens).
- Token budget per-session becomes constrained (e.g. ADR-0003 tier changes, very long sessions hitting compaction earlier) → revisit whether the explicit examples, NOTE-blocks, and worked checkpoint examples can be condensed without losing the behavior.
