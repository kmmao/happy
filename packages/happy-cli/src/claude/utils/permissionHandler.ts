/**
 * Permission Handler for canCallTool integration
 *
 * Replaces the MCP permission server with direct SDK integration.
 * Handles tool permission requests, responses, and state management.
 */

import { logger } from "@/lib";
import { ClaudeJsonlMessage } from "../jsonl";
import type { PermissionResult, PermissionDecisionClassification } from "../jsonl/types";
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from "../jsonl/prompts";
import { Session } from "../session";
import { getToolName } from "./getToolName";
import { EnhancedMode, PermissionMode } from "../loop";
import { getToolDescriptor } from "./getToolDescriptor";
import { delay } from "@/utils/time";
import { createAllowedToolMatcher } from "./allowedToolMatcher";
import { createToolCallTracker } from "./toolCallTracker";

interface PermissionResponse {
  id: string;
  approved: boolean;
  reason?: string;
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
  allowTools?: string[];
  receivedAt?: number;
  /** User answers for AskUserQuestion — keyed by question text */
  answers?: Record<string, string>;
}

interface PendingRequest {
  resolve: (value: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: unknown;
}

/** Modes that auto-approve all tools except AskUserQuestion */
const BYPASS_MODES: ReadonlySet<string> = new Set(["bypassPermissions", "yolo"]);

export class PermissionHandler {
  // JSONL tool_use ↔ canCallTool matching lives behind this pure seam.
  private tracker = createToolCallTracker();
  private responses = new Map<string, PermissionResponse>();
  private pendingRequests = new Map<string, PendingRequest>();
  private session: Session;
  // Session-wide "already granted" grant/check invariant lives behind this pure seam.
  private allowed = createAllowedToolMatcher();
  private permissionMode: PermissionMode = "default";
  private onPermissionRequestCallback?: (toolCallId: string) => void;

  constructor(session: Session) {
    this.session = session;
    this.setupClientHandler();
  }

  /**
   * Set callback to trigger when permission request is made
   */
  setOnPermissionRequest(callback: (toolCallId: string) => void) {
    this.onPermissionRequestCallback = callback;
  }

  handleModeChange(mode: PermissionMode) {
    this.permissionMode = mode;
  }

  /**
   * Returns true when the current mode is bypassPermissions or yolo.
   * Used by the launcher to avoid downgrading from bypass → plan on EnterPlanMode.
   */
  isInBypassMode(): boolean {
    return BYPASS_MODES.has(this.permissionMode);
  }

  /**
   * Current permission mode. The launcher reads this when queueing the
   * ExitPlanMode continuation (PLAN_FAKE_RESTART) so the relaunched session
   * keeps the user's exact bypass variant ("yolo" vs "bypassPermissions")
   * instead of being silently rewritten.
   */
  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  /**
   * Handler response
   */
  private handlePermissionResponse(
    response: PermissionResponse,
    pending: PendingRequest,
  ): void {
    // Update allowed tools
    if (response.allowTools && response.allowTools.length > 0) {
      response.allowTools.forEach((tool) => this.allowed.grant(tool));
    }

    // Update permission mode
    if (response.mode) {
      this.permissionMode = response.mode;
    }

    // Handle
    if (
      pending.toolName === "exit_plan_mode" ||
      pending.toolName === "ExitPlanMode"
    ) {
      // Handle exit_plan_mode specially
      logger.debug("Plan mode result received", response);
      if (response.approved) {
        logger.debug("Plan approved - injecting PLAN_FAKE_RESTART");
        // Inject the approval message at the beginning of the queue
        if (
          response.mode &&
          ["default", "acceptEdits", "bypassPermissions", "auto", "dontAsk"].includes(
            response.mode,
          )
        ) {
          this.session.queue.unshift(PLAN_FAKE_RESTART, {
            permissionMode: response.mode,
          }, { priority: "urgent", kind: "notification", source: "permission-handler" });
        } else {
          this.session.queue.unshift(PLAN_FAKE_RESTART, {
            permissionMode: "default",
          }, { priority: "urgent", kind: "notification", source: "permission-handler" });
        }
        pending.resolve({ behavior: "deny", message: PLAN_FAKE_REJECT });
      } else {
        pending.resolve({
          behavior: "deny",
          message: response.reason || "Plan rejected",
        });
      }
    } else {
      // Handle default case for all other tools
      // Classify the decision for telemetry:
      //   - allowTools present → user granted session-wide permission (permanent)
      //   - approved without allowTools → one-time allow (temporary)
      //   - denied → user_reject
      const classification: PermissionDecisionClassification = response.approved
        ? response.allowTools && response.allowTools.length > 0
          ? "user_permanent"
          : "user_temporary"
        : "user_reject";

      const result: PermissionResult = response.approved
        ? {
            behavior: "allow",
            classification,
            updatedInput: {
              ...((pending.input as Record<string, unknown>) || {}),
              // For AskUserQuestion: merge user answers into updatedInput
              // so the SDK includes them in the tool_result sent to Claude
              ...(response.answers && { answers: response.answers }),
            },
          }
        : {
            behavior: "deny",
            classification,
            message:
              response.reason ||
              `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`,
          };

      pending.resolve(result);
    }
  }

