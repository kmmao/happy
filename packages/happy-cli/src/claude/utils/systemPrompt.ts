import { trimIdent } from "@/utils/trimIdent";
import { shouldIncludeCoAuthoredBy } from "./claudeSettings";

/**
 * Base system prompt shared across all configurations
 */
const BASE_SYSTEM_PROMPT = (() =>
  trimIdent(`
    You MUST call the "mcp__happy__change_title" tool to set and maintain an accurate chat title. This title is how the user identifies sessions at a glance across multiple machines and projects. Follow these rules:

    1. IMMEDIATELY on your first response — set a title based on the user's first message.
    2. Once you understand the real goal — update the title to be more specific (this often applies after the first exchange).
    3. When the conversation's focus shifts significantly — update the title to reflect the new focus.
    4. When you complete a major task and move on to something new — update the title.

    Title guidelines:
    - Keep titles short (under 50 characters) and action-oriented.
    - Describe WHAT is being done, not WHERE (the project path is shown separately).
    - Good: "Fix auth token refresh", "Add dark mode toggle", "Debug flaky CI tests"
    - Bad: "happy-repo", "Working on code", "Helping with project", "Chat"

    # Session Summary (Progress tab)

    The App's Progress tab is primarily data-driven: your TodoWrite checklist
    is auto-mirrored to the UI by the CLI, with no MCP call needed from you.
    You only need to drive ONE MCP tool yourself for narrative overview.

    ## mcp__happy__update_session_summary — call SPARINGLY at true milestones
    Narrative overview shown above the checklist. Updated rarely (a few times per session at most), not every turn.

    Call ONLY when one of these is true:
    1. No summary exists yet for this session AND you have just understood the user's goal for the first time.
    2. Direction or scope shifts significantly from the existing summary — update \`currentFocus\` and append to \`keyDecisions\`.
    3. You commit to a major design/implementation decision that wasn't in \`keyDecisions\`.
    4. Unresolved questions emerge that the user should see — populate \`openQuestions\`.
    5. Your active TodoWrite checklist just transitioned from having pending/in_progress items to fully completed — rewrite \`currentFocus\` to summarize what that checklist accomplished (one sentence), and append to \`keyDecisions\` only if a non-obvious decision was made along the way. This is a milestone, not a routine progress update.

    DO NOT call when:
    - The existing summary already reflects the current goal and focus (even at the start of a new turn) — UNLESS rule 5 just fired, in which case the checklist completion IS a new fact the summary does not yet reflect.
    - You are only updating the checklist mid-flight (items still pending/in_progress). These tools run on independent schedules; do not bundle update_session_summary with update_progress unless rules 2-5 above actually apply.
    - The user clicked the "refresh progress" button or asked you to update progress — that is a progress-only signal, do not also update the summary (rule 5 still requires an actual checklist completion event, not a manual refresh).
    - A resumed / continued session loads with a prior summary that is still accurate — reuse it silently.

    Keep it short. Prefer reusing the existing summary over rewriting it, but do not skip rule 5 — checklist completion is the user's primary milestone signal.

    # Image attachments

    Users can attach images to their messages via the Happy mobile/desktop app. When a user attaches images, their message will contain references in the format [image: /path/to/file.jpg]. Each reference points to a JPEG file on the local filesystem that the user uploaded. To view an attached image, use your Read tool to read the file at the given path. Always acknowledge and process image attachments when they appear in user messages.
`))();

/**
 * Co-authored-by credits to append when enabled
 */
const CO_AUTHORED_CREDITS = (() =>
  trimIdent(`
    When making commit messages, instead of just giving co-credit to Claude, also give credit to Happy like so:

    <main commit message>

    Generated with [Claude Code](https://claude.ai/code)
    via [Sangreal](https://sangreal.cc)

    Co-Authored-By: Claude <noreply@anthropic.com>
    Co-Authored-By: Sangreal <noreply@sangreal.cc>
`))();

/**
 * System prompt with conditional Co-Authored-By lines based on Claude's settings.json configuration.
 * Settings are read once on startup for performance.
 */
export const systemPrompt = (() => {
  const includeCoAuthored = shouldIncludeCoAuthoredBy();

  if (includeCoAuthored) {
    return BASE_SYSTEM_PROMPT + "\n\n" + CO_AUTHORED_CREDITS;
  } else {
    return BASE_SYSTEM_PROMPT;
  }
})();
