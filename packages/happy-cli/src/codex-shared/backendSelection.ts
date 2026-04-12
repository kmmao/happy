export type RequestedCodexBackend =
  | "auto"
  | "codex-app-server"
  | "codex-mcp-legacy";

export type ResolvedCodexBackend = "codex-app-server" | "codex-mcp-legacy";

export function resolveRequestedCodexBackend(
  rawValue: string | undefined = process.env.HAPPY_CODEX_BACKEND,
): RequestedCodexBackend {
  switch ((rawValue || "").trim().toLowerCase()) {
    case "":
    case "auto":
      return "auto";
    case "app-server":
    case "appserver":
    case "codex-app-server":
      return "codex-app-server";
    case "legacy":
    case "mcp":
    case "mcp-legacy":
    case "codex-mcp-legacy":
      return "codex-mcp-legacy";
    default:
      return "auto";
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "");
}

export function shouldFallbackToLegacyCodex(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  const nonFallbackPatterns = [
    /unauthorized/,
    /invalid[_ -]?api[_ -]?key/,
    /auth/,
    /login/,
    /token/,
    /config/,
    /toml/,
    /parse/,
    /model/,
    /rate[_ -]?limit/,
    /\b429\b/,
    /credits?/,
  ];
  if (nonFallbackPatterns.some((pattern) => pattern.test(message))) {
    return false;
  }

  const fallbackPatterns = [
    /app-server/,
    /not found/,
    /unknown subcommand/,
    /initialize/,
    /json-rpc/,
    /broken pipe/,
    /eof/,
    /connection/,
    /exited/,
    /spawn/,
  ];

  return fallbackPatterns.some((pattern) => pattern.test(message));
}
