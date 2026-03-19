/**
 * Shared progress indicator for supervisor analysis/research runs.
 *
 * Renders: status chip → progress bar → elapsed time.
 * Does NOT include cancel/session buttons — those remain in each tab.
 */

import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import {
    formatElapsed,
    estimateProgress,
    type DimensionProgress,
} from "./supervisorUtils";
import { resolveDimensionLabel } from "./supervisorDimensionLabels";

interface SupervisorProgressViewProps {
    /** Current run status ("pending" | "running"). */
    readonly status: string;
    /** Seconds since the run started. */
    readonly elapsedSeconds: number;
    /** Per-dimension progress (null when not yet reporting dimensions). */
    readonly dimensionProgress: DimensionProgress | null;
    /** Label to show when status is "pending". Defaults to supervisor.statusWaitingCli. */
    readonly pendingLabel?: string;
    /** Label to show when running but no dimension progress yet. Defaults to supervisor.statusAnalyzing. */
    readonly analyzingLabel?: string;
}

export const SupervisorProgressView = React.memo(
    ({
        status,
        elapsedSeconds,
        dimensionProgress,
        pendingLabel,
        analyzingLabel,
    }: SupervisorProgressViewProps) => {
        const { theme } = useUnistyles();

        const statusText =
            status === "pending"
                ? (pendingLabel ?? t("supervisor.statusWaitingCli"))
                : dimensionProgress
                  ? t("supervisor.analyzingDimension", {
                        dimension: resolveDimensionLabel(
                            dimensionProgress.currentDimension,
                        ),
                        index: dimensionProgress.dimensionIndex,
                        total: dimensionProgress.totalDimensions,
                    })
                  : (analyzingLabel ?? t("supervisor.statusAnalyzing"));

        const progressPercent = dimensionProgress
            ? Math.round(
                  (dimensionProgress.dimensionIndex /
                      dimensionProgress.totalDimensions) *
                      95,
              )
            : estimateProgress(status, elapsedSeconds);

        const progressLabel = dimensionProgress
            ? `${dimensionProgress.dimensionIndex}/${dimensionProgress.totalDimensions}`
            : `${progressPercent}%`;

        return (
            <View style={styles.container}>
                <View style={styles.statusChip}>
                    <ActivityIndicator
                        size="small"
                        color={theme.colors.header.tint}
                    />
                    <Text style={styles.statusChipText}>{statusText}</Text>
                </View>
                <View style={styles.progressContainer}>
                    <View style={styles.progressBarBg}>
                        <View
                            style={[
                                styles.progressBarFill,
                                {
                                    width: `${progressPercent}%`,
                                    backgroundColor: theme.colors.header.tint,
                                },
                            ]}
                        />
                    </View>
                    <Text style={styles.progressText}>{progressLabel}</Text>
                </View>
                <Text style={styles.elapsedText}>
                    {t("supervisor.elapsed", {
                        time: formatElapsed(elapsedSeconds),
                    })}
                </Text>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        alignItems: "center",
        gap: 8,
        width: "100%",
    },
    statusChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    statusChipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    progressContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        width: "100%",
    },
    progressBarBg: {
        flex: 1,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.surface,
        overflow: "hidden" as const,
    },
    progressBarFill: {
        height: "100%",
        borderRadius: 3,
    },
    progressText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
        width: 32,
        textAlign: "right" as const,
    },
    elapsedText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));
