import * as React from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type {
  WorkflowAgentState,
  WorkflowAgentStatus,
} from "@/sync/workflow/typesWorkflow";

interface Props {
  agent: WorkflowAgentState;
  nowMs: number;
}

function statusVisual(
  status: WorkflowAgentStatus,
  theme: { colors: Record<string, unknown> },
): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  const colors = theme.colors as Record<string, string>;
  switch (status) {
    case "completed":
      return { icon: "checkmark-circle", color: colors.accentPurple };
    case "running":
      return { icon: "ellipse", color: colors.accentBlue };
    case "errored":
      return {
        icon: "alert-circle",
        color: colors.warning ?? colors.textSecondary,
      };
    case "skipped":
    default:
      return { icon: "remove-circle-outline", color: colors.textSecondary };
  }
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Compact token count: 35900 → "35.9k", 950 → "950". */
function formatTokenCount(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

/** Strip the trailing date suffix from a model id: claude-haiku-4-5-20251001 → claude-haiku-4-5. */
function formatModel(model: string): string {
  return model.replace(/-\d{6,}$/, "");
}

export const WorkflowAgentRow = React.memo<Props>(function WorkflowAgentRow({
  agent,
  nowMs,
}) {
  const { theme } = useUnistyles();
  const [expanded, setExpanded] = React.useState(false);
  const { icon, color: iconColor } = statusVisual(agent.status, theme);

  const elapsedMs =
    agent.status === "running"
      ? Math.max(0, nowMs - agent.startedAt)
      : agent.durationMs ?? 0;

  const label = agent.label ?? agent.agentId.slice(0, 8);
  const hasPreview = !!(agent.outputPreview || agent.errorMessage);

  return (
    <View>
      <Pressable
        onPress={hasPreview ? () => setExpanded((p) => !p) : undefined}
        style={styles.row}
        accessibilityRole={hasPreview ? "button" : undefined}
        accessibilityLabel={label}
      >
        <Ionicons name={icon} size={14} color={iconColor} />
        <Text
          style={[styles.label, { color: theme.colors.text }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {agent.model ? (
          <Text
            style={[styles.model, { color: theme.colors.textSecondary }]}
            numberOfLines={1}
          >
            {formatModel(agent.model)}
          </Text>
        ) : null}
        <Text
          style={[styles.duration, { color: theme.colors.textSecondary }]}
          numberOfLines={1}
        >
          {formatDuration(elapsedMs)}
        </Text>
        {agent.tokens ? (
          <Text
            style={[styles.tokens, { color: theme.colors.textSecondary }]}
            numberOfLines={1}
          >
            {t("session.workflowTokensInline", {
              n: formatTokenCount(agent.tokens.input + agent.tokens.output),
            })}
          </Text>
        ) : null}
        {hasPreview ? (
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={12}
            color={theme.colors.textSecondary}
          />
        ) : null}
      </Pressable>
      {expanded && hasPreview ? (
        <View
          style={[
            styles.previewBlock,
            { borderColor: theme.colors.divider },
          ]}
        >
          {agent.errorMessage ? (
            <Text
              style={[
                styles.previewText,
                { color: theme.colors.warning ?? theme.colors.text },
              ]}
            >
              {agent.errorMessage}
            </Text>
          ) : (
            <Text
              style={[styles.previewText, { color: theme.colors.text }]}
              numberOfLines={6}
            >
              {agent.outputPreview}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  label: {
    ...Typography.default("regular"),
    fontSize: 13,
    flex: 1,
  },
  model: {
    ...Typography.mono("regular"),
    fontSize: 10,
  },
  duration: {
    ...Typography.mono("regular"),
    fontSize: 11,
  },
  tokens: {
    ...Typography.mono("regular"),
    fontSize: 10,
  },
  previewBlock: {
    marginLeft: 22,
    marginVertical: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderLeftWidth: 2,
  },
  previewText: {
    ...Typography.default("regular"),
    fontSize: 12,
    lineHeight: 16,
  },
});
