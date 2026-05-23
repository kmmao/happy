/**
 * Tools whose specific view contains its own submit UI (the answer-picker /
 * confirmation buttons live inside the tool view itself). For these tools the
 * generic PermissionFooter — "approve / deny / approve forever" buttons — must
 * be suppressed everywhere it would otherwise render: under the tool card in
 * ToolView and inside the bottom-sheet permission popup in PermissionSheet.
 *
 * Why a single shared list:
 * - The hardcoded `toolName === "AskUserQuestion"` whitelist used to be
 *   duplicated across ToolView and PermissionSheet. When `mcp__happy__ask_user`
 *   shipped, the ToolView site got fixed but the PermissionSheet site was
 *   missed — tapping the "需要权限" footer chip rendered the generic
 *   approve/deny UI on top of a "questions: [object Object]" string. Centralise
 *   it so the next picker-style tool only touches one file.
 *
 * Membership criterion: the tool's registered view (see views/_all.tsx) calls
 * its own RPC (sessionAllow with answers, or sessionAskUserResponse for MCP
 * variants) to resolve the pending permission. Approve/deny in the generic
 * footer would short-circuit that path with the wrong arguments.
 */
export const TOOLS_WITH_BUILTIN_SUBMIT_UI = new Set<string>([
  "AskUserQuestion",
  "mcp__happy__ask_user",
]);
