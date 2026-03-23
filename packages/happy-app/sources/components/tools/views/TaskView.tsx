import * as React from "react";
import { ToolViewProps } from "./_all";
import {
  Text,
  View,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import { knownTools } from "../../tools/knownTools";
import { Ionicons } from "@expo/vector-icons";
import { ToolCall } from "@/sync/typesMessage";
import { AgentEvent } from "@/sync/typesRaw";
import { useUnistyles } from "react-native-unistyles";
import { useSetting } from "@/sync/storage";
import { t } from "@/text";
import { MarkdownView } from "@/components/markdown/MarkdownView";

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

function formatDuration(ms: number): string {
  if (ms >= 60000) {
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

interface FilteredTool {
  tool: ToolCall;
  title: string;
  state: "running" | "completed" | "error";
}

export const TaskView = React.memo<ToolViewProps>(
  ({ tool, metadata, messages }) => {
    const { theme } = useUnistyles();
    const showAgentActivity = useSetting("showAgentActivity");
    const filtered: FilteredTool[] = [];

    for (let m of messages) {
      if (m.kind === "tool-call") {
        const knownTool = knownTools[
          m.tool.name as keyof typeof knownTools
        ] as any;

        // Extract title using extractDescription if available, otherwise use title
        let title = m.tool.name;
        if (knownTool) {
          if (
            "extractDescription" in knownTool &&
            typeof knownTool.extractDescription === "function"
          ) {
            title = knownTool.extractDescription({ tool: m.tool, metadata });
          } else if (knownTool.title) {
            // Handle optional title and function type
            if (typeof knownTool.title === "function") {
              title = knownTool.title({ tool: m.tool, metadata });
            } else {
              title = knownTool.title;
            }
          }
        }

        if (
          m.tool.state === "running" ||
          m.tool.state === "completed" ||
          m.tool.state === "error"
        ) {
          filtered.push({
            tool: m.tool,
            title,
            state: m.tool.state,
          });
        }
      }
    }

    // Aggregate usage stats from agent-event children (one line instead of many)
    const usageByModel = new Map<
      string,
      {
        tokens: number;
        durationMs: number;
        cacheRead: number;
        totalInput: number;
      }
    >();
    for (const m of messages) {
      if (m.kind === "agent-event") {
        const evt = m.event as AgentEvent;
        if ((evt.type === "usage-stats" || evt.type === "ready") && evt.usage) {
          const model = evt.model ?? "unknown";
          const cr = evt.usage.cache_read_input_tokens ?? 0;
          const cc = evt.usage.cache_creation_input_tokens ?? 0;
          const totalTokens =
            evt.usage.input_tokens + evt.usage.output_tokens + cc + cr;
          const existing = usageByModel.get(model) ?? {
            tokens: 0,
            durationMs: 0,
            cacheRead: 0,
            totalInput: 0,
          };
          usageByModel.set(model, {
            tokens: existing.tokens + totalTokens,
            durationMs: existing.durationMs + (evt.durationMs ?? 0),
            cacheRead: existing.cacheRead + cr,
            totalInput: existing.totalInput + evt.usage.input_tokens + cc + cr,
          });
        }
      }
    }
    const usageSummary =
      usageByModel.size > 0
        ? Array.from(usageByModel.entries())
            .map(([model, data]) => {
              const tokenStr = formatTokenCount(data.tokens);
              const cacheHit =
                data.cacheRead > 0 && data.totalInput > 0
                  ? ` (↓${Math.round((data.cacheRead / data.totalInput) * 100)}%)`
                  : "";
              return `${model.replace(/-\d{8}$/, "")} · ${tokenStr}${cacheHit}`;
            })
            .join(" · ")
        : null;

    // When showAgentActivity is enabled, extract prompt summary and subagent type
    const promptSummary =
      showAgentActivity && tool.input?.prompt
        ? (tool.input.prompt as string)
        : null;
    const subagentType =
      showAgentActivity && tool.input?.subagent_type
        ? (tool.input.subagent_type as string)
        : null;

    const styles = StyleSheet.create({
      container: {
        paddingVertical: 4,
        paddingBottom: 12,
      },
      promptSummaryOuter: {
        marginHorizontal: 4,
        marginBottom: 8,
        overflow: "hidden" as const,
      },
      promptSummary: {
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.textSecondary + "40",
        borderRadius: 6,
        paddingLeft: 10,
        paddingRight: 8,
        ...(Platform.OS === "web"
          ? { zoom: 0.8 } as any
          : {
              transform: [{ scale: 0.85 }],
              transformOrigin: "top left" as any,
              width: "117.6%", // 1/0.85 to compensate scale
            }),
      },
      subagentType: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        opacity: 0.5,
        fontStyle: "italic",
        paddingHorizontal: 4,
        paddingBottom: 4,
      },
      toolItem: {
        position: "relative" as const,
      },
      treeContainer: {
        marginLeft: 4,
        borderLeftWidth: 1,
        borderLeftColor: theme.colors.textSecondary + "4D", // ~30% opacity
      },
      treeContainerLast: {
        marginLeft: 4,
        borderLeftWidth: 1,
        borderLeftColor: "transparent",
      },
      treeConnector: {
        width: 16,
        height: 12, // align with center of first line (paddingVertical 3 + ~half line height)
        position: "absolute" as const,
        left: -1,
        top: 0,
        borderLeftWidth: 1,
        borderBottomWidth: 1,
        borderLeftColor: theme.colors.textSecondary + "4D",
        borderBottomColor: theme.colors.textSecondary + "4D",
        borderBottomLeftRadius: 4,
      },
      treeItemContent: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        flex: 1,
        paddingLeft: 20,
        paddingVertical: 3,
        paddingRight: 2,
      },
      toolTitle: {
        fontSize: 14,
        fontWeight: "500",
        color: theme.colors.textSecondary,
        fontFamily: "monospace",
        flex: 1,
        ...(Platform.OS === "web"
          ? { wordBreak: "break-all" } as any
          : {}),
      },
      statusContainer: {
        marginLeft: "auto",
        paddingLeft: 8,
      },
      loadingItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 8,
        paddingHorizontal: 4,
      },
      loadingText: {
        marginLeft: 8,
        fontSize: 14,
        color: theme.colors.textSecondary,
      },
      moreToolsItem: {
        paddingVertical: 3,
        paddingLeft: 4,
      },
      moreToolsText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontStyle: "italic",
        opacity: 0.7,
      },
      summaryRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 6,
        paddingHorizontal: 4,
        gap: 4,
      },
      summaryText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontFamily: "monospace",
      },
    });

    const expandTools = useSetting("expandTools");
    const [collapsed, setCollapsed] = React.useState(!expandTools);
    const [showAllTools, setShowAllTools] = React.useState(false);

    if (filtered.length === 0) {
      return null;
    }

    // Summary stats for collapsed view
    const completedCount = filtered.filter(
      (ti) => ti.state === "completed",
    ).length;
    const runningCount = filtered.filter((ti) => ti.state === "running").length;
    const errorCount = filtered.filter((ti) => ti.state === "error").length;

    const summaryParts = [`${filtered.length} tools`];
    if (completedCount > 0) summaryParts.push(`${completedCount}✓`);
    if (runningCount > 0) summaryParts.push(`${runningCount}⟳`);
    if (errorCount > 0) summaryParts.push(`${errorCount}✗`);
    if (usageSummary) summaryParts.push(usageSummary);
    const summaryLabel = summaryParts.join(" · ");

    if (collapsed) {
      return (
        <Pressable
          onPress={() => setCollapsed(false)}
          style={styles.summaryRow}
        >
          <Ionicons
            name="chevron-forward"
            size={14}
            color={theme.colors.textSecondary}
          />
          <Text style={styles.summaryText}>{summaryLabel}</Text>
        </Pressable>
      );
    }

    // Show more tools when activity mode is enabled
    const maxVisible = showAgentActivity ? 6 : 3;
    const displayTools = showAllTools
      ? filtered
      : filtered.slice(filtered.length - maxVisible);
    const remainingCount = showAllTools ? 0 : filtered.length - maxVisible;

    return (
      <View style={styles.container}>
        <Pressable onPress={() => setCollapsed(true)} style={styles.summaryRow}>
          <Ionicons
            name="chevron-down"
            size={14}
            color={theme.colors.textSecondary}
          />
          <Text style={styles.summaryText}>{summaryLabel}</Text>
        </Pressable>
        {subagentType && (
          <Text style={styles.subagentType} numberOfLines={1}>
            {t("tools.taskView.subagentRunning", { type: subagentType })}
          </Text>
        )}
        {promptSummary && (
          <View style={styles.promptSummaryOuter}>
            <View style={styles.promptSummary}>
              <MarkdownView markdown={promptSummary} />
            </View>
          </View>
        )}
        {displayTools.map((item, index) => {
          const isLastItem =
            index === displayTools.length - 1 && remainingCount <= 0;
          const hasMoreBelow =
            remainingCount > 0 ||
            (showAllTools && filtered.length > maxVisible);
          const isLast = isLastItem && !hasMoreBelow;
          return (
            <View
              key={`${item.tool.name}-${index}`}
              style={
                isLast ? styles.treeContainerLast : styles.treeContainer
              }
            >
              <View style={styles.toolItem}>
                <View style={styles.treeConnector} />
                <View style={styles.treeItemContent}>
                  <Text style={styles.toolTitle}>{item.title}</Text>
                  <View style={styles.statusContainer}>
                    {item.state === "running" && (
                      <ActivityIndicator
                        size={
                          Platform.OS === "ios" ? "small" : (14 as any)
                        }
                        color={theme.colors.warning}
                      />
                    )}
                    {item.state === "completed" && (
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color={theme.colors.success}
                      />
                    )}
                    {item.state === "error" && (
                      <Ionicons
                        name="close-circle"
                        size={16}
                        color={theme.colors.textDestructive}
                      />
                    )}
                  </View>
                </View>
              </View>
            </View>
          );
        })}
        {remainingCount > 0 && (
          <View style={styles.treeContainerLast}>
            <Pressable style={styles.toolItem} onPress={() => setShowAllTools(true)}>
              <View style={styles.treeConnector} />
              <View style={styles.treeItemContent}>
                <Text style={styles.moreToolsText}>
                  {t("tools.taskView.moreTools", { count: remainingCount })}
                </Text>
              </View>
            </Pressable>
          </View>
        )}
        {showAllTools && filtered.length > maxVisible && (
          <View style={styles.treeContainerLast}>
            <Pressable style={styles.toolItem} onPress={() => setShowAllTools(false)}>
              <View style={styles.treeConnector} />
              <View style={styles.treeItemContent}>
                <Text style={styles.moreToolsText}>
                  {t("tools.taskView.collapseTools")}
                </Text>
              </View>
            </Pressable>
          </View>
        )}
      </View>
    );
  },
);
