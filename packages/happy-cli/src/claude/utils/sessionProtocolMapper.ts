import { createId } from "@paralleldrive/cuid2";
import type { RawJSONLines } from "@/claude/types";
import {
  createEnvelope,
  type SessionEnvelope,
  type SessionEvent,
  type SessionTurnEndStatus,
} from "@kmmao/happy-wire";
import { type ProtocolIntent } from "@/session-protocol/turnReducer";
import {
  applyToProvider,
  embeddedProtocolAdapter,
} from "@/session-protocol/providerAdapter";
import {
  createSubagentResolver,
  pickUuid,
  type SubagentResolver,
} from "@/claude/utils/subagentResolver";

export type ClaudeSessionProtocolState = {
  currentTurnId: string | null;
  /** Claude's Subagent identity resolution, owned by `subagentResolver.ts`. */
  subagents: SubagentResolver;
  startedSubagents?: Set<string>;
  activeSubagents?: Set<string>;
};

export type TurnModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
};

export type TurnMeta = {
  model?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  durationMs?: number;
  totalCostUsd?: number;
  numTurns?: number;
  modelUsage?: Record<string, TurnModelUsage>;
};

/**
 * Why a Claude log message produced no Session envelopes. Each value names a
 * distinct, intentional non-emit decision the mapper makes. Before this existed
 * the six drop sites all returned an indistinguishable `envelopes: []`, so a
 * caller (or a reader) could not tell "handled, deliberately silent, here's why"
 * from "fell through unhandled". Surfacing the reason turns those look-alike
 * returns into a typed, testable taxonomy — the same interface-as-test-surface
 * move the Cipher/dispatch seams make elsewhere.
 *
 * Note `buffered-pending-subagent` is a *deferral*, not a discard: the message
 * is queued and replayed once its parent tool-call appears.
 */
export type DropReason =
  | "buffered-pending-subagent"
  | "summary-message"
  | "system-message"
  | "meta-user-message"
  | "empty-user-content"
  | "task-notification-relay"
  | "unhandled-message-type";

export type DroppedMessage = {
  type: string;
  reason: DropReason;
};

export type ClaudeMapperResult = {
  currentTurnId: string | null;
  envelopes: SessionEnvelope[];
  dropped: DroppedMessage[];
};

/**
 * The single canonical empty Claude protocol state. Subagent identity
 * resolution lives behind the `subagents` resolver; the two reducer-owned
 * sets and the turn cursor are the only other fields. `ClaudeProtocolDriver`
 * and the mapper tests both build state through this one factory.
 */
export function createClaudeProtocolState(): ClaudeSessionProtocolState {
  return {
    currentTurnId: null,
    subagents: createSubagentResolver(),
    startedSubagents: new Set<string>(),
    activeSubagents: new Set<string>(),
  };
}


/**
 * Claude's ProviderAdapter (CONTEXT.md: Provider, ProviderAdapter; ADR-0025).
 * The three reducer fields are mirrored on ClaudeSessionProtocolState, so the
 * shared `embeddedProtocolAdapter` covers the lift/write; the Claude-only
 * `subagents` resolver is preserved by reference through its `writeProtocol`
 * spread. Callers continue to use the imperative
 * `applyIntent` boundary below to keep the existing `runMapper` call sites
 * unchanged; the seam itself is now uniform with Codex and ACP.
 */
export const CLAUDE_ADAPTER = embeddedProtocolAdapter<ClaudeSessionProtocolState>();

// Bridge to the shared Turn lifecycle reducer via the ProviderAdapter helper
// (ADR-0025). The external imperative signature is preserved so existing
// callers in `runMapper` keep their current shape; an open subordinate
// question in ADR-0025 covers a future return-thread cleanup that would
// remove the `envelopes` side-channel.
function applyIntent(
  state: ClaudeSessionProtocolState,
  intent: ProtocolIntent,
  envelopes: SessionEnvelope[],
): void {
  const result = applyToProvider(CLAUDE_ADAPTER, state, intent);
  // Mutate caller's state to keep the existing API stable. The Claude-only
  // map fields on result.state are shared by reference with the caller's
  // state (writeProtocol uses `{ ...state, …}`), so only the three reducer
  // fields differ.
  state.currentTurnId = result.state.currentTurnId;
  state.startedSubagents = result.state.startedSubagents;
  state.activeSubagents = result.state.activeSubagents;
  envelopes.push(...result.envelopes);
}

