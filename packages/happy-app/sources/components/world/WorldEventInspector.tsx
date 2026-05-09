import * as React from "react";
import {
    Modal,
    View,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateActionApproval } from "@/sync/apiSupervisor";
import { markInboxItemRead, deleteInboxItem } from "@/sync/apiInbox";
import { retryTask } from "@/sync/apiTasks";
import type { WorldEvent, WorldEventSeverity } from "./worldTypes";

function formatFullDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function formatSourceLabel(
    projectPath?: string | null,
    projectId?: string | null,
): string {
    if (projectPath) {
        const segments = projectPath.split("/").filter(Boolean);
        return segments.pop() ?? projectPath;
    }
    if (projectId) return projectId.slice(0, 12);
    return "";
}

function getSeverityColor(
    severity: WorldEventSeverity,
    theme: ReturnType<typeof useUnistyles>["theme"],
): string {
    if (severity === "critical") return theme.colors.warningCritical;
    if (severity === "warning") return theme.colors.warning;
    return theme.colors.textSecondary;
}

interface Props {
    event: WorldEvent | null;
    onClose: () => void;
    onActionDone?: (eventId: string) => void;
}

export const WorldEventInspector = React.memo(function WorldEventInspector({
    event,
    onClose,
    onActionDone,
}: Props) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const router = useRouter();
    const [actionLoading, setActionLoading] = React.useState(false);
    const [actionDone, setActionDone] = React.useState<string | null>(null);

    // Reset action state when a different event is opened
    React.useEffect(() => {
        setActionDone(null);
        setActionLoading(false);
    }, [event?.id]);

    const dotColor = event ? getSeverityColor(event.severity, theme) : theme.colors.textSecondary;

    const handleNavigate = React.useCallback(
        (path: string) => {
            onClose();
            router.push(path as any);
        },
        [onClose, router],
    );

    const handleAction = React.useCallback(
        async (action: () => Promise<void>, label: string) => {
            setActionLoading(true);
            try {
                await action();
                setActionDone(label);
                if (event) onActionDone?.(event.id);
            } finally {
                setActionLoading(false);
            }
        },
        [event, onActionDone],
    );

    return (
        <Modal
            visible={!!event}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <SafeAreaView style={styles.root}>
                {/* Handle bar + close */}
                <View style={styles.header}>
                    <View style={styles.handle} />
                    <View style={styles.titleRow}>
                        <View style={[styles.severityDot, { backgroundColor: dotColor }]} />
                        <Text style={styles.headerTitle}>{t("world.inspector")}</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
                            <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                    </View>
                </View>

                {event && (
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Event type badge */}
                        <View style={styles.badgeRow}>
                            <View style={[styles.badge, { borderColor: dotColor }]}>
                                <Text style={[styles.badgeText, { color: dotColor }]}>
                                    {event.eventType}
                                </Text>
                            </View>
                        </View>

                        {/* Title */}
                        <Text style={styles.eventTitle}>{event.title}</Text>

                        {/* Detail rows */}
                        <View style={styles.detailSection}>
                            {!!event.summary && event.summary !== event.title && (
                                <DetailRow label={t("world.eventSummary")} value={event.summary} />
                            )}
                            <DetailRow label={t("world.eventTime")} value={formatFullDate(event.occurredAt)} />
                            {!!(event.source.projectPath || event.source.projectId) && (
                                <DetailRow
                                    label={t("world.eventSource")}
                                    value={formatSourceLabel(
                                        event.source.projectPath,
                                        event.source.projectId,
                                    )}
                                />
                            )}
                            {!!event.source.machineId && (
                                <DetailRow label={t("world.eventMachine")} value={event.source.machineId} />
                            )}
                            {!!event.source.sessionId && (
                                <DetailRow
                                    label={t("world.eventSession")}
                                    value={event.source.sessionId.slice(0, 20) + "…"}
                                />
                            )}
                            <DetailRow
                                label={t("world.eventId")}
                                value={event.originalId.slice(0, 20) + "…"}
                            />
                        </View>

                        {/* Navigation links */}
                        <View style={styles.navSection}>
                            {!!event.source.sessionId && (
                                <NavButton
                                    icon="chatbubble-outline"
                                    label={t("world.openSession")}
                                    onPress={() =>
                                        handleNavigate(`/(app)/session/${event.source.sessionId}`)
                                    }
                                />
                            )}
                            {event.eventType === "memory.created" && !!event.source.projectId && (
                                <NavButton
                                    icon="library-outline"
                                    label={t("world.openKnowledge")}
                                    onPress={() =>
                                        handleNavigate(
                                            `/(app)/project/${event.source.projectId}/knowledge/${event.originalId}/evolution`,
                                        )
                                    }
                                />
                            )}
                            {!!event.source.projectId && (
                                <NavButton
                                    icon="folder-outline"
                                    label={t("world.openProject")}
                                    onPress={() =>
                                        handleNavigate(`/(app)/project/${event.source.projectId}`)
                                    }
                                />
                            )}
                            {!!event.source.machineId && (
                                <NavButton
                                    icon="desktop-outline"
                                    label={t("world.openMachine")}
                                    onPress={() =>
                                        handleNavigate(`/(app)/machine/${event.source.machineId}/tasks`)
                                    }
                                />
                            )}
                        </View>

                        {/* Action buttons */}
                        {!actionDone && (
                            <View style={styles.actionSection}>
                                {event.eventType === "supervisor.action_found" && (
                                    <View style={styles.actionRow}>
                                        <ActionButton
                                            label={t("world.actionApprove")}
                                            icon="checkmark-circle"
                                            color={theme.colors.success}
                                            loading={actionLoading}
                                            onPress={() =>
                                                handleAction(async () => {
                                                    const creds = await TokenStorage.getCredentials();
                                                    if (!creds || !event.source.projectId) return;
                                                    await updateActionApproval(
                                                        creds,
                                                        event.source.projectId,
                                                        event.originalId,
                                                        "approved",
                                                    );
                                                }, "approved")
                                            }
                                        />
                                        <ActionButton
                                            label={t("world.actionSkip")}
                                            icon="close-circle"
                                            color={theme.colors.textSecondary}
                                            loading={actionLoading}
                                            onPress={() =>
                                                handleAction(async () => {
                                                    const creds = await TokenStorage.getCredentials();
                                                    if (!creds || !event.source.projectId) return;
                                                    await updateActionApproval(
                                                        creds,
                                                        event.source.projectId,
                                                        event.originalId,
                                                        "skipped",
                                                    );
                                                }, "skipped")
                                            }
                                        />
                                    </View>
                                )}

                                {event.eventType.startsWith("decision.") && (
                                    <View style={styles.actionRow}>
                                        <ActionButton
                                            label={t("world.actionRead")}
                                            icon="checkmark"
                                            color={theme.colors.success}
                                            loading={actionLoading}
                                            onPress={() =>
                                                handleAction(async () => {
                                                    const creds = await TokenStorage.getCredentials();
                                                    if (!creds) return;
                                                    await markInboxItemRead(creds, event.originalId);
                                                }, "read")
                                            }
                                        />
                                        <ActionButton
                                            label={t("world.actionDismiss")}
                                            icon="trash-outline"
                                            color={theme.colors.warningCritical}
                                            loading={actionLoading}
                                            onPress={() =>
                                                handleAction(async () => {
                                                    const creds = await TokenStorage.getCredentials();
                                                    if (!creds) return;
                                                    await deleteInboxItem(creds, event.originalId);
                                                }, "dismissed")
                                            }
                                        />
                                    </View>
                                )}

                                {event.eventType === "task.failed" && (
                                    <View style={styles.actionRow}>
                                        <ActionButton
                                            label={t("world.actionRetry")}
                                            icon="refresh"
                                            color={theme.colors.accentBlue}
                                            loading={actionLoading}
                                            onPress={() =>
                                                handleAction(async () => {
                                                    const creds = await TokenStorage.getCredentials();
                                                    if (!creds) return;
                                                    await retryTask(creds, event.originalId);
                                                }, "retrying")
                                            }
                                        />
                                    </View>
                                )}
                            </View>
                        )}

                        {!!actionDone && (
                            <View style={styles.actionDoneRow}>
                                <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                                <Text style={styles.actionDoneText}>
                                    {t("world.actionDone")} · {actionDone}
                                </Text>
                            </View>
                        )}
                    </ScrollView>
                )}
            </SafeAreaView>
        </Modal>
    );
});

