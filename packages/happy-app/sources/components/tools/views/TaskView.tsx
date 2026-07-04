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
import { ToolCall, TaskStatusMessage } from "@/sync/typesMessage";
import { AgentEvent } from "@/sync/typesRaw";
import { useUnistyles } from "react-native-unistyles";
import { useSetting } from "@/sync/storage";
import { t } from "@/text";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { resolveToolChildTitle } from "@/components/tools/toolMetadataResolve";
import { formatModelName, formatTokensCompact, formatDurationCompact } from "@/utils/formatUsage";

interface SubTaskStats {
  durationMs: number | null;
  toolCount: number;
  tokenCount: number;
}

interface FilteredTool {
  tool: ToolCall;
  title: string;
  state: "running" | "completed" | "error";
  stats: SubTaskStats | null;
}

interface TaskStatusEntry {
  taskStatus: TaskStatusMessage;
  createdAt: number;
}

export const TaskView = React.memo<ToolViewProps>(
  ({ tool, metadata, messages }) => {
    const { theme } = useUnistyles();
    const showAgentActivity = useSetting("showAgentActivity");
    const filtered: FilteredTool[] = [];
    const taskStatusItems: TaskStatusEntry[] = [];
    const agentTexts: { id: string; text: string; createdAt: number }[] = [];

    for (let m of messages) {
      if (m.kind === "agent-text" && !m.taskStatus && !m.isThinking && m.text) {
        agentTexts.push({ id: m.id, text: m.text, createdAt: m.createdAt });
      } else if (m.kind === "tool-call") {
        const knownTool = knownTools[
          m.tool.name as keyof typeof knownTools
        ] as any;

        // Prefer extractDescription, fall back to title — via toolMetadataResolve.
        const title = resolveToolChildTitle(knownTool, m.tool, metadata);

        if (
          m.tool.state === "running" ||
          m.tool.state === "completed" ||
          m.tool.state === "error"
        ) {
          // Compute inline stats for Agent/Task sub-tools from their children
          let stats: SubTaskStats | null = null;
          if (
            (m.tool.name === "Agent" || m.tool.name === "Task") &&
            m.kind === "tool-call" &&
            m.children.length > 0
          ) {
            const toolCount = m.children.filter(
              (c) => c.kind === "tool-call",
            ).length;
            let tokenCount = 0;
            for (const c of m.children) {
              if (c.kind === "agent-event") {
                const evt = c.event as AgentEvent;
                if (
                  (evt.type === "usage-stats" || evt.type === "ready") &&
                  evt.usage
                ) {
                  tokenCount +=
                    evt.usage.input_tokens +
                    evt.usage.output_tokens +
                    (evt.usage.cache_creation_input_tokens ?? 0) +
                    (evt.usage.cache_read_input_tokens ?? 0);
                }
              }
            }
            const durationMs =
              m.tool.completedAt && m.tool.createdAt
                ? m.tool.completedAt - m.tool.createdAt
                : null;
            if (toolCount > 0 || tokenCount > 0) {
              stats = { durationMs, toolCount, tokenCount };
            }
          }
          filtered.push({
            tool: m.tool,
            title,
            state: m.tool.state,
            stats,
          });
        }
      } else if (m.kind === "agent-text" && m.taskStatus) {
        // Task status messages redirected from main timeline (Phase 3.7)
        taskStatusItems.push({
          taskStatus: m.taskStatus,
          createdAt: m.createdAt,
        });
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
    interface UsageInfo {
      model: string;
      tokens: string;
      cacheHit: string | null;
    }
    const usageInfos: UsageInfo[] =
      usageByModel.size > 0
        ? Array.from(usageByModel.entries()).map(([model, data]) => ({
            model: formatModelName(model),
            tokens: formatTokensCompact(data.tokens),
            cacheHit:
              data.cacheRead > 0 && data.totalInput > 0
                ? `↓${Math.round((data.cacheRead / data.totalInput) * 100)}%`
                : null,
          }))
        : [];

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
        paddingVertical: 5,
        paddingRight: 6,
        marginVertical: 1,
      },
      toolTitle: {
        fontSize: 13,
        fontWeight: "500",
        color: theme.colors.textSecondary,
        fontFamily: "monospace",
        flex: 1,
        lineHeight: 18,
        ...(Platform.OS === "web"
          ? { wordBreak: "break-all" } as any
          : {}),
      },
      statusContainer: {
        marginLeft: "auto",
        paddingLeft: 8,
        paddingTop: 1,
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
        fontSize: 12,
        color: theme.colors.accentBlue,
        fontFamily: "monospace",
        opacity: 0.85,
      },
      summaryRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        paddingVertical: 5,
        paddingHorizontal: 4,
        gap: 5,
      },
      statBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: theme.colors.textSecondary + "14",
        gap: 4,
      },
      statBadgeText: {
        fontSize: 12,
        fontFamily: "monospace",
        color: theme.colors.textSecondary,
      },
      inlineStatsRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 4,
        marginTop: 3,
      },
      inlineBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 4,
        backgroundColor: theme.colors.textSecondary + "12",
      },
      inlineBadgeText: {
        fontSize: 11,
        fontFamily: "monospace",
        color: theme.colors.textSecondary,
      },
      resultContainer: {
        marginTop: 6,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.accentBlue + "30",
        borderRadius: 4,
        paddingLeft: 8,
        paddingRight: 4,
        ...(Platform.OS === "web"
          ? { zoom: 0.82 } as any
          : {
              transform: [{ scale: 0.85 }],
              transformOrigin: "top left" as any,
              width: "117.6%", // 1/0.85
            }),
      },
      taskStatusSection: {
        marginHorizontal: 4,
        marginBottom: 6,
        gap: 3,
      },
      taskStatusRow: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 5,
        paddingVertical: 2,
        paddingHorizontal: 2,
      },
      taskStatusText: {
        fontSize: 12,
        fontWeight: "600" as const,
        fontFamily: "monospace",
      },
      taskStatusSummary: {
        fontSize: 12,
        fontFamily: "monospace",
        flex: 1,
      },
      taskStatusMetrics: {
        fontSize: 11,
        fontFamily: "monospace",
        opacity: 0.7,
      },
      agentTextOuter: {
        marginHorizontal: 4,
        marginTop: 6,
        overflow: "hidden" as const,
      },
      agentTextContent: {
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.accentTeal + "40",
        borderRadius: 6,
        paddingLeft: 10,
        paddingRight: 8,
        ...(Platform.OS === "web"
          ? { zoom: 0.8 } as any
          : {
              transform: [{ scale: 0.85 }],
              transformOrigin: "top left" as any,
              width: "117.6%",
            }),
      },
    });

    const expandTools = useSetting("expandTools");
    const [collapsed, setCollapsed] = React.useState(!expandTools);
    const [showAllTools, setShowAllTools] = React.useState(false);
    const [expandedResults, setExpandedResults] = React.useState<Set<string>>(
      () => new Set(),
    );

    const toggleResult = React.useCallback((key: string) => {
      setExpandedResults((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    }, []);

    // Take only the last agent-text block (the final subagent summary/output)
    const lastAgentText = showAgentActivity && agentTexts.length > 0
      ? agentTexts[agentTexts.length - 1]
      : null;

    if (filtered.length === 0 && taskStatusItems.length === 0 && !lastAgentText) {
      return null;
    }

    // Render task status section (always visible, between header and tools)
    const renderTaskStatus = () =>
      taskStatusItems.length > 0 ? (
        <View style={styles.taskStatusSection}>
          {taskStatusItems.map((entry, index) => {
            const statusIcon =
              entry.taskStatus.status === "completed"
                ? "checkmark-circle-outline" as const
                : entry.taskStatus.status === "failed"
                  ? "close-circle-outline" as const
                  : entry.taskStatus.status === "stopped"
                    ? "stop-circle-outline" as const
                    : "hourglass-outline" as const;
            const statusColor =
              entry.taskStatus.status === "completed"
                ? theme.colors.success
                : entry.taskStatus.status === "failed" || entry.taskStatus.status === "stopped"
                  ? theme.colors.textDestructive
                  : theme.colors.accentOrange;
            const statusLabel =
              entry.taskStatus.status === "start"
                ? t("message.taskStarted")
                : entry.taskStatus.status === "progress"
                  ? t("message.taskProgress")
                  : entry.taskStatus.status === "completed"
                    ? t("message.taskCompleted")
                    : entry.taskStatus.status === "failed"
                      ? t("message.taskFailed")
                      : t("message.taskStopped");
            return (
              <View key={`ts-${index}`} style={styles.taskStatusRow}>
                <Ionicons
                  name={statusIcon}
                  size={11}
                  color={statusColor}
                  style={{ marginTop: 1 }}
                />
                <Text
                  numberOfLines={2}
                  style={[styles.taskStatusText, { color: statusColor }]}
                >
                  {statusLabel}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[styles.taskStatusSummary, { color: theme.colors.text }]}
                >
                  {entry.taskStatus.summary}
                </Text>
                {entry.taskStatus.metrics ? (
                  <Text
                    numberOfLines={1}
                    style={[styles.taskStatusMetrics, { color: statusColor }]}
                  >
                    {entry.taskStatus.metrics}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null;

    const renderAgentText = () =>
      lastAgentText ? (
        <View style={styles.agentTextOuter}>
          <View style={styles.agentTextContent}>
            <MarkdownView markdown={lastAgentText.text} />
          </View>
        </View>
      ) : null;

    if (filtered.length === 0) {
      return (
        <View style={styles.container}>
          {renderTaskStatus()}
          {renderAgentText()}
        </View>
      );
    }

    // Summary stats for collapsed view
    const completedCount = filtered.filter(
      (ti) => ti.state === "completed",
    ).length;
    const runningCount = filtered.filter((ti) => ti.state === "running").length;
    const errorCount = filtered.filter((ti) => ti.state === "error").length;
    const agentCount = filtered.filter(
      (ti) => ti.tool.name === "Agent",
    ).length;

    const renderSummaryBadges = () => (
      <>
        {agentCount > 0 && (
          <View
            style={[
              styles.statBadge,
              { backgroundColor: theme.colors.accentPurple + "15" },
            ]}
          >
            <Ionicons
              name="git-branch-outline"
              size={10}
              color={theme.colors.accentPurple}
            />
            <Text
              style={[
                styles.statBadgeText,
                { color: theme.colors.accentPurple },
              ]}
            >
              {agentCount} {agentCount === 1 ? "agent" : "agents"}
            </Text>
          </View>
        )}
        <View style={styles.statBadge}>
          <Ionicons
            name="construct-outline"
            size={10}
            color={theme.colors.textSecondary}
          />
          <Text style={styles.statBadgeText}>
            {filtered.length} tools
          </Text>
        </View>
        {completedCount > 0 && (
          <View
            style={[
              styles.statBadge,
              { backgroundColor: theme.colors.success + "18" },
            ]}
          >
            <Text
              style={[
                styles.statBadgeText,
                { color: theme.colors.success },
              ]}
            >
              {completedCount}✓
            </Text>
          </View>
        )}
        {runningCount > 0 && (
          <View
            style={[
              styles.statBadge,
              { backgroundColor: theme.colors.accentOrange + "18" },
            ]}
          >
            <Text
              style={[
                styles.statBadgeText,
                { color: theme.colors.accentOrange },
              ]}
            >
              {runningCount}⟳
            </Text>
          </View>
        )}
        {errorCount > 0 && (
          <View
            style={[
              styles.statBadge,
              { backgroundColor: theme.colors.textDestructive + "18" },
            ]}
          >
            <Text
              style={[
                styles.statBadgeText,
                { color: theme.colors.textDestructive },
              ]}
            >
              {errorCount}✗
            </Text>
          </View>
        )}
        {usageInfos.map((info, i) => (
          <React.Fragment key={i}>
            <View
              style={[
                styles.statBadge,
                { backgroundColor: theme.colors.accentPurple + "15" },
              ]}
            >
              <Text
                style={[
                  styles.statBadgeText,
                  { color: theme.colors.accentPurple },
                ]}
              >
                {info.model}
              </Text>
            </View>
            <View
              style={[
                styles.statBadge,
                { backgroundColor: theme.colors.accentTeal + "15" },
              ]}
            >
              <Text
                style={[
                  styles.statBadgeText,
                  { color: theme.colors.accentTeal },
                ]}
              >
                {info.tokens}
              </Text>
              {info.cacheHit && (
                <Text
                  style={[
                    styles.statBadgeText,
                    { color: theme.colors.success, marginLeft: 3 },
                  ]}
                >
                  {info.cacheHit}
                </Text>
              )}
            </View>
          </React.Fragment>
        ))}
      </>
    );

    if (collapsed) {
      return (
        <>
          {renderTaskStatus()}
          <Pressable
            onPress={() => setCollapsed(false)}
            style={styles.summaryRow}
          >
            <Ionicons
              name="chevron-forward"
              size={14}
              color={theme.colors.textSecondary}
            />
            {renderSummaryBadges()}
          </Pressable>
        </>
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
        {renderTaskStatus()}
        <Pressable onPress={() => setCollapsed(true)} style={styles.summaryRow}>
          <Ionicons
            name="chevron-down"
            size={14}
            color={theme.colors.textSecondary}
          />
          {renderSummaryBadges()}
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
          const itemKey = `${item.tool.name}-${index}`;
          const hasResult =
            item.tool.result &&
            typeof item.tool.result === "string" &&
            item.tool.result.length > 0 &&
            item.state === "completed";
          const isResultExpanded = expandedResults.has(itemKey);
          return (
            <View
              key={itemKey}
              style={
                isLast ? styles.treeContainerLast : styles.treeContainer
              }
            >
              <View style={styles.toolItem}>
                <View style={styles.treeConnector} />
                <View style={styles.treeItemContent}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toolTitle}>{item.title}</Text>
                    {item.stats && (
                      <View style={styles.inlineStatsRow}>
                        {item.stats.durationMs != null && (
                          <View
                            style={[
                              styles.inlineBadge,
                              {
                                backgroundColor:
                                  theme.colors.accentOrange + "15",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.inlineBadgeText,
                                { color: theme.colors.accentOrange },
                              ]}
                            >
                              {formatDurationCompact(item.stats.durationMs)}
                            </Text>
                          </View>
                        )}
                        {item.stats.tokenCount > 0 && (
                          <View
                            style={[
                              styles.inlineBadge,
                              {
                                backgroundColor:
                                  theme.colors.accentTeal + "15",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.inlineBadgeText,
                                { color: theme.colors.accentTeal },
                              ]}
                            >
                              {formatTokensCompact(item.stats.tokenCount)}
                            </Text>
                          </View>
                        )}
                        {item.stats.toolCount > 0 && (
                          <View style={styles.inlineBadge}>
                            <Text style={styles.inlineBadgeText}>
                              {item.stats.toolCount} tools
                            </Text>
                          </View>
                        )}
                        {hasResult && (
                          <Pressable
                            onPress={() => toggleResult(itemKey)}
                            style={[
                              styles.inlineBadge,
                              {
                                backgroundColor:
                                  theme.colors.accentBlue + "15",
                              },
                            ]}
                          >
                            <Ionicons
                              name={
                                isResultExpanded
                                  ? "chevron-down"
                                  : "chevron-forward"
                              }
                              size={9}
                              color={theme.colors.accentBlue}
                            />
                            <Text
                              style={[
                                styles.inlineBadgeText,
                                { color: theme.colors.accentBlue },
                              ]}
                            >
                              {t("toolView.output")}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                    {!item.stats && hasResult && (
                      <View style={styles.inlineStatsRow}>
                        <Pressable
                          onPress={() => toggleResult(itemKey)}
                          style={[
                            styles.inlineBadge,
                            {
                              backgroundColor:
                                theme.colors.accentBlue + "15",
                            },
                          ]}
                        >
                          <Ionicons
                            name={
                              isResultExpanded
                                ? "chevron-down"
                                : "chevron-forward"
                            }
                            size={9}
                            color={theme.colors.accentBlue}
                          />
                          <Text
                            style={[
                              styles.inlineBadgeText,
                              { color: theme.colors.accentBlue },
                            ]}
                          >
                            {t("toolView.output")}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                    {hasResult && isResultExpanded && (
                      <View style={styles.resultContainer}>
                        <MarkdownView
                          markdown={String(item.tool.result)}
                        />
                      </View>
                    )}
                  </View>
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
        {renderAgentText()}
      </View>
    );
  },
);
