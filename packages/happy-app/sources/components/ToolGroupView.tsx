import * as React from "react";
import {
  Text,
  View,
  ActivityIndicator,
  Pressable,
  Platform,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ToolCallMessage } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { knownTools } from "./tools/knownTools";
import { layout } from "./layout";
import { t } from "@/text";
import { sessionAllow } from "@/sync/ops";

interface ToolGroupItem {
  message: ToolCallMessage;
  title: string;
  state: "running" | "completed" | "error";
}

function extractToolTitle(
  message: ToolCallMessage,
  metadata: Metadata | null,
): string {
  const toolName = message.tool.name;
  const knownTool = knownTools[toolName as keyof typeof knownTools] as any;

  if (knownTool) {
    if (
      "extractDescription" in knownTool &&
      typeof knownTool.extractDescription === "function"
    ) {
      return knownTool.extractDescription({
        tool: message.tool,
        metadata,
      });
    }
    if (knownTool.title) {
      if (typeof knownTool.title === "function") {
        return knownTool.title({ tool: message.tool, metadata });
      }
      return knownTool.title;
    }
  }

  return toolName;
}

function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

export const ToolGroupView = React.memo(
  (props: {
    messages: ToolCallMessage[];
    metadata: Metadata | null;
    sessionId: string;
    model?: string;
    turnTokens?: number;
    cacheRead?: number;
    totalInput?: number;
  }) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [collapsed, setCollapsed] = React.useState(false);
    const [showAllTools, setShowAllTools] = React.useState(false);

    // Auto-approve pending permissions for grouped tools (ToolView is not
    // rendered inside groups, so its own auto-approve useEffect never fires).
    React.useEffect(() => {
      for (const m of props.messages) {
        if (
          m.tool.permission?.status === "pending" &&
          m.tool.permission?.id &&
          m.tool.name !== "AskUserQuestion"
        ) {
          sessionAllow(props.sessionId, m.tool.permission.id);
        }
      }
    }, [props.messages, props.sessionId]);

    const items: ToolGroupItem[] = React.useMemo(
      () =>
        props.messages.map((m) => ({
          message: m,
          title: extractToolTitle(m, props.metadata),
          state: m.tool.state,
        })),
      [props.messages, props.metadata],
    );

    const summaryLabel = React.useMemo(() => {
      const completedCount = items.filter(
        (i) => i.state === "completed",
      ).length;
      const runningCount = items.filter((i) => i.state === "running").length;
      const errorCount = items.filter((i) => i.state === "error").length;

      const parts = [`${items.length} tools`];
      if (completedCount > 0) parts.push(`${completedCount}✓`);
      if (runningCount > 0) parts.push(`${runningCount}⟳`);
      if (errorCount > 0) parts.push(`${errorCount}✗`);
      if (props.model) {
        const displayModel = props.model.replace(/-\d{8}$/, "");
        parts.push(displayModel);
      }
      if (props.turnTokens !== undefined) {
        const tokenStr = formatTokenCount(props.turnTokens);
        if (
          props.cacheRead !== undefined &&
          props.cacheRead > 0 &&
          props.totalInput !== undefined &&
          props.totalInput > 0
        ) {
          const rate = Math.round((props.cacheRead / props.totalInput) * 100);
          parts.push(`${tokenStr} (↓${rate}%)`);
        } else {
          parts.push(tokenStr);
        }
      }
      return parts.join(" · ");
    }, [
      items,
      props.model,
      props.turnTokens,
      props.cacheRead,
      props.totalInput,
    ]);

    if (items.length === 0) {
      return null;
    }

    if (collapsed) {
      return (
        <View style={styles.outerContainer}>
          <View style={styles.contentWrapper}>
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
          </View>
        </View>
      );
    }

    const maxVisible = 5;
    const displayItems = showAllTools ? items : items.slice(0, maxVisible);
    const remainingCount = showAllTools
      ? 0
      : Math.max(0, items.length - maxVisible);

    return (
      <View style={styles.outerContainer}>
        <View style={styles.contentWrapper}>
          <View style={styles.container}>
            <Pressable
              onPress={() => {
                setCollapsed(true);
                setShowAllTools(false);
              }}
              style={styles.summaryRow}
            >
              <Ionicons
                name="chevron-down"
                size={14}
                color={theme.colors.textSecondary}
              />
              <Text style={styles.summaryText}>{summaryLabel}</Text>
            </Pressable>
            {displayItems.map((item, index) => {
              const isLast =
                index === displayItems.length - 1 && remainingCount <= 0;
              return (
                <Pressable
                  key={item.message.id}
                  style={styles.toolItem}
                  onPress={() => {
                    router.push(
                      `/session/${props.sessionId}/message/${item.message.id}` as any,
                    );
                  }}
                >
                  <Text style={styles.treeLine}>{isLast ? "└─" : "├─"}</Text>
                  <Text style={styles.toolTitle}>{item.title}</Text>
                  <View style={styles.statusContainer}>
                    {item.state === "running" && (
                      <ActivityIndicator
                        size={Platform.OS === "ios" ? "small" : (14 as any)}
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
                </Pressable>
              );
            })}
            {remainingCount > 0 && (
              <Pressable
                style={styles.toolItem}
                onPress={() => setShowAllTools(true)}
              >
                <Text style={styles.treeLine}>└─</Text>
                <Text style={styles.moreToolsText}>
                  {t("tools.taskView.moreTools", {
                    count: remainingCount,
                  })}
                </Text>
              </Pressable>
            )}
            {showAllTools && items.length > maxVisible && (
              <Pressable
                style={styles.toolItem}
                onPress={() => setShowAllTools(false)}
              >
                <Text style={styles.treeLine}>└─</Text>
                <Text style={styles.moreToolsText}>
                  {t("tools.taskView.collapseTools")}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  outerContainer: {
    flexDirection: "row",
    justifyContent: "center",
  },
  contentWrapper: {
    flexDirection: "column",
    flexGrow: 1,
    flexBasis: 0,
    maxWidth: layout.maxWidth,
    marginHorizontal: 8,
  },
  container: {
    paddingVertical: 4,
    paddingBottom: 8,
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
  toolItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 3,
    paddingLeft: 4,
    paddingRight: 2,
  },
  treeLine: {
    fontSize: 14,
    fontFamily: "monospace",
    color: theme.colors.textSecondary,
    opacity: 0.3,
    width: 24,
  },
  toolTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.textSecondary,
    fontFamily: "monospace",
    flex: 1,
  },
  statusContainer: {
    marginLeft: "auto",
    paddingLeft: 8,
  },
  moreToolsText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontStyle: "italic",
    opacity: 0.7,
  },
}));
