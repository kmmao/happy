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
  | "verify"
  | "test"
  | "git"
  | "package"
  | "run"
  | "unknown";

export type CodexPackageManager = "yarn" | "pnpm" | "npm" | "bun" | null;

export type CodexTestRunner =
  | "vitest"
  | "jest"
  | "pytest"
  | "cargo"
  | "go"
  | "yarn"
  | "pnpm"
  | "npm"
  | "bun"
  | null;

export type CodexParsedCommand = {
  type: CodexParsedCommandKind;
  cmd: string | null;
  name: string | null;
  path: string | null;
  query: string | null;
  subType?: string | null;
  manager?: CodexPackageManager;
  runner?: CodexTestRunner;
  workspace?: string | null;
  rangeStart?: number | null;
  rangeEnd?: number | null;
};

export type CodexParsedCommandSummary = {
  type: CodexParsedCommandKind;
  command: string | null;
  query: string | null;
  resolvedPath: string | null;
  displayName: string | null;
  subType?: string | null;
  manager?: CodexPackageManager;
  runner?: CodexTestRunner;
  workspace?: string | null;
  rangeStart?: number | null;
  rangeEnd?: number | null;
  extraCount: number;
};

function normalizeParsedCommandType(value: unknown): CodexParsedCommandKind {
  if (
    value === "read" ||
    value === "write" ||
    value === "search" ||
    value === "list_files" ||
    value === "verify" ||
    value === "test" ||
    value === "git" ||
    value === "package" ||
    value === "run"
  ) {
    return value;
  }
  return "unknown";
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!matches) {
    return [];
  }
  return matches.map(stripQuotes);
}

function getLastNonFlagToken(tokens: string[]): string | null {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token.startsWith("-")) {
      return token;
    }
  }
  return null;
}

function getPositionalTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !token.startsWith("-"));
}

function inferReadCommand(command: string): Partial<CodexParsedCommand> | null {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0];
  if (!executable) {
    return null;
  }

  if (executable === "sed" && tokens[1] === "-n") {
    const rangeToken = tokens[2] ?? "";
    const path = tokens[3] ?? null;
    const rangeMatch = rangeToken.match(/^(\d+),(\d+)p$/);
    return {
      type: "read",
      path,
      rangeStart: rangeMatch ? Number(rangeMatch[1]) : null,
      rangeEnd: rangeMatch ? Number(rangeMatch[2]) : null,
    };
  }

  if (
    executable === "cat" ||
    executable === "head" ||
    executable === "tail" ||
    executable === "less"
  ) {
    return {
      type: "read",
      path: getLastNonFlagToken(tokens.slice(1)),
    };
  }

  return null;
}

function inferSearchCommand(command: string): Partial<CodexParsedCommand> | null {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0];
  if (
    executable !== "rg" &&
    executable !== "grep" &&
    executable !== "ag" &&
    executable !== "ack"
  ) {
    return null;
  }

  const positional = getPositionalTokens(tokens.slice(1));
  const query = positional[0] ?? null;
  const path = positional.length > 1 ? positional[positional.length - 1] : null;

  return {
    type: "search",
    query,
    path,
  };
}

function inferListFilesCommand(command: string): Partial<CodexParsedCommand> | null {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0];
  if (!executable) {
    return null;
  }

  if (executable === "find") {
    let path: string | null = null;
    let query: string | null = null;

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!path && !token.startsWith("-")) {
        path = token;
        continue;
      }
      if (
        (token === "-name" || token === "-iname" || token === "-path") &&
        typeof tokens[index + 1] === "string"
      ) {
        query = tokens[index + 1];
      }
    }

    return {
      type: "list_files",
      path,
      query,
    };
  }

  if (executable === "fd" || executable === "fdfind") {
    const positional = getPositionalTokens(tokens.slice(1));
    return {
      type: "list_files",
      query: positional[0] ?? null,
      path: positional[1] ?? null,
    };
  }

  if (executable === "ls" || executable === "tree") {
    return {
      type: "list_files",
      path: getLastNonFlagToken(tokens.slice(1)),
    };
  }

  return null;
}

