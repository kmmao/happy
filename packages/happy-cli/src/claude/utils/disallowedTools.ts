/**
 * disallowedTools — pure helper for the PTY-mode `--disallowedTools` flag.
 *
 * Extracted so the `claudeRemote.ts` mega-function's tool-deny logic can be
 * unit-tested without standing up the full PTY spawn + JSONL scanner +
 * router machinery.
 *
 * Two invariants the spawn relies on:
 *
 *   1. `AskUserQuestion` is ALWAYS denied. The TUI's in-terminal Q&A
 *      picker has no return channel that the Happy App can submit
 *      answers through, so any AskUserQuestion tool_use hangs the
 *      session indefinitely (see claudeRemote.ts "AskUserQuestion is
 *      also force-disabled here" block for the full history).
 *
 *   2. During a Yolo plan-mode lockdown (`planModeLockdown=true`), the
 *      write/exec tool family is denied so the model can't sidestep
 *      `ExitPlanMode` by writing the plan straight to disk. See
 *      claudeRemoteLauncherCore.ts `planModeLockdownActive` for the
 *      surrounding state machine and the bug it fixes.
 *
 * Order of denies inside the returned array isn't significant for the
 * downstream `--disallowedTools` flag, but we keep it deterministic
 * (base → AskUserQuestion → lockdown set) so tests can assert against
 * a stable shape.
 */

/**
 * Tools moved into `disallowedTools` while a Yolo plan-mode lockdown is
 * active. Mirrors the set that Claude TUI's native `--permission-mode plan`
 * blocks, minus the read-only tools (Read/Grep/Glob/WebSearch/WebFetch)
 * which plan mode is meant to keep available.
 */
export const PLAN_LOCKDOWN_DISALLOWED_TOOLS: ReadonlyArray<string> = [
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
];

export interface BuildDisallowedToolsInput {
  /** Caller-supplied base list (typically from `mode.disallowedTools`). */
  base?: ReadonlyArray<string>;
  /** When true, append the plan-lockdown deny set. */
  planModeLockdown?: boolean;
}

/**
 * Compute the effective `disallowedTools` list passed to `--disallowedTools`.
 * Deduplicates so callers don't have to reason about overlaps between their
 * base list and the invariants this helper enforces.
 */
export function buildPtyDisallowedTools(
  input: BuildDisallowedToolsInput,
): string[] {
  const out = new Set<string>(input.base ?? []);
  out.add("AskUserQuestion");
  if (input.planModeLockdown) {
    for (const tool of PLAN_LOCKDOWN_DISALLOWED_TOOLS) {
      out.add(tool);
    }
  }
  return Array.from(out);
}
