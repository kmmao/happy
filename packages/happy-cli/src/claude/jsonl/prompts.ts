export const PLAN_FAKE_REJECT = `User approved plan, but you need to be restarted. STOP IMMEDIATELY TO SWITCH FROM PLAN MODE. DO NOT REPLY TO THIS MESSAGE.`
export const PLAN_FAKE_RESTART = `PlEaZe Continue with plan.`

/**
 * "Clear context & execute" path (Layer 0, see docs/investigations/plan-mode-429.md).
 * After the launcher runs `/clear` (context → 0, no model call), this wraps the
 * approved plan body into the first instruction of the fresh session. Because
 * the request body no longer carries the ~400K --resume replay, it stays under
 * Anthropic's 200K long-context billing line and never 429s.
 */
export function buildPlanExecutionPrompt(planText: string): string {
  return `以下是已批准的计划，请完整执行：\n\n${planText}`
}

/**
 * Happy-flavored replacement for the SDK 0.2.119+ plan-mode workflow body.
 * The SDK still wraps this with its read-only enforcement preamble and the
 * ExitPlanMode protocol footer, so we only restate the workflow itself —
 * adding Happy-specific surfaces the default does not know about (ExitPlanMode
 * as the sole approval point, plus a plain-text fallback for clarification
 * questions when the interactive Q&A tool is unavailable in PTY mode).
 *
 * Keep this tight: the SDK already injects enough preamble/footer, and long
 * system reminders cost tokens on every plan-mode turn.
 */
export const HAPPY_PLAN_MODE_INSTRUCTIONS = `When in plan mode, your job is to produce a concrete, actionable plan — not to execute it.

Research protocol:
- Use read-only tools (Read, Grep, Glob, read-only Bash) to map the problem before drafting.
- Read the relevant files in full when behavior depends on their contents.
- Prefer verifying claims against the code over restating memory.

Clarification protocol:
- If the request has ambiguous tradeoffs (API shape, approach A vs B, scope boundaries), resolve them BEFORE drafting.
- If an interactive question tool (AskUserQuestion / request_user_input) is available, use it — the user gets a one-tap picker UI.
- If no interactive question tool is available (happy-cli's PTY mode disables the native AskUserQuestion because its Q&A UI has no return channel), use the \`mcp__happy__ask_user\` MCP tool instead — its input schema is identical to AskUserQuestion's and it renders the same picker UI in the App, with the answers returned as the tool result.
- If even \`mcp__happy__ask_user\` is missing, fall back to plain-text numbered options so the user can answer with a digit.
- Only ask when a clarification would materially change the plan. Do not ask about trivia.

Plan composition:
- Concrete: list exact files to change, functions/components to add or refactor, migration order.
- Scoped: stay within the user's ask; flag out-of-scope temptations instead of silently expanding.
- Risk-aware: call out reversibility, blast radius, and anything you had to guess.

When your plan is ready, call ExitPlanMode with the plan body in markdown. ExitPlanMode IS the approval checkpoint — do not ask "shall I proceed?" inline.`;