function inferWriteCommand(command: string): Partial<CodexParsedCommand> | null {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0];
  if (!executable) {
    return null;
  }

  const redirectMatch = command.match(/(?:^|[^\S\r\n])(?:>|>>)\s*([^\s]+)\s*$/);
  if (redirectMatch?.[1]) {
    return {
      type: "write",
      path: stripQuotes(redirectMatch[1]),
    };
  }

  if (executable === "tee") {
    return {
      type: "write",
      path: getLastNonFlagToken(tokens.slice(1)),
    };
  }

  if (
    (executable === "mv" ||
      executable === "cp" ||
      executable === "touch" ||
      executable === "mkdir" ||
      executable === "rm" ||
      executable === "chmod") &&
    tokens[1]
  ) {
    const singlePathMutation =
      executable === "touch" ||
      executable === "mkdir" ||
      executable === "rm" ||
      executable === "chmod";

    const path = singlePathMutation ? getLastNonFlagToken(tokens.slice(1)) : tokens[2] ?? null;

    return {
      type: "write",
      path,
      name: singlePathMutation ? executable : tokens[1] ?? null,
    };
  }

  return null;
}

function inferGitCommand(command: string): Partial<CodexParsedCommand> | null {
  const tokens = tokenizeCommand(command);
  if (tokens[0] === "gh") {
    return {
      type: "git",
      subType: tokens[1] ?? "github",
      name: tokens[1] ?? "github",
    };
  }

  if (tokens[0] !== "git") {
    return null;
  }

  const operation = tokens[1] ?? "other";
  let subType = "other";
  if (operation === "status") {
    subType = "status";
  } else if (operation === "diff") {
    subType = "diff";
  } else if (operation === "log") {
    subType = "log";
  } else if (operation === "show") {
    subType = "show";
  } else if (operation === "blame") {
    subType = "blame";
  } else if (
    operation === "rev-parse" ||
    operation === "branch" ||
    operation === "symbolic-ref"
  ) {
    subType = "ref";
  }

  return {
    type: "git",
    subType,
    name: subType,
  };
}

function inferTestCommand(command: string): Partial<CodexParsedCommand> | null {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0];
  if (!executable) {
    return null;
  }

  if (executable === "vitest" || executable === "jest" || executable === "pytest") {
    return {
      type: "test",
      runner: executable,
      name: executable,
    };
  }

  if (executable === "cargo" && tokens[1] === "test") {
    return {
      type: "test",
      runner: "cargo",
      name: "cargo",
    };
  }

  if (executable === "go" && tokens[1] === "test") {
    return {
      type: "test",
      runner: "go",
      name: "go",
    };
  }

  return null;
}

function inferVerifyCommand(command: string): Partial<CodexParsedCommand> | null {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0];
  if (!executable) {
    return null;
  }

  if (executable === "tsc") {
    return {
      type: "verify",
      subType: "typecheck",
      name: "typecheck",
    };
  }

  if (
    executable === "eslint" ||
    executable === "biome" ||
    (executable === "prettier" && tokens.includes("--check"))
  ) {
    return {
      type: "verify",
      subType: executable === "prettier" ? "format_check" : "lint",
      name: executable === "prettier" ? "format_check" : "lint",
    };
  }

  if (executable === "cargo" && tokens[1] === "check") {
    return {
      type: "verify",
      subType: "build",
      name: "build",
    };
  }

  if (executable === "go" && tokens[1] === "vet") {
    return {
      type: "verify",
      subType: "check",
      name: "check",
    };
  }

  if (
    (executable === "cargo" && (tokens[1] === "build" || tokens[1] === "clippy")) ||
    (executable === "go" && tokens[1] === "build")
  ) {
    return {
      type: "verify",
      subType: tokens[1],
      name: tokens[1],
    };
  }

  if (executable === "make" || executable === "cmake" || executable === "ninja") {
    return {
      type: "verify",
      subType: "build",
      name: "build",
    };
  }

  return null;
}

type PackageInvocation = {
  manager: NonNullable<CodexPackageManager>;
  workspace: string | null;
  args: string[];
};

function getPackageInvocation(command: string): PackageInvocation | null {
  const tokens = tokenizeCommand(command);
  const manager = tokens[0];
  if (
    manager !== "yarn" &&
    manager !== "pnpm" &&
    manager !== "npm" &&
    manager !== "bun"
  ) {
    return null;
  }

  if (manager === "pnpm" && tokens[1] === "dlx") {
    return null;
  }

  let workspace: string | null = null;
  let index = 1;

  if (manager === "yarn") {
    if (tokens[1] === "workspace" && tokens[2]) {
      workspace = tokens[2];
      index = 3;
    } else if (tokens[1] === "run") {
      index = 2;
    }
  } else if (manager === "npm") {
    if (tokens[1] === "run") {
      index = 2;
    }
  } else if (manager === "pnpm") {
    while (index < tokens.length) {
      const token = tokens[index];
      if (
        (token === "-F" || token === "--filter" || token === "--dir" || token === "-C") &&
        tokens[index + 1]
      ) {
        if (!workspace) {
          workspace = tokens[index + 1];
        }
        index += 2;
        continue;
      }
      if (token.startsWith("--filter=")) {
        if (!workspace) {
          workspace = token.slice("--filter=".length);
        }
        index += 1;
        continue;
      }
      if (token === "run") {
        index += 1;
        break;
      }
      if (token.startsWith("-")) {
        index += 1;
        continue;
      }
      break;
    }
  } else if (manager === "bun" && tokens[1] === "run") {
    index = 2;
  }

  return {
    manager,
    workspace,
    args: tokens.slice(index),
  };
}

