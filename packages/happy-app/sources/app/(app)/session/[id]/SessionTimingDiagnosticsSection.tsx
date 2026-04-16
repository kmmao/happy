import * as React from "react";
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";

import { CodeView } from "@/components/CodeView";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { Modal } from "@/modal";
import { Session } from "@/sync/storageTypes";
import { Message } from "@/sync/typesMessage";
import { t } from "@/text";
import { getSessionName, getSessionProviderLabel } from "@/utils/sessionUtils";
import {
  buildSessionTimingDiagnosticsExport,
  buildSessionTimingDiagnosticsReport,
  SessionTimingMetricSummary,
} from "./sessionTimingDiagnostics";
import {
  getSessionTimingDiagnosisAction,
  getSessionTimingDiagnosisHint,
  getSessionTimingDiagnosisLabel,
} from "../sessionTimingDiagnosisText";

function formatMs(value: number | null): string {
  if (value == null) {
    return t("sessionInfo.requestTimingUnavailable");
  }
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatMetricSummary(summary: SessionTimingMetricSummary): string {
  if (summary.sampleCount === 0) {
    return t("sessionInfo.requestTimingUnavailable");
  }
  return t("sessionInfo.requestTimingP50P95", {
    p50: formatMs(summary.p50Ms),
    p95: formatMs(summary.p95Ms),
  });
}

function shortenRequestId(requestId: string | undefined): string {
  if (!requestId) {
    return "—";
  }
  if (requestId.length <= 14) {
    return requestId;
  }
  return `${requestId.slice(0, 8)}...${requestId.slice(-4)}`;
}

type SessionTimingDiagnosticsSectionProps = {
  enabled: boolean;
  session: Session;
  messages: Message[];
};

export const SessionTimingDiagnosticsSection = React.memo<SessionTimingDiagnosticsSectionProps>(
  function SessionTimingDiagnosticsSection({ enabled, session, messages }) {
    const router = useRouter();
    const report = React.useMemo(
      () => buildSessionTimingDiagnosticsReport(messages),
      [messages],
    );
    const handleCopyReport = React.useCallback(async () => {
      if (!report) {
        return;
      }

      try {
        const payload = buildSessionTimingDiagnosticsExport({
          sessionId: session.id,
          sessionName: getSessionName(session),
          providerLabel: getSessionProviderLabel(session),
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
    }, [report, session]);

    if (!enabled) {
      return null;
    }

    if (!report) {
      return (
        <ItemGroup
          title={t("sessionInfo.requestTimingAnalysis")}
          footer={t("sessionInfo.requestTimingClockNote")}
        >
          <Item
            title={t("sessionInfo.requestTimingAnalysisHint")}
            subtitle={t("sessionInfo.requestTimingAnalysisEmpty")}
            icon={<Ionicons name="analytics-outline" size={29} color="#5856D6" />}
            showChevron={false}
          />
        </ItemGroup>
      );
    }

    const latestTurn = report.latestTurn;
    const latestSubtitle = [
      new Date(latestTurn.createdAt).toLocaleString(),
      latestTurn.provider ?? undefined,
      latestTurn.model ?? undefined,
      latestTurn.requestIds[0]
        ? shortenRequestId(latestTurn.requestIds[0])
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <ItemGroup
        title={t("sessionInfo.requestTimingAnalysis")}
        footer={t("sessionInfo.requestTimingClockNote")}
      >
        <Item
          title={t("sessionInfo.requestTimingAnalyzedTurns")}
          detail={String(report.turnCount)}
          icon={<Ionicons name="layers-outline" size={29} color="#007AFF" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingCorrelatedTurns")}
          detail={`${report.correlatedTurnCount}/${report.turnCount}`}
          icon={<Ionicons name="link-outline" size={29} color="#34C759" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingSocketToQueue")}
          subtitle={formatMetricSummary(report.socketToQueue)}
          detail={formatMs(report.socketToQueue.averageMs)}
          icon={<Ionicons name="swap-horizontal-outline" size={29} color="#5AC8FA" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingTtft")}
          subtitle={t("sessionInfo.requestTimingP50P95", {
            p50: formatMs(report.ttft.p50Ms),
            p95: formatMs(report.ttft.p95Ms),
          })}
          detail={formatMs(report.ttft.averageMs)}
          icon={<Ionicons name="flash-outline" size={29} color="#FF9500" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingQueueWait")}
          subtitle={formatMetricSummary(report.queueWait)}
          detail={formatMs(report.queueWait.averageMs)}
          icon={<Ionicons name="git-network-outline" size={29} color="#AF52DE" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingGenerationTail")}
          subtitle={formatMetricSummary(report.generationTail)}
          detail={formatMs(report.generationTail.averageMs)}
          icon={<Ionicons name="pulse-outline" size={29} color="#FFCC00" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingTurnDuration")}
          subtitle={formatMetricSummary(report.turnDuration)}
          detail={formatMs(report.turnDuration.averageMs)}
          icon={<Ionicons name="timer-outline" size={29} color="#FF3B30" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingLatestTurn")}
          subtitle={latestSubtitle || t("sessionInfo.requestTimingUnavailable")}
          detail={formatMs(latestTurn.turnDurationMs)}
          icon={<Ionicons name="sparkles-outline" size={29} color="#5856D6" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingLikelyIssue")}
          subtitle={getSessionTimingDiagnosisHint(report.primaryDiagnosis.code)}
          detail={getSessionTimingDiagnosisLabel(report.primaryDiagnosis.code)}
          icon={<Ionicons name="search-outline" size={29} color="#FF9500" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingSuggestedChecks")}
          subtitle={getSessionTimingDiagnosisAction(report.primaryDiagnosis.code)}
          icon={<Ionicons name="construct-outline" size={29} color="#34C759" />}
          showChevron={false}
        />
        <Item
          title={t("sessionInfo.requestTimingCopyReport")}
          subtitle={t("sessionInfo.requestTimingCopyReportSubtitle")}
          icon={<Ionicons name="copy-outline" size={29} color="#007AFF" />}
          onPress={handleCopyReport}
        />
        <Item
          title={t("sessionInfo.requestTimingOverview")}
          subtitle={t("sessionInfo.requestTimingOverviewSubtitle")}
          icon={<Ionicons name="analytics-outline" size={29} color="#5856D6" />}
          onPress={() => router.push("/session/timing")}
        />
        <Item
          title={t("sessionInfo.requestTimingRecentTurns")}
          icon={<Ionicons name="code-working-outline" size={29} color="#8E8E93" />}
          showChevron={false}
        />
        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
          <CodeView
            code={JSON.stringify(report.recentTurns, null, 2)}
            language="json"
          />
        </View>
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <Text
            style={{
              color: "#8E8E93",
              fontSize: 12,
              lineHeight: 18,
              ...Typography.default(),
            }}
          >
            {t("sessionInfo.requestTimingAverages", {
              ttft: formatMs(report.ttft.averageMs),
              queueWait: formatMs(report.queueWait.averageMs),
              socketToQueue: formatMs(report.socketToQueue.averageMs),
              generationTail: formatMs(report.generationTail.averageMs),
              duration: formatMs(report.turnDuration.averageMs),
            })}
          </Text>
        </View>
      </ItemGroup>
    );
  },
);
