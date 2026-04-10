/**
 * Message Reducer for Real-time Sync System
 *
 * This reducer is the core message processing engine that transforms raw messages from
 * the sync system into a structured, deduplicated message history. It handles complex
 * scenarios including tool permissions, sidechains, and message deduplication.
 *
 * ## Core Responsibilities:
 *
 * 1. **Message Deduplication**: Prevents duplicate messages using multiple tracking mechanisms:
 *    - localId tracking for user messages
 *    - messageId tracking for all messages
 *    - Permission ID tracking for tool permissions
 *
 * 2. **Tool Permission Management**: Integrates with AgentState to handle tool permissions:
 *    - Creates placeholder messages for pending permission requests
 *    - Updates permission status (pending → approved/denied/canceled)
 *    - Matches incoming tool calls to approved permissions
 *    - Prioritizes tool calls over permissions when both exist
 *
 * 3. **Tool Call Lifecycle**: Manages the complete lifecycle of tool calls:
 *    - Creation from permission requests or direct tool calls
 *    - Matching tool calls to existing permission messages
 *    - Processing tool results and updating states
 *    - Handling errors and completion states
 *
 * 4. **Sidechain Processing**: Handles nested conversation branches (sidechains):
 *    - Identifies sidechain messages using the tracer
 *    - Stores sidechain messages separately
 *    - Links sidechains to their parent tool calls
 *
 * ## Processing Phases:
 *
 * The reducer processes messages in a specific order to ensure correct behavior:
 *
 * **Phase 0: AgentState Permissions**
 *   - Processes pending and completed permission requests
 *   - Creates tool messages for permissions
 *   - Skips completed permissions if matching tool call (same name AND arguments) exists in incoming messages
 *   - Phase 2 will handle matching tool calls to existing permission messages
 *
 * **Phase 0.5: Message-to-Event Conversion**
 *   - Parses messages to check if they should be converted to events
 *   - Converts matching messages to events immediately
 *   - Converted messages skip all subsequent processing phases
 *   - Supports user commands, tool results, and metadata-driven conversions
 *
 * **Phase 1: User and Text Messages**
 *   - Processes user messages with deduplication
 *   - Processes agent text messages
 *   - Skips tool calls for later phases
 *
 * **Phase 2: Tool Calls**
 *   - Processes incoming tool calls from agents
 *   - Matches to existing permission messages when possible
 *   - Creates new tool messages when no match exists
 *   - Prioritizes newest permission when multiple matches
 *
 * **Phase 3: Tool Results**
 *   - Updates tool messages with results
 *   - Sets completion or error states
 *   - Updates completion timestamps
 *
 * **Phase 4: Sidechains**
 *   - Processes sidechain messages separately
 *   - Stores in sidechain map linked to parent tool
 *   - Handles nested tool calls within sidechains
 *
 * **Phase 5: Mode Switch Events**
 *   - Processes agent event messages
 *   - Handles mode changes and other events
 *
 * ## Key Behaviors:
 *
 * - **Idempotency**: Calling the reducer multiple times with the same data produces no duplicates
 * - **Priority Rules**: When both tool calls and permissions exist, tool calls take priority
 * - **Argument Matching**: Tool calls match to permissions based on both name AND arguments
 * - **Timestamp Preservation**: Original timestamps are preserved when matching tools to permissions
 * - **State Persistence**: The ReducerState maintains all mappings across calls
 * - **Message Immutability**: NEVER modify message timestamps or core properties after creation
 *   Messages can only have their tool state/result updated, never their creation metadata
 * - **Timestamp Preservation**: NEVER change a message's createdAt timestamp. The timestamp
 *   represents when the message was originally created and must be preserved throughout all
 *   processing phases. This is critical for maintaining correct message ordering.
 *
 * ## Permission Matching Algorithm:
 *
 * When a tool call arrives, the matching algorithm:
 * 1. Checks if the tool has already been processed (via toolIdToMessageId)
 * 2. Searches for approved permission messages with:
 *    - Same tool name
 *    - Matching arguments (deep equality)
 *    - Not already linked to another tool
 * 3. Prioritizes the newest matching permission
 * 4. Updates the permission message with tool execution details
 * 5. Falls back to creating a new tool message if no match
 *
 * ## Data Flow:
 *
 * Raw Messages → Normalizer → Reducer → Structured Messages
 *                              ↑
 *                         AgentState
 *
 * The reducer receives:
 * - Normalized messages from the sync system
 * - Current AgentState with permission information
 *
 * And produces:
 * - Structured Message objects for UI rendering
 * - Updated internal state for future processing
 */

import { Message, ModeSwitchMessage, ToolCall } from "../typesMessage";
import { AgentEvent, NormalizedMessage, UsageData } from "../typesRaw";
import { createTracer, traceMessages, TracerState } from "./reducerTracer";
import { AgentState } from "../storageTypes";
import { parseMessageAsEvent } from "./messageToEvent";
import {
    ReducerMessage,
    StoredPermission,
    allocateId,
    applyPermissionFromToolResult,
    updateMessageWithCompletedPermission,
    createStoredPermission,
    processSidechainToolResult,
    extractSdkResultData,
} from "./reducerHelpers";

/** SDK event-driven background task entry, maintained by task-start/progress/end events */
export type BackgroundTaskEntry = {
  readonly taskId: string;
  readonly toolUseId: string | null;
  readonly command: string;
  readonly description: string;
  readonly outputFile: string | null;
  readonly startedAt: number;
  readonly status: "running" | "completed" | "failed" | "stopped";
  readonly summary: string | null;
};

