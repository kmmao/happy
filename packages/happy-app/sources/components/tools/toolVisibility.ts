/**
 * Per-tool visibility metadata — the single source of truth (#129).
 *
 * Deliberately Expo-free: the chat render pipeline (chatTimelineDisplay.ts)
 * is a pure, node-testable module and must not transitively import the icon
 * registry in knownTools.tsx (which pulls in @expo/vector-icons). Both sides
 * read visibility from here: ToolView consults isHiddenTool, the pipeline
 * consults isToolVisibleWithoutInline. Do not re-declare tool-name lists for
 * visibility anywhere else.
 */

/** Internal plumbing tools never rendered in the chat UI (e.g. ToolSearch). */
const HIDDEN_TOOLS = new Set(["ToolSearch"]);

/** Tool calls that stay visible even when the viewInline setting is off. */
const ALWAYS_VISIBLE_TOOLS = new Set([
    "Task",
    "Agent",
    "AskUserQuestion",
    "TodoWrite",
    "Read",
    "Edit",
    "MultiEdit",
    "Write",
    "Grep",
    "Glob",
    "LS",
    "NotebookEdit",
    "CodexDynamicTool",
    "CodexPermissions",
    "unknown",
    "CodexPatch",
    "GeminiPatch",
    "CodexDiff",
    "GeminiDiff",
    "edit",
]);

/** Tools completely hidden from the chat UI regardless of any setting. */
export function isHiddenTool(toolName: string): boolean {
    return HIDDEN_TOOLS.has(toolName);
}

/**
 * Whether a tool call stays visible when the viewInline setting is off:
 * the always-visible set plus any MCP tool. Message-level overrides (e.g.
 * a pending permission request) are the caller's concern.
 */
export function isToolVisibleWithoutInline(toolName: string): boolean {
    if (ALWAYS_VISIBLE_TOOLS.has(toolName)) return true;
    if (toolName.startsWith("mcp__")) return true;
    return false;
}
