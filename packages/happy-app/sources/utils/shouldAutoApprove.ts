/**
 * Determines whether a tool permission should be auto-approved based on the
 * current permission mode, mirroring the CLI-side logic in permissionHandler.ts.
 *
 * When this returns false, the App should show PermissionFooter for manual review.
 */

/** Edit tools that are auto-approved in acceptEdits mode */
const EDIT_TOOLS = new Set([
    "Edit",
    "MultiEdit",
    "Write",
    "NotebookEdit",
]);

/**
 * Tools that always require manual interaction regardless of mode.
 *
 * Both entries are Q&A channels — auto-approving them would silently call the
 * permission RPC with no answers, dropping the user's input and freezing the
 * model on a never-resolving tool_use. `mcp__happy__ask_user` additionally
 * uses a different RPC (`ask_user_response`), so auto-approving it would hit
 * the wrong handler entirely.
 */
const ALWAYS_MANUAL_TOOLS = new Set([
    "AskUserQuestion",
    "mcp__happy__ask_user",
]);

/** ExitPlanMode tool names (Claude SDK uses both conventions) */
const EXIT_PLAN_TOOLS = new Set([
    "ExitPlanMode",
    "exit_plan_mode",
]);

export function shouldAutoApprove(
    permissionModeKey: string | null | undefined,
    toolName: string,
): boolean {
    // AskUserQuestion always requires manual interaction (it's the Q&A channel)
    if (ALWAYS_MANUAL_TOOLS.has(toolName)) {
        return false;
    }

    // ExitPlanMode always requires manual approval (except in bypassPermissions/yolo)
    if (EXIT_PLAN_TOOLS.has(toolName)) {
        return permissionModeKey === "bypassPermissions" || permissionModeKey === "yolo";
    }

    switch (permissionModeKey) {
        case "yolo":
            // Codex YOLO: auto-approve everything except AskUserQuestion
            return true;

        case "bypassPermissions":
            // Auto-approve everything except AskUserQuestion (handled above)
            return true;

        case "plan":
            // In plan mode, auto-approve all tools except ExitPlanMode (handled above)
            // and AskUserQuestion (handled above)
            return true;

        case "acceptEdits":
            // Only auto-approve edit tools
            return EDIT_TOOLS.has(toolName);

        case "auto":
            // AI classifier handles permissions server-side — no App-side auto-approve
            return false;

        case "dontAsk":
            // Auto-deny unapproved actions — SDK handles it, App shows nothing
            return false;

        case "default":
        case null:
        case undefined:
        default:
            // Default mode: never auto-approve — show review UI
            return false;
    }
}
