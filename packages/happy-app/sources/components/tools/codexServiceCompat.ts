export type CodexServicePreview =
  | { kind: "reroute"; title: string; detail: string }
  | { kind: "warning"; title: string; detail: string | null }
  | { kind: "review"; title: string; detail: string | null }
  | { kind: "steering"; title: string };

export function parseCodexServicePreview(
  text: string,
): CodexServicePreview | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  // Plan messages start with <plan title="..."> — do not misidentify as warnings
  if (trimmed.startsWith("<plan ")) {
    return null;
  }

  if (trimmed === "Steering active Codex turn...") {
    return {
      kind: "steering",
      title: trimmed,
    };
  }

  if (trimmed.startsWith("Codex rerouted")) {
    return {
      kind: "reroute",
      title: "Model rerouted",
      detail: trimmed,
    };
  }

  if (
    trimmed === "Codex review started" ||
    trimmed === "Codex review completed"
  ) {
    return {
      kind: "review",
      title: trimmed,
      detail: null,
    };
  }

  if (/warning/i.test(trimmed)) {
    const [firstLine, ...rest] = trimmed.split("\n");
    return {
      kind: "warning",
      title: firstLine,
      detail: rest.length > 0 ? rest.join("\n").trim() : null,
    };
  }

  return null;
}