function inferFromPackageInvocation(
  invocation: PackageInvocation,
): Partial<CodexParsedCommand> | null {
  const { manager, workspace, args } = invocation;
  const primary = args[0] ?? null;
  const nestedCommand = args.join(" ");

  if (!primary) {
    return {
      type: "package",
      subType: workspace ? "workspace_run" : "other",
      manager,
      workspace,
      name: workspace ? "workspace_run" : "other",
    };
  }

  if (
    primary === "add" ||
    primary === "install" ||
    primary === "i"
  ) {
    return {
      type: "package",
      subType: "install",
      manager,
      workspace,
      name: "install",
    };
  }

  if (
    primary === "remove" ||
    primary === "rm" ||
    primary === "uninstall"
  ) {
    return {
      type: "package",
      subType: "remove",
      manager,
      workspace,
      name: "remove",
    };
  }

  if (
    primary === "test" ||
    primary === "vitest" ||
    primary === "jest" ||
    primary === "pytest"
  ) {
    return {
      type: "test",
      runner: manager,
      manager,
      workspace,
      name: manager,
    };
  }

  if (
    primary === "typecheck" ||
    primary === "lint" ||
    primary === "check" ||
    primary === "build"
  ) {
    return {
      type: "verify",
      subType: primary === "typecheck" ? "typecheck" : primary,
      manager,
      workspace,
      name: workspace ?? (primary === "typecheck" ? "typecheck" : primary),
    };
  }

  if (
    primary === "dev" ||
    primary === "start" ||
    primary === "serve" ||
    primary === "preview"
  ) {
    return {
      type: "run",
      subType: primary,
      manager,
      workspace,
      name: primary,
    };
  }

  if (primary === "exec" && args[1]) {
    const inferred = inferCommandDetails(args.slice(1).join(" "));
    if (inferred) {
      return {
        ...inferred,
        manager,
        workspace,
      };
    }
  }

  const nestedVerify = inferVerifyCommand(nestedCommand);
  if (nestedVerify) {
    return {
      ...nestedVerify,
      manager,
      workspace,
      name: workspace ?? nestedVerify.name ?? nestedVerify.subType ?? null,
    };
  }

  const nestedTest = inferTestCommand(nestedCommand);
  if (nestedTest) {
    return {
      ...nestedTest,
      manager,
      workspace,
      runner: nestedTest.runner ?? manager,
      name: workspace ?? nestedTest.name ?? manager,
    };
  }

  return {
    type: "package",
    subType: workspace ? "workspace_run" : "run",
    manager,
    workspace,
    name: workspace ? "workspace_run" : "run",
  };
}

function inferPackageExecutorCommand(
  tokens: string[],
): Partial<CodexParsedCommand> | null {
  const executable = tokens[0];
  if (!executable) {
    return null;
  }

  let manager: NonNullable<CodexPackageManager> | null = null;
  let commandTokens: string[] = [];

  if (executable === "npx" && tokens[1]) {
    manager = "npm";
    commandTokens = tokens.slice(1);
  } else if (executable === "bunx" && tokens[1]) {
    manager = "bun";
    commandTokens = tokens.slice(1);
  } else if (executable === "pnpm" && tokens[1] === "dlx" && tokens[2]) {
    manager = "pnpm";
    commandTokens = tokens.slice(2);
  }

  if (!manager || commandTokens.length === 0) {
    return null;
  }

  const inferred = inferCommandDetails(commandTokens.join(" "));
  return {
    type: inferred?.type ?? "run",
    subType: inferred?.subType ?? "script",
    name: inferred?.name ?? commandTokens[0] ?? null,
    path: inferred?.path ?? null,
    query: inferred?.query ?? null,
    manager: inferred?.manager ?? manager,
    runner: inferred?.runner ?? null,
    workspace: inferred?.workspace ?? null,
    rangeStart: inferred?.rangeStart ?? null,
    rangeEnd: inferred?.rangeEnd ?? null,
  };
}

