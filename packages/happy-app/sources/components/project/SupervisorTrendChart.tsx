import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { TrendPoint } from "@/sync/apiSupervisor";
import type { TranslationKey } from "@/text";

const SEVERITY_COLORS = {
    critical: "#FF3B30",
    high: "#FF9500",
    medium: "#FFCC00",
    low: "#34C759",
} as const;

const SCORE_COLOR = "#007AFF";

export const SupervisorTrendChart = React.memo(
    ({ points }: { points: TrendPoint[] }) => {
        const { theme } = useUnistyles();
        const maxTotal = Math.max(...points.map((p) => p.total), 1);
        const hasScores = points.some((p) => p.score != null);
        const maxScore = hasScores
            ? Math.max(...points.filter((p) => p.score != null).map((p) => p.score!), 1)
            : 1;

        return (
            <View style={styles.trendCard}>
                <View style={styles.trendChartContainer}>
                    {points.map((point, index) => {
                        const barHeight = (point.total / maxTotal) * 120;
                        const date = new Date(point.date);
                        const label = `${date.getMonth() + 1}/${date.getDate()}`;

                        // Score dot position (relative to bar area height of 120)
                        const scoreDotBottom =
                            hasScores && point.score != null
                                ? (point.score / maxScore) * 110 + 5
                                : null;

                        return (
                            <View key={index} style={styles.trendBarColumn}>
                                <View style={styles.barWithScore}>
                                    {/* Score dot */}
                                    {scoreDotBottom != null && (
                                        <View
                                            style={[
                                                styles.scoreDot,
                                                { bottom: scoreDotBottom },
                                            ]}
                                        />
                                    )}
                                    {/* Severity bar */}
                                    <View
                                        style={[
                                            styles.trendBarStack,
                                            { height: barHeight },
                                        ]}
                                    >
                                        {point.critical > 0 && (
                                            <View
                                                style={{
                                                    height:
                                                        (point.critical /
                                                            point.total) *
                                                        barHeight,
                                                    backgroundColor:
                                                        SEVERITY_COLORS.critical,
                                                    borderTopLeftRadius:
                                                        point.high === 0 &&
                                                        point.medium === 0 &&
                                                        point.low === 0
                                                            ? 3
                                                            : 0,
                                                    borderTopRightRadius:
                                                        point.high === 0 &&
                                                        point.medium === 0 &&
                                                        point.low === 0
                                                            ? 3
                                                            : 0,
                                                }}
                                            />
                                        )}
                                        {point.high > 0 && (
                                            <View
                                                style={{
                                                    height:
                                                        (point.high / point.total) *
                                                        barHeight,
                                                    backgroundColor:
                                                        SEVERITY_COLORS.high,
                                                }}
                                            />
                                        )}
                                        {point.medium > 0 && (
                                            <View
                                                style={{
                                                    height:
                                                        (point.medium /
                                                            point.total) *
                                                        barHeight,
                                                    backgroundColor:
                                                        SEVERITY_COLORS.medium,
                                                }}
                                            />
                                        )}
                                        {point.low > 0 && (
                                            <View
                                                style={{
                                                    height:
                                                        (point.low / point.total) *
                                                        barHeight,
                                                    backgroundColor:
                                                        SEVERITY_COLORS.low,
                                                    borderBottomLeftRadius: 3,
                                                    borderBottomRightRadius: 3,
                                                }}
                                            />
                                        )}
                                    </View>
                                </View>
                                <Text style={styles.trendBarLabel}>
                                    {label}
                                </Text>
                            </View>
                        );
                    })}
                </View>
                {/* Legend */}
                <View style={styles.trendLegend}>
                    {(
                        Object.entries(SEVERITY_COLORS) as [string, string][]
                    ).map(([key, color]) => (
                        <View key={key} style={styles.trendLegendItem}>
                            <View
                                style={[
                                    styles.trendLegendDot,
                                    { backgroundColor: color },
                                ]}
                            />
                            <Text style={styles.trendLegendText}>
                                {t(
                                    `supervisor.severity${key.charAt(0).toUpperCase() + key.slice(1)}` as TranslationKey,
                                )}
                            </Text>
                        </View>
                    ))}
                    {hasScores && (
                        <View style={styles.trendLegendItem}>
                            <View
                                style={[
                                    styles.trendLegendDot,
                                    { backgroundColor: SCORE_COLOR },
                                ]}
                            />
                            <Text style={styles.trendLegendText}>
                                {t("supervisor.healthScore")}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    trendCard: {
        padding: 16,
        gap: 12,
    },
    trendChartContainer: {
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-around",
        height: 140,
        paddingTop: 20,
    },
    trendBarColumn: {
        alignItems: "center",
        flex: 1,
        gap: 4,
    },
    barWithScore: {
        position: "relative",
        justifyContent: "flex-end",
        alignItems: "center",
        height: 120,
    },
    scoreDot: {
        position: "absolute",
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: SCORE_COLOR,
        zIndex: 1,
    },
    trendBarStack: {
        width: 20,
        justifyContent: "flex-end",
        overflow: "hidden",
        borderRadius: 3,
    },
    trendBarLabel: {
        ...Typography.default(),
        fontSize: 10,
        color: theme.colors.textSecondary,
    },
    trendLegend: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 16,
        flexWrap: "wrap",
    },
    trendLegendItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    trendLegendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    trendLegendText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
}));