export type ReducerState = {
  toolIdToMessageId: Map<string, string>; // toolId/permissionId -> messageId (since they're the same now)
  sidechainToolIdToMessageId: Map<string, string>; // toolId -> sidechain messageId (for dual tracking)
  permissions: Map<string, StoredPermission>; // Store permission details by ID for quick lookup
  localIds: Map<string, string>;
  messageIds: Map<string, string>; // originalId -> internalId
  messages: Map<string, ReducerMessage>;
  sidechains: Map<string, ReducerMessage[]>;
  tracerState: TracerState; // Tracer state for sidechain processing
  turnHadUsageStats: boolean; // true if current turn already has per-call usage-stats lines
  latestTodos?: {
    todos: Array<{
      content: string;
      status: "pending" | "in_progress" | "completed";
      priority: "high" | "medium" | "low";
      id: string;
    }>;
    timestamp: number;
  };
  latestUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    contextSize: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    timestamp: number;
    totalCostUsd?: number;
    contextWindow?: number;
    totalDurationMs?: number;
    completedTurnsDurationMs?: number;
    currentTurnStartedAt?: number;
    modelUsage?: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        costUSD: number;
        contextWindow: number;
      }
    >;
  };
  latestAgentTextTime: number;
  resolvedModelId?: string; // Actual model ID from turn-end (e.g. "claude-opus-4-6")
  backgroundTaskIdToMessageId: Map<string, string>; // backgroundTaskId -> messageId
  /** SDK event-driven background task registry, keyed by taskId */
  backgroundTasks: Map<string, BackgroundTaskEntry>;
  contextUsage?: {
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    model?: string;
    categories?: Array<{ name: string; tokens: number; color?: string }>;
    isAutoCompactEnabled?: boolean;
    autoCompactThreshold?: number;
    messageBreakdown?: {
      toolCallTokens: number;
      toolResultTokens: number;
      attachmentTokens: number;
      assistantMessageTokens: number;
      userMessageTokens: number;
    };
    timestamp: number;
  };
};

export function createReducer(): ReducerState {
  return {
    toolIdToMessageId: new Map(),
    sidechainToolIdToMessageId: new Map(),
    permissions: new Map(),
    messages: new Map(),
    localIds: new Map(),
    messageIds: new Map(),
    sidechains: new Map(),
    tracerState: createTracer(),
    latestAgentTextTime: 0,
    backgroundTaskIdToMessageId: new Map(),
    backgroundTasks: new Map(),
    turnHadUsageStats: false,
  };
}


export type ReducerResult = {
  messages: Message[];
  todos?: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority: "high" | "medium" | "low";
    id: string;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    contextSize: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd?: number;
    contextWindow?: number;
    totalDurationMs?: number;
    completedTurnsDurationMs?: number;
    currentTurnStartedAt?: number;
    modelUsage?: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        costUSD: number;
        contextWindow: number;
      }
    >;
  };
  hasReadyEvent?: boolean;
};

