/**
 * Permission Handler for canCallTool integration
 *
 * Replaces the MCP permission server with direct SDK integration.
 * Handles tool permission requests, responses, and state management.
 */

import { logger } from "@/lib";
import { randomUUID } from "node:crypto";
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
import { classifyToolCall, type Classification } from "./autoModeClassifier";

interface PermissionResponse {
  id: string;
  approved: boolean;
  reason?: string;
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
  allowTools?: string[];
  receivedAt?: number;
  /** User answers for AskUserQuestion — keyed by question text */
  answers?: Record<string, string>;
  /**
   * ExitPlanMode "Clear context & execute" opt-in from the App picker. When
   * true, the launcher runs `/clear` then injects the approved plan body into
   * a fresh session instead of the full --resume replay — sidestepping the
   * 200K long-context 429. See docs/investigations/plan-mode-429.md (Layer 0).
   */
  clearContext?: boolean;
}

interface PendingRequest {
  resolve: (value: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: unknown;
}

/**
 * Outcome delivered to the ExitPlanMode approval-forwarder hook. Shaped
 * so the hookServer callback can build a `hookSpecificOutput` response
 * body directly without re-parsing the raw permission wire format.
 *
 *   - `approved: true`  → `permissionDecision: "allow"` + `updatedInput`
 *   - `approved: false` → `permissionDecision: "deny"`  + `reason`
 *
 * `mode` (when present, always alongside `approved: true`) tells the
 * launcher which permission mode to unshift the PLAN_FAKE_RESTART
 * continuation in, matching the App picker's Approve / "Approve &
 * Auto-approve All" split.
 */
export interface ExitPlanApprovalResult {
  approved: boolean;
  mode?: PermissionMode;
  reason?: string;
  updatedInput?: unknown;
  /**
   * True when the App picker chose "Clear context & execute". The launcher
   * (`onExitPlanApproval`) branches on this to run `/clear` + inject the plan
   * body into a new session, instead of the classic PLAN_FAKE_RESTART replay.
   */
  clearContext?: boolean;
}

interface ExitPlanPending {
  resolve: (value: ExitPlanApprovalResult) => void;
  toolInput: unknown;
  timeoutHandle: NodeJS.Timeout;
}

/**
 * Prefix identifying an ExitPlanMode approval request in the shared
 * agentState.requests id space. The RPC `permission` handler routes on
 * this prefix to distinguish App picker → hook-bridge responses from
 * classic SDK canCallTool responses (they share the same wire but need
 * different resolution paths).
 */
const EXIT_PLAN_REQUEST_ID_PREFIX = "exit-plan-";

/**
 * Modes the App may legitimately request when approving an ExitPlanMode
 * picker. Matches the whitelist the SDK-path branch of
 * `handlePermissionResponse` enforces (see the `["default", "acceptEdits",
 * "bypassPermissions", "auto", "dontAsk"].includes(...)` check). Mirrored
 * here so the App-picker RPC path stops any garbage / future-shape mode
 * value before it reaches `PLAN_FAKE_RESTART` and the `--permission-mode`
 * CLI flag downstream.
 */
const EXIT_PLAN_APPROVAL_ALLOWED_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "auto",
  "dontAsk",
];

/** Modes that auto-approve all tools except AskUserQuestion */
const BYPASS_MODES: ReadonlySet<string> = new Set(["bypassPermissions", "yolo"]);

