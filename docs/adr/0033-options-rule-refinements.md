---
status: accepted
amends: 0030
---

# Refine `<options>` rules — explicit two-trigger gate, allow 1 option, principle-led ordering

## Rule

In `packages/happy-cli/src/claude/utils/systemPrompt.ts`, refine the `<options>` rules established by [ADR-0030](0030-scope-options-heuristic-to-real-decisions.md). ADR-0030 stays valid as the **scope and skip-list** authority; this ADR tightens **how `<options>` itself is gated, sized, ordered, and framed**. Six specific changes:

1. **Two explicit triggers replace the implicit carve-out.** ADR-0030 gated `<options>` on "a real decision is needed" but then re-admitted "self-contained task complete with a natural next direction" inside the Skip list. The two read as contradictory (the negative example "want me to run tests?" sounds exactly like a natural-next chip). Restructure as two named triggers at the top: **(1) Real decision needed** and **(2) Self-contained task complete with a natural next direction**. Trigger 2 is explicitly the softer trigger; the Skip-list entry for "Self-contained task complete" now references Trigger 2 instead of duplicating its logic.
2. **Count: 2-4 → 1-4, with "do not manufacture" clause.** A floor of 2 forced contrived alternatives whenever the natural answer was a single action. New rule: prefer 1 when there's one clear next step; three weak options is worse than one strong one.
3. **First-option framing exposes the trap.** The old text — "what a senior engineer would do next without being asked" — was self-defeating: if you'd do it without being asked, you should just do it. New text reframes the first option as "the most plausible direction the user would pick" AND surfaces the trap explicitly: if the next step is obvious enough you'd auto-execute it, skip `<options>` entirely (announcing if irreversible per the other rule).
4. **Stage ordering becomes principle-led.** The five enumerated cases (after code changes / fixing bugs / planning / deploying / errors) don't cover refactors, config changes, doc edits, schema changes, etc. Promote the underlying principle — **shortest feedback loop first** — and keep the enum as concrete examples. When the case isn't listed, the model applies the principle directly.
5. **Inspection-only exception clarified.** Old rule: "Exclude passive inspection-only actions ... unless they lead to a concrete decision" — the exception got swallowed by the prohibition. New rule: reading source/docs/logs IS valid IFF it's the necessary input to a downstream decision, with positive ("read failing test source before fixing") and negative ("review the diff" with no follow-up) examples up front.
6. **Staleness signal: semantic, not turn-count.** ADR-0030 set the threshold at "roughly 3+ unrelated turns". A single off-topic question shouldn't reset a plan; several turns about something else genuinely should. Replace the count with the semantic signal: do the user's recent messages still reference the plan's terminology, artifacts, or batch numbers?

## Trigger

Each fix maps to an observed or anticipated failure mode:

- **#1 contradiction**: Model behavior is inconsistent at task boundaries — sometimes emits `<options>` for cases the "real decision" gate would reject; sometimes withholds for natural-next-direction cases the carve-out admits. Two-trigger framing eliminates the ambiguity.
- **#2 forced 2+**: Repeated observation that follow-on responses include 2–3 chips where 1 was the only real option, with the others being "run lint" / "view diff" filler. Filler trains users to ignore the panel.
- **#3 first-option self-conflict**: Rule said "first = what you'd do without being asked"; the skip-list said "if you'd do it without being asked, just do it". The chip exists precisely for cases where the user might redirect — the rule now names that.
- **#4 stage enum gaps**: Refactors and config edits don't fit any of the five enumerated stages. Models default to the closest enum match, producing wrong orderings (e.g. "commit" before "verify behavior unchanged"). Principle-led ordering handles new cases.
- **#5 inspection over-correction**: Models internalize the prohibition and drop legitimately useful "read X before deciding Y" options. Clarifying that purposeful reading qualifies restores the valid use.
- **#6 staleness brittleness**: "3+ turns" was arbitrary and brittle — a single off-topic clarification within an active plan was triggering re-confirmation. Semantic signal aligns with the actual cognitive shift the rule is trying to detect.

## Scope

**Same as ADR-0030: Claude PTY only.** Gemini's `<options>` is code-driven in `optionsParser.ts`; Codex has no `<options>` support. This ADR does not touch either. Cross-provider convergence remains backlog work.

## Considered alternatives

- **Add a `kind="decision" | "next-action"` attribute and let App render them differently.** Rejected — requires parser changes in `packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts`, schema changes in `useLatestOptions`, and renderer changes. Out of scope for a prompt-only refinement; revisit when there's a concrete UX delta the App wants to show.
- **Add an `order="N"` or `weight="strong|weak"` attribute to individual options.** Same rejection: parser/schema/renderer work for marginal benefit. The "first = recommended" convention is preserved by the prompt; UI keeps reading position.
- **Add a `chain="1|2|..."` attribute to mark sequential follow-ups.** Same rejection plus a UX question: chained chips imply queueing on selection, which the App doesn't support today. Sequential workflows currently rendered as "either / or" remain a known UX limitation.
- **Delete the "Self-contained task complete" Skip entry entirely** (since Trigger 2 covers it). Rejected — keeping the entry preserves the parallel structure of the Skip list (all 4 termination modes named in one place) and provides a final cross-reference. Tightened to reference Trigger 2 rather than duplicate the rule.
- **Rewrite ADR-0030 in place rather than amend.** Rejected — ADR-0030 documents the original rationale (Trigger of recurring batch-restart pain, the two-layer separation, the Gemini/Codex scope). That history is valuable; amend with a separate ADR.

## Consequences

- **Tighter signal-to-noise on `<options>`.** Fewer panels overall (skip-when-obvious), fewer chips per panel (1-4 floor), but each remaining chip is more deliberate. Users may notice the panel appearing less often.
- **Token delta is small.** Net change to `systemPrompt.ts` body is approximately ±0; some lines longer (trigger explanations, trap framing), some shorter (Skip-list entry now a reference instead of full restate). Within prompt-cache noise.
- **"Most plausible direction" is still a judgment call.** Like "real decision" in ADR-0030, the new framing relies on model heuristic. Mis-classification at the margin remains possible but the trap clause makes the worst failure mode (offering chips for actions you should auto-execute) explicit.
- **Stage-ordering meta-principle is broader.** Models will infer ordering for unlisted cases (refactor, config, schema, docs) — fewer mis-orderings, but also less determinism. Acceptable; the principle is well-defined.
- **Staleness signal is harder to game.** Removing the turn-count makes false positives less common but removes a clear trigger the model could mechanically check. Net positive — the count was a brittle proxy for the actual cognitive shift.

## Affected

`packages/happy-cli/src/claude/utils/systemPrompt.ts` — same sole edit point as ADR-0030. Flows into every PTY Claude session via `claudeLocal.ts` / `claudeRemote.ts` as `--append-system-prompt`. Tests mock the export to `'test-system-prompt'`, so prompt-text changes do not affect test outcomes — behavior must be validated by dogfooding.

## Re-evaluate when

- Dogfooding shows the **1-option floor** producing under-suggestion at task completion (users wanting more direction options) → consider re-introducing a soft "if 2+ options are genuinely distinct, list them" hint.
- Models are observed **incorrectly classifying "real decision" vs "natural next direction"** at the margin → revisit the boundary or add a third trigger.
- App adopts a `kind="..."` rendering distinction → fold the two triggers into a single rule with the attribute and let the UI tell them apart.
- Cross-provider unification with Gemini/Codex finally happens → re-evaluate whether the rule still belongs as a prompt fragment vs. shared schema.
