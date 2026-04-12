import { ToolCall } from "@/sync/typesMessage";

const SILENT_TITLE_UPDATE_TOOLS = new Set([
  "change_title",
  "happy__change_title",
  "mcp__happy__change_title",
]);

function hasToolError(tool: ToolCall): boolean {
  if (tool.state === "error") {
    return true;
  }

  if (
    tool.result &&
    typeof tool.result === "object" &&
    !Array.isArray(tool.result) &&
    typeof (tool.result as { error?: unknown }).error === "string"
  ) {
    return true;
  }

  return false;
}

export function shouldHideToolCall(tool: ToolCall): boolean {
  if (!SILENT_TITLE_UPDATE_TOOLS.has(tool.name)) {
    return false;
  }

  if (tool.permission?.status === "pending") {
    return false;
  }

  return !hasToolError(tool);
}
