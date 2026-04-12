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
