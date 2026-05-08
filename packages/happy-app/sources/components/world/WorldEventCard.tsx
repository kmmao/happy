import * as React from "react";
import { View, TouchableOpacity, LayoutAnimation, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateActionApproval } from "@/sync/apiSupervisor";
import { markInboxItemRead, deleteInboxItem } from "@/sync/apiInbox";
import { retryTask } from "@/sync/apiTasks";
import type { WorldEvent, WorldEventSeverity } from "./worldTypes";

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

function formatSourceLabel(projectPath?: string | null, projectId?: string | null): string {
    if (projectPath) {
        const segments = projectPath.split("/").filter(Boolean);
        return segments.pop() ?? projectPath;
    }
    if (projectId) return projectId.slice(0, 12);
    return "";
}

function useSeverityColor(severity: WorldEventSeverity): string {
    const { theme } = useUnistyles();
    if (severity === "critical") return theme.colors.warningCritical;
    if (severity === "warning") return theme.colors.warning;
    return theme.colors.textSecondary;
}

interface WorldEventCardProps {
    event: WorldEvent;
    onPress?: (event: WorldEvent) => void;
}

export const WorldEventCard = React.memo(function WorldEventCard({
    event,
    onPress,
}: WorldEventCardProps) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const router = useRouter();
    const dotColor = useSeverityColor(event.severity);
    const [expanded, setExpanded] = React.useState(false);
    const [actionLoading, setActionLoading] = React.useState(false);
    const [actionDone, setActionDone] = React.useState<string | null>(null);

    const handlePress = React.useCallback(() => {
        // Events with a sessionId: tap to navigate directly to the session
        const isSessionEvent = event.eventType.startsWith("session.");
        const isActiveTask = event.eventType.startsWith("task.") &&
            (event.eventType === "task.running" || event.eventType === "task.completed");
        if (event.source.sessionId && (isSessionEvent || isActiveTask)) {
            router.push(`/(app)/session/${event.source.sessionId}`);
            onPress?.(event);
            return;
        }
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((v) => !v);
        onPress?.(event);
    }, [event, onPress, router]);

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={handlePress}
            activeOpacity={0.7}
        >
            <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: dotColor }]} />
                <View style={styles.content}>
                    <View style={styles.headerRow}>
                        <Text style={styles.eventType} numberOfLines={1}>
                            {event.eventType}
                        </Text>
                        <Text style={styles.time}>{formatTime(event.occurredAt)}</Text>
                        {event.source.sessionId && (
                            event.eventType.startsWith("session.") ||
                            event.eventType === "task.running" ||
                            event.eventType === "task.completed"
                        ) && (
                            <Ionicons name="chevron-forward" size={14} color={theme.colors.textLink} style={{ marginLeft: 4 }} />
                        )}
                    </View>
                    <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>
                        {event.title}
                    </Text>
                    {(event.source.projectPath || event.source.projectId) && (
                        <Text style={styles.source} numberOfLines={1}>
                            {formatSourceLabel(event.source.projectPath, event.source.projectId)}
                        </Text>
                    )}

                    {expanded && (
                        <View style={styles.detail}>
                            {!!event.summary && (
                                <DetailRow label="Summary" value={event.summary} />
                            )}
                            <DetailRow label="Time" value={formatFullDate(event.occurredAt)} />
                            <DetailRow label="Source" value={event.source.type} />
                            {!!event.source.machineId && (
                                <DetailRow label="Machine" value={event.source.machineId} />
                            )}
                            {!!event.source.sessionId && (
                                <DetailRow label="Session" value={event.source.sessionId.slice(0, 16)} />
                            )}
                            <DetailRow label="ID" value={event.originalId.slice(0, 20)} />
                            {!!event.source.sessionId && (
                                <TouchableOpacity
                                    style={styles.openButton}
                                    onPress={() => router.push(`/(app)/session/${event.source.sessionId}`)}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="open-outline" size={14} color={theme.colors.textLink} />
                                    <Text style={styles.openButtonText}>Open Session</Text>
                                </TouchableOpacity>
                            )}
                            {/* Inline actions for supervisor events */}
                            {event.eventType === "supervisor.action_found" && !actionDone && (
                                <View style={styles.actionRow}>
                                    <ActionButton
                                        label="Approve"
                                        icon="checkmark-circle"
                                        color={theme.colors.success}
                                        loading={actionLoading}
                                        onPress={async () => {
                                            setActionLoading(true);
                                            try {
                                                const creds = await TokenStorage.getCredentials();
                                                if (!creds || !event.source.projectId) return;
                                                await updateActionApproval(creds, event.source.projectId, event.originalId, "approved");
                                                setActionDone("approved");
                                            } finally { setActionLoading(false); }
                                        }}
                                    />
                                    <ActionButton
                                        label="Skip"
                                        icon="close-circle"
                                        color={theme.colors.textSecondary}
                                        loading={actionLoading}
                                        onPress={async () => {
                                            setActionLoading(true);
                                            try {
                                                const creds = await TokenStorage.getCredentials();
                                                if (!creds || !event.source.projectId) return;
                                                await updateActionApproval(creds, event.source.projectId, event.originalId, "skipped");
                                                setActionDone("skipped");
                                            } finally { setActionLoading(false); }
                                        }}
                                    />
                                </View>
                            )}
                            {/* Inline actions for inbox/decision events */}
                            {event.eventType.startsWith("decision.") && !actionDone && (
                                <View style={styles.actionRow}>
                                    <ActionButton
                                        label="Read"
                                        icon="checkmark"
                                        color={theme.colors.success}
                                        loading={actionLoading}
                                        onPress={async () => {
                                            setActionLoading(true);
                                            try {
                                                const creds = await TokenStorage.getCredentials();
                                                if (!creds) return;
                                                await markInboxItemRead(creds, event.originalId);
                                                setActionDone("read");
                                            } finally { setActionLoading(false); }
                                        }}
                                    />
                                    <ActionButton
                                        label="Dismiss"
                                        icon="trash-outline"
                                        color={theme.colors.warningCritical}
                                        loading={actionLoading}
                                        onPress={async () => {
                                            setActionLoading(true);
                                            try {
                                                const creds = await TokenStorage.getCredentials();
                                                if (!creds) return;
                                                await deleteInboxItem(creds, event.originalId);
                                                setActionDone("dismissed");
                                            } finally { setActionLoading(false); }
                                        }}
                                    />
                                </View>
                            )}
                            {/* Retry action for failed tasks */}
                            {event.eventType === "task.failed" && !actionDone && (
                                <View style={styles.actionRow}>
                                    <ActionButton
                                        label="Retry"
                                        icon="refresh"
                                        color={theme.colors.accentBlue}
                                        loading={actionLoading}
                                        onPress={async () => {
                                            setActionLoading(true);
                                            try {
                                                const creds = await TokenStorage.getCredentials();
                                                if (!creds) return;
                                                await retryTask(creds, event.originalId);
                                                setActionDone("retrying");
                                            } finally { setActionLoading(false); }
                                        }}
                                    />
                                </View>
                            )}
                            {!!actionDone && (
                                <Text style={styles.actionDoneText}>{actionDone}</Text>
                            )}
                        </View>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );
});