  /**
   * Creates the canCallTool callback for the SDK
   */
  handleToolCall = async (
    toolName: string,
    input: unknown,
    _mode: EnhancedMode,
    options: { signal: AbortSignal },
  ): Promise<PermissionResult> => {
    // Calculate descriptor early - needed for ExitPlanMode check
    const descriptor = getToolDescriptor(toolName);

    // ExitPlanMode requires special handling in all modes.
    // It must trigger PLAN_FAKE_RESTART to restart the Claude session after plan mode exit.
    // Without it, isAborted() returns true for ExitPlanMode and claudeRemote exits,
    // but the restart message is never queued, causing the session to hang forever.
    if (descriptor.exitPlan) {
      // Auto-approve in bypassPermissions/yolo mode
      if (BYPASS_MODES.has(this.permissionMode)) {
        return this.autoApproveExitPlan(toolName, input);
      }

      // In other modes: go through the normal approval flow (shows Yes/No buttons in App)
      let toolCallId = this.tracker.resolveId(toolName, input);
      if (!toolCallId) {
        await delay(1000);
        toolCallId = this.tracker.resolveId(toolName, input);
        if (!toolCallId) {
          throw new Error(`Could not resolve tool call ID for ${toolName}`);
        }
      }
      return this.handlePermissionRequest(
        toolCallId,
        toolName,
        input,
        options.signal,
      );
    }

    // Check if tool is explicitly allowed (session-wide grant, incl. Bash patterns)
    if (this.allowed.isPreAllowed(toolName, input)) {
      return {
        behavior: "allow",
        updatedInput: input as Record<string, unknown>,
      };
    }

    //
    // Handle special cases
    //

    if (
      BYPASS_MODES.has(this.permissionMode) &&
      toolName !== "AskUserQuestion"
    ) {
      return {
        behavior: "allow",
        updatedInput: input as Record<string, unknown>,
      };
    }

    // In plan mode, auto-approve all non-ExitPlanMode tools (read, search, web, etc.).
    // ExitPlanMode is handled above and is the only meaningful approval checkpoint.
    // AskUserQuestion must still go through permission flow — it's how Q&A reaches the App.
    if (this.permissionMode === "plan" && toolName !== "AskUserQuestion") {
      return {
        behavior: "allow",
        updatedInput: input as Record<string, unknown>,
      };
    }

    if (this.permissionMode === "acceptEdits" && descriptor.edit) {
      return {
        behavior: "allow",
        updatedInput: input as Record<string, unknown>,
      };
    }

    //
    // Approval flow
    //

    let toolCallId = this.tracker.resolveId(toolName, input);
    if (!toolCallId) {
      // What if we got permission before tool call
      await delay(1000);
      toolCallId = this.tracker.resolveId(toolName, input);
      if (!toolCallId) {
        throw new Error(`Could not resolve tool call ID for ${toolName}`);
      }
    }
    return this.handlePermissionRequest(
      toolCallId,
      toolName,
      input,
      options.signal,
    );
  };