export function reducer(
  state: ReducerState,
  messages: NormalizedMessage[],
  agentState?: AgentState | null,
): ReducerResult {
  let newMessages: Message[] = [];
  let changed: Set<string> = new Set();
  let hasReadyEvent = false;

  // First, trace all messages to identify sidechains
  const tracedMessages = traceMessages(state.tracerState, messages);

  // Separate sidechain and non-sidechain messages
  let nonSidechainMessages = tracedMessages.filter((msg) => !msg.sidechainId);
  const sidechainMessages = tracedMessages.filter((msg) => msg.sidechainId);

  //
  // Phase 0.5: Message-to-Event Conversion
  // Convert certain messages to events before normal processing
  //

  const messagesToProcess: NormalizedMessage[] = [];
  const convertedEvents: { message: NormalizedMessage; event: AgentEvent }[] =
    [];

  for (const msg of nonSidechainMessages) {
    // Check if we've already processed this message
    if (msg.role === "user" && msg.localId && state.localIds.has(msg.localId)) {
      continue;
    }
    if (state.messageIds.has(msg.id)) {
      continue;
    }

    // Suppress subagent usage/ready events that slip through to non-sidechain processing.
    // These are aggregated in TaskView via sidechain children instead.
    if (
      msg.role === "event" &&
      msg.isSidechain &&
      (msg.content.type === "ready" || msg.content.type === "usage-stats")
    ) {
      state.messageIds.set(msg.id, msg.id);
      continue;
    }

    // Turn-end: render session-level summary line with cumulative tokens and cost.
    if (msg.role === "event" && msg.content.type === "ready") {
      state.messageIds.set(msg.id, msg.id);
      hasReadyEvent = true;

      // Store actual model ID reported by CLI (e.g. "claude-opus-4-6")
      if (msg.content.model) {
        state.resolvedModelId = msg.content.model;
      }

      // Accumulate this turn's usage if not already done by usage-stats events
      if (msg.content.usage && !state.turnHadUsageStats) {
        processUsageData(
          state,
          {
            input_tokens: msg.content.usage.input_tokens,
            output_tokens: msg.content.usage.output_tokens,
            cache_creation_input_tokens:
              msg.content.usage.cache_creation_input_tokens,
            cache_read_input_tokens: msg.content.usage.cache_read_input_tokens,
          },
          msg.createdAt,
          msg.content.durationMs,
        );
      }

      // Extract SDK result data (cost, model usage, context window) if present
      if (
        msg.content.totalCostUsd !== undefined ||
        msg.content.modelUsage !== undefined
      ) {
        const { maxContextWindow, compactModelUsage } = extractSdkResultData(msg.content.modelUsage);
        if (state.latestUsage) {
          state.latestUsage = {
            ...state.latestUsage,
            ...(msg.content.totalCostUsd !== undefined
              ? { totalCostUsd: msg.content.totalCostUsd }
              : {}),
            ...(maxContextWindow ? { contextWindow: maxContextWindow } : {}),
            ...(compactModelUsage ? { modelUsage: compactModelUsage } : {}),
          };
        }
      }

      // Reset turn tracking
      state.turnHadUsageStats = false;

      // Snapshot completed turns duration and clear turn start for real-time UI
      if (state.latestUsage) {
        state.latestUsage = {
          ...state.latestUsage,
          completedTurnsDurationMs: state.latestUsage.totalDurationMs,
          currentTurnStartedAt: undefined,
        };
      }

      // Show session summary if we have any useful data
      const hasStats =
        msg.content.totalCostUsd !== undefined ||
        msg.content.modelUsage !== undefined ||
        msg.content.usage !== undefined ||
        msg.content.model !== undefined ||
        msg.content.durationMs !== undefined;
      if (!hasStats) {
        continue;
      }
      // Fall through to Phase 5 to render as session summary line
    }

    // Per-request usage stats: update cumulative usage only, no longer rendered.
    // Session-level summary is shown at turn-end ("ready" event) instead.
    if (msg.role === "event" && msg.content.type === "usage-stats") {
      state.messageIds.set(msg.id, msg.id);
      state.turnHadUsageStats = true;
      if (msg.content.usage) {
        processUsageData(
          state,
          msg.content.usage,
          msg.createdAt,
          msg.content.durationMs,
        );
      }
      continue;
    }

    // Context usage snapshot: update state for UI display, not rendered as chat message.
    if (msg.role === "event" && msg.content.type === "context-usage") {
      state.messageIds.set(msg.id, msg.id);
      state.contextUsage = {
        totalTokens: msg.content.totalTokens,
        maxTokens: msg.content.maxTokens,
        percentage: msg.content.percentage,
        model: msg.content.model,
        categories: msg.content.categories,
        isAutoCompactEnabled: msg.content.isAutoCompactEnabled,
        autoCompactThreshold: msg.content.autoCompactThreshold,
        messageBreakdown: msg.content.messageBreakdown,
        timestamp: msg.createdAt,
      };
      continue;
    }

    // Session protocol turn-start markers are lifecycle-only and should stay invisible.
    if (
      msg.role === "event" &&
      msg.content.type === "message" &&
      msg.content.message === "Turn started"
    ) {
      state.messageIds.set(msg.id, msg.id);
      // Record turn start time for real-time elapsed display
      if (state.latestUsage) {
        state.latestUsage = {
          ...state.latestUsage,
          currentTurnStartedAt: msg.createdAt,
        };
      } else {
        state.latestUsage = {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreation: 0,
          cacheRead: 0,
          contextSize: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          timestamp: msg.createdAt,
          currentTurnStartedAt: msg.createdAt,
        };
      }
      continue;
    }

    // Handle context reset events - reset state and let the message be shown
    if (
      msg.role === "event" &&
      msg.content.type === "message" &&
      msg.content.message === "Context was reset"
    ) {
      // Reset todos to empty array and reset usage to zero
      state.latestTodos = {
        todos: [],
        timestamp: msg.createdAt, // Use message timestamp, not current time
      };
      state.latestUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreation: 0,
        cacheRead: 0,
        contextSize: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        timestamp: msg.createdAt, // Use message timestamp to avoid blocking older usage data
      };
      // Don't continue - let the event be processed normally to create a message
    }

    // Handle compaction completed events - reset context but keep todos
    if (
      msg.role === "event" &&
      msg.content.type === "message" &&
      msg.content.message === "Compaction completed"
    ) {
      // Reset usage/context to zero but keep todos unchanged
      state.latestUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreation: 0,
        cacheRead: 0,
        contextSize: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        timestamp: msg.createdAt, // Use message timestamp to avoid blocking older usage data
      };
      // Don't continue - let the event be processed normally to create a message
    }

    // Try to parse message as event
    const event = parseMessageAsEvent(msg);
    if (event) {
      convertedEvents.push({ message: msg, event });
      // Mark as processed to prevent duplication
      state.messageIds.set(msg.id, msg.id);
      if (msg.role === "user" && msg.localId) {
        state.localIds.set(msg.localId, msg.id);
      }
    } else {
      messagesToProcess.push(msg);
    }
  }

  // Process converted events immediately
  for (const { message, event } of convertedEvents) {
    const mid = allocateId();
    state.messages.set(mid, {
      id: mid,
      realID: message.id,
      role: "agent",
      createdAt: message.createdAt,
      event: event,
      tool: null,
      text: null,
      meta: message.meta,
    });
    changed.add(mid);
  }

  // Update nonSidechainMessages to only include messages that weren't converted
  nonSidechainMessages = messagesToProcess;

  // Build a set of incoming tool IDs for quick lookup
  const incomingToolIds = new Set<string>();
  for (let msg of nonSidechainMessages) {
    if (msg.role === "agent") {
      for (let c of msg.content) {
        if (c.type === "tool-call") {
          incomingToolIds.add(c.id);
        }
      }
    }
  }

  //
  // Phase 0: Process AgentState permissions
  //

  if (agentState) {
    // Process pending permission requests
    if (agentState.requests) {
      for (const [permId, request] of Object.entries(agentState.requests)) {
        // Skip if this permission is also in completedRequests (completed takes precedence)
        if (
          agentState.completedRequests &&
          agentState.completedRequests[permId]
        ) {
          continue;
        }

        // Check if we already have a message for this permission ID
        const existingMessageId = state.toolIdToMessageId.get(permId);
        if (existingMessageId) {
          // Update existing tool message with permission info
          const message = state.messages.get(existingMessageId);
          if (message?.tool && !message.tool.permission) {
            message.tool.permission = {
              id: permId,
              status: "pending",
            };
            changed.add(existingMessageId);
          }
        } else {
          // Create a new tool message for the permission request
          let mid = allocateId();
          let toolCall: ToolCall = {
            name: request.tool,
            state: "running" as const,
            input: request.arguments,
            createdAt: request.createdAt || Date.now(),
            startedAt: null,
            completedAt: null,
            description: null,
            result: undefined,
            permission: {
              id: permId,
              status: "pending",
            },
          };

          state.messages.set(mid, {
            id: mid,
            realID: null,
            role: "agent",
            createdAt: request.createdAt || Date.now(),
            text: null,
            tool: toolCall,
            event: null,
          });

          // Store by permission ID (which will match tool ID)
          state.toolIdToMessageId.set(permId, mid);

          changed.add(mid);
        }

        // Store permission details for quick lookup
        state.permissions.set(permId, {
          tool: request.tool,
          arguments: request.arguments,
          createdAt: request.createdAt || Date.now(),
          status: "pending",
        });
      }
    }

    // Process completed permission requests
    if (agentState.completedRequests) {
      for (const [permId, completed] of Object.entries(
        agentState.completedRequests,
      )) {
        // Check if we have a message for this permission ID
        const messageId = state.toolIdToMessageId.get(permId);
        if (messageId) {
          const message = state.messages.get(messageId);
          if (message?.tool) {
            const hasChanged = updateMessageWithCompletedPermission(message, permId, completed);
            state.permissions.set(permId, createStoredPermission(completed));
            if (hasChanged) {
              changed.add(messageId);
            }
          }
        } else {
          // No existing message - check if tool ID is in incoming messages
          if (incomingToolIds.has(permId)) {
            // Store permission for when tool arrives in Phase 2
            state.permissions.set(permId, createStoredPermission(completed));
            continue;
          }

          // Skip if already processed as pending
          if (agentState.requests && agentState.requests[permId]) {
            continue;
          }

          // Create a new message for completed permission without tool
          let mid = allocateId();
          let toolCall: ToolCall = {
            name: completed.tool,
            state: completed.status === "approved" ? "completed" : "error",
            input: completed.arguments,
            createdAt: completed.createdAt || Date.now(),
            startedAt: null,
            completedAt: completed.completedAt || Date.now(),
            description: null,
            result:
              completed.status === "approved"
                ? "Approved"
                : completed.reason
                  ? { error: completed.reason }
                  : undefined,
            permission: {
              id: permId,
              status: completed.status,
              reason: completed.reason || undefined,
              mode: completed.mode || undefined,
              allowedTools: completed.allowedTools || undefined,
              decision: completed.decision || undefined,
            },
          };

          state.messages.set(mid, {
            id: mid,
            realID: null,
            role: "agent",
            createdAt: completed.createdAt || Date.now(),
            text: null,
            tool: toolCall,
            event: null,
          });

          state.toolIdToMessageId.set(permId, mid);

          // Store permission details
          state.permissions.set(permId, createStoredPermission(completed));

          changed.add(mid);
        }
      }
    }
  }

  //
  // Phase 1: Process non-sidechain user messages and text messages
  //

  for (let msg of nonSidechainMessages) {
    if (msg.role === "user") {
      // Check if we've seen this localId before
      if (msg.localId && state.localIds.has(msg.localId)) {
        continue;
      }
      // Check if we've seen this message ID before
      if (state.messageIds.has(msg.id)) {
        continue;
      }

      // Create a new message
      let mid = allocateId();
      state.messages.set(mid, {
        id: mid,
        realID: msg.id,
        role: "user",
        createdAt: msg.createdAt,
        text: msg.content.text,
        tool: null,
        event: null,
        meta: msg.meta,
      });

      // Track both localId and messageId
      if (msg.localId) {
        state.localIds.set(msg.localId, mid);
      }
      state.messageIds.set(msg.id, mid);

      changed.add(mid);
    } else if (msg.role === "agent") {
      // Check if we've seen this agent message before
      if (state.messageIds.has(msg.id)) {
        continue;
      }

      // Mark this message as seen
      state.messageIds.set(msg.id, msg.id);

      // Process usage data if present
      if (msg.usage) {
        processUsageData(state, msg.usage, msg.createdAt);
      }

      // Process text and thinking content (tool calls handled in Phase 2)
      for (let c of msg.content) {
        if (c.type === "text" || c.type === "thinking") {
          let mid = allocateId();
          const isThinking = c.type === "thinking";
          const taskStatus = !isThinking
            ? msg.taskStartInfo
              ? {
                  status: "start" as const,
                  summary: msg.taskStartInfo.description,
                  metrics: null,
                }
              : msg.taskProgressInfo
                ? {
                    status: "progress" as const,
                    summary: msg.taskProgressInfo.summary,
                    metrics: c.text.split("\n")[2]?.trim()?.replace(/^_/, "").replace(/_$/, "") ?? null,
                  }
                : msg.taskEndInfo
                  ? {
                      status: msg.taskEndInfo.status,
                      summary: c.text.split("\n")[1]?.trim() || c.text,
                      metrics: null,
                    }
                  : undefined
            : undefined;
          state.messages.set(mid, {
            id: mid,
            realID: msg.id,
            role: "agent",
            createdAt: msg.createdAt,
            text: isThinking ? `*${c.thinking}*` : c.text,
            isThinking,
            ...(taskStatus && { taskStatus }),
            tool: null,
            event: null,
            meta: msg.meta,
          });
          changed.add(mid);
          // Track latest agent text time incrementally for Phase 6
          if (c.type === "text" && msg.createdAt > state.latestAgentTextTime) {
            state.latestAgentTextTime = msg.createdAt;
          }
        }
      }

    }
  }

  //
  // Phase 2: Process non-sidechain tool calls
  //

  for (let msg of nonSidechainMessages) {
    if (msg.role === "agent") {
      for (let c of msg.content) {
        if (c.type === "tool-call") {
          // Direct lookup by tool ID (since permission ID = tool ID now)
          const existingMessageId = state.toolIdToMessageId.get(c.id);

          if (existingMessageId) {
            // Update existing message with tool execution details
            const message = state.messages.get(existingMessageId);
            if (message?.tool) {
              message.realID = msg.id;
              message.tool.description = c.description;
              message.tool.startedAt = msg.createdAt;
              // If permission was approved and shown as completed (no tool), now it's running
              if (
                message.tool.permission?.status === "approved" &&
                message.tool.state === "completed"
              ) {
                message.tool.state = "running";
                message.tool.completedAt = null;
                message.tool.result = undefined;
              }
              changed.add(existingMessageId);

              // Track TodoWrite tool inputs when updating existing messages
              if (
                message.tool.name === "TodoWrite" &&
                message.tool.state === "running" &&
                message.tool.input?.todos
              ) {
                // Only update if this is newer than existing todos
                if (
                  !state.latestTodos ||
                  message.tool.createdAt > state.latestTodos.timestamp
                ) {
                  state.latestTodos = {
                    todos: message.tool.input.todos,
                    timestamp: message.tool.createdAt,
                  };
                }
              }
            }
          } else {
            // Check if there's a stored permission for this tool
            const permission = state.permissions.get(c.id);

            let toolCall: ToolCall = {
              name: c.name,
              state: "running" as const,
              input: permission ? permission.arguments : c.input, // Use permission args if available
              createdAt: permission ? permission.createdAt : msg.createdAt, // Use permission timestamp if available
              startedAt: msg.createdAt,
              completedAt: null,
              description: c.description,
              result: undefined,
            };

            // Add permission info if found
            if (permission) {
              toolCall.permission = {
                id: c.id,
                status: permission.status,
                reason: permission.reason,
                mode: permission.mode,
                allowedTools: permission.allowedTools,
                decision: permission.decision,
              };

              // Update state based on permission status
              if (permission.status !== "approved") {
                toolCall.state = "error";
                toolCall.completedAt = permission.completedAt || msg.createdAt;
                if (permission.reason) {
                  toolCall.result = { error: permission.reason };
                }
              }
            }

            let mid = allocateId();
            state.messages.set(mid, {
              id: mid,
              realID: msg.id,
              role: "agent",
              createdAt: msg.createdAt,
              text: null,
              tool: toolCall,
              event: null,
              meta: msg.meta,
            });

            state.toolIdToMessageId.set(c.id, mid);
            changed.add(mid);

            // Track TodoWrite tool inputs
            if (
              toolCall.name === "TodoWrite" &&
              toolCall.state === "running" &&
              toolCall.input?.todos
            ) {
              // Only update if this is newer than existing todos
              if (
                !state.latestTodos ||
                toolCall.createdAt > state.latestTodos.timestamp
              ) {
                state.latestTodos = {
                  todos: toolCall.input.todos,
                  timestamp: toolCall.createdAt,
                };
              }
            }
          }
        }
      }
    }
  }

  // Track whether backgroundTasks Map was modified (used in Phase 3, 3.5, 6.5)
  let bgTasksDirty = false;

  //
  // Phase 3: Process non-sidechain tool results
  //

  for (let msg of nonSidechainMessages) {
    if (msg.role === "agent") {
      for (let c of msg.content) {
        if (c.type === "tool-result") {
          // Find the message containing this tool
          let messageId = state.toolIdToMessageId.get(c.tool_use_id);
          if (!messageId) {
            continue;
          }

          let message = state.messages.get(messageId);
          if (!message || !message.tool) {
            continue;
          }

          // tool-call-end with backgroundTaskId may arrive AFTER the real tool-result
          // has already set state to "completed". Handle it before the state guard.
          if (c.backgroundTaskId) {
            message.tool.backgroundTaskId = c.backgroundTaskId;
            message.tool.outputFile = c.outputFile;
            state.backgroundTaskIdToMessageId.set(c.backgroundTaskId, messageId);

            // Create or enrich backgroundTasks entry
            const cmd = typeof message.tool.input?.command === "string"
              ? message.tool.input.command : "";
            const existing = state.backgroundTasks.get(c.backgroundTaskId);
            if (existing) {
              if ((!existing.command && cmd) || (!existing.outputFile && c.outputFile)) {
                state.backgroundTasks.set(c.backgroundTaskId, {
                  ...existing,
                  command: existing.command || cmd,
                  outputFile: existing.outputFile ?? c.outputFile ?? null,
                });
                bgTasksDirty = true;
              }
            } else {
              state.backgroundTasks.set(c.backgroundTaskId, {
                taskId: c.backgroundTaskId,
                toolUseId: null,
                command: cmd,
                description: typeof message.tool.input?.description === "string"
                  ? message.tool.input.description : cmd,
                outputFile: c.outputFile ?? null,
                startedAt: message.tool.startedAt ?? message.createdAt,
                status: "running",
                summary: null,
              });
              bgTasksDirty = true;
            }
          }

          if (message.tool.state !== "running") {
            continue;
          }

          // Update tool state and result
          message.tool.state = c.is_error ? "error" : "completed";
          message.tool.result = c.content;
          message.tool.completedAt = msg.createdAt;

          // Update permission data if provided by backend
          if (c.permissions) {
            applyPermissionFromToolResult(message.tool, c.tool_use_id, c.permissions);
          }

          changed.add(messageId);
        }
      }
    }
  }

  //
  // Phase 3.5: Maintain backgroundTasks registry from SDK lifecycle events
  // Also applies task-end status to tool-call messages (for tool bubble UI)
  // (must run after Phase 3 which populates backgroundTaskIdToMessageId)
  //
  //

  for (const msg of nonSidechainMessages) {
    if (msg.role !== "agent") continue;

    // task-start → create entry in backgroundTasks
    if (msg.taskStartInfo) {
      const { taskId, toolUseId, description } = msg.taskStartInfo;
      const existing = state.backgroundTasks.get(taskId);
      if (existing) {
        // task-start activates the entry — override provisional "completed" status
        state.backgroundTasks.set(taskId, {
          ...existing,
          toolUseId: toolUseId ?? existing.toolUseId,
          description,
          status: "running",
        });
      } else {
        // Try to get command/outputFile from tool message if it was processed
        // in a previous reducer call (tool-result may arrive before task-start)
        const toolMsgId = state.backgroundTaskIdToMessageId.get(taskId);
        const toolMsg = toolMsgId ? state.messages.get(toolMsgId) : null;
        const cmd = toolMsg?.tool?.input?.command
          ? String(toolMsg.tool.input.command) : "";
        const outFile = toolMsg?.tool?.outputFile ?? null;
        state.backgroundTasks.set(taskId, {
          taskId,
          toolUseId: toolUseId ?? null,
          command: cmd,
          description,
          outputFile: outFile,
          startedAt: msg.createdAt,
          status: "running",
          summary: null,
        });
      }
      bgTasksDirty = true;
    }

    // task-progress → update summary
    if (msg.taskProgressInfo) {
      const entry = state.backgroundTasks.get(msg.taskProgressInfo.taskId);
      if (entry) {
        state.backgroundTasks.set(msg.taskProgressInfo.taskId, {
          ...entry,
          description: msg.taskProgressInfo.description,
          summary: msg.taskProgressInfo.summary ?? entry.summary,
        });
      } else {
        state.backgroundTasks.set(msg.taskProgressInfo.taskId, {
          taskId: msg.taskProgressInfo.taskId,
          toolUseId: null,
          command: "",
          description: msg.taskProgressInfo.description,
          outputFile: null,
          startedAt: msg.createdAt,
          status: "running",
          summary: msg.taskProgressInfo.summary,
        });
      }
      bgTasksDirty = true;
    }

    // task-end → update status in backgroundTasks + update tool-call message state
    if (msg.taskEndInfo) {
      const { taskId, status } = msg.taskEndInfo;
      const entry = state.backgroundTasks.get(taskId);
      if (entry) {
        state.backgroundTasks.set(taskId, {
          ...entry,
          status,
        });
        bgTasksDirty = true;
      }
      // Also update the tool-call message for tool bubble UI when the tool is still active.
      const bgMsgId = state.backgroundTaskIdToMessageId.get(taskId);
      if (bgMsgId) {
        const bgMessage = state.messages.get(bgMsgId);
        if (bgMessage?.tool && bgMessage.tool.state === "running") {
          bgMessage.tool.state =
            status === "failed" || status === "stopped" ? "error" : "completed";
          bgMessage.tool.completedAt = msg.createdAt;
          changed.add(bgMsgId);
        }
      }
    }
  }

  //
  // Phase 4: Process sidechains and store them in state
  //

  // For each sidechain message, store it in the state and mark the Task as changed
  for (const msg of sidechainMessages) {
    if (!msg.sidechainId) continue;

    // Skip if we already processed this message
    if (state.messageIds.has(msg.id)) continue;

    // Mark as processed
    state.messageIds.set(msg.id, msg.id);

    // Get or create the sidechain array for this Task
    const existingSidechain = state.sidechains.get(msg.sidechainId) || [];

    // Process and add new sidechain messages
    if (msg.role === "agent" && msg.content[0]?.type === "sidechain") {
      // This is the sidechain root - create a user message
      let mid = allocateId();
      let userMsg: ReducerMessage = {
        id: mid,
        realID: msg.id,
        role: "user",
        createdAt: msg.createdAt,
        text: msg.content[0].prompt,
        tool: null,
        event: null,
        meta: msg.meta,
      };
      state.messages.set(mid, userMsg);
      existingSidechain.push(userMsg);
    } else if (msg.role === "agent") {
      // Process agent content in sidechain
      for (let c of msg.content) {
        if (c.type === "text" || c.type === "thinking") {
          let mid = allocateId();
          const isThinking = c.type === "thinking";
          let textMsg: ReducerMessage = {
            id: mid,
            realID: msg.id,
            role: "agent",
            createdAt: msg.createdAt,
            text: isThinking ? `*${c.thinking}*` : c.text,
            isThinking,
            tool: null,
            event: null,
            meta: msg.meta,
          };
          state.messages.set(mid, textMsg);
          existingSidechain.push(textMsg);
        } else if (c.type === "tool-call") {
          // Check if there's already a permission message for this tool
          const existingPermissionMessageId = state.toolIdToMessageId.get(c.id);

          let mid = allocateId();
          let toolCall: ToolCall = {
            name: c.name,
            state: "running" as const,
            input: c.input,
            createdAt: msg.createdAt,
            startedAt: null,
            completedAt: null,
            description: c.description,
            result: undefined,
          };

          // If there's a permission message, copy its permission info
          if (existingPermissionMessageId) {
            const permissionMessage = state.messages.get(
              existingPermissionMessageId,
            );
            if (permissionMessage?.tool?.permission) {
              toolCall.permission = { ...permissionMessage.tool.permission };
              // Update the permission message to show it's running
              if (
                permissionMessage.tool.state !== "completed" &&
                permissionMessage.tool.state !== "error"
              ) {
                permissionMessage.tool.state = "running";
                permissionMessage.tool.startedAt = msg.createdAt;
                permissionMessage.tool.description = c.description;
                changed.add(existingPermissionMessageId);
              }
            }
          }

          let toolMsg: ReducerMessage = {
            id: mid,
            realID: msg.id,
            role: "agent",
            createdAt: msg.createdAt,
            text: null,
            tool: toolCall,
            event: null,
            meta: msg.meta,
          };
          state.messages.set(mid, toolMsg);
          existingSidechain.push(toolMsg);

          // Map sidechain tool separately to avoid overwriting permission mapping
          state.sidechainToolIdToMessageId.set(c.id, mid);
        } else if (c.type === "tool-result") {
          // Process tool result in sidechain - update BOTH messages
          const resultChangedIds = processSidechainToolResult(
            {
              toolIdToMessageId: state.toolIdToMessageId,
              sidechainToolIdToMessageId: state.sidechainToolIdToMessageId,
              permissions: state.permissions,
              messages: state.messages,
            },
            c,
            msg.createdAt,
          );
          for (const id of resultChangedIds) {
            changed.add(id);
          }
        }
      }
    } else if (msg.role === "event") {
      // Sidechain event messages (e.g. usage-stats, ready with model data).
      // Store them as children so TaskView can aggregate usage summaries
      // instead of showing individual per-turn stats lines.
      const evt = msg.content;
      const hasUsageData =
        evt.type === "usage-stats" ||
        (evt.type === "ready" &&
          (evt.model !== undefined ||
            evt.usage !== undefined ||
            evt.durationMs !== undefined));
      if (hasUsageData) {
        const mid = allocateId();
        const eventMsg: ReducerMessage = {
          id: mid,
          realID: msg.id,
          role: "agent",
          createdAt: msg.createdAt,
          text: null,
          tool: null,
          event: evt,
          meta: msg.meta,
        };
        state.messages.set(mid, eventMsg);
        existingSidechain.push(eventMsg);
      }
    }

    // Update the sidechain in state
    state.sidechains.set(msg.sidechainId, existingSidechain);

    // Find the Task tool message that owns this sidechain and mark it as changed
    // msg.sidechainId is the realID of the Task message
    for (const [internalId, message] of state.messages) {
      if (message.realID === msg.sidechainId && message.tool) {
        changed.add(internalId);
        break;
      }
    }
  }

  //
  // Phase 5: Process mode-switch messages
  //

  for (let msg of nonSidechainMessages) {
    if (msg.role === "event") {
      let mid = allocateId();
      state.messages.set(mid, {
        id: mid,
        realID: msg.id,
        role: "agent",
        createdAt: msg.createdAt,
        event: msg.content,
        tool: null,
        text: null,
        meta: msg.meta,
      });
      changed.add(mid);
    }
  }

  //
  // Phase 6: Force-complete stale running tools
  // If the agent sent a text response AFTER a tool_use, the tool must have completed
  // (the API requires tool_result before the assistant can produce text).
  // The SDK may handle tool execution internally without emitting tool_result events
  // to the stream, leaving tool states stuck at 'running'.
  //

  if (state.latestAgentTextTime > 0) {
    for (const messageId of state.toolIdToMessageId.values()) {
      const msg = state.messages.get(messageId);
      if (!msg || !msg.tool) continue;
      if (
        msg.tool.state === "running" &&
        msg.createdAt < state.latestAgentTextTime
      ) {
        // Skip tools with pending permissions — they're waiting for user input, not stale
        if (msg.tool.permission?.status === "pending") {
          continue;
        }
        // Skip sidechain tools — they may still be running in nested conversations
        if (msg.tool.name === "Task" || msg.tool.name === "Agent") {
          continue;
        }
        // Skip background tasks — they run independently of the conversation flow.
        // Their lifecycle is managed by task-end events in Phase 3.5.
        // Historical tasks without task-end are handled by isDead detection in the UI.
        if (msg.tool.backgroundTaskId) {
          continue;
        }
        msg.tool.state = "completed";
        msg.tool.completedAt = state.latestAgentTextTime;
        changed.add(messageId);
      }
    }
  }

  //
  // Phase 6.5: Enrich backgroundTasks with outputFile/command from tool-result metadata.
  // MUST run after Phase 6 so that tool.state reflects stale-cleanup results.
  // tool-result may arrive before or after task-start; both must be handled.
  //
  for (const [taskId, messageId] of state.backgroundTaskIdToMessageId) {
    const entry = state.backgroundTasks.get(taskId);
    const toolMsg = state.messages.get(messageId);
    if (!toolMsg?.tool) continue;
    const command =
      typeof toolMsg.tool.input?.command === "string"
        ? toolMsg.tool.input.command
        : "";
    const outputFile = toolMsg.tool.outputFile ?? null;
    // Only enrich existing entries (created by task-start in Phase 3.5).
    // Never create provisional entries from tool-result alone — old sessions
    // without task-start events should not show ghost tasks in the panel.
    if (!entry) continue;
    const needsCommand = !entry.command && command;
    const needsOutputFile = !entry.outputFile && outputFile;
    if (!needsCommand && !needsOutputFile) continue;
    state.backgroundTasks.set(taskId, {
      ...entry,
      command: entry.command || command,
      outputFile: entry.outputFile ?? outputFile,
    });
    bgTasksDirty = true;
  }

  // Replace Map reference so Zustand detects the change
  if (bgTasksDirty) {
    state.backgroundTasks = new Map(state.backgroundTasks);
  }

  //
  // Collect changed messages (only root-level messages)
  //

  for (let id of changed) {
    let existing = state.messages.get(id);
    if (!existing) continue;

    let message = convertReducerMessageToMessage(existing, state);
    if (message) {
      newMessages.push(message);
    }
  }

  return {
    messages: newMessages,
    todos: state.latestTodos?.todos,
    usage: state.latestUsage
      ? {
          inputTokens: state.latestUsage.inputTokens,
          outputTokens: state.latestUsage.outputTokens,
          cacheCreation: state.latestUsage.cacheCreation,
          cacheRead: state.latestUsage.cacheRead,
          contextSize: state.latestUsage.contextSize,
          totalInputTokens: state.latestUsage.totalInputTokens,
          totalOutputTokens: state.latestUsage.totalOutputTokens,
          totalCostUsd: state.latestUsage.totalCostUsd,
          contextWindow: state.latestUsage.contextWindow,
          modelUsage: state.latestUsage.modelUsage,
          totalDurationMs: state.latestUsage.totalDurationMs,
          completedTurnsDurationMs: state.latestUsage.completedTurnsDurationMs,
          currentTurnStartedAt: state.latestUsage.currentTurnStartedAt,
        }
      : undefined,
    hasReadyEvent: hasReadyEvent || undefined,
  };
}

