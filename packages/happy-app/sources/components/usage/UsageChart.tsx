import React from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { UsageDataPoint } from "@/sync/apiUsage";

interface UsageChartProps {
  data: UsageDataPoint[];
  metric: "tokens" | "cost";
  groupBy: "hour" | "day";
  height?: number;
  onBarPress?: (dataPoint: UsageDataPoint, index: number) => void;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    marginVertical: 16,
  },
  chartContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  barWrapper: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 2,
  },
  bar: {
    width: "100%",
    borderRadius: 4,
    minHeight: 2,
  },
  barValue: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginBottom: 4,
    fontWeight: "600",
  },
  barLabel: {
    position: "absolute",
    bottom: -20,
    fontSize: 9,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  emptyState: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
}));

export const UsageChart: React.FC<UsageChartProps> = ({
  data,
  metric,
  groupBy,
  height = 200,
  onBarPress,
}) => {
  const { theme } = useUnistyles();

  if (!data || data.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No usage data available</Text>
      </View>
    );
  }

  // Calculate max value for scaling - use 'total' key to avoid double counting
  const getValueForDataPoint = (point: UsageDataPoint): number => {
    if (metric === "tokens") {
      return typeof point.tokens.total === "number" ? point.tokens.total : 0;
    } else {
      return typeof point.cost.total === "number" ? point.cost.total : 0;
    }
  };

  const maxValue = Math.max(...data.map(getValueForDataPoint), 1);

  // Format date label based on groupBy
  const formatLabel = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    if (groupBy === "hour") {
      return date.toLocaleTimeString("en-US", { hour: "numeric" });
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // Format value for display
  const formatValue = (value: number): string => {
    if (metric === "cost") {
      return `$${value.toFixed(2)}`;
    } else if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    } else {
      return value.toFixed(0);
    }
  };

  // Limit bars to show (for better visibility)
  const maxBarsToShow = 31;
  const displayData =
    data.length > maxBarsToShow ? data.slice(-maxBarsToShow) : data;

  // Determine label frequency to avoid crowding
  // Show every label for ≤10 bars, every other for ≤20, every 3rd for more
  const labelInterval =
    displayData.length <= 10 ? 1 : displayData.length <= 20 ? 2 : 3;

  // Tighter spacing when there are many bars
  const barMargin = displayData.length > 15 ? 1 : 2;

  const chartContent = (
    <View style={[styles.chartContainer, { height }]}>
      {displayData.map((point, index) => {
        const value = getValueForDataPoint(point);
        // Reserve space at top for value label text (~18px)
        const maxBarHeight = height - 20;
        const barHeight = (value / maxValue) * maxBarHeight;
        const showValue = value > 0 && barHeight > 20;
        const showLabel =
          index % labelInterval === 0 || index === displayData.length - 1;

        return (
          <Pressable
            key={`${point.timestamp}-${index}`}
            style={[styles.barWrapper, { marginHorizontal: barMargin }]}
            onPress={() => onBarPress?.(point, index)}
          >
            {showValue && (
              <Text style={styles.barValue}>{formatValue(value)}</Text>
            )}
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(barHeight, 2),
                  backgroundColor: metric === "cost" ? "#FF9500" : "#007AFF",
                },
              ]}
            />
            {showLabel && (
              <Text style={styles.barLabel}>
                {formatLabel(point.timestamp)}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );

  return <View style={styles.container}>{chartContent}</View>;
};
