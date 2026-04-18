import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { createId } from "@paralleldrive/cuid2";
import type { ReasoningOutput } from "./reasoningProcessor";
import type { DiffToolCall, DiffToolResult } from "./diffProcessor";
import {
  createEnvelope,
  type CreateEnvelopeOptions,
  type SessionEnvelope,
} from "@kmmao/happy-wire";

export type CodexTurnState = {
  currentTurnId: string | null;
  startedSubagents?: Set<string>;
  activeSubagents?: Set<string>;
  providerSubagentToSessionSubagent?: Map<string, string>;
};

type CodexMapperResult = {
  currentTurnId: string | null;
  startedSubagents: Set<string>;
  activeSubagents: Set<string>;
  providerSubagentToSessionSubagent: Map<string, string>;
  envelopes: SessionEnvelope[];
};

type LegacyToolLikeMessage = {
  type: "tool-call" | "tool-call-result";
  callId: string;
  name?: string;
  toolName?: string;
  tool?: string;
  tool_name?: string;
  input?: unknown;
  args?: unknown;
  arguments?: unknown;
  output?: {
    content?: string;
    status?: "completed" | "canceled";
  };
};

type TurnEndStatus = "completed" | "failed" | "cancelled";

function getStartedSubagents(state: CodexTurnState): Set<string> {
  return state.startedSubagents ?? new Set<string>();
}

function getActiveSubagents(state: CodexTurnState): Set<string> {
  return state.activeSubagents ?? new Set<string>();
}

function getProviderSubagentToSessionSubagent(
  state: CodexTurnState,
): Map<string, string> {
  return state.providerSubagentToSessionSubagent ?? new Map<string, string>();
}

function maybeEmitSubagentStart(
  subagent: string | undefined,
  opts: CreateEnvelopeOptions,
  startedSubagents: Set<string>,
  activeSubagents: Set<string>,
  envelopes: SessionEnvelope[],
): void {
  if (!subagent || startedSubagents.has(subagent)) {
    return;
  }

  envelopes.push(
    createEnvelope("agent", { t: "start" }, { ...opts, subagent }),
  );
  startedSubagents.add(subagent);
  activeSubagents.add(subagent);
}

function emitSubagentStops(
  opts: CreateEnvelopeOptions,
  startedSubagents: Set<string>,
  activeSubagents: Set<string>,
): SessionEnvelope[] {
  const envelopes: SessionEnvelope[] = [];
  for (const subagent of activeSubagents) {
    envelopes.push(
      createEnvelope("agent", { t: "stop" }, { ...opts, subagent }),
    );
  }
  activeSubagents.clear();
  startedSubagents.clear();
  return envelopes;
}

function buildEnvelopeOptions(
  currentTurnId: string | null,
  subagent?: string,
): CreateEnvelopeOptions {
  return {
    ...(currentTurnId ? { turn: currentTurnId } : {}),
    ...(subagent ? { subagent } : {}),
  };
}