function inferRunCommand(command: string): Partial<CodexParsedCommand> | null {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0];
  if (!executable) {
    return null;
  }

  if (executable === "expo" && tokens[1] === "start") {
    return {
      type: "run",
      subType: "start",
      name: "start",
    };
  }

  const packageExecutor = inferPackageExecutorCommand(tokens);
  if (packageExecutor) {
    return packageExecutor;
  }

  if (
    (executable === "docker" && tokens[1] === "compose") ||
    executable === "docker-compose"
  ) {
    return {
      type: "run",
      subType: "server",
      name: "server",
    };
  }

  if (
    executable === "node" ||
    executable === "python" ||
    executable === "python3" ||
    executable === "tsx" ||
    executable === "ts-node" ||
    executable === "curl" ||
    executable === "jq" ||
    executable === "ps" ||
    executable === "lsof" ||
    executable === "kill" ||
    executable === "which" ||
    executable === "pwd" ||
    executable === "date" ||
    executable === "docker"
  ) {
    return {
      type: "run",
      subType: executable === "docker" ? "server" : "script",
      name: executable === "docker" ? "server" : "script",
    };
  }

  if (
    executable === "echo" ||
    executable === "printf" ||
    executable === "wc" ||
    executable === "sort" ||
    executable === "uniq" ||
    executable === "awk" ||
    executable === "sed" ||
    executable === "cut" ||
    executable === "tr" ||
    executable === "xargs" ||
    executable === "basename" ||
    executable === "dirname" ||
    executable === "realpath" ||
    executable === "env" ||
    executable === "export" ||
    executable === "source" ||
    executable === "true" ||
    executable === "false" ||
    // Directory navigation / shell builtins
    executable === "cd" ||
    executable === "pushd" ||
    executable === "popd" ||
    executable === "sleep" ||
    executable === "wait" ||
    executable === "mktemp" ||
    // macOS utilities
    executable === "open" ||
    executable === "pbcopy" ||
    executable === "pbpaste" ||
    executable === "osascript" ||
    // Archive tools
    executable === "tar" ||
    executable === "zip" ||
    executable === "unzip" ||
    executable === "gzip" ||
    executable === "gunzip" ||
    executable === "bzip2" ||
    executable === "xz" ||
    // Network / remote
    executable === "ssh" ||
    executable === "scp" ||
    executable === "rsync" ||
    executable === "sftp" ||
    executable === "wget" ||
    // Package managers (non-node)
    executable === "brew" ||
    executable === "pip" ||
    executable === "pip3" ||
    executable === "gem" ||
    executable === "bundle" ||
    executable === "composer" ||
    // Runtimes
    executable === "ruby" ||
    executable === "perl" ||
    executable === "lua" ||
    executable === "java" ||
    // CLI tools
    executable === "happy" ||
    executable === "diff" ||
    executable === "patch"
  ) {
    return {
      type: "run",
      subType: "script",
      name: "script",
    };
  }

  // Path-based executables (./script.sh, /usr/local/bin/tool, etc.)
  if (executable.startsWith("./") || executable.startsWith("/")) {
    return {
      type: "run",
      subType: "script",
      name: "script",
    };
  }

  return null;
}

function inferCommandDetails(command: string): Partial<CodexParsedCommand> | null {
  const normalizedCommand = getCodexCommandText(command);
  if (!normalizedCommand) {
    return null;
  }

  // rtk is a token-killer proxy: strip the `rtk [proxy]` prefix and re-infer.
  // Meta-commands (gain, discover) have no equivalent tool type → treat as run.
  const rtkMatch = normalizedCommand.match(/^rtk(?:\s+proxy)?\s+(.+)$/);
  if (rtkMatch) {
    return inferCommandDetails(rtkMatch[1]) ?? { type: 'run' };
  }
  if (/^rtk(\s|$)/.test(normalizedCommand)) {
    return { type: 'run' };
  }

  const packageInvocation = getPackageInvocation(normalizedCommand);
  if (packageInvocation) {
    const packageInferred = inferFromPackageInvocation(packageInvocation);
    if (packageInferred) {
      return packageInferred;
    }
  }

  return (
    inferGitCommand(normalizedCommand) ||
    inferTestCommand(normalizedCommand) ||
    inferVerifyCommand(normalizedCommand) ||
    inferReadCommand(normalizedCommand) ||
    inferSearchCommand(normalizedCommand) ||
    inferListFilesCommand(normalizedCommand) ||
    inferWriteCommand(normalizedCommand) ||
    inferRunCommand(normalizedCommand) || {
      type: "unknown",
    }
  );
}