// Emit one agent content event, lazily opening the Turn — and the Subagent's
// `start` (titled from its Task registration) — as needed.
//
// `claudeUuid`, when provided, is the Claude JSONL message UUID of the source
// record. We thread it onto the emitted envelope so the App can use it as a
// precise rewind/fork anchor (passed back to the CLI's `forkSession` RPC as
// `upToMessageId`). Stream-only deltas and turn-lifecycle events leave it
// unset — only single-record content envelopes carry the anchor.
function emitContent(
  state: ClaudeSessionProtocolState,
  ev: SessionEvent,
  subagent: string | undefined,
  envelopes: SessionEnvelope[],
  claudeUuid?: string,
): void {
  applyIntent(
    state,
    subagent
      ? {
          kind: "content",
          ev,
          subagent,
          subagentTitle: state.subagents.titleFor(subagent),
          claudeUuid,
        }
      : { kind: "content", ev, claudeUuid },
    envelopes,
  );
}

// Close the open Turn (turn-end + auto-stop of any still-active Subagent) and
// drop the Claude-specific resolution maps. No-op when no Turn is open.
function closeTurn(
  state: ClaudeSessionProtocolState,
  status: SessionTurnEndStatus,
  envelopes: SessionEnvelope[],
  meta?: TurnMeta,
): void {
  if (!state.currentTurnId) {
    return;
  }
  applyIntent(state, { kind: "turnEnd", status, meta }, envelopes);
  state.subagents.clear();
}

function toolTitle(name: string, input: unknown): string {
  if (input && typeof input === "object") {
    const description = (input as { description?: unknown }).description;
    if (typeof description === "string" && description.trim().length > 0) {
      return description.length > 80
        ? `${description.slice(0, 77)}...`
        : description;
    }
  }
  return `${name} call`;
}

function toToolArgs(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (input === undefined) {
    return {};
  }
  return { input };
}

export function closeClaudeTurnWithStatus(
  state: ClaudeSessionProtocolState,
  status: SessionTurnEndStatus,
  meta?: TurnMeta,
): ClaudeMapperResult {
  const envelopes: SessionEnvelope[] = [];
  closeTurn(state, status, envelopes, meta);
  return {
    currentTurnId: state.currentTurnId,
    envelopes,
    dropped: [],
  };
}

/**
 * The accumulators every per-message-type handler threads through. Handlers
 * push envelopes and drop-reasons here instead of each rebuilding the
 * `ClaudeMapperResult` boilerplate; the dispatcher stamps the turn cursor once.
 */
type MapperSink = {
  envelopes: SessionEnvelope[];
  dropped: DroppedMessage[];
};

function makeResult(
  state: ClaudeSessionProtocolState,
  sink: MapperSink,
): ClaudeMapperResult {
  return {
    currentTurnId: state.currentTurnId,
    envelopes: sink.envelopes,
    dropped: sink.dropped,
  };
}

/**
 * Emit one assistant `tool_use` block: allocate the call id, register a Task /
 * Agent subagent, emit the `tool-call-start` envelope, then replay any messages
 * that were buffered waiting for this call to appear. Isolated so the
 * subagent-linking + buffered-replay invariants live in one testable place
 * instead of being inlined in the assistant loop.
 */
function emitAssistantToolUse(
  state: ClaudeSessionProtocolState,
  block: { id?: unknown; name?: unknown; input?: unknown },
  subagent: string | undefined,
  assistantClaudeUuid: string | undefined,
  sink: MapperSink,
): void {
  const call =
    typeof block.id === "string" && block.id.length > 0
      ? block.id
      : createId();
  const name =
    typeof block.name === "string" && block.name.length > 0
      ? block.name
      : "unknown";
  const args = toToolArgs(block.input);
  const title = toolTitle(name, block.input);
  const sessionSubagentForCall = state.subagents.ensureSessionId(call);
  if (name === "Task" || name === "Agent") {
    state.subagents.registerTaskCall(call, block.input);
    // Inject subagent ID into args for App-side sidechain linking
    if (sessionSubagentForCall) {
      args._subagentId = sessionSubagentForCall;
    }
    // Fall through to emit tool-call-start envelope like regular tools
  }

  emitContent(
    state,
    {
      t: "tool-call-start",
      call,
      name,
      title,
      description: title,
      args,
    },
    subagent,
    sink.envelopes,
    assistantClaudeUuid,
  );
  const buffered = state.subagents.consumeBuffered(call);
  for (const bufferedMessage of buffered) {
    const replay = mapClaudeLogMessageToSessionEnvelopes(bufferedMessage, state);
    sink.envelopes.push(...replay.envelopes);
    sink.dropped.push(...replay.dropped);
  }
}

