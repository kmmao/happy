import * as React from "react";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Modal } from "@/modal";
import { storage, useAllSessions, useSetting } from "@/sync/storage";
import { t } from "@/text";
import {
  buildSessionTimingOverviewExport,
  buildSessionTimingOverviewReport,
} from "./sessionTimingOverview";
import {
  getSessionTimingDiagnosisAction,
  getSessionTimingDiagnosisHint,
  getSessionTimingDiagnosisLabel,
} from "./sessionTimingDiagnosisText";

function formatMs(value: number | null): string {
  if (value == null) {
    return t("sessionInfo.requestTimingUnavailable");
  }
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatMetricSummary(input: {
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
}): string {
  if (input.sampleCount === 0) {
    return t("sessionInfo.requestTimingUnavailable");
  }
  return t("sessionInfo.requestTimingP50P95", {
    p50: formatMs(input.p50Ms),
    p95: formatMs(input.p95Ms),
  });
}

function formatDiagnosisDistribution(input: {
  low_confidence: number;
  queue_wait: number;
  ttft: number;
  generation_tail: number;
  balanced: number;
}): string {
  return [
    input.queue_wait > 0
      ? `${getSessionTimingDiagnosisLabel("queue_wait")} ${input.queue_wait}`
      : null,
    input.ttft > 0 ? `${getSessionTimingDiagnosisLabel("ttft")} ${input.ttft}` : null,
    input.generation_tail > 0
      ? `${getSessionTimingDiagnosisLabel("generation_tail")} ${input.generation_tail}`
      : null,
    input.balanced > 0
      ? `${getSessionTimingDiagnosisLabel("balanced")} ${input.balanced}`
      : null,
    input.low_confidence > 0
      ? `${getSessionTimingDiagnosisLabel("low_confidence")} ${input.low_confidence}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default React.memo(function SessionTimingOverviewScreen() {
  const router = useRouter();
  const enabled = useSetting("requestTimingDiagnostics");
  const sessions = useAllSessions();
  const sessionMessages = storage((state) => state.sessionMessages);

  const report = React.useMemo(
    () =>
      enabled
        ? buildSessionTimingOverviewReport({
            sessions,
            sessionMessages,
          })
        : null,
    [enabled, sessionMessages, sessions],
  );

  const handleCopyReport = React.useCallback(async () => {
    if (!report) {
      return;
    }

    try {
      const payload = buildSessionTimingOverviewExport({
        exportedAtMs: Date.now(),
        report,
      });
      await Clipboard.setStringAsync(JSON.stringify(payload, null, 2));
      Modal.toast(t("sessionInfo.requestTimingReportCopied"));
    } catch {
      Modal.alert(
        t("common.error"),
        t("sessionInfo.requestTimingReportCopyFailed"),
      );
    }
  }, [report]);

  if (!enabled) {
    return (
      <ItemList>
        <ItemGroup title={t("sessionInfo.requestTimingOverview")}>
          <Item
            title={t("sessionInfo.requestTimingEnableDiagnostics")}
            subtitle={t("sessionInfo.requestTimingEnableDiagnosticsSubtitle")}
            icon={<Ionicons name="flask-outline" size={29} color="#5856D6" />}
            onPress={() => router.push("/settings/features")}
          />
        </ItemGroup>
      </ItemList>
    );
  }

  if (!report) {
    return (
      <ItemList>
        <ItemGroup title={t("sessionInfo.requestTimingOverview")}>
          <Item
            title={t("sessionInfo.requestTimingAnalysis")}
            subtitle={t("sessionInfo.requestTimingOverviewEmpty")}
            icon={<Ionicons name="analytics-outline" size={29} color="#5856D6" />}
            showChevron={false}
          />
        </ItemGroup>
      </ItemList>
    );
  }

  return (
    <ItemList>
      <ItemGroup
        title={t("sessionInfo.requestTimingOverview")}
        footer={t("sessionInfo.requestTimingClockNote")}
      >
        <Item
          title={t("sessionInfo.requestTimingTrackedSessions")}
          detail={`${report.analyzedSessionCount}/${report.totalSessionCount}`}
          icon={<Ionicons name="albums-outline" size={29} color="#007AFF" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingTrackedModels")}
          detail={String(report.trackedModelCount)}
          icon={<Ionicons name="layers-outline" size={29} color="#34C759" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingAnalyzedTurns")}
          detail={String(report.totalTurnCount)}
          icon={<Ionicons name="swap-vertical-outline" size={29} color="#FF9500" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingCorrelatedTurns")}
          detail={`${report.correlatedTurnCount}/${report.totalTurnCount}`}
          icon={<Ionicons name="link-outline" size={29} color="#AF52DE" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingOverallDiagnosis")}
          subtitle={getSessionTimingDiagnosisHint(report.overall.primaryDiagnosis.code)}
          detail={getSessionTimingDiagnosisLabel(report.overall.primaryDiagnosis.code)}
          icon={<Ionicons name="search-outline" size={29} color="#FF9500" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingSuggestedChecks")}
          subtitle={getSessionTimingDiagnosisAction(report.overall.primaryDiagnosis.code)}
          icon={<Ionicons name="construct-outline" size={29} color="#34C759" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingDiagnosisDistribution")}
          subtitle={formatDiagnosisDistribution(report.diagnosisCounts)}
          icon={<Ionicons name="pie-chart-outline" size={29} color="#8E8E93" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingSocketToQueue")}
          subtitle={formatMetricSummary(report.overall.socketToQueue)}
          detail={formatMs(report.overall.socketToQueue.averageMs)}
          icon={<Ionicons name="swap-horizontal-outline" size={29} color="#5AC8FA" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingTtft")}
          subtitle={formatMetricSummary(report.overall.ttft)}
          detail={formatMs(report.overall.ttft.averageMs)}
          icon={<Ionicons name="flash-outline" size={29} color="#FF9500" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingQueueWait")}
          subtitle={formatMetricSummary(report.overall.queueWait)}
          detail={formatMs(report.overall.queueWait.averageMs)}
          icon={<Ionicons name="git-network-outline" size={29} color="#AF52DE" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingGenerationTail")}
          subtitle={formatMetricSummary(report.overall.generationTail)}
          detail={formatMs(report.overall.generationTail.averageMs)}
          icon={<Ionicons name="pulse-outline" size={29} color="#FFCC00" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingTurnDuration")}
          subtitle={formatMetricSummary(report.overall.turnDuration)}
          detail={formatMs(report.overall.turnDuration.averageMs)}
          icon={<Ionicons name="timer-outline" size={29} color="#FF3B30" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingCopyOverviewReport")}
          subtitle={t("sessionInfo.requestTimingCopyOverviewReportSubtitle")}
          icon={<Ionicons name="copy-outline" size={29} color="#007AFF" />}
          onPress={handleCopyReport}
        />
      </ItemGroup>

      <ItemGroup title={t("sessionInfo.requestTimingTrackedModels")}>
        {report.models.slice(0, 8).map((bucket) => (
          <Item
            key={bucket.key}
            title={bucket.model ?? t("sessionInfo.requestTimingUnavailable")}
            subtitle={[
              bucket.providerLabel,
              getSessionTimingDiagnosisLabel(bucket.primaryDiagnosis.code),
              `${t("sessionInfo.requestTimingTtft")} ${formatMs(bucket.ttft.p95Ms)}`,
              `${t("sessionInfo.requestTimingTurnDuration")} ${formatMs(
                bucket.turnDuration.p95Ms,
              )}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            detail={t("sessionInfo.requestTimingTurnsCount", {
              count: bucket.turnCount,
            })}
            icon={<Ionicons name="hardware-chip-outline" size={29} color="#5856D6" />}
            showChevron={false}
          />
        ))}
      </ItemGroup>

      <ItemGroup title={t("sessionInfo.requestTimingTrackedSessions")}>
        {report.sessions.slice(0, 10).map((entry) => (
          <Item
            key={entry.sessionId}
            title={entry.sessionName}
            subtitle={[
              entry.providerLabel,
              entry.latestModel ?? undefined,
              getSessionTimingDiagnosisLabel(entry.primaryDiagnosis.code),
              `${t("sessionInfo.requestTimingTtft")} ${formatMs(entry.ttft.p95Ms)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            detail={t("sessionInfo.requestTimingTurnsCount", {
              count: entry.turnCount,
            })}
            icon={<Ionicons name="terminal-outline" size={29} color="#007AFF" />}
            onPress={() => router.push(`/session/${entry.sessionId}/info`)}
          />
        ))}
      </ItemGroup>
    </ItemList>
  );
});
