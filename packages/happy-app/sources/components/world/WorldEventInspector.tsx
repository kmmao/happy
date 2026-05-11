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
import type { WorldEvent } from "./worldTypes";

// Consistent with WorldEventCard TYPE_COLORS
const TYPE_COLORS: Record<string, string> = {
    "task": "#3B82F6",
    "session": "#22C55E",
    "supervisor": "#F59E0B",
    "memory": "#8B5CF6",
    "trigger": "#EC4899",
    "decision": "#EF4444",
    "world": "#5e52a7",
};

function getTypeColor(eventType: string): string {
    const prefix = eventType.split(".")[0];
    return TYPE_COLORS[prefix] ?? "";
}

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

    React.useEffect(() => {
        setActionDone(null);
        setActionLoading(false);
    }, [event?.id]);

    const typeColor = event
        ? (getTypeColor(event.eventType) || theme.colors.textSecondary)
        : theme.colors.textSecondary;

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
                {/* Handle + header */}
                <View style={styles.header}>
                    <View style={styles.handle} />
                    <View style={styles.titleRow}>
                        <Text style={styles.headerTitle}>{t("world.inspector")}</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
                            <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                    </View>
                </View>

                {event && (
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Event type badge — filled tint, uses TYPE_COLORS */}
                        <View style={styles.badgeRow}>
                            <View style={[
                                styles.typeBadge,
                                { backgroundColor: typeColor + "20", borderColor: typeColor + "60" },
                            ]}>
                                <View style={[styles.typeDot, { backgroundColor: typeColor }]} />
                                <Text style={[styles.typeBadgeText, { color: typeColor }]}>
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
                                    value={formatSourceLabel(event.source.projectPath, event.source.projectId)}
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
                                    accentColor="#22C55E"
                                    label={t("world.openSession")}
                                    onPress={() => handleNavigate(`/(app)/session/${event.source.sessionId}`)}
                                />
                            )}
                            {event.eventType === "memory.created" && !!event.source.projectId && (
                                <NavButton
                                    icon="library-outline"
                                    accentColor="#8B5CF6"
                                    label={t("world.openKnowledge")}
                                    onPress={() =>
                                        handleNavigate(
                                            `/(app)/project/${event.source.projectId}/knowledge/${event.originalId}/evolution`,
                                        )
                                    }
                                />
                            )}
                            {!!event.referenceUrl && event.eventType.startsWith("decision.") && (() => {
                                const url = event.referenceUrl!;
                                const sessionMatch = url.match(/\/session\/([^/?]+)/);
                                const projectMatch = url.match(/\/project\/([^/?]+)/);
                                const icon = sessionMatch ? "chatbubble-outline" as const : "folder-outline" as const;
                                const label = sessionMatch ? t("world.openSession") : t("world.openProject");
                                const path = sessionMatch
                                    ? `/(app)/session/${sessionMatch[1]}`
                                    : projectMatch ? `/(app)/project/${projectMatch[1]}` : null;
                                if (!path) return null;
                                return (
                                    <NavButton
                                        key="ref-url"
                                        icon={icon}
                                        accentColor={sessionMatch ? "#22C55E" : "#3B82F6"}
                                        label={label}
                                        onPress={() => handleNavigate(path)}
                                    />
                                );
                            })()}
                            {!!event.source.projectId && !event.eventType.startsWith("decision.") && (
                                <NavButton
                                    icon="folder-outline"
                                    accentColor="#3B82F6"
                                    label={t("world.openProject")}
                                    onPress={() => handleNavigate(`/(app)/project/${event.source.projectId}`)}
                                />
                            )}
                            {!!event.source.machineId && (
                                <NavButton
                                    icon="desktop-outline"
                                    accentColor="#F59E0B"
                                    label={t("world.openMachine")}
                                    onPress={() => handleNavigate(`/(app)/machine/${event.source.machineId}/tasks`)}
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
                                            bgColor={theme.colors.success + "18"}
                                            loading={actionLoading}
                                            onPress={() =>
                                                handleAction(async () => {
                                                    const creds = await TokenStorage.getCredentials();
                                                    if (!creds || !event.source.projectId) return;
                                                    await updateActionApproval(creds, event.source.projectId, event.originalId, "approved");
                                                }, "approved")
                                            }
                                        />
                                        <ActionButton
                                            label={t("world.actionSkip")}
                                            icon="close-circle"
                                            color={theme.colors.textSecondary}
                                            bgColor={theme.colors.surfaceHigh}
                                            loading={actionLoading}
                                            onPress={() =>
                                                handleAction(async () => {
                                                    const creds = await TokenStorage.getCredentials();
                                                    if (!creds || !event.source.projectId) return;
                                                    await updateActionApproval(creds, event.source.projectId, event.originalId, "skipped");
                                                }, "skipped")
                                            }
                                        />
                                    </View>
                                )}

                                {event.eventType.startsWith("decision.") && (() => {
                                    const inner = event.eventType;
                                    const readLabel =
                                        inner.includes("task.failed") || inner.includes("task.cancelled")
                                            ? "Acknowledge"
                                            : inner.includes("supervisor")
                                                ? "Mark Reviewed"
                                                : t("world.actionRead");
                                    return (
                                        <View style={styles.actionRow}>
                                            <ActionButton
                                                label={readLabel}
                                                icon="checkmark-circle-outline"
                                                color={theme.colors.success}
                                                bgColor={theme.colors.success + "18"}
                                                loading={actionLoading}
                                                onPress={() =>
                                                    handleAction(async () => {
                                                        const creds = await TokenStorage.getCredentials();
                                                        if (!creds) return;
                                                        await markInboxItemRead(creds, event.originalId);
                                                    }, "acknowledged")
                                                }
                                            />
                                            <ActionButton
                                                label={t("world.actionDismiss")}
                                                icon="trash-outline"
                                                color={theme.colors.warningCritical}
                                                bgColor={theme.colors.warningCritical + "18"}
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
                                    );
                                })()}

                                {event.eventType === "task.failed" && (
                                    <View style={styles.actionRow}>
                                        <ActionButton
                                            label={t("world.actionRetry")}
                                            icon="refresh"
                                            color={theme.colors.accentBlue}
                                            bgColor={theme.colors.accentBlue + "18"}
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
            <Text style={styles.detailValue} numberOfLines={3}>{value}</Text>
        </View>
    );
}

