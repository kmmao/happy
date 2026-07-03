import { Message } from "@/sync/typesMessage";
import { t } from "@/text";

/**
 * Collapsed tool-group summary — the pure i18n phrasing lifted out of the
 * retired `hooks/useGroupedMessages` module.
 *
 * ToolGroupView renders a run of tool calls collapsed into one row and needs a
 * one-line "what happened" label ("Edited 2 files, ran 1 command"). That mapping
 * (tool name → category → pluralised phrase) was the one genuinely live export
 * of the old grouping module, yet it had no test — the module's tests all
 * covered the now-deleted `groupMessages`. Kept as its own `.ts` module (not
 * inlined into the ToolGroupView `.tsx`, which pulls in react-native) so it
 * stays a pure, unit-testable seam with `@/text` mockable in the test.
 */

// Tool name → summary category. Drives generateGroupSummary's phrasing.
const TOOL_CATEGORIES: Record<string, string> = {
  Edit: "edit", MultiEdit: "edit", Write: "edit",
  CodexPatch: "edit", GeminiPatch: "edit", edit: "edit", NotebookEdit: "edit",
  Read: "read", read: "read", NotebookRead: "read",
  Bash: "terminal", CodexBash: "terminal", GeminiBash: "terminal",
  shell: "terminal", execute: "terminal",
  Grep: "search", Glob: "search", LS: "search", search: "search", WebSearch: "search",
  WebFetch: "web",
  Task: "task", Agent: "task",
};

/** Generate a human-readable summary of the tools in a collapsed group. */
export function generateGroupSummary(messages: Message[]): string {
  const counts: Record<string, number> = {};

  for (const msg of messages) {
    if (msg.kind === "tool-call") {
      const category = TOOL_CATEGORIES[msg.tool.name] || "other";
      counts[category] = (counts[category] || 0) + 1;
    }
  }

  const parts: string[] = [];

  if (counts.edit) parts.push(t("toolGroup.editedFiles", { count: counts.edit }));
  if (counts.read) parts.push(t("toolGroup.readFiles", { count: counts.read }));
  if (counts.terminal) parts.push(t("toolGroup.ranCommands", { count: counts.terminal }));
  if (counts.search) parts.push(t("toolGroup.searched", { count: counts.search }));
  if (counts.web) parts.push(t("toolGroup.fetchedUrls", { count: counts.web }));
  if (counts.task) parts.push(t("toolGroup.ranTasks", { count: counts.task }));
  if (counts.other) parts.push(t("toolGroup.usedTools", { count: counts.other }));

  return parts.join(", ") || t("toolGroup.usedTools", { count: messages.length });
}
