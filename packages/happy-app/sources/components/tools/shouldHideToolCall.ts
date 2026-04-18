import { shouldHideSuccessfulHappyMcpTool } from "@kmmao/happy-wire";
import { ToolCall } from "@/sync/typesMessage";

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
  if (!shouldHideSuccessfulHappyMcpTool(tool.name)) {
    return false;
  }

  if (tool.permission?.status === "pending") {
    return false;
  }

  return !hasToolError(tool);
}