function DetailRow({ label, value }: { label: string; value: string }) {
    const { styles } = useStyles();
    return (
        <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue} numberOfLines={3}>
                {value}
            </Text>
        </View>
    );
}

function NavButton({
    icon,
    label,
    onPress,
}: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    label: string;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    return (
        <TouchableOpacity style={styles.navButton} onPress={onPress} activeOpacity={0.7}>
            <Ionicons name={icon} size={18} color={theme.colors.textLink} />
            <Text style={styles.navButtonText}>{label}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textLink} />
        </TouchableOpacity>
    );
}

function ActionButton({
    label,
    icon,
    color,
    loading,
    onPress,
}: {
    label: string;
    icon: string;
    color: string;
    loading: boolean;
    onPress: () => void;
}) {
    const { styles } = useStyles();
    return (
        <TouchableOpacity
            style={styles.actionButton}
            onPress={onPress}
            disabled={loading}
            activeOpacity={0.7}
        >
            {loading ? (
                <ActivityIndicator size="small" color={color} />
            ) : (
                <Ionicons name={icon as any} size={16} color={color} />
            )}
            <Text style={[styles.actionButtonText, { color }]}>{label}</Text>
        </TouchableOpacity>
    );
}

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        root: {
            flex: 1,
            backgroundColor: theme.colors.surface,
        },
        header: {
            paddingHorizontal: 16,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
        },
        handle: {
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.divider,
            alignSelf: "center",
            marginTop: 8,
            marginBottom: 12,
        },
        titleRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
        },
        severityDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
        },
        headerTitle: {
            flex: 1,
            fontSize: 17,
            fontWeight: "600",
            color: theme.colors.text,
        },
        closeButton: {
            padding: 4,
        },
        scroll: {
            flex: 1,
        },
        scrollContent: {
            padding: 20,
            gap: 16,
            paddingBottom: 48,
        },
        badgeRow: {
            flexDirection: "row",
        },
        badge: {
            borderWidth: 1,
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 3,
        },
        badgeText: {
            fontSize: 12,
            fontWeight: "500",
        },
        eventTitle: {
            fontSize: 20,
            fontWeight: "600",
            color: theme.colors.text,
            lineHeight: 28,
        },
        detailSection: {
            gap: 10,
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 10,
            padding: 14,
        },
        detailRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 10,
        },
        detailLabel: {
            fontSize: 12,
            color: theme.colors.textSecondary,
            width: 64,
            paddingTop: 1,
        },
        detailValue: {
            flex: 1,
            fontSize: 13,
            color: theme.colors.text,
        },
        navSection: {
            gap: 8,
        },
        navButton: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 14,
        },
        navButtonText: {
            flex: 1,
            fontSize: 15,
            color: theme.colors.textLink,
            fontWeight: "500",
        },
        actionSection: {
            gap: 8,
        },
        actionRow: {
            flexDirection: "row",
            gap: 10,
        },
        actionButton: {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
            backgroundColor: theme.colors.surfaceHigh,
        },
        actionButtonText: {
            fontSize: 14,
            fontWeight: "500",
        },
        actionDoneRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 4,
        },
        actionDoneText: {
            fontSize: 14,
            color: theme.colors.success,
            fontStyle: "italic",
        },
    });
    return { styles };
};