function pickProviderSubagent(
  message: Record<string, unknown>,
): string | undefined {
  const candidates = [
    message.subagent,
    message.parent_call_id,
    message.parentCallId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function resolveSessionSubagent(
  message: Record<string, unknown>,
  providerSubagentToSessionSubagent: Map<string, string>,
): string | undefined {
  const providerSubagent = pickProviderSubagent(message);
  if (!providerSubagent) {
    return undefined;
  }

  const existing = providerSubagentToSessionSubagent.get(providerSubagent);
  if (existing) {
    return existing;
  }

  const created = createId();
  providerSubagentToSessionSubagent.set(providerSubagent, created);
  return created;
}

function pickCallId(message: Record<string, unknown>): string {
  const callId = message.call_id ?? message.callId;
  if (typeof callId === "string" && callId.length > 0) {
    return callId;
  }
  return randomUUID();
}

function pickToolName(message: LegacyToolLikeMessage): string {
  if (typeof message.name === "string" && message.name.length > 0) {
    return message.name;
  }
  if (typeof message.toolName === "string" && message.toolName.length > 0) {
    return message.toolName;
  }
  if (typeof message.tool === "string" && message.tool.length > 0) {
    return message.tool;
  }
  if (
    typeof message.tool_name === "string" &&
    message.tool_name.length > 0
  ) {
    return message.tool_name;
  }

  const candidateArgs = [message.input, message.args, message.arguments];
  for (const candidate of candidateArgs) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const nestedToolNameCandidates = [
      record.toolName,
      record.requestedToolName,
      record.tool,
      record.tool_name,
      record.name,
    ];
    for (const nestedToolName of nestedToolNameCandidates) {
      if (typeof nestedToolName === "string" && nestedToolName.length > 0) {
        return nestedToolName;
      }
    }
  }
  return "unknown";
}

function pickToolArgs(message: LegacyToolLikeMessage): Record<string, unknown> {
  const input = message.input ?? message.args ?? message.arguments;
  return input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {};
}

function summarizeCommand(command: unknown): string | null {
  if (typeof command === "string" && command.trim().length > 0) {
    return command;
  }
  if (Array.isArray(command)) {
    const cmd = command
      .map((v) => String(v))
      .join(" ")
      .trim();
    return cmd.length > 0 ? cmd : null;
  }
  return null;
}

function commandToTitle(command: string | null): string {
  if (!command) {
    return "Run command";
  }
  const short = command.length > 80 ? `${command.slice(0, 77)}...` : command;
  return `Run \`${short}\``;
}

type ParsedCodexCommandType =
  | "read"
  | "write"
  | "search"
  | "list_files"
  | "unknown";

type ParsedCodexCommand = {
  type: ParsedCodexCommandType;
  cmd?: string;
  name?: string;
  path?: string | null;
  query?: string;
};

function normalizeParsedCodexCommandType(value: unknown): ParsedCodexCommandType {
  if (
    value === "read" ||
    value === "write" ||
    value === "search" ||
    value === "list_files"
  ) {
    return value;
  }
  return "unknown";
}

function getParsedCodexCommands(
  args: Record<string, unknown>,
): ParsedCodexCommand[] {
  if (!Array.isArray(args.parsed_cmd)) {
    return [];
  }

  return args.parsed_cmd
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      type: normalizeParsedCodexCommandType(item.type),
      cmd: typeof item.cmd === "string" ? item.cmd : undefined,
      name: typeof item.name === "string" ? item.name : undefined,
      path: typeof item.path === "string" ? item.path : null,
      query: typeof item.query === "string" ? item.query : undefined,
    }));
}

function describeExtraParsedCommands(parsedCommands: ParsedCodexCommand[]): string {
  const extraCount = Math.max(parsedCommands.length - 1, 0);
  return extraCount > 0 ? ` (+${extraCount} more actions)` : "";
}

function buildCodexExecToolPayload(
  args: Record<string, unknown>,
): {
  name: string;
  title: string;
  description: string;
  args: Record<string, unknown>;
} {
  const command = summarizeCommand(args.command);
  const parsedCommands = getParsedCodexCommands(args);
  const primaryCommand = parsedCommands[0];
  const extraSuffix = describeExtraParsedCommands(parsedCommands);

  if (primaryCommand?.type === "read") {
    const filePath = primaryCommand.path ?? primaryCommand.name;
    const fileName = filePath ? basename(filePath) : "file";
    return {
      name: "Read",
      title: filePath || fileName,
      description: `Reading ${fileName}${extraSuffix}`,
      args: {
        file_path: filePath,
        parsed_cmd: args.parsed_cmd,
        command: args.command,
        cwd: args.cwd,
      },
    };
  }

  if (primaryCommand?.type === "search") {
    const pattern = primaryCommand.query ?? command ?? "";
    return {
      name: "Grep",
      title: pattern ? `grep(pattern: ${pattern})` : "Search Content",
      description: pattern
        ? `Search(pattern: ${pattern})${extraSuffix}`
        : `Search${extraSuffix}`,
      args: {
        pattern,
        ...(primaryCommand.path ? { path: primaryCommand.path } : {}),
        parsed_cmd: args.parsed_cmd,
        command: args.command,
        cwd: args.cwd,
      },
    };
  }

  if (primaryCommand?.type === "list_files") {
    const path = primaryCommand.path ?? null;
    const label = path ? basename(path) || path : "List Files";
    return {
      name: "LS",
      title: path || "List Files",
      description: path
        ? `Search(path: ${label})${extraSuffix}`
        : `List files${extraSuffix}`,
      args: {
        ...(path ? { path } : {}),
        parsed_cmd: args.parsed_cmd,
        command: args.command,
        cwd: args.cwd,
      },
    };
  }

  return {
    name: "CodexBash",
    title: commandToTitle(command),
    description:
      typeof args.description === "string"
        ? args.description
        : (command ?? "Execute command"),
    args,
  };
}

function patchDescription(changes: unknown): string {
  if (!changes || typeof changes !== "object") {
    return "Applying patch";
  }
  const fileCount = Object.keys(changes as Record<string, unknown>).length;
  if (fileCount === 1) {
    return "Applying patch to 1 file";
  }
  return `Applying patch to ${fileCount} files`;
}

