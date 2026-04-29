import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useAuth } from "@/auth/AuthContext";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { screenLayoutMaxWidth } from "@/components/layout";
import { UsageChart } from "./UsageChart";
import { UsageBar } from "./UsageBar";
import {
  getUsageForPeriod,
  calculateTotals,
  UsageDataPoint,
} from "@/sync/apiUsage";
import { Ionicons } from "@expo/vector-icons";
import { HappyError } from "@/utils/errors";
import { t } from "@/text";
import { SharedStateView } from "@/components/SharedStateView";

type TimePeriod = "today" | "7days" | "30days";

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
  },
  periodSelector: {
    flexDirection: "row",
    padding: 16,
    gap: 8,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
  },
  periodButtonActive: {
    backgroundColor: "#007AFF",
  },
  periodText: {
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: "500",
  },
  periodTextActive: {
    color: "#FFFFFF",
  },
  statsWrapper: {
    alignItems: "center",
  },
  statsConstraint: {
    width: "100%",
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
    paddingHorizontal: Platform.select({ ios: 0, default: 4 }),
  },
  statsContainer: {
    padding: 16,
    backgroundColor: theme.colors.surface,
    margin: 16,
    borderRadius: 12,
    gap: 12,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statLabel: {
    fontSize: 16,
    color: theme.colors.text,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text,
  },
  chartSection: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.text,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  errorContainer: {
    padding: 32,
    alignItems: "center",
  },
  errorText: {
    fontSize: 14,
    color: theme.colors.status.error,
    textAlign: "center",
  },
  metricToggle: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    padding: 16,
  },
  metricButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: theme.colors.divider,
  },
  metricButtonActive: {
    backgroundColor: "#007AFF",
  },
  metricText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontWeight: "500",
  },
  metricTextActive: {
    color: "#FFFFFF",
  },
  breakdownRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: Platform.select({ ios: 0, default: 4 }),
  },
  breakdownColumn: {
    flex: 1,
  },
}));

// Re-export for backward compatibility — canonical source is modelModeOptions.ts
import { formatModelName } from "@/components/modelModeOptions";
import { log } from '@/log';

const TOKEN_TYPE_LABELS: Record<string, string> = {
  input: "Input",
  output: "Output",
  cache_read: "Cache Read",
  cache_creation: "Cache Write",
  total: "Total",
};