/** Map an `assistant` record's content blocks (text / thinking / tool_use). */
function handleAssistantMessage(
  message: Extract<RawJSONLines, { type: "assistant" }>,
  state: ClaudeSessionProtocolState,
  subagent: string | undefined,
  sink: MapperSink,
): void {
  const blocks = Array.isArray(message.message?.content)
    ? message.message.content
    : [];
  // Same record-level UUID is threaded onto every envelope emitted from
  // this assistant message, so a multi-block message (text + tool_use)
  // shares a single fork anchor pointing at the source JSONL record.
  const assistantClaudeUuid = pickUuid(message);

  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      emitContent(
        state,
        { t: "text", text: block.text },
        subagent,
        sink.envelopes,
        assistantClaudeUuid,
      );
      continue;
    }

    if (block.type === "thinking" && typeof block.thinking === "string") {
      // Opus 4.7+ defaults to thinking.display="omitted" — the API returns
      // an empty `thinking` field plus a signature. Skip empty blocks so the
      // App doesn't render an orphan "Thinking" header with no content.
      if (block.thinking.length === 0) {
        continue;
      }
      emitContent(
        state,
        { t: "text", text: block.thinking, thinking: true },
        subagent,
        sink.envelopes,
        assistantClaudeUuid,
      );
      continue;
    }

    if (block.type === "tool_use") {
      emitAssistantToolUse(state, block, subagent, assistantClaudeUuid, sink);
    }
  }
}

/** Flatten a tool_result content (string or array of text blocks) to text. */
function extractToolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: "text"; text: string } =>
          !!b &&
          typeof b === "object" &&
          (b as { type?: unknown }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string",
      )
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/**
 * Parse the Task/Agent `run_in_background` launch acknowledgment. Claude Code
 * returns it as the tool_result the moment a background agent spawns; the
 * agent itself keeps running and writes to `subagents/agent-<id>.jsonl`.
 * The agentId doubles as the background task id (`<task-id>` in the eventual
 * `<task-notification>` completion message uses the same value).
 */
export function parseBackgroundAgentLaunchAck(
  text: string,
): { agentId: string; outputFile?: string } | null {
  if (!/agent launched/i.test(text)) {
    return null;
  }
  const idMatch = text.match(/\bagentId:\s*([\w-]+)/);
  if (!idMatch) {
    return null;
  }
  const fileMatch = text.match(/\boutput_file:\s*(\S+)/);
  return { agentId: idMatch[1], outputFile: fileMatch?.[1] };
}

/**
 * Parse the `<task-notification>` XML that Claude Code injects as a user prompt
 * when a `run_in_background` Agent/Task finishes. Mirrors happy-app's
 * `parseTaskNotification` (typesRaw.ts) — the two MUST agree on tag names and
 * the status mapping. The `<task-id>` equals the launch ack's agentId (the same
 * value `parseBackgroundAgentLaunchAck` lifts into `backgroundTaskId`), so the
 * `task-end` we emit from it reaps the exact background task on the App.
 * `summary` falls back to `""` because the wire `task-end` schema requires a
 * string; `toolUseId` is intentionally omitted — the App completes the card by
 * `taskId` lookup, not the spawning tool_use id.
 */
export function parseTaskNotificationXml(
  text: string,
): { taskId: string; status: "completed" | "failed" | "stopped"; summary: string } | null {
  const tag = (name: string): string | null => {
    const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? m[1].trim() : null;
  };
  const taskId = tag("task-id");
  if (!taskId) {
    return null;
  }
  const rawStatus = (tag("status") ?? "completed").toLowerCase();
  const status: "completed" | "failed" | "stopped" = /fail|error/.test(rawStatus)
    ? "failed"
    : /stop|kill|cancel|abort/.test(rawStatus)
      ? "stopped"
      : "completed";
  return { taskId, status, summary: tag("summary") ?? "" };
}

