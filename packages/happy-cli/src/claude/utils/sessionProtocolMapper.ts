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

export function mapClaudeLogMessageToSessionEnvelopes(
  message: RawJSONLines,
  state: ClaudeSessionProtocolState,
): ClaudeMapperResult {
  const envelopes: SessionEnvelope[] = [];
  const dropped: DroppedMessage[] = [];
  const providerSubagent = state.subagents.resolveProvider(message);
  const subagent = providerSubagent
    ? state.subagents.sessionIdFor(providerSubagent)
    : undefined;
  state.subagents.rememberMessage(message, providerSubagent);

  if (providerSubagent && !subagent) {
    state.subagents.buffer(providerSubagent, message);
    return {
      currentTurnId: state.currentTurnId,
      envelopes,
      dropped: [{ type: message.type, reason: "buffered-pending-subagent" }],
    };
  }

  if (message.type === "summary") {
    return {
      currentTurnId: state.currentTurnId,
      envelopes,
      dropped: [{ type: message.type, reason: "summary-message" }],
    };
  }

  if (message.type === "system") {
    return {
      currentTurnId: state.currentTurnId,
      envelopes,
      dropped: [{ type: message.type, reason: "system-message" }],
    };
  }

  if (message.type === "assistant") {
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
          envelopes,
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
          envelopes,
          assistantClaudeUuid,
        );
        continue;
      }

      if (block.type === "tool_use") {
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
          envelopes,
          assistantClaudeUuid,
        );
        const buffered = state.subagents.consumeBuffered(call);
        for (const bufferedMessage of buffered) {
          const replay = mapClaudeLogMessageToSessionEnvelopes(
            bufferedMessage,
            state,
          );
          envelopes.push(...replay.envelopes);
          dropped.push(...replay.dropped);
        }
      }
    }

    return {
      currentTurnId: state.currentTurnId,
      envelopes,
      dropped,
    };
  }

  if (message.type === "user") {
    // SDK-injected synthetic user messages (e.g. the Skill tool feeds
    // the skill prompt back to Claude as a 'user' message with
    // isMeta=true so the model sees it but the human shouldn't).
    // Without this skip the prompt body — easily 10–20k characters —
    // gets emitted as an agent-text envelope and lands in the chat as
    // a wall of text.
    if (message.isMeta) {
      return {
        currentTurnId: state.currentTurnId,
        envelopes,
        dropped: [{ type: message.type, reason: "meta-user-message" }],
      };
    }

    if (typeof message.message.content === "string") {
      if (message.isSidechain) {
        emitContent(
          state,
          { t: "text", text: message.message.content },
          subagent,
          envelopes,
          pickUuid(message),
        );
      } else {
        closeTurn(state, "completed", envelopes);
        const userUuid = pickUuid(message);
        envelopes.push(
          createEnvelope("user", { t: "text", text: message.message.content }, {
            id: userUuid,
            ...(userUuid ? { claudeUuid: userUuid } : {}),
          }),
        );
      }

      return {
        currentTurnId: state.currentTurnId,
        envelopes,
        dropped,
      };
    }

    const blocks = Array.isArray(message.message.content)
      ? message.message.content
      : [];
    if (blocks.length === 0) {
      return {
        currentTurnId: state.currentTurnId,
        envelopes,
        dropped: [{ type: message.type, reason: "empty-user-content" }],
      };
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
        const sessionSubagentForToolResult = state.subagents.sessionIdFor(
          block.tool_use_id,
        );
        if (!message.isSidechain && sessionSubagentForToolResult) {
          applyIntent(
            state,
            { kind: "subagentStop", subagent: sessionSubagentForToolResult },
            envelopes,
          );
        }
        const toolCallEnd: Record<string, unknown> = {
          t: "tool-call-end",
          call: block.tool_use_id,
        };

        // Extract background task metadata from Bash tool_result
        const resultContent =
          typeof block.content === "string" ? block.content : "";
        const bgMatch = resultContent.match(
          /Command running in background with ID: (\S+)\. Output is being written to: (\S+)/,
        );
        if (bgMatch) {
          toolCallEnd.backgroundTaskId = bgMatch[1];
          toolCallEnd.outputFile = bgMatch[2];
        }

        emitContent(
          state,
          toolCallEnd as unknown as SessionEvent,
          subagent,
          envelopes,
          userBlocksClaudeUuid,
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
          envelopes,
          userBlocksClaudeUuid,
        );
      }
    }

    return {
      currentTurnId: state.currentTurnId,
      envelopes,
      dropped,
    };
  }

  return {
    currentTurnId: state.currentTurnId,
    envelopes,
    dropped: [{ type: message.type, reason: "unhandled-message-type" }],
  };
}
