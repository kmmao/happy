import { createId } from "@paralleldrive/cuid2";
import type { RawJSONLines } from "@/claude/types";

/**
 * Claude's Subagent identity resolver (CONTEXT.md: Subagent, Provider).
 *
 * Claude's JSONL stream identifies Subagent activity three different ways:
 * an explicit `parent_tool_use_id` on the record, inheritance from a parent
 * record's uuid on sidechain messages, and — for sidechain roots that carry
 * neither — matching the record's prompt text against pending Task tool
 * registrations. This module owns all of that plus the supporting state
 * (uuid index, prompt queues, provider→session id assignment, titles, and
 * the buffer for records that arrive before their parent tool call).
 *
 * The mapper (`sessionProtocolMapper.ts`) is a client of this interface; the
 * Turn / Subagent lifecycle invariants stay in `turnReducer` per ADR-0025.
 * "Provider subagent" below is Claude's identifier (the Task tool_use id);
 * "session id" is the cuid2 carried on SessionEnvelopes.
 */
export type SubagentResolver = {
  /** Resolve which provider subagent a raw record belongs to, if any. */
  resolveProvider(message: RawJSONLines): string | undefined;
  /** Session-side Subagent id already assigned to a provider subagent. */
  sessionIdFor(providerSubagent: string): string | undefined;
  /** Assign (or return the existing) session-side Subagent id. */
  ensureSessionId(providerSubagent: string): string;
  /** Index the record's uuid so sidechain children inherit by parentUuid. */
  rememberMessage(
    message: RawJSONLines,
    providerSubagent: string | undefined,
  ): void;
  /**
   * Register a Task/Agent tool call: queue its prompt for sidechain-root
   * matching and title the Subagent from the call's input.
   */
  registerTaskCall(call: string, input: unknown): void;
  /** Title captured from the Subagent's Task registration. */
  titleFor(sessionSubagent: string): string | undefined;
  /** Defer a record that arrived before its parent tool call was seen. */
  buffer(providerSubagent: string, message: RawJSONLines): void;
  /** Drain records buffered for a provider subagent ([] when none). */
  consumeBuffered(providerSubagent: string): RawJSONLines[];
  /** Drop all resolution state (Turn end). */
  clear(): void;
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

// Exported: the mapper also threads this uuid onto envelopes as the
// rewind/fork anchor — one picker, two consumers.
export function pickUuid(message: RawJSONLines): string | undefined {
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

export function createSubagentResolver(): SubagentResolver {
  const uuidToProviderSubagent = new Map<string, string>();
  const taskPromptToSubagents = new Map<string, string[]>();
  const providerToSessionId = new Map<string, string>();
  const titles = new Map<string, string>();
  const bufferedMessages = new Map<string, RawJSONLines[]>();

  function consumeTaskPromptSubagent(prompt: string): string | undefined {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) {
      return undefined;
    }

    const queue = taskPromptToSubagents.get(normalized);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const subagent = queue.shift();
    if (queue.length === 0) {
      taskPromptToSubagents.delete(normalized);
    }
    return subagent;
  }

  // Last-resort match for a sidechain root with no parentUuid and no prompt
  // hit: only safe when exactly one Task registration is pending, otherwise
  // ambiguous and resolution fails.
  function consumeSinglePendingTaskSubagent(): string | undefined {
    let candidateKey: string | null = null;
    let candidateSubagent: string | null = null;

    for (const [prompt, queue] of taskPromptToSubagents.entries()) {
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

    const queue = taskPromptToSubagents.get(candidateKey);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    queue.shift();
    if (queue.length === 0) {
      taskPromptToSubagents.delete(candidateKey);
    }

    return candidateSubagent;
  }

  const resolver: SubagentResolver = {
    resolveProvider(message) {
      const explicitSubagent = pickProviderSubagent(message);
      if (explicitSubagent) {
        return explicitSubagent;
      }

      const parentUuid = pickParentUuid(message);
      if (parentUuid && isSidechainMessage(message)) {
        const inheritedSubagent = uuidToProviderSubagent.get(parentUuid);
        if (inheritedSubagent) {
          return inheritedSubagent;
        }
      }

      if (!isSidechainMessage(message)) {
        return undefined;
      }

      const prompt = pickSidechainRootPrompt(message);
      if (prompt) {
        const matchedSubagent = consumeTaskPromptSubagent(prompt);
        if (matchedSubagent) {
          return matchedSubagent;
        }
      }

      if (!parentUuid) {
        return consumeSinglePendingTaskSubagent();
      }

      return undefined;
    },

    sessionIdFor(providerSubagent) {
      return providerToSessionId.get(providerSubagent);
    },

    ensureSessionId(providerSubagent) {
      const existing = providerToSessionId.get(providerSubagent);
      if (existing) {
        return existing;
      }

      const created = createId();
      providerToSessionId.set(providerSubagent, created);
      return created;
    },

    rememberMessage(message, providerSubagent) {
      if (!providerSubagent) {
        return;
      }

      const uuid = pickUuid(message);
      if (!uuid) {
        return;
      }

      uuidToProviderSubagent.set(uuid, providerSubagent);
    },

    registerTaskCall(call, input) {
      const prompt = pickTaskPrompt(input);
      if (prompt) {
        const queue = taskPromptToSubagents.get(prompt) ?? [];
        if (!queue.includes(call)) {
          queue.push(call);
        }
        taskPromptToSubagents.set(prompt, queue);
      }

      const title = pickTaskTitle(input) ?? prompt;
      if (title && title.trim().length > 0) {
        titles.set(resolver.ensureSessionId(call), title.trim());
      }
    },

    titleFor(sessionSubagent) {
      return titles.get(sessionSubagent);
    },

    buffer(providerSubagent, message) {
      const queue = bufferedMessages.get(providerSubagent) ?? [];
      queue.push(message);
      bufferedMessages.set(providerSubagent, queue);
    },

    consumeBuffered(providerSubagent) {
      const queue = bufferedMessages.get(providerSubagent) ?? [];
      bufferedMessages.delete(providerSubagent);
      return queue;
    },

    clear() {
      uuidToProviderSubagent.clear();
      taskPromptToSubagents.clear();
      providerToSessionId.clear();
      titles.clear();
      bufferedMessages.clear();
    },
  };

  return resolver;
}
