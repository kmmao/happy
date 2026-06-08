import { createId } from "@paralleldrive/cuid2";
import {
  createEnvelope,
  type CreateEnvelopeOptions,
  type SessionEnvelope,
  type SessionEvent,
} from "@kmmao/happy-wire";
import type { AgentMessage } from "@/agent/core";
import {
  initialProtocolState,
  type ProtocolClock,
  type ProtocolState,
} from "@/session-protocol/turnReducer";
import {
  applyToProvider,
  type ProviderAdapter,
} from "@/session-protocol/providerAdapter";

function turnOptions(
  turnId: string | null,
  time: number,
): CreateEnvelopeOptions {
  return turnId ? { turn: turnId, time } : { time };
}

function buildToolTitle(toolName: string): string {
  return toolName;
}

function buildToolDescription(toolName: string): string {
  return `Running ${toolName}`;
}

function buildFsEditDescription(msg: Extract<AgentMessage, { type: "fs-edit" }>): string {
  if (msg.description && msg.description.trim().length > 0) {
    return msg.description.trim();
  }
  if (msg.path && msg.path.trim().length > 0) {
    return `Edited ${msg.path.trim()}`;
  }
  return "File edit";
}

function parseThinkingPayload(payload: unknown): {
  text: string;
  streaming: boolean;
} {
  if (typeof payload === "string") {
    return { text: payload, streaming: false };
  }
  if (!payload || typeof payload !== "object") {
    return { text: "", streaming: false };
  }
  const text =
    typeof (payload as { text?: unknown }).text === "string"
      ? (payload as { text: string }).text
      : "";
  const streaming = (payload as { streaming?: unknown }).streaming === true;
  return { text, streaming };
}

/**
 * ACP's ProviderAdapter (CONTEXT.md: Provider, ProviderAdapter; ADR-0025).
 * ACP's reducer view is just `ProtocolState` itself — no extra Provider-only
 * fields ride on top of the lifecycle state. The Provider's signal-extraction
 * state (`acpCallToSessionCall`, `pendingText`, `pendingType`, `lastTime`)
 * lives on the class instance, NOT in the adapter's state argument.
 */
export const ACP_ADAPTER: ProviderAdapter<ProtocolState> = {
  liftProtocol(state) {
    return state;
  },
  writeProtocol(_state, next) {
    return next;
  },
};

export class AcpSessionManager {
  /** Reducer view (CONTEXT.md: Turn, Subagent). Replaces the standalone
   *  `currentTurnId` field used before ADR-0025 — startedSubagents and
   *  activeSubagents are tracked too even though ACP has no Subagent concept
   *  today, so the reducer's auto-stop guarantee is in place ahead of time. */
  private protocol: ProtocolState = initialProtocolState();
  private readonly acpCallToSessionCall = new Map<string, string>();

  /** Monotonic clock: max(lastTime + 1, Date.now()). Injected into the
   *  reducer as a ProtocolClock so ACP envelopes keep the same time semantic
   *  they had before ADR-0025 (Claude and Codex continue to use the default
   *  realClock — see ADR-0025 decision D3). */
  private lastTime = 0;
  private readonly clock: ProtocolClock = {
    now: () => this.nextTime(),
    newId: () => createId(),
  };

  /** Pending text waiting to be flushed when the stream type changes */
  private pendingText = "";
  private pendingType: "thinking" | "output" | null = null;

  private nextTime(): number {
    this.lastTime = Math.max(this.lastTime + 1, Date.now());
    return this.lastTime;
  }

  private ensureSessionCallId(acpCallId: string): string {
    const existing = this.acpCallToSessionCall.get(acpCallId);
    if (existing) {
      return existing;
    }

    const created = createId();
    this.acpCallToSessionCall.set(acpCallId, created);
    return created;
  }

  /** Run one content intent through the reducer. Pre-bound `openTurn: false`
   *  because ACP has explicit Turn boundaries (startTurn / endTurn) — content
   *  outside a Turn stays Turn-less rather than forcing one open, which
   *  matches the test "flushes pending text on endTurn() even without
   *  active turn". */
  private emitContent(ev: SessionEvent): SessionEnvelope[] {
    const result = applyToProvider(
      ACP_ADAPTER,
      this.protocol,
      { kind: "content", ev, openTurn: false },
      this.clock,
    );
    this.protocol = result.state;
    return result.envelopes;
  }