function parseCommandEntry(
  entry: unknown,
  fallbackCommand: string | null,
): CodexParsedCommand {
  const entryCommand =
    typeof entry === "object" && entry && typeof (entry as { cmd?: unknown }).cmd === "string"
      ? (entry as { cmd: string }).cmd
      : fallbackCommand;
  const inferred = entryCommand ? inferCommandDetails(entryCommand) : null;
  const explicitType = normalizeParsedCommandType(
    typeof entry === "object" && entry ? (entry as { type?: unknown }).type : null,
  );

  return {
    type: explicitType !== "unknown" ? explicitType : inferred?.type ?? "unknown",
    cmd: entryCommand,
    name:
      typeof entry === "object" && entry && typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name
        : inferred?.name ?? null,
    path:
      typeof entry === "object" && entry && typeof (entry as { path?: unknown }).path === "string"
        ? (entry as { path: string }).path
        : inferred?.path ?? null,
    query:
      typeof entry === "object" && entry && typeof (entry as { query?: unknown }).query === "string"
        ? (entry as { query: string }).query
        : inferred?.query ?? null,
    subType: inferred?.subType ?? null,
    manager: inferred?.manager ?? null,
    runner: inferred?.runner ?? null,
    workspace: inferred?.workspace ?? null,
    rangeStart: inferred?.rangeStart ?? null,
    rangeEnd: inferred?.rangeEnd ?? null,
  };
}

function getSummaryRawPath(parsedCommand: CodexParsedCommand): string | null {
  if (parsedCommand.path) {
    return parsedCommand.path;
  }

  if (
    (parsedCommand.type === "read" ||
      parsedCommand.type === "write" ||
      parsedCommand.type === "list_files") &&
    parsedCommand.name
  ) {
    return parsedCommand.name;
  }

  return null;
}

export function getCodexParsedCommands(input: unknown): CodexParsedCommand[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const command = getCodexCommandText((input as { command?: unknown }).command);
  const parsedCmd = (input as { parsed_cmd?: unknown }).parsed_cmd;
  if (Array.isArray(parsedCmd) && parsedCmd.length > 0) {
    return parsedCmd.map((entry) => parseCommandEntry(entry, command));
  }

  if (!command) {
    return [];
  }

  const inferred = inferCommandDetails(command);

  return [
    {
      type: inferred?.type ?? "unknown",
      cmd: command,
      name: inferred?.name ?? null,
      path: inferred?.path ?? null,
      query: inferred?.query ?? null,
      subType: inferred?.subType ?? null,
      manager: inferred?.manager ?? null,
      runner: inferred?.runner ?? null,
      workspace: inferred?.workspace ?? null,
      rangeStart: inferred?.rangeStart ?? null,
      rangeEnd: inferred?.rangeEnd ?? null,
    },
  ];
}

export function summarizeCodexParsedCommand(
  parsedCommand: CodexParsedCommand,
  metadata: Metadata | null,
): CodexParsedCommandSummary {
  const rawPath = getSummaryRawPath(parsedCommand);
  const resolvedPath = rawPath ? resolvePath(rawPath, metadata) : null;
  const displayName: string | null = resolvedPath
    ? resolvedPath.split("/").pop() || resolvedPath
    : parsedCommand.name ??
      parsedCommand.workspace ??
      parsedCommand.runner ??
      parsedCommand.subType ??
      parsedCommand.manager ??
      null;

  return {
    type: parsedCommand.type,
    command: parsedCommand.cmd,
    query: parsedCommand.query,
    resolvedPath,
    displayName,
    ...(parsedCommand.subType ? { subType: parsedCommand.subType } : {}),
    ...(parsedCommand.manager ? { manager: parsedCommand.manager } : {}),
    ...(parsedCommand.runner ? { runner: parsedCommand.runner } : {}),
    ...(parsedCommand.workspace ? { workspace: parsedCommand.workspace } : {}),
    ...(typeof parsedCommand.rangeStart === "number"
      ? { rangeStart: parsedCommand.rangeStart }
      : {}),
    ...(typeof parsedCommand.rangeEnd === "number"
      ? { rangeEnd: parsedCommand.rangeEnd }
      : {}),
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