function pickTurnEndStatus(
  message: Record<string, unknown>,
  type: unknown,
): TurnEndStatus {
  const rawStatus = message.status;
  if (
    rawStatus === "completed" ||
    rawStatus === "failed" ||
    rawStatus === "cancelled"
  ) {
    return rawStatus;
  }
  if (rawStatus === "canceled") {
    return "cancelled";
  }

  // Abort events are treated as cancelled unless they explicitly look like failures.
  if (type === "turn_aborted") {
    const reason = message.reason;
    const error = message.error;
    if (
      (typeof reason === "string" && /(fail|error)/i.test(reason)) ||
      (typeof error === "string" && error.length > 0) ||
      (error !== undefined && error !== null && typeof error === "object")
    ) {
      return "failed";
    }
    return "cancelled";
  }

  if (message.error !== undefined && message.error !== null) {
    return "failed";
  }

  return "completed";
}

export function mapCodexMcpMessageToSessionEnvelopes(
  message: Record<string, unknown>,
  state: CodexTurnState,
): CodexMapperResult {
  const type = message.type;
  const startedSubagents = getStartedSubagents(state);
  const activeSubagents = getActiveSubagents(state);
  const providerSubagentToSessionSubagent =
    getProviderSubagentToSessionSubagent(state);

  if (type === "task_started") {
    const turnId = createId();
    const turnStart = createEnvelope(
      "agent",
      { t: "turn-start" },
      { turn: turnId },
    );
    startedSubagents.clear();
    activeSubagents.clear();
    providerSubagentToSessionSubagent.clear();
    return {
      currentTurnId: turnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes: [turnStart],
    };
  }

  if (type === "task_complete" || type === "turn_aborted") {
    if (!state.currentTurnId) {
      return {
        currentTurnId: null,
        startedSubagents,
        activeSubagents,
        providerSubagentToSessionSubagent,
        envelopes: [],
      };
    }

    const lifecycleOpts = {
      turn: state.currentTurnId,
    } satisfies CreateEnvelopeOptions;
    providerSubagentToSessionSubagent.clear();
    return {
      currentTurnId: null,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes: [
        ...emitSubagentStops(lifecycleOpts, startedSubagents, activeSubagents),
        createEnvelope(
          "agent",
          {
            t: "turn-end",
            status: pickTurnEndStatus(message, type),
          },
          lifecycleOpts,
        ),
      ],
    };
  }

  if (type === "token_count") {
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes: [],
    };
  }

  const subagent = resolveSessionSubagent(
    message,
    providerSubagentToSessionSubagent,
  );
  const opts = buildEnvelopeOptions(state.currentTurnId, subagent);

  if (type === "agent_message") {
    if (typeof message.message !== "string") {
      return {
        currentTurnId: state.currentTurnId,
        startedSubagents,
        activeSubagents,
        providerSubagentToSessionSubagent,
        envelopes: [],
      };
    }

    const envelopes: SessionEnvelope[] = [];
    maybeEmitSubagentStart(
      subagent,
      opts,
      startedSubagents,
      activeSubagents,
      envelopes,
    );
    envelopes.push(
      createEnvelope("agent", { t: "text", text: message.message }, opts),
    );
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes,
    };
  }

  if (type === "text_delta") {
    if (
      typeof message.stream !== "string" ||
      message.stream.length === 0 ||
      typeof message.delta !== "string" ||
      message.delta.length === 0
    ) {
      return {
        currentTurnId: state.currentTurnId,
        startedSubagents,
        activeSubagents,
        providerSubagentToSessionSubagent,
        envelopes: [],
      };
    }

    const envelopes: SessionEnvelope[] = [];
    maybeEmitSubagentStart(
      subagent,
      opts,
      startedSubagents,
      activeSubagents,
      envelopes,
    );
    envelopes.push(
      createEnvelope(
        "agent",
        {
          t: "text-delta",
          stream: message.stream,
          delta: message.delta,
          ...(message.thinking ? { thinking: true } : {}),
        } as any,
        opts,
      ),
    );
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes,
    };
  }

  if (type === "service_message") {
    if (typeof message.text !== "string" || message.text.length === 0) {
      return {
        currentTurnId: state.currentTurnId,
        startedSubagents,
        activeSubagents,
        providerSubagentToSessionSubagent,
        envelopes: [],
      };
    }

    const envelopes: SessionEnvelope[] = [];
    maybeEmitSubagentStart(
      subagent,
      opts,
      startedSubagents,
      activeSubagents,
      envelopes,
    );
    envelopes.push(
      createEnvelope("agent", { t: "service", text: message.text }, opts),
    );
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes,
    };
  }

  if (type === "agent_reasoning" || type === "agent_reasoning_delta") {
    const text =
      typeof message.text === "string"
        ? message.text
        : typeof message.delta === "string"
          ? message.delta
          : null;

    if (!text) {
      return {
        currentTurnId: state.currentTurnId,
        startedSubagents,
        activeSubagents,
        providerSubagentToSessionSubagent,
        envelopes: [],
      };
    }

    const envelopes: SessionEnvelope[] = [];
    maybeEmitSubagentStart(
      subagent,
      opts,
      startedSubagents,
      activeSubagents,
      envelopes,
    );
    envelopes.push(
      createEnvelope("agent", { t: "text", text, thinking: true }, opts),
    );
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes,
    };
  }

  if (type === "exec_command_begin" || type === "exec_approval_request") {
    const call = pickCallId(message);
    const {
      call_id: _callIdSnake,
      callId: _callIdCamel,
      type: _type,
      ...args
    } = message;
    const payload = buildCodexExecToolPayload(args as Record<string, unknown>);

    const envelopes: SessionEnvelope[] = [];
    maybeEmitSubagentStart(
      subagent,
      opts,
      startedSubagents,
      activeSubagents,
      envelopes,
    );
    envelopes.push(
      createEnvelope(
        "agent",
        {
          t: "tool-call-start",
          call,
          name: payload.name,
          title: payload.title,
          description: payload.description,
          args: payload.args,
        },
        opts,
      ),
    );
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes,
    };
  }

  if (type === "exec_command_end") {
    const call = pickCallId(message);
    const envelopes: SessionEnvelope[] = [];
    maybeEmitSubagentStart(
      subagent,
      opts,
      startedSubagents,
      activeSubagents,
      envelopes,
    );
    envelopes.push(createEnvelope("agent", { t: "tool-call-end", call }, opts));
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes,
    };
  }

  if (type === "patch_apply_begin") {
    const call = pickCallId(message);
    const autoApproved = (message as { auto_approved?: unknown }).auto_approved;
    const changes = (message as { changes?: unknown }).changes;

    const envelopes: SessionEnvelope[] = [];
    maybeEmitSubagentStart(
      subagent,
      opts,
      startedSubagents,
      activeSubagents,
      envelopes,
    );
    envelopes.push(
      createEnvelope(
        "agent",
        {
          t: "tool-call-start",
          call,
          name: "CodexPatch",
          title: "Apply patch",
          description: patchDescription(changes),
          args: {
            auto_approved: autoApproved,
            changes,
          },
        },
        opts,
      ),
    );
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes,
    };
  }

  if (type === "patch_apply_end") {
    const call = pickCallId(message);
    const envelopes: SessionEnvelope[] = [];
    maybeEmitSubagentStart(
      subagent,
      opts,
      startedSubagents,
      activeSubagents,
      envelopes,
    );
    envelopes.push(createEnvelope("agent", { t: "tool-call-end", call }, opts));
    return {
      currentTurnId: state.currentTurnId,
      startedSubagents,
      activeSubagents,
      providerSubagentToSessionSubagent,
      envelopes,
    };
  }

  return {
    currentTurnId: state.currentTurnId,
    startedSubagents,
    activeSubagents,
    providerSubagentToSessionSubagent,
    envelopes: [],
  };
}

