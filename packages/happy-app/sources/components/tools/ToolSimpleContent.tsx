import * as React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ToolCall } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { resolvePath } from "@/utils/pathUtils";
import { t } from "@/text";
import {
  getCodexCommandPreview,
  getCodexParsedCommandSummary,
} from "./codexCommandUtils";
import { buildToolSimpleContentTheme } from "./toolChromeTheme";
import { getToolProvider, type ToolProvider } from "./toolProvider";

/**
 * Extract a short display name from a file path.
 * For relative paths, returns as-is. For absolute paths, returns basename.
 */
function extractFileName(path: string): string {
  if (!path.startsWith("/") && !path.startsWith("\\")) {
    return path;
  }
  return path.split("/").pop() || path;
}

/**
 * Format duration in seconds to a human-readable string.
 */
function formatDuration(startMs: number, endMs: number): string {
  const seconds = (endMs - startMs) / 1000;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

type InfoRow = {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
};

interface SimpleContentStatusColors {
  successColor: string;
  errorColor: string;
  runningColor: string;
}

/**
 * Generate simple view content based on tool type.
 * Returns a title and an array of key-value info rows.
 */
function generateSimpleContent(
  tool: ToolCall,
  metadata: Metadata | null,
  statusColors: SimpleContentStatusColors,
): { title: string; rows: readonly InfoRow[] } {
  const rows: InfoRow[] = [];

  // Common: add duration if completed
  const addDuration = () => {
    if (tool.completedAt && tool.createdAt) {
      rows.push({
        label: t("tools.fullView.simple.duration"),
        value: formatDuration(tool.createdAt, tool.completedAt),
      });
    }
  };

  // Common: add status
  const addStatus = () => {
    if (tool.state === "completed") {
      rows.push({
        label: t("tools.fullView.simple.status"),
        value: t("tools.fullView.simple.succeeded"),
        color: statusColors.successColor,
      });
    } else if (tool.state === "error") {
      rows.push({
        label: t("tools.fullView.simple.status"),
        value: t("tools.fullView.simple.failed"),
        color: statusColors.errorColor,
      });
    } else {
      rows.push({
        label: t("tools.fullView.simple.status"),
        value: t("tools.fullView.simple.running"),
        color: statusColors.runningColor,
      });
    }
  };

  switch (tool.name) {
    case "Read": {
      const filePath =
        typeof tool.input?.file_path === "string" ? tool.input.file_path : "";
      const resolved = filePath ? resolvePath(filePath, metadata) : "";
      const displayName = resolved ? extractFileName(resolved) : "unknown";
      const title = t("tools.fullView.simple.readFile", {
        file: displayName,
      });
      rows.push({
        label: t("tools.fullView.simple.fileName"),
        value: resolved || filePath,
      });
      addStatus();
      addDuration();
      return { title, rows };
    }

    // Note: Edit/MultiEdit have specialized full views (EditViewFull, MultiEditViewFull)
    // so they never reach ToolSimpleContent. No case needed here.

    case "Write": {
      const filePath =
        typeof tool.input?.file_path === "string" ? tool.input.file_path : "";
      const resolved = filePath ? resolvePath(filePath, metadata) : "";
      const displayName = resolved ? extractFileName(resolved) : "unknown";
      const title = t("tools.fullView.simple.writeFile", {
        file: displayName,
      });
      rows.push({
        label: t("tools.fullView.simple.fileName"),
        value: resolved || filePath,
      });
      addStatus();
      addDuration();
      return { title, rows };
    }

    case "Bash":
    case "CodexBash": {
      const summary =
        tool.name === "CodexBash"
          ? getCodexParsedCommandSummary(tool.input, metadata)
          : null;
      const description =
        typeof tool.description === "string"
          ? tool.description
          : typeof tool.input?.description === "string"
            ? tool.input.description
            : null;
      const command = getCodexCommandPreview(tool.input?.command, 120);
      let title = t("tools.fullView.simple.runCommand");

      if (summary?.type === "read") {
        title = t("tools.fullView.simple.readFile", {
          file: summary.displayName || "unknown",
        });
        if (summary.resolvedPath) {
          rows.push({
            label: t("tools.fullView.simple.fileName"),
            value: summary.resolvedPath,
          });
        }
      } else if (summary?.type === "write") {
        title = t("tools.fullView.simple.writeFile", {
          file: summary.displayName || "unknown",
        });
        if (summary.resolvedPath) {
          rows.push({
            label: t("tools.fullView.simple.fileName"),
            value: summary.resolvedPath,
          });
        }
      } else if (summary?.type === "search") {
        title = t("tools.fullView.simple.searchCode", {
          pattern: (summary.query || summary.command || "search").slice(0, 60),
        });
        if (summary.query) {
          rows.push({
            label: t("tools.fullView.simple.pattern"),
            value: summary.query,
          });
        }
      } else if (summary?.type === "list_files") {
        title = t("tools.fullView.simple.findFiles", {
          pattern: (summary.displayName || summary.command || "files").slice(0, 60),
        });
        if (summary.resolvedPath) {
          rows.push({
            label: t("tools.fullView.simple.fileName"),
            value: summary.resolvedPath,
          });
        }
      }

      if (description) {
        rows.push({
          label: t("tools.fullView.simple.description"),
          value: description,
        });
      }
      if (command) {
        rows.push({
          label: t("tools.fullView.simple.command"),
          value: command,
        });
      }
      addStatus();
      addDuration();
      return { title, rows };
    }

    case "Grep": {
      const pattern =
        typeof tool.input?.pattern === "string" ? tool.input.pattern : "";
      const title = t("tools.fullView.simple.searchCode", {
        pattern: pattern.slice(0, 60),
      });
      if (pattern) {
        rows.push({
          label: t("tools.fullView.simple.pattern"),
          value: pattern,
        });
      }
      addStatus();
      addDuration();
      return { title, rows };
    }

    case "Glob": {
      const pattern =
        typeof tool.input?.pattern === "string" ? tool.input.pattern : "";
      const title = t("tools.fullView.simple.findFiles", {
        pattern: pattern.slice(0, 60),
      });
      if (pattern) {
        rows.push({
          label: t("tools.fullView.simple.pattern"),
          value: pattern,
        });
      }
      addStatus();
      addDuration();
      return { title, rows };
    }

    case "Task":
    case "Agent": {
      const subagentType =
        typeof tool.input?.subagent_type === "string"
          ? tool.input.subagent_type
          : "unknown";
      const title = t("tools.fullView.simple.launchAgent", {
        type: subagentType,
      });
      rows.push({
        label: t("tools.fullView.simple.agent"),
        value: subagentType,
      });
      const desc =
        typeof tool.input?.description === "string"
          ? tool.input.description
          : null;
      if (desc) {
        rows.push({
          label: t("tools.fullView.simple.description"),
          value: desc,
        });
      }
      addStatus();
      addDuration();
      return { title, rows };
    }

    case "WebSearch": {
      const query =
        typeof tool.input?.query === "string" ? tool.input.query : "";
      const title = t("tools.fullView.simple.webSearch", {
        query: query.slice(0, 60),
      });
      if (query) {
        rows.push({
          label: t("tools.fullView.simple.query"),
          value: query,
        });
      }
      addStatus();
      addDuration();
      return { title, rows };
    }

    case "WebFetch": {
      const url = typeof tool.input?.url === "string" ? tool.input.url : "";
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
        // keep original
      }
      const title = t("tools.fullView.simple.fetchUrl", { host });
      if (url) {
        rows.push({
          label: t("tools.fullView.simple.url"),
          value: url,
        });
      }
      addStatus();
      addDuration();
      return { title, rows };
    }

    case "TodoWrite": {
      const todos = Array.isArray(tool.input?.todos) ? tool.input.todos : [];
      const title = t("tools.fullView.simple.updateTodos", {
        count: todos.length,
      });
      addStatus();
      addDuration();
      return { title, rows };
    }

    case "NotebookEdit": {
      const filePath =
        typeof tool.input?.notebook_path === "string"
          ? tool.input.notebook_path
          : "";
      const resolved = filePath ? resolvePath(filePath, metadata) : "";
      const displayName = resolved ? extractFileName(resolved) : "unknown";
      const title = t("tools.fullView.simple.editFile", {
        file: displayName,
      });
      rows.push({
        label: t("tools.fullView.simple.fileName"),
        value: resolved || filePath,
      });
      addStatus();
      addDuration();
      return { title, rows };
    }

    default: {
      // MCP tools or unknown tools
      const toolName = tool.name.startsWith("mcp__")
        ? tool.name.replace(/^mcp__[^_]+__/, "")
        : tool.name;
      const title = tool.name.startsWith("mcp__")
        ? t("tools.fullView.simple.mcpTool", { name: toolName })
        : t("tools.fullView.simple.unknownTool", { name: toolName });

      if (tool.description) {
        rows.push({
          label: t("tools.fullView.simple.description"),
          value: tool.description,
        });
      }
      addStatus();
      addDuration();
      return { title, rows };
    }
  }
}

