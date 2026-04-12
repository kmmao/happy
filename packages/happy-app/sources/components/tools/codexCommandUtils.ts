import { Metadata } from "@/sync/storageTypes";
import { resolvePath } from "@/utils/pathUtils";

function unwrapShellWrapper(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(
    /^(?:\S+\/)?(?:bash|zsh|sh)\s+-lc\s+([\s\S]+)$/i,
  );
  const rawInner = match ? match[1].trim() : trimmed;

  if (
    (rawInner.startsWith('"') && rawInner.endsWith('"')) ||
    (rawInner.startsWith("'") && rawInner.endsWith("'"))
  ) {
    return rawInner.slice(1, -1);
  }

  return rawInner;
}

export function getCodexCommandText(command: unknown): string | null {
  if (typeof command === "string" && command.trim().length > 0) {
    return unwrapShellWrapper(command);
  }

  if (Array.isArray(command)) {
    const joined = command
      .map((value) => String(value))
      .join(" ")
      .trim();
    return joined.length > 0 ? unwrapShellWrapper(joined) : null;
  }

  return null;
}

export function getCodexCommandPreview(
  command: unknown,
  maxLength: number = 120,
): string | null {
  const normalized = getCodexCommandText(command);
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

export type CodexParsedCommandKind =
  | "read"
  | "write"
  | "search"
  | "list_files"
  | "unknown";

export type CodexParsedCommand = {
  type: CodexParsedCommandKind;
  cmd: string | null;
  name: string | null;
  path: string | null;
  query: string | null;
};

export type CodexParsedCommandSummary = {
  type: CodexParsedCommandKind;
  command: string | null;
  query: string | null;
  resolvedPath: string | null;
  displayName: string | null;
  extraCount: number;
};

function normalizeParsedCommandType(value: unknown): CodexParsedCommandKind {
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

export function getCodexParsedCommands(input: unknown): CodexParsedCommand[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const parsedCmd = (input as { parsed_cmd?: unknown }).parsed_cmd;
  if (!Array.isArray(parsedCmd)) {
    return [];
  }

  return parsedCmd.map((entry) => ({
    type: normalizeParsedCommandType(
      typeof entry === "object" && entry ? (entry as { type?: unknown }).type : null,
    ),
    cmd:
      typeof entry === "object" && entry && typeof (entry as { cmd?: unknown }).cmd === "string"
        ? (entry as { cmd: string }).cmd
        : null,
    name:
      typeof entry === "object" && entry && typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name
        : null,
    path:
      typeof entry === "object" && entry && typeof (entry as { path?: unknown }).path === "string"
        ? (entry as { path: string }).path
        : null,
    query:
      typeof entry === "object" && entry && typeof (entry as { query?: unknown }).query === "string"
        ? (entry as { query: string }).query
        : null,
  }));
}

export function summarizeCodexParsedCommand(
  parsedCommand: CodexParsedCommand,
  metadata: Metadata | null,
): CodexParsedCommandSummary {
  const rawPath = parsedCommand.path ?? parsedCommand.name;
  const resolvedPath = rawPath ? resolvePath(rawPath, metadata) : null;
  const displayName = resolvedPath
    ? resolvedPath.split("/").pop() || resolvedPath
    : parsedCommand.name;

  return {
    type: parsedCommand.type,
    command: parsedCommand.cmd,
    query: parsedCommand.query,
    resolvedPath,
    displayName,
    extraCount: 0,
  };
}

export function getCodexParsedCommandSummaries(
  input: unknown,
  metadata: Metadata | null,
): CodexParsedCommandSummary[] {
  return getCodexParsedCommands(input).map((parsedCommand) =>
    summarizeCodexParsedCommand(parsedCommand, metadata),
  );
}

export function getCodexParsedCommandSummary(
  input: unknown,
  metadata: Metadata | null,
): CodexParsedCommandSummary | null {
  const parsedCommands = getCodexParsedCommands(input);
  if (parsedCommands.length === 0) {
    return null;
  }

  const primaryCommand = summarizeCodexParsedCommand(
    parsedCommands[0],
    metadata,
  );
  return {
    ...primaryCommand,
    extraCount: Math.max(parsedCommands.length - 1, 0),
  };
}
