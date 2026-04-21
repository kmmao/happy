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