function NavButton({
    icon,
    accentColor,
    label,
    onPress,
}: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    accentColor: string;
    label: string;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    return (
        <TouchableOpacity
            style={[styles.navButton, { borderLeftColor: accentColor }]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <Ionicons name={icon} size={18} color={accentColor} />
            <Text style={styles.navButtonText}>{label}</Text>
            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
        </TouchableOpacity>
    );
}

function ActionButton({
    label,
    icon,
    color,
    bgColor,
    loading,
    onPress,
}: {
    label: string;
    icon: string;
    color: string;
    bgColor: string;
    loading: boolean;
    onPress: () => void;
}) {
    const { styles } = useStyles();
    return (
        <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: bgColor }]}
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
            paddingHorizontal: 20,
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
        },
        handle: {
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.divider,
            alignSelf: "center",
            marginTop: 10,
            marginBottom: 14,
        },
        titleRow: {
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 2,
        },
        headerTitle: {
            flex: 1,
            fontSize: 17,
            fontWeight: "600",
            color: theme.colors.text,
        },
        closeButton: {
            padding: 6,
            borderRadius: 16,
            backgroundColor: theme.colors.surfaceHigh,
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
        typeBadge: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderWidth: 1,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 5,
        },
        typeDot: {
            width: 6,
            height: 6,
            borderRadius: 3,
        },
        typeBadgeText: {
            fontSize: 12,
            fontWeight: "600",
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
            borderRadius: 12,
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
            width: 68,
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
            paddingVertical: 13,
            borderLeftWidth: 3,
        },
        navButtonText: {
            flex: 1,
            fontSize: 15,
            color: theme.colors.text,
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
            paddingVertical: 13,
            paddingHorizontal: 16,
            borderRadius: 10,
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