interface ToolSimpleContentProps {
  tool: ToolCall;
  metadata: Metadata | null;
  provider?: ToolProvider;
}

export const ToolSimpleContent = React.memo<ToolSimpleContentProps>(
  ({ tool, metadata, provider }) => {
    const { theme } = useUnistyles();
    const toolProvider =
      provider ?? getToolProvider({ toolName: tool.name, metadata });
    const contentTheme = React.useMemo(
      () => buildToolSimpleContentTheme(toolProvider, theme),
      [toolProvider, theme],
    );
    const { title, rows } = React.useMemo(
      () =>
        generateSimpleContent(tool, metadata, {
          successColor: contentTheme.statusCompletedColor,
          errorColor: contentTheme.statusErrorColor,
          runningColor: contentTheme.statusRunningColor,
        }),
      [
        contentTheme.statusCompletedColor,
        contentTheme.statusErrorColor,
        contentTheme.statusRunningColor,
        metadata,
        tool,
      ],
    );

    return (
      <View style={styles.container}>
        {/* Title card */}
        <View
          style={[
            styles.titleCard,
            {
              backgroundColor: contentTheme.titleCardBackground,
              borderColor: contentTheme.borderColor ?? "transparent",
              borderRadius: contentTheme.borderRadius,
              borderWidth: contentTheme.borderWidth,
            },
          ]}
        >
          <StatusIcon
            state={tool.state}
            completedColor={contentTheme.statusCompletedColor}
            errorColor={contentTheme.statusErrorColor}
            runningColor={contentTheme.statusRunningColor}
          />
          <Text style={[styles.title, { color: contentTheme.titleColor }]}>
            {title}
          </Text>
        </View>

        {/* Info rows */}
        {rows.length > 0 && (
          <View
            style={[
              styles.infoCard,
              {
                backgroundColor: contentTheme.infoCardBackground,
                borderColor: contentTheme.borderColor ?? "transparent",
                borderRadius: contentTheme.borderRadius,
                borderWidth: contentTheme.borderWidth,
              },
            ]}
          >
            {rows.map((row, index) => (
              <View
                key={`${row.label}-${row.value}-${index}`}
                style={[
                  styles.infoRow,
                  index < rows.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor:
                      contentTheme.borderColor ?? theme.colors.divider,
                  },
                ]}
              >
                {row.label ? (
                  <Text
                    style={[
                      styles.infoLabel,
                      {
                        color: contentTheme.labelColor,
                      },
                    ]}
                  >
                    {row.label}
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.infoValue,
                    {
                      color: row.color || contentTheme.valueColor,
                    },
                    !row.label && { flex: 1 },
                  ]}
                  numberOfLines={3}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  },
);

function StatusIcon({
  state,
  completedColor,
  errorColor,
  runningColor,
}: {
  state: ToolCall["state"];
  completedColor: string;
  errorColor: string;
  runningColor: string;
}): React.ReactElement | null {
  switch (state) {
    case "completed":
      return (
        <Ionicons name="checkmark-circle" size={28} color={completedColor} />
      );
    case "error":
      return <Ionicons name="alert-circle" size={28} color={errorColor} />;
    case "running":
      return (
        <Ionicons name="hourglass-outline" size={28} color={runningColor} />
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: 16,
    paddingHorizontal: 4,
  },
  titleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    flex: 1,
  },
  infoCard: {
    borderRadius: 12,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  infoLabel: {
    fontSize: 14,
    width: 60,
    flexShrink: 0,
  },
  infoValue: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
}));