function DetailRow({ label, value }: { label: string; value: string }) {
    const { styles } = useStyles();
    return (
        <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
        </View>
    );
}

function ActionButton({ label, icon, color, loading, onPress }: {
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
            {loading
                ? <ActivityIndicator size="small" color={color} />
                : <Ionicons name={icon as any} size={14} color={color} />
            }
            <Text style={[styles.actionButtonText, { color }]}>{label}</Text>
        </TouchableOpacity>
    );
}

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        card: {
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 10,
            marginHorizontal: 16,
            marginVertical: 4,
            paddingHorizontal: 12,
            paddingVertical: 10,
        },
        row: {
            flexDirection: "row",
            alignItems: "flex-start",
        },
        dot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 5,
            marginRight: 10,
        },
        content: {
            flex: 1,
        },
        headerRow: {
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 2,
        },
        eventType: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            flex: 1,
        },
        time: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            marginLeft: 8,
        },
        title: {
            fontSize: 14,
            color: theme.colors.text,
            lineHeight: 20,
        },
        source: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            marginTop: 4,
        },
        detail: {
            marginTop: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            gap: 4,
        },
        detailRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        detailLabel: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            width: 60,
        },
        detailValue: {
            flex: 1,
            fontSize: 12,
            color: theme.colors.text,
        },
        openButton: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 6,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 6,
            backgroundColor: theme.colors.surfaceHigh,
            alignSelf: "flex-start",
        },
        openButtonText: {
            fontSize: 13,
            color: theme.colors.textLink,
        },
        actionRow: {
            flexDirection: "row",
            gap: 8,
            marginTop: 8,
        },
        actionButton: {
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 6,
            backgroundColor: theme.colors.surfaceHigh,
        },
        actionButtonText: {
            fontSize: 13,
            fontWeight: "500",
        },
        actionDoneText: {
            fontSize: 12,
            color: theme.colors.success,
            marginTop: 6,
            fontStyle: "italic",
        },
    });
    return { styles };
};