/**
 * Force-complete all running background tasks in the reducer state.
 * Called when a session goes offline — the CLI process is no longer running,
 * so background tasks cannot be monitored or controlled.
 * Mutates both backgroundTasks registry and tool-call messages in-place.
 * Returns affected tool-call message IDs for updating the message map.
 */
export function completeStaleBackgroundTasks(
  state: ReducerState,
): string[] {
  const now = Date.now();
  const affected: string[] = [];

  // Update backgroundTasks registry — mark as stopped (not completed, since they were interrupted)
  let bgDirty = false;
  for (const [taskId, entry] of state.backgroundTasks) {
    if (entry.status === "running") {
      state.backgroundTasks.set(taskId, { ...entry, status: "stopped" });
      bgDirty = true;
    }
  }
  if (bgDirty) {
    state.backgroundTasks = new Map(state.backgroundTasks);
  }

  // Update tool-call messages (tool.state only supports "running"|"completed"|"error",
  // so stopped maps to "error" — consistent with Phase 3.5 task-end handling)
  for (const messageId of state.backgroundTaskIdToMessageId.values()) {
    const msg = state.messages.get(messageId);
    if (!msg?.tool || msg.tool.state !== "running") continue;
    msg.tool.state = "error";
    msg.tool.completedAt = now;
    affected.push(messageId);
  }
  return affected;
}