export function mapCodexProcessorMessageToSessionEnvelopes(
  message: ReasoningOutput | DiffToolCall | DiffToolResult,
  state: CodexTurnState,
): SessionEnvelope[] {
  const toolLikeMessage = message as LegacyToolLikeMessage;
  const opts = buildEnvelopeOptions(state.currentTurnId);

  if (message.type === "reasoning") {
    return [
      createEnvelope(
        "agent",
        {
          t: "text",
          text: message.message,
          thinking: true,
        },
        opts,
      ),
    ];
  }

  if (message.type === "tool-call") {
    const toolName = pickToolName(toolLikeMessage);
    const toolArgs = pickToolArgs(toolLikeMessage);
    const description =
      typeof (toolArgs as { description?: unknown } | undefined)?.description ===
      "string"
        ? (toolArgs as { description: string }).description
        : null;
    const title =
      typeof (toolArgs as { title?: unknown } | undefined)?.title === "string"
        ? (toolArgs as { title: string }).title
        : `${toolName || "Tool"} call`;

    return [
      createEnvelope(
        "agent",
        {
          t: "tool-call-start",
          call: toolLikeMessage.callId,
          name: toolName,
          title,
          description: description || title,
          args: toolArgs,
        },
        opts,
      ),
    ];
  }

  if (message.type === "tool-call-result") {
    const envelopes: SessionEnvelope[] = [];
    const content = toolLikeMessage.output?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      envelopes.push(
        createEnvelope(
          "agent",
          {
            t: "text",
            text: content,
            thinking: true,
          },
          opts,
        ),
      );
    }
    envelopes.push(
      createEnvelope(
        "agent",
        {
          t: "tool-call-end",
          call: toolLikeMessage.callId,
        },
        opts,
      ),
    );
    return envelopes;
  }

  return [];
}
