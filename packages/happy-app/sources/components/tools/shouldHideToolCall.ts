import { shouldHideSuccessfulHappyMcpTool } from "@kmmao/happy-wire";
import { ToolCall } from "@/sync/typesMessage";
import { isHiddenTool } from "./toolVisibility";

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

/**
 * The single predicate for "this tool call renders as null in the chat UI" —
 * the union of the two independent hiding rules: internal plumbing tools
 * (`isHiddenTool`, name-based) and dynamically-hidden successful Happy MCP tools
 * (`shouldHideToolCall`, instance-based). Every consumer that must agree with the
 * renderer (grouping, timeline padding) crosses this seam instead of re-deriving
 * the union, so the two rules cannot drift out of sync.
 */
export function isEffectivelyHiddenToolCall(tool: ToolCall): boolean {
  return isHiddenTool(tool.name) || shouldHideToolCall(tool);
}