//
// Helpers
//

function processUsageData(
  state: ReducerState,
  usage: UsageData,
  timestamp: number,
  durationMs?: number,
) {
  // Only update if this is newer than (or same timestamp as) the current latest usage.
  // Using >= to handle multiple usage events with the same timestamp (messageIds
  // deduplication prevents the same event from being processed twice).
  if (!state.latestUsage || timestamp >= state.latestUsage.timestamp) {
    const prevTotal = state.latestUsage ?? {
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
    state.latestUsage = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreation: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      contextSize:
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0) +
        usage.input_tokens,
      totalInputTokens:
        prevTotal.totalInputTokens +
        usage.input_tokens +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0),
      totalOutputTokens: prevTotal.totalOutputTokens + usage.output_tokens,
      timestamp: timestamp,
      // Preserve SDK-level fields from previous ready event so they don't
      // disappear mid-turn when usage-stats events arrive before the next ready.
      totalCostUsd: state.latestUsage?.totalCostUsd,
      contextWindow: state.latestUsage?.contextWindow,
      modelUsage: state.latestUsage?.modelUsage,
      totalDurationMs:
        (state.latestUsage?.totalDurationMs ?? 0) + (durationMs ?? 0),
      // Preserve real-time elapsed time fields across usage updates
      completedTurnsDurationMs: state.latestUsage?.completedTurnsDurationMs,
      currentTurnStartedAt: state.latestUsage?.currentTurnStartedAt,
    };
  }
}