  private flush(): SessionEnvelope[] {
    if (!this.pendingText || !this.pendingType) {
      return [];
    }
    const text = this.pendingText.replace(/^\n+|\n+$/g, "");
    const type = this.pendingType;
    this.pendingText = "";
    this.pendingType = null;

    if (!text) {
      return [];
    }
    return this.emitContent(
      type === "thinking" ? { t: "text", text, thinking: true } : { t: "text", text },
    );
  }

  /** Tool-call envelopes (start/end) reuse the class's monotonic clock via
   *  `turnOptions` rather than routing through the reducer — they are not
   *  Turn or Subagent boundary events, so the reducer would add no value
   *  beyond stamping the current `turn`, which `turnOptions` already does.
   *  Keeping them direct avoids a second `applyToProvider` round-trip per
   *  tool call. */
  private buildToolEnvelope(ev: SessionEvent): SessionEnvelope {
    return createEnvelope(
      "agent",
      ev,
      turnOptions(this.protocol.currentTurnId, this.nextTime()),
    );
  }

  startTurn(): SessionEnvelope[] {
    const before = this.protocol.currentTurnId;
    const result = applyToProvider(
      ACP_ADAPTER,
      this.protocol,
      { kind: "turnBegin" },
      this.clock,
    );
    this.protocol = result.state;
    // turnBegin is idempotent at the reducer level; reset the ACP-specific
    // tool-call routing only when we actually opened a new Turn.
    if (before === null && this.protocol.currentTurnId !== null) {
      this.acpCallToSessionCall.clear();
    }
    return result.envelopes;
  }

  endTurn(status: "completed" | "failed" | "cancelled"): SessionEnvelope[] {
    const flushed = this.flush();
    if (!this.protocol.currentTurnId) {
      return flushed;
    }

    const result = applyToProvider(
      ACP_ADAPTER,
      this.protocol,
      { kind: "turnEnd", status },
      this.clock,
    );
    this.protocol = result.state;
    this.acpCallToSessionCall.clear();
    return [...flushed, ...result.envelopes];
  }

  mapMessage(msg: AgentMessage): SessionEnvelope[] {
    if (msg.type === "event" && msg.name === "thinking") {
      const { text, streaming } = parseThinkingPayload(msg.payload);
      if (!text) {
        return [];
      }

      if (streaming) {
        // Streaming thinking: accumulate, flush if switching from a different type
        const flushed = this.pendingType !== "thinking" ? this.flush() : [];
        this.pendingType = "thinking";
        this.pendingText += text;
        return flushed;
      }

      // Non-streaming thinking: flush pending, emit immediately
      const trimmed = text.replace(/^\n+|\n+$/g, "");
      if (!trimmed) {
        return this.flush();
      }
      return [
        ...this.flush(),
        ...this.emitContent({ t: "text", text: trimmed, thinking: true }),
      ];
    }

    if (msg.type === "status") {
      return [];
    }

    if (msg.type === "model-output") {
      const text = msg.textDelta ?? "";
      if (!text) {
        return [];
      }
      // Accumulate output, flush if switching from a different type
      const flushed = this.pendingType !== "output" ? this.flush() : [];
      this.pendingType = "output";
      this.pendingText += text;
      return flushed;
    }

    if (msg.type === "tool-call") {
      const flushed = this.flush();
      const call = this.ensureSessionCallId(msg.callId);
      return [
        ...flushed,
        this.buildToolEnvelope({
          t: "tool-call-start",
          call,
          name: msg.toolName,
          title: buildToolTitle(msg.toolName),
          description: buildToolDescription(msg.toolName),
          args: msg.args,
        }),
      ];
    }

    if (msg.type === "tool-result") {
      const flushed = this.flush();
      const call = this.ensureSessionCallId(msg.callId);
      return [
        ...flushed,
        this.buildToolEnvelope({ t: "tool-call-end", call }),
      ];
    }

    if (msg.type === "fs-edit") {
      const flushed = this.flush();
      const call = createId();
      const args = {
        filePath: msg.path,
        description: msg.description,
        diff: msg.diff,
      };

      return [
        ...flushed,
        this.buildToolEnvelope({
          t: "tool-call-start",
          call,
          name: "file-edit",
          title: "file-edit",
          description: buildFsEditDescription(msg),
          args,
        }),
        this.buildToolEnvelope({ t: "tool-call-end", call }),
      ];
    }

    return [];
  }
}