function formatTokenType(type: string): string {
  return (
    TOKEN_TYPE_LABELS[type] ??
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export const UsagePanel: React.FC<{ sessionId?: string }> = ({ sessionId }) => {
  const { theme } = useUnistyles();
  const auth = useAuth();
  const [period, setPeriod] = useState<TimePeriod>("7days");
  const [chartMetric, setChartMetric] = useState<"tokens" | "cost">("tokens");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageDataPoint[]>([]);
  const [totals, setTotals] = useState({
    totalTokens: 0,
    totalCost: 0,
    tokensByType: {} as Record<string, number>,
    tokensByModel: {} as Record<string, number>,
    costByType: {} as Record<string, number>,
    costByModel: {} as Record<string, number>,
  });

  useEffect(() => {
    loadUsageData();
  }, [period, sessionId]);

  const loadUsageData = async () => {
    if (!auth.credentials) {
      setError(t("errors.authenticationFailed"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await getUsageForPeriod(
        auth.credentials,
        period,
        sessionId,
      );
      setUsageData(response.usage || []);
      setTotals(calculateTotals(response.usage || []));
    } catch (err) {
      log.error("Failed to load usage data:", err);
      if (err instanceof HappyError) {
        setError(err.message);
      } else {
        setError(t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(2)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toLocaleString();
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(4)}`;
  };

  const periodLabels: Record<TimePeriod, string> = {
    today: t("usage.today"),
    "7days": t("usage.last7Days"),
    "30days": t("usage.last30Days"),
  };

  if (loading) {
    return (
      <SharedStateView kind="loading" title={t("common.loading")} />
    );
  }

  if (error) {
    return (
      <SharedStateView
        kind="error"
        title={t("common.error")}
        description={error}
        onAction={() => {
          void loadUsageData();
        }}
      />
    );
  }

  if (usageData.length === 0) {
    return (
      <SharedStateView
        kind="empty"
        title={t("usage.noData")}
        icon={
          <Ionicons
            name="bar-chart-outline"
            size={36}
            color={theme.colors.textSecondary}
          />
        }
      />
    );
  }

  // Get token breakdown by type (cache_read, cache_creation, input, output)
  const tokenTypes = Object.entries(totals.tokensByType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const maxTypeTokens = Math.max(...Object.values(totals.tokensByType), 1);

  // Get token breakdown by model (claude-opus-4-6, etc.)
  const tokenModels = Object.entries(totals.tokensByModel)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const maxModelTokens = Math.max(...Object.values(totals.tokensByModel), 1);

  // Get cost breakdown by model
  const costModels = Object.entries(totals.costByModel)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const maxModelCost = Math.max(...Object.values(totals.costByModel), 0.0001);

  return (
    <ScrollView style={styles.container}>
      {/* Period Selector */}
      <View style={styles.statsWrapper}>
        <View style={styles.statsConstraint}>
          <View style={styles.periodSelector}>
            {(["today", "7days", "30days"] as TimePeriod[]).map((p) => (
              <Pressable
                key={p}
                style={[
                  styles.periodButton,
                  period === p && styles.periodButtonActive,
                ]}
                onPress={() => setPeriod(p)}
              >
                <Text
                  style={[
                    styles.periodText,
                    period === p && styles.periodTextActive,
                  ]}
                >
                  {periodLabels[p]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* Summary Stats */}
      <View style={styles.statsWrapper}>
        <View style={styles.statsConstraint}>
          <View style={styles.statsContainer}>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>{t("usage.totalTokens")}</Text>
              <Text style={styles.statValue}>
                {formatTokens(totals.totalTokens)}
              </Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>{t("usage.totalCost")}</Text>
              <Text style={styles.statValue}>
                {formatCost(totals.totalCost)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Usage Chart */}
      {usageData.length > 0 && (
        <View style={styles.statsWrapper}>
          <View style={styles.statsConstraint}>
            <View style={styles.chartSection}>
              <Text style={styles.sectionTitle}>
                {t("usage.usageOverTime")}
              </Text>

              {/* Metric Toggle */}
              <View style={styles.metricToggle}>
                <Pressable
                  style={[
                    styles.metricButton,
                    chartMetric === "tokens" && styles.metricButtonActive,
                  ]}
                  onPress={() => setChartMetric("tokens")}
                >
                  <Text
                    style={[
                      styles.metricText,
                      chartMetric === "tokens" && styles.metricTextActive,
                    ]}
                  >
                    {t("usage.tokens")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.metricButton,
                    chartMetric === "cost" && styles.metricButtonActive,
                  ]}
                  onPress={() => setChartMetric("cost")}
                >
                  <Text
                    style={[
                      styles.metricText,
                      chartMetric === "cost" && styles.metricTextActive,
                    ]}
                  >
                    {t("usage.cost")}
                  </Text>
                </Pressable>
              </View>

              <UsageChart
                data={usageData}
                metric={chartMetric}
                groupBy={period === "today" ? "hour" : "day"}
                height={180}
              />
            </View>
          </View>
        </View>
      )}

      {/* Usage by model & token type - side by side */}
      {(tokenModels.length > 0 || tokenTypes.length > 0) && (
        <View style={styles.statsWrapper}>
          <View style={styles.statsConstraint}>
            <View style={styles.breakdownRow}>
              {tokenModels.length > 0 && (
                <ItemGroup
                  title={t("usage.byModel")}
                  style={styles.breakdownColumn}
                >
                  <View style={{ padding: 16 }}>
                    {(chartMetric === "tokens" ? tokenModels : costModels).map(
                      ([model, value]) => (
                        <UsageBar
                          key={model}
                          label={formatModelName(model)}
                          value={value}
                          maxValue={
                            chartMetric === "tokens"
                              ? maxModelTokens
                              : maxModelCost
                          }
                          color="#007AFF"
                          formatValue={
                            chartMetric === "cost"
                              ? (v) => formatCost(v)
                              : (v) => formatTokens(v)
                          }
                        />
                      ),
                    )}
                  </View>
                </ItemGroup>
              )}

              {tokenTypes.length > 0 && (
                <ItemGroup
                  title={t("usage.byTokenType")}
                  style={styles.breakdownColumn}
                >
                  <View style={{ padding: 16 }}>
                    {tokenTypes.map(([type, tokens]) => (
                      <UsageBar
                        key={type}
                        label={formatTokenType(type)}
                        value={tokens}
                        maxValue={maxTypeTokens}
                        color="#007AFF"
                        formatValue={(v) => formatTokens(v)}
                      />
                    ))}
                  </View>
                </ItemGroup>
              )}
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
};
