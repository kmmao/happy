import * as React from "react";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type {
  WorkflowRunState,
  WorkflowRunStatus,
} from "@/sync/workflow/typesWorkflow";

import { WorkflowAgentRow } from "./WorkflowAgentRow";

interface Props {
  run: WorkflowRunState;
  nowMs: number;
}

function runStatusVisual(
  status: WorkflowRunStatus,
  theme: { colors: Record<string, unknown> },
): {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
} {
  const colors = theme.colors as Record<string, string>;
  switch (status) {
    case "running":
      return {
        icon: "ellipsis-horizontal-circle",
        color: colors.accentBlue,
        label: t("session.workflowStatusRunning"),
      };
    case "completed":
      return {
        icon: "checkmark-circle",
        color: colors.accentPurple,
        label: t("session.workflowStatusCompleted"),
      };
    case "errored":
      return {
        icon: "alert-circle",
        color: colors.warning ?? colors.textSecondary,
        label: t("session.workflowStatusErrored"),
      };
    case "aborted":
    default:
      return {
        icon: "stop-circle",
        color: colors.textSecondary,
        label: t("session.workflowStatusAborted"),
      };
  }
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export const WorkflowRunCard = React.memo<Props>(function WorkflowRunCard({
  run,
  nowMs,
}) {
  const { theme } = useUnistyles();
  const { icon: statusIcon, color: iconColor, label: statusLabel } =
    runStatusVisual(run.status, theme);

  const elapsedMs =
    run.status === "running"
      ? Math.max(0, nowMs - run.startedAt)
      : run.durationMs ?? 0;

  // Agents not attached to any phase render directly under the card root.
  const looseAgentIds = React.useMemo(
    () => run.agentOrder.filter((aid) => !run.agents[aid]?.phase),
    [run.agentOrder, run.agents],
  );

  const displayName = run.name || t("session.workflowUnnamedRun");
  const agentCountForBadge = run.agentCount ?? run.agentOrder.length;

  return (
    <View style={[styles.card, { borderColor: theme.colors.divider }]}>
      <View style={styles.header}>
        <Ionicons name={statusIcon} size={14} color={iconColor} />
        <Text
          style={[styles.title, { color: theme.colors.text }]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <Text style={[styles.elapsed, { color: theme.colors.textSecondary }]}>
          {formatDuration(elapsedMs)}
        </Text>
      </View>
      <View style={styles.subHeader}>
        <Text style={[styles.statusBadge, { color: iconColor }]}>
          {statusLabel}
        </Text>
        {agentCountForBadge > 0 ? (
          <Text style={[styles.muted, { color: theme.colors.textSecondary }]}>
            {t("session.workflowAgentCount", { n: agentCountForBadge })}
          </Text>
        ) : null}
        {run.totalTokens && run.totalTokens > 0 ? (
          <Text style={[styles.muted, { color: theme.colors.textSecondary }]}>
            {t("session.workflowTokensUsed", { n: run.totalTokens })}
          </Text>
        ) : null}
      </View>

      {run.description ? (
        <Text
          style={[styles.description, { color: theme.colors.textSecondary }]}
          numberOfLines={2}
        >
          {run.description}
        </Text>
      ) : null}

      {run.phases.map((phase) => {
        const doneCount = phase.agentIds.filter(
          (aid) => run.agents[aid] && run.agents[aid]!.status !== "running",
        ).length;
        return (
        <View key={`${phase.title}-${phase.index}`} style={styles.phaseBlock}>
          <View style={styles.phaseHeader}>
            <Text
              style={[styles.phaseTitle, { color: theme.colors.text }]}
              numberOfLines={1}
            >
              {phase.title}
            </Text>
            {phase.agentIds.length > 0 ? (
              <Text
                style={[styles.phaseCount, { color: theme.colors.textSecondary }]}
              >
                {`${doneCount}/${phase.agentIds.length}`}
              </Text>
            ) : null}
          </View>
          {phase.agentIds.length === 0 ? (
            <Text
              style={[styles.muted, { color: theme.colors.textSecondary }]}
            >
              {t("session.workflowPendingPhase")}
            </Text>
          ) : (
            phase.agentIds.map((agentId) => {
              const agent = run.agents[agentId];
              if (!agent) return null;
              return (
                <WorkflowAgentRow
                  key={agentId}
                  agent={agent}
                  nowMs={nowMs}
                />
              );
            })
          )}
        </View>
        );
      })}

      {looseAgentIds.length > 0 ? (
        <View style={styles.looseBlock}>
          {looseAgentIds.map((agentId) => {
            const agent = run.agents[agentId];
            if (!agent) return null;
            return (
              <WorkflowAgentRow
                key={agentId}
                agent={agent}
                nowMs={nowMs}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    ...Typography.default("semiBold"),
    fontSize: 14,
    flex: 1,
  },
  elapsed: {
    ...Typography.mono("regular"),
    fontSize: 11,
  },
  subHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  statusBadge: {
    ...Typography.default("semiBold"),
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  muted: {
    ...Typography.default("regular"),
    fontSize: 11,
  },
  description: {
    ...Typography.default("regular"),
    fontSize: 12,
    lineHeight: 16,
  },
  phaseBlock: {
    marginTop: 6,
    gap: 2,
  },
  phaseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  phaseTitle: {
    ...Typography.default("semiBold"),
    fontSize: 12,
    flex: 1,
  },
  phaseCount: {
    ...Typography.mono("regular"),
    fontSize: 10,
  },
  looseBlock: {
    marginTop: 6,
    gap: 2,
  },
});
