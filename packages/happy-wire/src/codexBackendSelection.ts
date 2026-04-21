import * as z from "zod";

export const CODEX_APP_SERVER_BACKEND = "codex-app-server";

export const CODEX_MCP_LEGACY_BACKEND = "codex-mcp-legacy";

export const CodexBackendModeSchema = z.enum([
  "auto",
  CODEX_APP_SERVER_BACKEND,
  CODEX_MCP_LEGACY_BACKEND,
]);

export type CodexBackendMode = z.infer<typeof CodexBackendModeSchema>;

export const CodexRequestedBackendSchema = CodexBackendModeSchema;

export type CodexRequestedBackend = CodexBackendMode;

export const CodexResolvedBackendSchema = z.enum([
  CODEX_APP_SERVER_BACKEND,
  CODEX_MCP_LEGACY_BACKEND,
]);

export type CodexResolvedBackend = z.infer<
  typeof CodexResolvedBackendSchema
>;

export const CodexConfigModeSchema = z.enum([
  "inherit",
  "managed-profile",
  "managed-overrides",
]);

export type CodexConfigMode = z.infer<typeof CodexConfigModeSchema>;

export const CODEX_REQUESTED_BACKEND_ALIASES = {
  auto: ["", "auto"],
  [CODEX_APP_SERVER_BACKEND]: ["app-server", "appserver", CODEX_APP_SERVER_BACKEND],
  [CODEX_MCP_LEGACY_BACKEND]: [
    "legacy",
    "mcp",
    "mcp-legacy",
    CODEX_MCP_LEGACY_BACKEND,
  ],
} as const satisfies Record<CodexRequestedBackend, readonly string[]>;

const CODEX_REQUESTED_BACKEND_ALIAS_TO_VALUE = new Map<
  string,
  CodexRequestedBackend
>(
  Object.entries(CODEX_REQUESTED_BACKEND_ALIASES).flatMap(
    ([backend, aliases]) =>
      aliases.map((alias) => [alias, backend as CodexRequestedBackend] as const),
  ),
);

export function resolveRequestedCodexBackend(
  rawValue: string | undefined,
): CodexRequestedBackend {
  const normalizedAlias = (rawValue || "").trim().toLowerCase();

  return CODEX_REQUESTED_BACKEND_ALIAS_TO_VALUE.get(normalizedAlias) ?? "auto";
}

export function isCodexAppServerBackend(
  value: string | null | undefined,
): value is typeof CODEX_APP_SERVER_BACKEND {
  return value === CODEX_APP_SERVER_BACKEND;
}

export function isCodexLegacyBackend(
  value: string | null | undefined,
): value is typeof CODEX_MCP_LEGACY_BACKEND {
  return value === CODEX_MCP_LEGACY_BACKEND;
}

export function resolveCodexResolvedBackend(
  requestedBackend: CodexRequestedBackend,
  appServerSupported: boolean,
): CodexResolvedBackend {
  if (isCodexLegacyBackend(requestedBackend)) {
    return CODEX_MCP_LEGACY_BACKEND;
  }

  if (isCodexAppServerBackend(requestedBackend)) {
    return CODEX_APP_SERVER_BACKEND;
  }

  return appServerSupported
    ? CODEX_APP_SERVER_BACKEND
    : CODEX_MCP_LEGACY_BACKEND;
}

export function resolveCodexResumableThreadId(
  value:
    | {
        threadId?: string | null | undefined;
        resolvedBackend?: CodexResolvedBackend | undefined;
      }
    | null
    | undefined,
): string | null {
  const threadId = value?.threadId;
  if (!threadId) {
    return null;
  }

  if (isCodexLegacyBackend(value?.resolvedBackend)) {
    return null;
  }

  return threadId;
}