  /**
   * Handles individual permission requests
   */
  private async handlePermissionRequest(
    id: string,
    toolName: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve, reject) => {
      // Set up abort signal handling
      const abortHandler = () => {
        this.pendingRequests.delete(id);
        reject(new Error("Permission request aborted"));
      };
      signal.addEventListener("abort", abortHandler, { once: true });

      // Store the pending request
      this.pendingRequests.set(id, {
        resolve: (result: PermissionResult) => {
          signal.removeEventListener("abort", abortHandler);
          resolve(result);
        },
        reject: (error: Error) => {
          signal.removeEventListener("abort", abortHandler);
          reject(error);
        },
        toolName,
        input,
      });

      // Trigger callback to send delayed messages immediately
      if (this.onPermissionRequestCallback) {
        this.onPermissionRequestCallback(id);
      }

      // Send push notification
      this.session.api
        .push()
        .sendToAllDevices(
          "Permission Request",
          `Claude wants to ${getToolName(toolName)}`,
          {
            sessionId: this.session.client.sessionId,
            requestId: id,
            tool: toolName,
            type: "permission_request",
          },
        );

      // Update agent state
      this.session.client.updateAgentState((currentState) => ({
        ...currentState,
        requests: {
          ...currentState.requests,
          [id]: {
            tool: toolName,
            arguments: input,
            createdAt: Date.now(),
          },
        },
      }));

      logger.debug(`Permission request sent for tool call ${id}: ${toolName}`);
    });
  }

  /**
   * Auto-approves ExitPlanMode without sending a permission request to the App.
   * Used in bypassPermissions/Yolo mode to avoid hanging while still correctly
   * triggering PLAN_FAKE_RESTART for session continuation.
   */
  private async autoApproveExitPlan(
    toolName: string,
    input: unknown,
  ): Promise<PermissionResult> {
    let toolCallId = this.tracker.resolveId(toolName, input);
    if (!toolCallId) {
      await delay(1000);
      toolCallId = this.tracker.resolveId(toolName, input);
      if (!toolCallId) {
        throw new Error(`Could not resolve tool call ID for ${toolName}`);
      }
    }

    logger.debug(
      `Auto-approving ExitPlanMode in bypassPermissions mode: ${toolCallId}`,
    );

    // Store auto-approved response for isAborted() lookups
    this.responses.set(toolCallId, {
      id: toolCallId,
      approved: true,
      mode: "bypassPermissions",
      receivedAt: Date.now(),
    });

    // Mark the tool call as used
    this.tracker.markUsed(toolCallId);

    // Queue PLAN_FAKE_RESTART to trigger session restart in the outer loop
    this.session.queue.unshift(PLAN_FAKE_RESTART, {
      permissionMode: this.permissionMode,
    }, { priority: "urgent", kind: "notification", source: "permission-handler" });

    // Update agent state to mark as auto-approved (so App shows correct status)
    this.session.client.updateAgentState((currentState) => ({
      ...currentState,
      completedRequests: {
        ...currentState.completedRequests,
        [toolCallId!]: {
          tool: toolName,
          arguments: input,
          createdAt: Date.now(),
          completedAt: Date.now(),
          status: "approved",
          reason: "Auto-approved in Yolo mode",
          mode: "bypassPermissions",
        },
      },
    }));

    // Return deny with PLAN_FAKE_REJECT to trigger the SDK to exit plan mode
    return { behavior: "deny", message: PLAN_FAKE_REJECT };
  }

  /**
   * Handles messages to track tool calls. Delegates to the pure tool-call
   * tracker seam (toolCallTracker.ts).
   */
  onMessage(message: ClaudeJsonlMessage): void {
    this.tracker.ingest(message);
  }

  /**
   * Checks if a tool call is rejected
   */
  isAborted(toolCallId: string): boolean {
    // If tool not approved, it's aborted
    if (this.responses.get(toolCallId)?.approved === false) {
      return true;
    }

    // Always abort exit_plan_mode
    if (this.tracker.isExitPlanCall(toolCallId)) {
      return true;
    }

    // Tool call is not aborted
    return false;
  }

  /**
   * Resets all state for new sessions
   */
  reset(reason: string = 'Session switched to local mode'): void {
    this.tracker.clear();
    this.responses.clear();
    this.allowed.clear();

    // Cancel all pending requests
    for (const [, pending] of this.pendingRequests.entries()) {
      pending.reject(new Error("Session reset"));
    }
    this.pendingRequests.clear();

    // Move all pending requests to completedRequests with canceled status
    this.session.client.updateAgentState((currentState) => {
      const pendingRequests = currentState.requests || {};
      const completedRequests = { ...currentState.completedRequests };

      // Move each pending request to completed with canceled status
      for (const [id, request] of Object.entries(pendingRequests)) {
        completedRequests[id] = {
          ...request,
          completedAt: Date.now(),
          status: "canceled",
          reason,
        };
      }

      return {
        ...currentState,
        requests: {}, // Clear all pending requests
        completedRequests,
      };
    });
  }

  /**
   * Auto-approve all pending permission requests and clear them from agentState.
   * Used when switching to bypassPermissions/Yolo mode mid-turn to prevent
   * stale "needs permission" indicators in the App.
   */
  autoApproveAllPending(): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      this.responses.set(id, { id, approved: true, receivedAt: Date.now() });
      pending.resolve({
        behavior: "allow",
        updatedInput: (pending.input as Record<string, unknown>) || {},
      });
    }
    const approvedIds = [...this.pendingRequests.keys()];
    this.pendingRequests.clear();

    if (approvedIds.length > 0) {
      this.session.client.updateAgentState((currentState) => {
        const requests = { ...currentState.requests };
        const completedRequests = { ...currentState.completedRequests };
        for (const id of approvedIds) {
          const req = requests[id];
          if (req) {
            completedRequests[id] = {
              ...req,
              completedAt: Date.now(),
              status: "approved",
              reason: "Auto-approved on Yolo mode switch",
            };
            delete requests[id];
          }
        }
        return { ...currentState, requests, completedRequests };
      });
      logger.debug(`[permission] Auto-approved ${approvedIds.length} pending requests on mode switch`);
    }
  }

  /**
   * Sets up the client handler for permission responses
   */
  private setupClientHandler(): void {
    this.session.client.rpcHandlerManager.registerHandler<
      PermissionResponse,
      void
    >("permission", async (message) => {
      logger.debug(`Permission response: ${JSON.stringify(message)}`);

      const id = message.id;
      const pending = this.pendingRequests.get(id);

      if (!pending) {
        logger.debug("Permission request not found or already resolved");
        return;
      }

      // Store the response with timestamp
      this.responses.set(id, { ...message, receivedAt: Date.now() });
      this.pendingRequests.delete(id);

      // Handle the permission response based on tool type
      this.handlePermissionResponse(message, pending);

      // Move processed request to completedRequests
      this.session.client.updateAgentState((currentState) => {
        const request = currentState.requests?.[id];
        if (!request) return currentState;
        let r = { ...currentState.requests };
        delete r[id];
        return {
          ...currentState,
          requests: r,
          completedRequests: {
            ...currentState.completedRequests,
            [id]: {
              ...request,
              completedAt: Date.now(),
              status: message.approved ? "approved" : "denied",
              reason: message.reason,
              mode: message.mode,
              allowTools: message.allowTools,
              ...(message.answers && { answers: message.answers }),
            },
          },
        };
      });
    });
  }

  /**
   * Gets the responses map (for compatibility with existing code)
   */
  getResponses(): Map<string, PermissionResponse> {
    return this.responses;
  }
}
