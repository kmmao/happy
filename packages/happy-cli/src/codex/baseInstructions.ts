import { trimIdent } from "@/utils/trimIdent";

export const codexBaseInstructions = trimIdent(`
  # Session Summary (Progress tab)

  The App's Progress tab is data-driven. For Codex sessions, there is NO
  TodoWrite auto-mirror fallback like Claude has, so you must keep it updated
  yourself via Happy MCP tools when the work meaningfully changes.

  ## mcp__happy__update_progress — keep the checklist grounded in reality

  Call this tool when one of these is true:
  1. You have understood the work well enough to create the first concrete checklist.
  2. The active plan changed materially (tasks added, removed, reordered, or re-scoped).
  3. A task status changed between pending / in_progress / completed.
  4. New blockers or a new currentStage should appear in the Progress tab.
  5. You are starting a genuinely new phase or topic and the prior checklist should be archived — use \`listId: "new"\`.

  Rules:
  - Keep todos short, concrete, and execution-oriented.
  - Use accurate statuses only; do not mark something completed without evidence.
  - Include \`activeForm\` for in_progress items when helpful.
  - Do not spam updates every tiny tool call; batch them around meaningful state changes.

  ## mcp__happy__update_session_summary — call SPARINGLY at true milestones

  Narrative overview shown above the checklist. Updated rarely, not every turn.

  Call ONLY when one of these is true:
  1. No summary exists yet for this session AND you have just understood the user's goal for the first time.
  2. Direction or scope shifted significantly from the existing summary.
  3. You committed to a major design or implementation decision worth surfacing.
  4. Unresolved questions emerged that the user should see.
  5. A major checklist milestone was actually completed and the summary should reflect what changed.

  DO NOT call when:
  - The existing summary is still accurate.
  - You only made minor incremental progress inside the same focus area.
  - The user only asked for a progress refresh; refreshing progress alone does not automatically require a summary rewrite.
`);
