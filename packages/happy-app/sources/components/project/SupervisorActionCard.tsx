import * as React from "react";
import {
    View,
    Text,
    Pressable,
    ActivityIndicator,
    Linking,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    type SupervisorAction,
    updateActionApproval,
    triggerActionFix,
    deleteAction,
} from "@/sync/apiSupervisor";
import {
    SEVERITY_COLORS,
    SEVERITY_KEY_MAP,
    CATEGORY_KEY_MAP,
    getConfidenceColor,
} from "./supervisorConstants";
import { Modal } from "@/modal";

interface SupervisorActionCardProps {
    action: SupervisorAction;
    projectId: string;
    onUpdated: () => void;
    onDeleted?: () => void;
    isLast?: boolean;
}

export const SupervisorActionCard = React.memo(
    ({ action, projectId, onUpdated, onDeleted, isLast }: SupervisorActionCardProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const borderColor =
            SEVERITY_COLORS[action.severity] ?? theme.colors.textSecondary;

        const severityLabel = SEVERITY_KEY_MAP[action.severity]
            ? t(SEVERITY_KEY_MAP[action.severity])
            : action.severity;

        const categoryLabel = CATEGORY_KEY_MAP[action.category]
            ? t(CATEGORY_KEY_MAP[action.category])
            : action.category;

        const confidenceColor = getConfidenceColor(action.confidence);

        const isRecurring = action.lastSeenRunId != null && action.lastSeenRunId !== action.runId;

        const [, doApprove] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await updateActionApproval(
                    credentials,
                    projectId,
                    action.id,
                    "approved",
                );
                onUpdated();
            }, [projectId, action.id, onUpdated]),
        );

        const [, doSkip] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await updateActionApproval(
                    credentials,
                    projectId,
                    action.id,
                    "skipped",
                );
                onUpdated();
            }, [projectId, action.id, onUpdated]),
        );

        const [, doIgnore] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await updateActionApproval(
                    credentials,
                    projectId,
                    action.id,
                    "ignored",
                );
                onUpdated();
            }, [projectId, action.id, onUpdated]),
        );

        const [fixLoading, doFix] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await triggerActionFix(credentials, projectId, action.id);
                onUpdated();
            }, [projectId, action.id, onUpdated]),
        );

        const [, doRestore] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await updateActionApproval(
                    credentials,
                    projectId,
                    action.id,
                    "pending",
                );
                onUpdated();
            }, [projectId, action.id, onUpdated]),
        );

        const [, doDelete] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await deleteAction(credentials, projectId, action.id);
                (onDeleted ?? onUpdated)();
            }, [projectId, action.id, onUpdated, onDeleted]),
        );

        const handleDelete = React.useCallback(() => {
            Modal.alert(
                t("supervisor.deleteConfirm"),
                t("supervisor.deleteConfirmBody"),
                [
                    { text: t("common.cancel"), style: "cancel" },
                    { text: t("supervisor.delete"), style: "destructive", onPress: doDelete },
                ],
            );
        }, [doDelete]);

        const isPending = action.approval === "pending";
        const isApproved = action.approval === "approved";
        const isDismissed =
            action.approval === "skipped" || action.approval === "ignored";
        const isFixing =
            action.fixStatus === "pending" ||
            action.fixStatus === "running";

        const showDetail = React.useCallback(() => {
            const message = action.suggestedFix
                ? `${action.description}\n\n${t("supervisor.suggestedFix")}:\n${action.suggestedFix}`
                : action.description;
            Modal.alert(action.title, message);
        }, [action.title, action.description, action.suggestedFix]);

        return (
            <View
                style={[
                    styles.card,
                    !isLast && styles.cardBorder,
                    { borderLeftColor: borderColor },
                ]}
            >
                {/* Header */}
                <View style={styles.headerRow}>
                    <View
                        style={[
                            styles.severityBadge,
                            { backgroundColor: borderColor },
                        ]}
                    >
                        <Text style={styles.severityText}>
                            {severityLabel}
                        </Text>
                    </View>
                    <Text style={styles.categoryText}>{categoryLabel}</Text>
                    {isRecurring && (
                        <View style={styles.recurringBadge}>
                            <Ionicons name="repeat-outline" size={10} color="#FF9500" />
                            <Text style={styles.recurringText}>
                                {t("supervisor.recurring")}
                            </Text>
                        </View>
                    )}
                    {confidenceColor && action.confidence != null && (
                        <View
                            style={[
                                styles.confidenceBadge,
                                { backgroundColor: confidenceColor + "20" },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.confidenceText,
                                    { color: confidenceColor },
                                ]}
                            >
                                {action.confidence}%
                            </Text>
                        </View>
                    )}
                </View>

                {/* Title + Description (tap for full detail) */}
                <Pressable onPress={showDetail}>
                    <Text style={styles.title}>{action.title}</Text>

                    {/* Description */}
                    <Text style={styles.description} numberOfLines={3}>
                        {action.description}
                    </Text>

                    {/* Suggested fix */}
                    {action.suggestedFix && (
                        <View style={styles.fixBox}>
                            <Text style={styles.fixLabel}>
                                {t("supervisor.suggestedFix")}
                            </Text>
                            <Text style={styles.fixText} numberOfLines={3}>
                                {action.suggestedFix}
                            </Text>
                        </View>
                    )}
                </Pressable>

                {/* Fix progress */}
                {isApproved && action.fixStatus && (
                    <View style={styles.fixProgressRow}>
                        {isFixing ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.header.tint}
                            />
                        ) : action.fixStatus === "completed" ? (
                            <Ionicons
                                name="checkmark-circle"
                                size={18}
                                color="#34C759"
                            />
                        ) : (
                            <Ionicons
                                name="close-circle"
                                size={18}
                                color="#FF3B30"
                            />
                        )}
                        <Text style={styles.fixProgressText}>
                            {t("supervisor.fixStatus")}: {action.fixStatus}
                        </Text>
                    </View>
                )}

                {/* Fix session link */}
                {action.fixSessionId && (
                    <Pressable
                        style={styles.sessionLinkRow}
                        onPress={(e) => {
                            e.stopPropagation();
                            router.push(`/session/${action.fixSessionId}` as any);
                        }}
                    >
                        <Ionicons
                            name="terminal-outline"
                            size={14}
                            color={theme.colors.header.tint}
                        />
                        <Text style={styles.sessionLinkText}>
                            {t("supervisor.viewSession")}
                        </Text>
                    </Pressable>
                )}

                {/* Issue URL / PR link */}
                {action.issueUrl && (
                    <Pressable
                        style={styles.issueRow}
                        onPress={() => {
                            Linking.openURL(action.issueUrl!);
                        }}
                    >
                        <Ionicons
                            name="git-pull-request-outline"
                            size={14}
                            color={theme.colors.header.tint}
                        />
                        <Text
                            style={styles.issueUrl}
                            numberOfLines={1}
                        >
                            {t("supervisor.viewPR")}
                        </Text>
                    </Pressable>
                )}

                {/* Action buttons */}
                {isPending && (
                    <View style={styles.buttonRow}>
                        <Pressable
                            style={styles.approveButton}
                            onPress={doApprove}
                        >
                            <Text style={styles.approveButtonText}>
                                {t("supervisor.approve")}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={styles.secondaryButton}
                            onPress={doSkip}
                        >
                            <Text style={styles.secondaryButtonText}>
                                {t("supervisor.skip")}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={styles.secondaryButton}
                            onPress={doIgnore}
                        >
                            <Text style={styles.secondaryButtonText}>
                                {t("supervisor.ignore")}
                            </Text>
                        </Pressable>
                    </View>
                )}

                {/* Skip/Ignore hint for pending */}
                {isPending && (
                    <Text style={styles.hintText}>
                        {t("supervisor.skipIgnoreHint")}
                    </Text>
                )}

                {/* Restore + Delete buttons for dismissed actions */}
                {isDismissed && (
                    <View style={styles.buttonRow}>
                        <Pressable
                            style={styles.restoreButton}
                            onPress={doRestore}
                        >
                            <Ionicons name="arrow-undo-outline" size={14} color={theme.colors.header.tint} />
                            <Text style={[styles.restoreButtonText, { color: theme.colors.header.tint }]}>
                                {t("supervisor.restore")}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={styles.deleteButton}
                            onPress={handleDelete}
                        >
                            <Ionicons name="trash-outline" size={14} color="#FF3B30" />
                            <Text style={styles.deleteButtonText}>
                                {t("supervisor.delete")}
                            </Text>
                        </Pressable>
                    </View>
                )}

                {/* Fix trigger for approved but not yet fixed */}
                {isApproved && !action.fixStatus && (
                    <View style={styles.buttonRow}>
                        <Pressable
                            style={styles.approveButton}
                            onPress={doFix}
                            disabled={fixLoading}
                        >
                            {fixLoading ? (
                                <ActivityIndicator
                                    size="small"
                                    color="#FFFFFF"
                                />
                            ) : (
                                <Text style={styles.approveButtonText}>
                                    {t("supervisor.triggerFix")}
                                </Text>
                            )}
                        </Pressable>
                    </View>
                )}

                {/* Retry button for failed fixes */}
                {isApproved && action.fixStatus === "failed" && (
                    <View style={styles.buttonRow}>
                        <Pressable
                            style={styles.approveButton}
                            onPress={doFix}
                            disabled={fixLoading}
                        >
                            {fixLoading ? (
                                <ActivityIndicator
                                    size="small"
                                    color="#FFFFFF"
                                />
                            ) : (
                                <Text style={styles.approveButtonText}>
                                    {t("supervisor.retryFix")}
                                </Text>
                            )}
                        </Pressable>
                    </View>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    card: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderLeftWidth: 3,
    },
    cardBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
        flexWrap: "wrap",
    },
    severityBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    severityText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: "#FFFFFF",
        textTransform: "uppercase",
    },
    categoryText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    confidenceBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        marginLeft: "auto",
    },
    confidenceText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
        marginBottom: 4,
    },
    description: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    fixBox: {
        marginTop: 8,
        padding: 10,
        backgroundColor: theme.colors.surface,
        borderRadius: 6,
    },
    fixLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        textTransform: "uppercase",
    },
    fixText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        lineHeight: 18,
    },
    fixProgressRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 8,
    },
    fixProgressText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    issueRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
    },
    issueUrl: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.header.tint,
        flex: 1,
    },
    sessionLinkRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
    },
    sessionLinkText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.header.tint,
    },
    buttonRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 10,
    },
    approveButton: {
        backgroundColor: theme.colors.header.tint,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 6,
    },
    approveButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: "#FFFFFF",
    },
    secondaryButton: {
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
    },
    secondaryButtonText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    recurringBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        backgroundColor: "#FF950020",
    },
    recurringText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
        color: "#FF9500",
    },
    hintText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 6,
        opacity: 0.7,
    },
    restoreButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.surface,
    },
    restoreButtonText: {
        ...Typography.default(),
        fontSize: 13,
    },
    deleteButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        backgroundColor: "#FF3B3010",
    },
    deleteButtonText: {
        ...Typography.default(),
        fontSize: 13,
        color: "#FF3B30",
    },
}));
