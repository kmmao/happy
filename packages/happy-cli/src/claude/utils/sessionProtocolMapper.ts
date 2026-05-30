import { createId } from "@paralleldrive/cuid2";
import type { RawJSONLines } from "@/claude/types";
import {
  createEnvelope,
  type SessionEnvelope,
  type SessionEvent,
  type SessionTurnEndStatus,
} from "@kmmao/happy-wire";
import { reduce, type ProtocolIntent } from "@/session-protocol/turnReducer";

export type ClaudeSessionProtocolState = {
  currentTurnId: string | null;
  uuidToProviderSubagent?: Map<string, string>;
  taskPromptToSubagents?: Map<string, string[]>;
  providerSubagentToSessionSubagent?: Map<string, string>;
  subagentTitles?: Map<string, string>;
  bufferedSubagentMessages?: Map<string, RawJSONLines[]>;
  hiddenParentToolCalls?: Set<string>;
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

type ClaudeMapperResult = {
  currentTurnId: string | null;
  envelopes: SessionEnvelope[];
  dropped: DroppedMessage[];
};

function pickProviderSubagent(message: RawJSONLines): string | undefined {
  const raw = message as {
    parent_tool_use_id?: unknown;
    parentToolUseId?: unknown;
  };
  if (
    typeof raw.parent_tool_use_id === "string" &&
    raw.parent_tool_use_id.length > 0
  ) {
    return raw.parent_tool_use_id;
  }
  if (
    typeof raw.parentToolUseId === "string" &&
    raw.parentToolUseId.length > 0
  ) {
    return raw.parentToolUseId;
  }
  return undefined;
}

function getUuidToProviderSubagent(
  state: ClaudeSessionProtocolState,
): Map<string, string> {
  if (!state.uuidToProviderSubagent) {
    state.uuidToProviderSubagent = new Map<string, string>();
  }
  return state.uuidToProviderSubagent;
}

function getTaskPromptToSubagents(
  state: ClaudeSessionProtocolState,
): Map<string, string[]> {
  if (!state.taskPromptToSubagents) {
    state.taskPromptToSubagents = new Map<string, string[]>();
  }
  return state.taskPromptToSubagents;
}

function getProviderSubagentToSessionSubagent(
  state: ClaudeSessionProtocolState,
): Map<string, string> {
  if (!state.providerSubagentToSessionSubagent) {
    state.providerSubagentToSessionSubagent = new Map<string, string>();
  }
  return state.providerSubagentToSessionSubagent;
}

function getSessionSubagentIdForProviderSubagent(
  state: ClaudeSessionProtocolState,
  providerSubagent: string,
): string | undefined {
  return getProviderSubagentToSessionSubagent(state).get(providerSubagent);
}

function ensureSessionSubagentIdForProviderSubagent(
  state: ClaudeSessionProtocolState,
  providerSubagent: string,
): string {
  const existing = getSessionSubagentIdForProviderSubagent(
    state,
    providerSubagent,
  );
  if (existing) {
    return existing;
  }

  const created = createId();
  getProviderSubagentToSessionSubagent(state).set(providerSubagent, created);
  return created;
}

function getSubagentTitles(
  state: ClaudeSessionProtocolState,
): Map<string, string> {
  if (!state.subagentTitles) {
    state.subagentTitles = new Map<string, string>();
  }
  return state.subagentTitles;
}

function getBufferedSubagentMessages(
  state: ClaudeSessionProtocolState,
): Map<string, RawJSONLines[]> {
  if (!state.bufferedSubagentMessages) {
    state.bufferedSubagentMessages = new Map<string, RawJSONLines[]>();
  }
  return state.bufferedSubagentMessages;
}

function getHiddenParentToolCalls(
  state: ClaudeSessionProtocolState,
): Set<string> {
  if (!state.hiddenParentToolCalls) {
    state.hiddenParentToolCalls = new Set<string>();
  }
  return state.hiddenParentToolCalls;
}

function bufferSubagentMessage(
  state: ClaudeSessionProtocolState,
  subagent: string,
  message: RawJSONLines,
): void {
  const buffer = getBufferedSubagentMessages(state);
  const queue = buffer.get(subagent) ?? [];
  queue.push(message);
  buffer.set(subagent, queue);
}

function consumeBufferedSubagentMessages(
  state: ClaudeSessionProtocolState,
  subagent: string,
): RawJSONLines[] {
  const buffer = getBufferedSubagentMessages(state);
  const queue = buffer.get(subagent) ?? [];
  buffer.delete(subagent);
  return queue;
}

function getStartedSubagents(state: ClaudeSessionProtocolState): Set<string> {
  if (!state.startedSubagents) {
    state.startedSubagents = new Set<string>();
  }
  return state.startedSubagents;
}

function getActiveSubagents(state: ClaudeSessionProtocolState): Set<string> {
  if (!state.activeSubagents) {
    state.activeSubagents = new Set<string>();
  }
  return state.activeSubagents;
}

function pickUuid(message: RawJSONLines): string | undefined {
  const raw = message as { uuid?: unknown };
  if (typeof raw.uuid === "string" && raw.uuid.length > 0) {
    return raw.uuid;
  }
  return undefined;
}

function pickParentUuid(message: RawJSONLines): string | undefined {
  const raw = message as { parentUuid?: unknown; parentUUID?: unknown };
  if (typeof raw.parentUuid === "string" && raw.parentUuid.length > 0) {
    return raw.parentUuid;
  }
  if (typeof raw.parentUUID === "string" && raw.parentUUID.length > 0) {
    return raw.parentUUID;
  }
  return undefined;
}

function isSidechainMessage(message: RawJSONLines): boolean {
  const raw = message as { isSidechain?: unknown };
  return raw.isSidechain === true;
}

function normalizePrompt(prompt: string): string {
  return prompt.trim();
}

function queueTaskPromptSubagent(
  state: ClaudeSessionProtocolState,
  prompt: string,
  subagent: string,
): void {
  const normalized = normalizePrompt(prompt);
  if (normalized.length === 0) {
    return;
  }

  const promptMap = getTaskPromptToSubagents(state);
  const queue = promptMap.get(normalized) ?? [];
  if (!queue.includes(subagent)) {
    queue.push(subagent);
  }
  promptMap.set(normalized, queue);
}

function consumeTaskPromptSubagent(
  state: ClaudeSessionProtocolState,
  prompt: string,
): string | undefined {
  const normalized = normalizePrompt(prompt);
  if (normalized.length === 0) {
    return undefined;
  }

  const promptMap = getTaskPromptToSubagents(state);
  const queue = promptMap.get(normalized);
  if (!queue || queue.length === 0) {
    return undefined;
  }

  const subagent = queue.shift();
  if (queue.length === 0) {
    promptMap.delete(normalized);
  }
  return subagent;
}

function consumeSinglePendingTaskSubagent(
  state: ClaudeSessionProtocolState,
): string | undefined {
  const promptMap = getTaskPromptToSubagents(state);
  let candidateKey: string | null = null;
  let candidateSubagent: string | null = null;

  for (const [prompt, queue] of promptMap.entries()) {
    if (queue.length === 0) {
      continue;
    }

    if (candidateKey !== null) {
      return undefined;
    }

    candidateKey = prompt;
    candidateSubagent = queue[0] ?? null;
  }

  if (!candidateKey || !candidateSubagent) {
    return undefined;
  }

  const queue = promptMap.get(candidateKey);
  if (!queue || queue.length === 0) {
    return undefined;
  }

  queue.shift();
  if (queue.length === 0) {
    promptMap.delete(candidateKey);
  }

  return candidateSubagent;
}

function pickSidechainRootPrompt(message: RawJSONLines): string | undefined {
  if (message.type !== "user") {
    return undefined;
  }

  if (typeof message.message?.content === "string") {
    const normalized = normalizePrompt(message.message.content);
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

function resolveProviderSubagent(
  message: RawJSONLines,
  state: ClaudeSessionProtocolState,
): string | undefined {
  const explicitSubagent = pickProviderSubagent(message);
  if (explicitSubagent) {
    return explicitSubagent;
  }

  const parentUuid = pickParentUuid(message);
  if (parentUuid && isSidechainMessage(message)) {
    const inheritedSubagent = getUuidToProviderSubagent(state).get(parentUuid);
    if (inheritedSubagent) {
      return inheritedSubagent;
    }
  }

  if (!isSidechainMessage(message)) {
    return undefined;
  }

  const prompt = pickSidechainRootPrompt(message);
  if (prompt) {
    const matchedSubagent = consumeTaskPromptSubagent(state, prompt);
    if (matchedSubagent) {
      return matchedSubagent;
    }
  }

  if (!parentUuid) {
    return consumeSinglePendingTaskSubagent(state);
  }

  return undefined;
}

function rememberSubagentForMessage(
  message: RawJSONLines,
  state: ClaudeSessionProtocolState,
  providerSubagent: string | undefined,
): void {
  if (!providerSubagent) {
    return;
  }

  const uuid = pickUuid(message);
  if (!uuid) {
    return;
  }

  getUuidToProviderSubagent(state).set(uuid, providerSubagent);
}

function pickTaskPrompt(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const prompt = (input as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string") {
    return undefined;
  }

  const normalized = normalizePrompt(prompt);
  return normalized.length > 0 ? normalized : undefined;
}

function pickTaskTitle(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const candidateKeys = ["description", "title", "subagent_type"];
  for (const key of candidateKeys) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function setSubagentTitle(
  state: ClaudeSessionProtocolState,
  subagent: string,
  title: string | undefined,
): void {
  if (!title || title.trim().length === 0) {
    return;
  }
  getSubagentTitles(state).set(subagent, title.trim());
}

function clearResolutionMaps(state: ClaudeSessionProtocolState): void {
  getUuidToProviderSubagent(state).clear();
  getTaskPromptToSubagents(state).clear();
  getProviderSubagentToSessionSubagent(state).clear();
  getSubagentTitles(state).clear();
  getBufferedSubagentMessages(state).clear();
  getHiddenParentToolCalls(state).clear();
}

// Bridge to the shared Turn lifecycle reducer (see CONTEXT.md: Turn, Subagent).
// The three lifecycle fields on ClaudeSessionProtocolState — currentTurnId,
// startedSubagents, activeSubagents — ARE the reducer's ProtocolState, so we
// lift them in, reduce, and write them back. This keeps the external state
// shape (and apiSession's `.currentTurnId` reads) untouched while turn opening,
// subagent start/stop dedup, and ordering live in one place instead of being
// hand-rolled here. Claude-specific subagent *resolution* stays below.
function applyIntent(
  state: ClaudeSessionProtocolState,
  intent: ProtocolIntent,
  envelopes: SessionEnvelope[],
): void {
  const { state: next, envelopes: emitted } = reduce(
    {
      currentTurnId: state.currentTurnId,
      startedSubagents: getStartedSubagents(state),
      activeSubagents: getActiveSubagents(state),
    },
    intent,
  );
  state.currentTurnId = next.currentTurnId;
  state.startedSubagents = new Set(next.startedSubagents);
  state.activeSubagents = new Set(next.activeSubagents);
  envelopes.push(...emitted);
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
          subagentTitle: getSubagentTitles(state).get(subagent),
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
  clearResolutionMaps(state);
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
  return mapClaudeLogMessageToSessionEnvelopesInternal(message, state);
}

function mapClaudeLogMessageToSessionEnvelopesInternal(
  message: RawJSONLines,
  state: ClaudeSessionProtocolState,
): ClaudeMapperResult {
  const envelopes: SessionEnvelope[] = [];
  const dropped: DroppedMessage[] = [];
  const providerSubagent = resolveProviderSubagent(message, state);
  const subagent = providerSubagent
    ? getSessionSubagentIdForProviderSubagent(state, providerSubagent)
    : undefined;
  rememberSubagentForMessage(message, state, providerSubagent);

  if (providerSubagent && !subagent) {
    bufferSubagentMessage(state, providerSubagent, message);
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
        const sessionSubagentForCall =
          ensureSessionSubagentIdForProviderSubagent(state, call);
        if (name === "Task" || name === "Agent") {
          const prompt = pickTaskPrompt(block.input);
          if (prompt) {
            queueTaskPromptSubagent(state, prompt, call);
          }
          setSubagentTitle(
            state,
            sessionSubagentForCall,
            pickTaskTitle(block.input) ?? prompt,
          );
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
        const buffered = consumeBufferedSubagentMessages(state, call);
        for (const bufferedMessage of buffered) {
          const replay = mapClaudeLogMessageToSessionEnvelopesInternal(
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
        const sessionSubagentForToolResult =
          getSessionSubagentIdForProviderSubagent(state, block.tool_use_id);
        if (!message.isSidechain) {
          if (getHiddenParentToolCalls(state).has(block.tool_use_id)) {
            if (sessionSubagentForToolResult) {
              applyIntent(
                state,
                { kind: "subagentStop", subagent: sessionSubagentForToolResult },
                envelopes,
              );
            }
            getHiddenParentToolCalls(state).delete(block.tool_use_id);
            continue;
          }
          if (sessionSubagentForToolResult) {
            applyIntent(
              state,
              { kind: "subagentStop", subagent: sessionSubagentForToolResult },
              envelopes,
            );
          }
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
