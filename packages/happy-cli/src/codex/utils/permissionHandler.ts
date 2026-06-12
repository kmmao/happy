/**
 * Codex Permission Handler
 *
 * Handles tool permission requests and responses for Codex sessions.
 * Extends BasePermissionHandler with Codex-specific configuration.
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import type { PermissionMode } from "@/api/types";
import {
  HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES,
  shouldAutoApproveHappyMcpReason,
  shouldAutoApproveHappyMcpToolName,
} from "@kmmao/happy-wire";
import {
  BasePermissionHandler,
  PermissionResult,
  PendingRequest,
} from "@/utils/BasePermissionHandler";

// Re-export types for backwards compatibility
export type { PermissionResult, PendingRequest };

const ALWAYS_AUTO_APPROVE_IDS = [...HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES];

function getReason(input: unknown): string {
  if (
    input &&
    typeof input === "object" &&
    typeof (input as { reason?: unknown }).reason === "string"
  ) {
    return (input as { reason: string }).reason.toLowerCase();
  }

  return "";
}

/**
 * Codex-specific permission handler.
 */
export class CodexPermissionHandler extends BasePermissionHandler {
  private currentPermissionMode: PermissionMode = "default";

  constructor(session: ApiSessionClient) {
    super(session);
  }

  protected getLogPrefix(): string {
    return "[Codex]";
  }

  setPermissionMode(mode: PermissionMode): void {
    this.currentPermissionMode = mode;
    logger.debug(`${this.getLogPrefix()} Permission mode set to: ${mode}`);
  }

  private shouldAlwaysAutoApprove(
    toolName: string,
    toolCallId: string,
    input: unknown,
  ): boolean {
    const lowerToolCallId = toolCallId.toLowerCase();
    const reason = getReason(input);

    if (
      shouldAutoApproveHappyMcpToolName(toolName) ||
      ALWAYS_AUTO_APPROVE_IDS.some((id) => lowerToolCallId.includes(id))
    ) {
      return true;
    }

    return shouldAutoApproveHappyMcpReason(reason);
  }

  private shouldAutoApprove(
    toolName: string,
    toolCallId: string,
    input: unknown,
  ): boolean {
    if (this.shouldAlwaysAutoApprove(toolName, toolCallId, input)) {
      return true;
    }

    return (
      this.currentPermissionMode === "yolo" ||
      this.currentPermissionMode === "bypassPermissions"
    );
  }

  /**
   * Handle a tool permission request
   * @param toolCallId - The unique ID of the tool call
   * @param toolName - The name of the tool being called
   * @param input - The input parameters for the tool
   * @returns Promise resolving to permission result
   */
  async handleToolCall(
    toolCallId: string,
    toolName: string,
    input: unknown,
  ): Promise<PermissionResult> {
    if (this.shouldAutoApprove(toolName, toolCallId, input)) {
      const decision =
        this.currentPermissionMode === "yolo" ||
        this.currentPermissionMode === "bypassPermissions"
          ? "approved_for_session"
          : "approved";

      logger.debug(
        `${this.getLogPrefix()} Auto-approving tool ${toolName} (${toolCallId}) in ${this.currentPermissionMode} mode`,
      );

      this.recordAutoApproval(toolCallId, toolName, input, decision);
      return { decision };
    }

    return this.requestPermission(toolCallId, toolName, input);
  }
}
