import { CodexParsedCommandSummary } from "./codexCommandUtils";

function titleCase(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getCodexBashIconName(
  summary: CodexParsedCommandSummary | null | undefined,
): string {
  switch (summary?.type) {
    case "read":
      return "eye";
    case "write":
      return "file-diff";
    case "search":
    case "list_files":
      return "search";
    case "verify":
      return "checklist";
    case "test":
      return "beaker";
    case "git":
      return "git-branch";
    case "package":
      return "package";
    case "run":
      return "play";
    default:
      return "terminal";
  }
}

export function formatCodexBashTitle(
  summary: CodexParsedCommandSummary | null | undefined,
): string | null {
  if (!summary) {
    return null;
  }

  switch (summary.type) {
    case "read":
    case "write":
      return summary.displayName ?? summary.resolvedPath ?? null;
    case "search":
      return "Search";
    case "list_files":
      return "Files";
    case "verify":
      return titleCase(summary.subType) ?? "Verify";
    case "test":
      return "Tests";
    case "git":
      return "Git";
    case "package":
      return titleCase(summary.subType) ?? "Package";
    case "run":
      return titleCase(summary.subType) ?? "Run";
    default:
      return null;
  }
}

export function formatCodexBashDescription(
  summary: CodexParsedCommandSummary | null | undefined,
): string | null {
  if (!summary) {
    return null;
  }

  switch (summary.type) {
    case "read":
      return summary.resolvedPath ? `Reading ${summary.resolvedPath}` : summary.command;
    case "write":
      return summary.resolvedPath ? `Writing ${summary.resolvedPath}` : summary.command;
    case "search":
      return summary.query ? `Search(pattern: ${summary.query})` : "Search content";
    case "list_files":
      return summary.resolvedPath
        ? `Browse(path: ${summary.resolvedPath})`
        : "List files";
    case "verify":
      return [titleCase(summary.subType) ?? "Verify", summary.workspace]
        .filter(Boolean)
        .join(" · ");
    case "test": {
      const runner = titleCase(summary.runner) ?? "Test";
      return [runner, "tests", summary.workspace].filter(Boolean).join(" ");
    }
    case "git":
      return `Git ${summary.subType ?? "command"}`;
    case "package":
      return [titleCase(summary.manager), titleCase(summary.subType)]
        .filter(Boolean)
        .join(" ");
    case "run":
      return `Run ${summary.subType ?? "command"}`;
    default:
      return summary.command;
  }
}

export function getCodexBashMetaLabels(
  summary: CodexParsedCommandSummary | null | undefined,
): string[] {
  if (!summary) {
    return [];
  }

  switch (summary.type) {
    case "read":
      if (
        typeof summary.rangeStart === "number" &&
        typeof summary.rangeEnd === "number"
      ) {
        return [`${summary.rangeStart}-${summary.rangeEnd}`];
      }
      return [];
    case "search":
      return summary.query ? [summary.query] : [];
    case "list_files":
      return summary.query ? [summary.query] : [];
    case "verify":
      return [summary.manager, summary.workspace].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "test":
      return [summary.runner, summary.workspace].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "git":
      return summary.subType ? [summary.subType] : [];
    case "package":
      return [summary.manager, summary.workspace].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "run":
      return summary.subType ? [summary.subType] : [];
    default:
      return [];
  }
}