function convertReducerMessageToMessage(
  reducerMsg: ReducerMessage,
  state: ReducerState,
): Message | null {
  if (reducerMsg.role === "user" && reducerMsg.text !== null) {
    return {
      id: reducerMsg.id,
      realId: reducerMsg.realID,
      localId: null,
      createdAt: reducerMsg.createdAt,
      kind: "user-text",
      text: reducerMsg.text,
      ...(reducerMsg.meta?.displayText && {
        displayText: reducerMsg.meta.displayText,
      }),
      meta: reducerMsg.meta,
    };
  } else if (reducerMsg.role === "agent" && reducerMsg.text !== null) {
    return {
      id: reducerMsg.id,
      localId: null,
      createdAt: reducerMsg.createdAt,
      kind: "agent-text",
      text: reducerMsg.text,
      ...(reducerMsg.isThinking && { isThinking: true }),
      ...(reducerMsg.taskStatus && { taskStatus: reducerMsg.taskStatus }),
      meta: reducerMsg.meta,
    };
  } else if (reducerMsg.role === "agent" && reducerMsg.tool !== null) {
    // Convert children recursively
    let childMessages: Message[] = [];
    let children = reducerMsg.realID
      ? state.sidechains.get(reducerMsg.realID) || []
      : [];
    for (let child of children) {
      let childMessage = convertReducerMessageToMessage(child, state);
      if (childMessage) {
        childMessages.push(childMessage);
      }
    }

    return {
      id: reducerMsg.id,
      localId: null,
      createdAt: reducerMsg.createdAt,
      kind: "tool-call",
      tool: { ...reducerMsg.tool },
      children: childMessages,
      meta: reducerMsg.meta,
    };
  } else if (reducerMsg.role === "agent" && reducerMsg.event !== null) {
    const eventMessage: ModeSwitchMessage = {
      id: reducerMsg.id,
      createdAt: reducerMsg.createdAt,
      kind: "agent-event",
      event: reducerMsg.event,
      meta: reducerMsg.meta,
    };
    // Inject session-level cumulative usage for "ready" events
    if (reducerMsg.event.type === "ready" && state.latestUsage) {
      return {
        ...eventMessage,
        sessionUsage: {
          totalInputTokens: state.latestUsage.totalInputTokens,
          totalOutputTokens: state.latestUsage.totalOutputTokens,
          ...(state.latestUsage.totalCostUsd !== undefined
            ? { totalCostUsd: state.latestUsage.totalCostUsd }
            : {}),
        },
      };
    }
    return eventMessage;
  }

  return null;
}
