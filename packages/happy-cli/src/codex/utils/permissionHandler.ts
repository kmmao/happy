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
  BasePermissionHandler,
  PermissionResult,
  PendingRequest,
} from "@/utils/BasePermissionHandler";

// Re-export types for backwards compatibility
export type { PermissionResult, PendingRequest };

const ALWAYS_AUTO_APPROVE_NAMES = [
  "change_title",
  "happy__change_title",
  "mcp__happy__change_title",
];

const ALWAYS_AUTO_APPROVE_IDS = ["change_title"];

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
    const lowerToolName = toolName.toLowerCase();
    const lowerToolCallId = toolCallId.toLowerCase();
    const reason = getReason(input);

    if (
      ALWAYS_AUTO_APPROVE_NAMES.some((name) => lowerToolName.includes(name)) ||
      ALWAYS_AUTO_APPROVE_IDS.some((id) => lowerToolCallId.includes(id))
    ) {
      return true;
    }

    return (
      reason.includes("happy") &&
      (reason.includes("title update") || reason.includes("title updates"))
    );
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

      this.session.updateAgentState((currentState) => ({
        ...currentState,
        completedRequests: {
          ...currentState.completedRequests,
          [toolCallId]: {
            tool: toolName,
            arguments: input,
            createdAt: Date.now(),
            completedAt: Date.now(),
            status: "approved",
            decision,
          },
        },
      }));

      return { decision };
    }

    return new Promise<PermissionResult>((resolve, reject) => {
      this.pendingRequests.set(toolCallId, {
        resolve,
        reject,
        toolName,
        input,
      });

      this.addPendingRequestToState(toolCallId, toolName, input);

      logger.debug(
        `${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${toolCallId}) in ${this.currentPermissionMode} mode`,
      );
    });
  }
}