/**
 * Emit one user `tool_result` block: auto-stop the matching subagent, build the
 * `tool-call-end` envelope, and lift background-task metadata out of a Bash
 * result. Isolated so the subagent-stop + background-task parsing invariants
 * are testable independent of the surrounding user-message loop.
 */
function emitUserToolResult(
  state: ClaudeSessionProtocolState,
  message: Extract<RawJSONLines, { type: "user" }>,
  block: { tool_use_id: string; content?: unknown },
  subagent: string | undefined,
  userBlocksClaudeUuid: string | undefined,
  sink: MapperSink,
): void {
  const sessionSubagentForToolResult = state.subagents.sessionIdFor(
    block.tool_use_id,
  );
  if (!message.isSidechain && sessionSubagentForToolResult) {
    applyIntent(
      state,
      { kind: "subagentStop", subagent: sessionSubagentForToolResult },
      sink.envelopes,
    );
  }
  const toolCallEnd: Record<string, unknown> = {
    t: "tool-call-end",
    call: block.tool_use_id,
  };

  // Extract background task metadata from the tool_result. Two producers:
  //   - Bash run_in_background acks (string content),
  //   - Task/Agent run_in_background launch acks (array-of-text-blocks
  //     content: "Async agent launched successfully … agentId: X …
  //     output_file: Y"). Tagging the tool-call-end lets the App keep the
  //     Agent card in the "running" state and register the background task
  //     instead of treating the launch ack as the agent's final result.
  const resultContent = extractToolResultText(block.content);
  const bgMatch = resultContent.match(
    /Command running in background with ID: (\S+)\. Output is being written to: (\S+)/,
  );
  if (bgMatch) {
    toolCallEnd.backgroundTaskId = bgMatch[1];
    toolCallEnd.outputFile = bgMatch[2];
  } else {
    const agentAck = parseBackgroundAgentLaunchAck(resultContent);
    if (agentAck) {
      toolCallEnd.backgroundTaskId = agentAck.agentId;
      if (agentAck.outputFile) {
        toolCallEnd.outputFile = agentAck.outputFile;
      }
    }
  }

  emitContent(
    state,
    toolCallEnd as unknown as SessionEvent,
    subagent,
    sink.envelopes,
    userBlocksClaudeUuid,
  );
}

/**
 * Map a `user` record. Three shapes: string content (opens a real user turn, or
 * relays a sidechain line), or an array of tool_result / text blocks. Returns
 * `false` for the two whole-message drop cases (meta, empty) so the dispatcher
 * can record the reason; returns `true` once any envelope path is taken.
 */
