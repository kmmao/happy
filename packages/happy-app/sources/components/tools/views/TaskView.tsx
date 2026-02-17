import * as React from "react";
import { ToolViewProps } from "./_all";
import {
  Text,
  View,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { knownTools } from "../../tools/knownTools";
import { Ionicons } from "@expo/vector-icons";
import { ToolCall } from "@/sync/typesMessage";
import { useUnistyles } from "react-native-unistyles";
import { useSetting } from "@/sync/storage";
import { t } from "@/text";

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

    // When showAgentActivity is enabled, extract prompt summary and subagent type
    const promptSummary =
      showAgentActivity && tool.input?.prompt
        ? (tool.input.prompt as string).slice(0, 100) +
          ((tool.input.prompt as string).length > 100 ? "..." : "")
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
      promptSummary: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        opacity: 0.7,
        paddingHorizontal: 4,
        paddingBottom: 6,
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
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 4,
        paddingLeft: 4,
        paddingRight: 2,
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
        paddingVertical: 4,
        paddingHorizontal: 4,
      },
      moreToolsText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontStyle: "italic",
        opacity: 0.7,
      },
    });

    if (filtered.length === 0) {
      return null;
    }

    // Show more tools when activity mode is enabled
    const maxVisible = showAgentActivity ? 6 : 3;
    const visibleTools = filtered.slice(filtered.length - maxVisible);
    const remainingCount = filtered.length - maxVisible;

    return (
      <View style={styles.container}>
        {subagentType && (
          <Text style={styles.subagentType} numberOfLines={1}>
            {t("tools.taskView.subagentRunning", { type: subagentType })}
          </Text>
        )}
        {promptSummary && (
          <Text style={styles.promptSummary} numberOfLines={2}>
            {promptSummary}
          </Text>
        )}
        {visibleTools.map((item, index) => (
          <View key={`${item.tool.name}-${index}`} style={styles.toolItem}>
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
          </View>
        ))}
        {remainingCount > 0 && (
          <View style={styles.moreToolsItem}>
            <Text style={styles.moreToolsText}>
              {t("tools.taskView.moreTools", { count: remainingCount })}
            </Text>
          </View>
        )}
      </View>
    );
  },
);
