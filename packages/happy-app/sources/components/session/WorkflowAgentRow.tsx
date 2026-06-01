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

/** Render a scalar (or compact-JSON for nested containers) to a string. */
function scalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** One array item → a single readable line. */
function itemToLine(item: unknown): string {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.entries(item as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${scalar(val)}`)
      .join(" · ");
  }
  if (Array.isArray(item)) return item.map(scalar).join(", ");
  return String(item);
}

/** A field value → one or more display lines. */
function valueToLines(v: unknown): string[] {
  if (v === null || v === undefined) return ["—"];
  if (Array.isArray(v)) {
    return v.length === 0 ? ["—"] : v.map(itemToLine);
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${k}: ${scalar(val)}`,
    );
  }
  return [String(v)];
}

type ParsedOutput =
  | { kind: "table"; entries: [string, unknown][] }
  | { kind: "text"; text: string };

/** Decide how to render the full output: a key/value table for JSON objects,
 *  otherwise plain (full) text. */
function parseOutput(full?: string, preview?: string): ParsedOutput | null {
  const raw = full ?? preview;
  if (!raw) return null;
  if (full) {
    try {
      const obj = JSON.parse(full);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return { kind: "table", entries: Object.entries(obj) };
      }
      // Arrays / primitives: pretty-print so they stay readable.
      return { kind: "text", text: JSON.stringify(obj, null, 2) };
    } catch {
      // Not JSON — show the raw full text.
      return { kind: "text", text: full };
    }
  }
  return { kind: "text", text: raw };
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
  const parsed = React.useMemo(
    () => parseOutput(agent.outputFull, agent.outputPreview),
    [agent.outputFull, agent.outputPreview],
  );
  const hasPreview = !!(parsed || agent.errorMessage);

  return (
    <View>
      <Pressable
        onPress={hasPreview ? () => setExpanded((p) => !p) : undefined}
        style={styles.row}
        accessibilityRole={hasPreview ? "button" : undefined}
        accessibilityLabel={label}
      >
        <Ionicons name={icon} size={14} color={iconColor} style={styles.icon} />
        <View style={styles.body}>
          <View style={styles.labelLine}>
            <Text
              style={[styles.label, { color: theme.colors.text }]}
              numberOfLines={2}
            >
              {label}
            </Text>
            {hasPreview ? (
              <Ionicons
                name={expanded ? "chevron-down" : "chevron-forward"}
                size={12}
                color={theme.colors.textSecondary}
                style={styles.chevron}
              />
            ) : null}
          </View>
          {/* Meta moves to a wrapping sub-row so a long label never squeezes
              model/duration/token off-screen. */}
          <View style={styles.metaLine}>
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
          </View>
        </View>
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
          ) : parsed?.kind === "table" ? (
            <View style={styles.table}>
              {parsed.entries.map(([key, value]) => (
                <View key={key} style={styles.tableRow}>
                  <Text
                    style={[styles.tableKey, { color: theme.colors.textSecondary }]}
                  >
                    {key}
                  </Text>
                  <View style={styles.tableValue}>
                    {valueToLines(value).map((line, i) => (
                      <Text
                        key={i}
                        style={[styles.previewText, { color: theme.colors.text }]}
                      >
                        {line}
                      </Text>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : parsed ? (
            <Text
              selectable
              style={[styles.previewText, { color: theme.colors.text }]}
            >
              {parsed.text}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 4,
  },
  icon: {
    marginTop: 2,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  labelLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  chevron: {
    marginTop: 3,
  },
  label: {
    ...Typography.default("regular"),
    fontSize: 13,
    flex: 1,
  },
  metaLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
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
  table: {
    gap: 6,
  },
  tableRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  tableKey: {
    ...Typography.mono("regular"),
    fontSize: 11,
    width: 96,
    flexShrink: 0,
  },
  tableValue: {
    flex: 1,
    gap: 1,
  },
});