export class PermissionHandler {
  // JSONL tool_use ↔ canCallTool matching lives behind this pure seam.
  private tracker = createToolCallTracker();
  private responses = new Map<string, PermissionResponse>();
  private pendingRequests = new Map<string, PendingRequest>();
  /**
   * Pending ExitPlanMode approvals waiting on the App picker.
   *
   * Kept in a separate map from `pendingRequests` because the resolve
   * shape is different: `pendingRequests` resolves to `PermissionResult`
   * (an SDK-facing allow/deny), whereas this map resolves to the
   * high-level `{approved, mode, reason}` the hookServer callback
   * consumes to build its response body. Sharing the map would force a
   * lossy union type or drive branches on toolName across the whole
   * response-handling code path.
   */
  private exitPlanPending = new Map<string, ExitPlanPending>();
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
    // Auto Mode: silently allow classified-safe (read-only) operations to kill
    // permission-popup fatigue. Dangerous/neutral calls fall through to the
    // approval flow below, carrying the classification so the App can flag risk.
    // AskUserQuestion always goes through — it's how Q&A reaches the App.
    //
    const classification = classifyToolCall(toolName, input);
    if (
      this.permissionMode === "auto" &&
      toolName !== "AskUserQuestion" &&
      classification.risk === "safe"
    ) {
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
      classification,
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
    classification?: Classification,
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
            ...(classification && {
              riskLevel: classification.risk,
              classifierReason: classification.reason,
            }),
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
   * Register an ExitPlanMode approval request whose response is driven
   * from the App picker (via the `exit_plan_approval_forwarder.cjs` hook
   * bridge, NOT via SDK canCallTool).
   *
   * Flow:
   *   1. Push an entry into `agentState.requests[id]` — the App renders
   *      `PermissionFooter` with its dedicated `ExitPlanButtons`, giving
   *      the user Approve / Approve-and-auto-approve / Reject-with-reason.
   *   2. Send a push notification so a background user gets pinged.
   *   3. BLOCK on the returned promise. The `permission` RPC handler
   *      resolves it when the App responds; a `timeoutMs` fallback
   *      resolves it as denied so we never hold the hook forever.
   *   4. Regardless of outcome, migrate the entry from `requests` to
   *      `completedRequests` so the App shows the correct final state.
   *
   * The caller (hookServer's `onExitPlanApproval`) turns the result into
   * a `hookSpecificOutput` body and hands it back to the forwarder,
   * which writes it to stdout for the TUI.
   */
  async registerExitPlanApproval(
    toolInput: unknown,
    timeoutMs: number,
  ): Promise<ExitPlanApprovalResult> {
    const id = `${EXIT_PLAN_REQUEST_ID_PREFIX}${randomUUID()}`;

    return new Promise<ExitPlanApprovalResult>((resolve) => {
      const finalize = (
        result: ExitPlanApprovalResult,
        status: "approved" | "denied" | "canceled",
      ) => {
        clearTimeout(pending.timeoutHandle);
        if (this.exitPlanPending.get(id) === pending) {
          this.exitPlanPending.delete(id);
        }
        this.moveExitPlanRequestToCompleted(id, status, result.reason);
        resolve(result);
      };

      const timeoutHandle = setTimeout(() => {
        finalize(
          { approved: false, reason: "Approval timeout" },
          "denied",
        );
      }, timeoutMs);

      const pending: ExitPlanPending = {
        // The RPC handler calls this with the final result once the App
        // responds. It also runs the same completedRequests migration
        // via `finalize`, so both paths converge on identical state.
        // Both "user rejected" and "approval timeout" surface as
        // completedRequests[id].status="denied" — the reason field
        // carries the distinction for the App to render.
        resolve: (result) => {
          finalize(result, result.approved ? "approved" : "denied");
        },
        toolInput,
        timeoutHandle,
      };

      this.exitPlanPending.set(id, pending);

      // Surface to the App via the shared `agentState.requests` channel.
      this.session.client.updateAgentState((currentState) => ({
        ...currentState,
        requests: {
          ...currentState.requests,
          [id]: {
            tool: "ExitPlanMode",
            arguments: toolInput,
            createdAt: Date.now(),
          },
        },
      }));

      // Fire push notification (fire-and-forget, mirrors handlePermissionRequest).
      this.session.api
        .push()
        .sendToAllDevices(
          "Plan ready to review",
          "Claude has a plan awaiting your approval",
          {
            sessionId: this.session.client.sessionId,
            requestId: id,
            tool: "ExitPlanMode",
            type: "permission_request",
          },
        );

      logger.debug(
        `[permission] ExitPlanMode approval request registered id=${id} timeout=${timeoutMs}ms`,
      );
    });
  }

  /**
   * Migrate an ExitPlanMode request entry from `requests` → `completedRequests`
   * on the App-visible agent state. Called by both the RPC-response and the
   * timeout paths so the App always sees a terminal state, never a stuck
   * "pending" card.
   */
  private moveExitPlanRequestToCompleted(
    id: string,
    status: "approved" | "denied" | "canceled",
    reason?: string,
  ): void {
    this.session.client.updateAgentState((currentState) => {
      const request = currentState.requests?.[id];
      if (!request) return currentState;
      const nextRequests = { ...currentState.requests };
      delete nextRequests[id];
      return {
        ...currentState,
        requests: nextRequests,
        completedRequests: {
          ...currentState.completedRequests,
          [id]: {
            ...request,
            completedAt: Date.now(),
            status,
            ...(reason ? { reason } : {}),
          },
        },
      };
    });
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

    // Also cancel any in-flight ExitPlanMode approvals. Resolving as
    // denied (rather than rejecting) keeps the hookServer callback's
    // caller path simple — a canceled session is functionally identical
    // to the user rejecting the plan.
    for (const [, pending] of this.exitPlanPending.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.resolve({ approved: false, reason });
    }
    this.exitPlanPending.clear();

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

      // ExitPlanMode hook-bridge path — the App picker resolving a request
      // that was registered via `registerExitPlanApproval` (Yolo without
      // opt-in). Routed by id prefix so we can key on a plain-string
      // rather than a stateful pool lookup + branch.
      if (id.startsWith(EXIT_PLAN_REQUEST_ID_PREFIX)) {
        const pendingExitPlan = this.exitPlanPending.get(id);
        if (!pendingExitPlan) {
          // Timed out or double-answered — either way, ignore.
          logger.debug(
            `Permission response for exit-plan id=${id} arrived after resolution`,
          );
          return;
        }
        // Whitelist the mode value the App sent (defense-in-depth: the sibling
        // SDK-path branch at ~L163 already does this for regular tool
        // permissions). Anything unrecognised is treated as unset so we fall
        // back to the CURRENT permission mode rather than downgrading to
        // "default" — the App's "Approve Plan" button intentionally sends
        // mode=undefined to mean "keep whatever mode the session was in",
        // and a Yolo user pressing that button should stay in Yolo, not
        // silently drop into default. See docs/investigations/plan-mode-429.md
        // and PermissionFooter.tsx ExitPlanButtons approve-vs-approve-all
        // wiring.
        const requestedMode: PermissionMode | undefined =
          message.mode &&
          EXIT_PLAN_APPROVAL_ALLOWED_MODES.includes(
            message.mode as PermissionMode,
          )
            ? (message.mode as PermissionMode)
            : undefined;
        const result: ExitPlanApprovalResult = message.approved
          ? {
              approved: true,
              // Preserve the current permission mode when the App didn't
              // pick one — critical for Yolo users hitting plain "Approve".
              mode: requestedMode ?? this.permissionMode,
              updatedInput: pendingExitPlan.toolInput,
              // Forward the "Clear context & execute" opt-in so the launcher
              // can route to the /clear + plan-inject path (Layer 0).
              clearContext: message.clearContext === true,
            }
          : {
              approved: false,
              reason: message.reason || "User rejected plan",
            };
        pendingExitPlan.resolve(result);
        return;
      }

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