function handleUserMessage(
  message: Extract<RawJSONLines, { type: "user" }>,
  state: ClaudeSessionProtocolState,
  subagent: string | undefined,
  sink: MapperSink,
): DropReason | null {
  // SDK-injected synthetic user messages (e.g. the Skill tool feeds
  // the skill prompt back to Claude as a 'user' message with
  // isMeta=true so the model sees it but the human shouldn't).
  // Without this skip the prompt body — easily 10–20k characters —
  // gets emitted as an agent-text envelope and lands in the chat as
  // a wall of text.
  if (message.isMeta) {
    return "meta-user-message";
  }

  if (typeof message.message.content === "string") {
    if (message.isSidechain) {
      emitContent(
        state,
        { t: "text", text: message.message.content },
        subagent,
        sink.envelopes,
        pickUuid(message),
      );
    } else if (
      message.message.content.trimStart().startsWith("<task-notification>")
    ) {
      // Background-agent completion relay: Claude Code injects this XML as a
      // user prompt to wake the main loop when a run_in_background Agent/Task
      // finishes. It is machine metadata, not something the human typed, so we
      // never render it as a user bubble. In session-protocol-only mode there
      // is NO legacy message stream for the App to derive completion from (it
      // once parsed the raw user message via happy-app typesRaw
      // parseTaskNotification, but the CLI no longer emits that), so the
      // protocol path itself must carry the signal — otherwise the Agent/Task
      // card stays stuck "running" forever. Parse the notification and emit a
      // `task-end`, mirroring the structured `task_notification` system-message
      // path in claudeRemoteLauncherCore. The `task-end` reaps the background
      // task by its taskId (== the launch ack's agentId, already registered as
      // backgroundTaskId), so the App flips the card to completed/failed.
      const notification = parseTaskNotificationXml(message.message.content);
      if (notification) {
        const taskEndEvent: SessionEvent = {
          t: "task-end",
          taskId: notification.taskId,
          status: notification.status,
          summary: notification.summary,
        };
        // openTurn: false — a completion signal must never spawn an empty Turn.
        // It stamps onto the currently-open Turn if any, else emits Turn-less.
        applyIntent(
          state,
          { kind: "content", ev: taskEndEvent, openTurn: false },
          sink.envelopes,
        );
      }
      // The notification also wakes a new prompt, so close any open turn.
      closeTurn(state, "completed", sink.envelopes);
      // Emitting a task-end is no longer a drop; only a malformed notification
      // (no <task-id>) falls back to the relay drop-reason for honest taxonomy.
      return notification ? null : "task-notification-relay";
    } else {
      closeTurn(state, "completed", sink.envelopes);
      const userUuid = pickUuid(message);
      sink.envelopes.push(
        createEnvelope("user", { t: "text", text: message.message.content }, {
          id: userUuid,
          ...(userUuid ? { claudeUuid: userUuid } : {}),
        }),
      );
    }
    return null;
  }

  const blocks = Array.isArray(message.message.content)
    ? message.message.content
    : [];
  if (blocks.length === 0) {
    return "empty-user-content";
  }
  // Single anchor per source record — same idea as the assistant branch:
  // tool_result + sidechain text blocks emitted from one user message all
  // point at the same JSONL UUID for fork purposes.
  const userBlocksClaudeUuid = pickUuid(message);

  for (const block of blocks) {
    if (
      block.type === "tool_result" &&
      typeof block.tool_use_id === "string" &&
      block.tool_use_id.length > 0
    ) {
      emitUserToolResult(
        state,
        message,
        block as { tool_use_id: string; content?: unknown },
        subagent,
        userBlocksClaudeUuid,
        sink,
      );
      continue;
    }

    if (
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.trim().length > 0
    ) {
      emitContent(
        state,
        { t: "text", text: block.text },
        subagent,
        sink.envelopes,
        userBlocksClaudeUuid,
      );
    }
  }

  return null;
}

/**
 * Dispatch one raw Claude JSONL record to its per-type handler. This function
 * owns only the shared preamble — Subagent identity resolution + the
 * pending-parent buffering deferral — and the type switch; every message
 * type's real work lives behind a named handler seam
 * (`handleAssistantMessage` / `handleUserMessage`) so each concern is testable
 * on its own and a reader sees the whole shape at a glance.
 */
export function mapClaudeLogMessageToSessionEnvelopes(
  message: RawJSONLines,
  state: ClaudeSessionProtocolState,
): ClaudeMapperResult {
  const sink: MapperSink = { envelopes: [], dropped: [] };
  const providerSubagent = state.subagents.resolveProvider(message);
  const subagent = providerSubagent
    ? state.subagents.sessionIdFor(providerSubagent)
    : undefined;
  state.subagents.rememberMessage(message, providerSubagent);

  if (providerSubagent && !subagent) {
    state.subagents.buffer(providerSubagent, message);
    sink.dropped.push({ type: message.type, reason: "buffered-pending-subagent" });
    return makeResult(state, sink);
  }

  switch (message.type) {
    case "summary":
      sink.dropped.push({ type: message.type, reason: "summary-message" });
      return makeResult(state, sink);

    case "system":
      sink.dropped.push({ type: message.type, reason: "system-message" });
      return makeResult(state, sink);

    case "assistant":
      handleAssistantMessage(message, state, subagent, sink);
      return makeResult(state, sink);

    case "user": {
      const dropReason = handleUserMessage(message, state, subagent, sink);
      if (dropReason) {
        sink.dropped.push({ type: message.type, reason: dropReason });
      }
      return makeResult(state, sink);
    }

    default:
      sink.dropped.push({ type: message.type, reason: "unhandled-message-type" });
      return makeResult(state, sink);
  }
}
