/**
 * Loop autopilot status card — shows iteration progress, phase, metrics, and controls.
 * Displayed in ProjectHealthTab when a loop is active or recently completed.
 */

import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    type SupervisorLoop,
    pauseSupervisorLoop,
    resumeSupervisorLoop,
    stopSupervisorLoop,
} from "@/sync/apiSupervisor";
import { Modal } from "@/modal";
import { formatElapsed, useElapsedSeconds } from "./supervisorUtils";

interface SupervisorLoopStatusCardProps {
    readonly loop: SupervisorLoop;
    readonly projectId: string;
    readonly onUpdate: () => void;
}

const phaseIcons: Record<string, string> = {
    idle: "ellipse-outline",
    analyzing: "scan-outline",
    fixing: "hammer-outline",
    deciding: "help-circle-outline",
};

export const SupervisorLoopStatusCard = React.memo(
    ({ loop, projectId, onUpdate }: SupervisorLoopStatusCardProps) => {
        const { theme } = useUnistyles();
        const elapsedSeconds = useElapsedSeconds(loop.createdAt);
        const isActive = loop.status === "running" || loop.status === "paused";
        const isRunning = loop.status === "running";
        const isPaused = loop.status === "paused";

        const [pauseLoading, doPause] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await pauseSupervisorLoop(credentials, projectId, loop.id);
                onUpdate();
            }, [projectId, loop.id, onUpdate]),
        );

        const [resumeLoading, doResume] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await resumeSupervisorLoop(credentials, projectId, loop.id);
                onUpdate();
            }, [projectId, loop.id, onUpdate]),
        );

        const [stopLoading, doStop] = useHappyAction(
            React.useCallback(async () => {
                const confirmed = await Modal.confirm(
                    t("supervisor.loopStopConfirm"),
                    t("supervisor.loopStopConfirmBody"),
                    { confirmText: t("supervisor.loopStop"), destructive: true },
                );
                if (!confirmed) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await stopSupervisorLoop(credentials, projectId, loop.id);
                onUpdate();
            }, [projectId, loop.id, onUpdate]),
        );

        const phaseLabels: Record<string, string> = {
            idle: t("supervisor.loopPhase_idle"),
            analyzing: t("supervisor.loopPhase_analyzing"),
            fixing: t("supervisor.loopPhase_fixing"),
            deciding: t("supervisor.loopPhase_deciding"),
        };
        const statusLabels: Record<string, string> = {
            running: t("supervisor.loopStatus_running"),
            paused: t("supervisor.loopStatus_paused"),
            completed: t("supervisor.loopStatus_completed"),
            failed: t("supervisor.loopStatus_failed"),
            stopped: t("supervisor.loopStatus_stopped"),
        };
        const exitReasonLabels: Record<string, string> = {
            max_iterations: t("supervisor.loopExit_max_iterations"),
            cost_cap: t("supervisor.loopExit_cost_cap"),
            health_target: t("supervisor.loopExit_health_target"),
            no_new_actions: t("supervisor.loopExit_no_new_actions"),
            consecutive_failures: t("supervisor.loopExit_consecutive_failures"),
            user_stopped: t("supervisor.loopExit_user_stopped"),
            timeout: t("supervisor.loopExit_timeout"),
        };

        const phaseLabel = phaseLabels[loop.currentPhase] ?? loop.currentPhase;
        const statusLabel = statusLabels[loop.status] ?? loop.status;
        const exitReasonLabel = loop.exitReason
            ? (exitReasonLabels[loop.exitReason] ?? loop.exitReason)
            : null;

        const progressPercent = Math.round(
            (loop.currentIteration / loop.maxIterations) * 100,
        );

        const healthDelta =
            loop.initialHealthScore != null && loop.currentHealthScore != null
                ? loop.currentHealthScore - loop.initialHealthScore
                : null;

        return (
            <View style={styles.container}>
                {/* Status header */}
                <View style={styles.statusRow}>
                    {isActive && (
                        <ActivityIndicator
                            size="small"
                            color={
                                isPaused
                                    ? theme.colors.textSecondary
                                    : theme.colors.header.tint
                            }
                        />
                    )}
                    <Text style={styles.statusText}>{statusLabel}</Text>
                    {isActive && (
                        <View style={styles.phaseChip}>
                            <Ionicons
                                name={(phaseIcons[loop.currentPhase] ?? "ellipse-outline") as any}
                                size={14}
                                color={theme.colors.header.tint}
                            />
                            <Text style={styles.phaseText}>{phaseLabel}</Text>
                        </View>
                    )}
                </View>

                {/* Iteration progress bar */}
                <View style={styles.progressSection}>
                    <Text style={styles.metricLabel}>
                        {t("supervisor.loopIteration", {
                            current: loop.currentIteration,
                            max: loop.maxIterations,
                        })}
                    </Text>
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
                </View>

                {/* Metrics row */}
                <View style={styles.metricsRow}>
                    <View style={styles.metricItem}>
                        <Text style={styles.metricValue}>
                            {loop.totalActionsFound}
                        </Text>
                        <Text style={styles.metricLabel}>
                            {t("supervisor.loopFound")}
                        </Text>
                    </View>
                    <View style={styles.metricItem}>
                        <Text style={styles.metricValue}>
                            {loop.totalActionsFixed}
                        </Text>
                        <Text style={styles.metricLabel}>
                            {t("supervisor.loopFixed")}
                        </Text>
                    </View>
                    <View style={styles.metricItem}>
                        <Text style={styles.metricValue}>
                            ${loop.totalCostUsd.toFixed(2)}
                        </Text>
                        <Text style={styles.metricLabel}>
                            {t("supervisor.loopCost")}
                        </Text>
                    </View>
                    {healthDelta !== null && (
                        <View style={styles.metricItem}>
                            <Text
                                style={[
                                    styles.metricValue,
                                    {
                                        color:
                                            healthDelta < 0
                                                ? "#34C759"
                                                : healthDelta > 0
                                                  ? "#FF3B30"
                                                  : theme.colors.textSecondary,
                                    },
                                ]}
                            >
                                {healthDelta <= 0 ? healthDelta : `+${healthDelta}`}
                            </Text>
                            <Text style={styles.metricLabel}>
                                {t("supervisor.loopHealthDelta")}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Elapsed time */}
                {isActive && (
                    <Text style={styles.elapsedText}>
                        {t("supervisor.elapsed", {
                            time: formatElapsed(elapsedSeconds),
                        })}
                    </Text>
                )}

                {/* Exit reason (for completed loops) */}
                {!isActive && exitReasonLabel && (
                    <Text style={styles.exitReasonText}>
                        {exitReasonLabel}
                    </Text>
                )}

                {/* Control buttons */}
                {isActive && (
                    <View style={styles.controlRow}>
                        {isRunning ? (
                            <Pressable
                                style={styles.controlButton}
                                onPress={doPause}
                                disabled={pauseLoading}
                            >
                                <Ionicons
                                    name="pause"
                                    size={16}
                                    color={theme.colors.header.tint}
                                />
                                <Text
                                    style={[
                                        styles.controlButtonText,
                                        { color: theme.colors.header.tint },
                                    ]}
                                >
                                    {t("supervisor.loopPause")}
                                </Text>
                            </Pressable>
                        ) : (
                            <Pressable
                                style={styles.controlButton}
                                onPress={doResume}
                                disabled={resumeLoading}
                            >
                                <Ionicons
                                    name="play"
                                    size={16}
                                    color={theme.colors.header.tint}
                                />
                                <Text
                                    style={[
                                        styles.controlButtonText,
                                        { color: theme.colors.header.tint },
                                    ]}
                                >
                                    {t("supervisor.loopResume")}
                                </Text>
                            </Pressable>
                        )}
                        <Pressable
                            style={styles.controlButton}
                            onPress={doStop}
                            disabled={stopLoading}
                        >
                            <Ionicons
                                name="stop"
                                size={16}
                                color="#FF3B30"
                            />
                            <Text
                                style={[
                                    styles.controlButtonText,
                                    { color: "#FF3B30" },
                                ]}
                            >
                                {t("supervisor.loopStop")}
                            </Text>
                        </Pressable>
                    </View>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 12,
        padding: 16,
    },
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    statusText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
    },
    phaseChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        marginLeft: "auto",
    },
    phaseText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.header.tint,
    },
    progressSection: {
        gap: 4,
    },
    progressBarBg: {
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.surface,
        overflow: "hidden" as const,
    },
    progressBarFill: {
        height: "100%",
        borderRadius: 3,
    },
    metricsRow: {
        flexDirection: "row",
        justifyContent: "space-around",
    },
    metricItem: {
        alignItems: "center",
        gap: 2,
    },
    metricValue: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    metricLabel: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    elapsedText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
    },
    exitReasonText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
    },
    controlRow: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 16,
    },
    controlButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
    },
    controlButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
}));
