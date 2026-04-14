import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchAuditLog, type AuditLogEntry } from "@/sync/apiProjects";

const ACTION_ICONS: Record<string, string> = {
    "role.create": "add-circle",
    "role.update": "create",
    "role.delete": "trash",
    "decision.adjudicate": "checkmark-circle",
    "decision.reassign": "swap-horizontal",
    "member.add": "person-add",
    "member.update": "person",
    "member.remove": "person-remove",
    "law.create": "shield-checkmark",
    "narrative.update": "document-text",
};

function formatTimeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("time.justNow");
    if (mins < 60) return t("time.minutesAgo", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("time.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    return `${days}d`;
}

interface AuditLogSectionProps {
    projectId: string;
    isActive: boolean;
}

const PREVIEW_COUNT = 5;

export const AuditLogSection = React.memo(
    ({ projectId, isActive }: AuditLogSectionProps) => {
        const { theme } = useUnistyles();
        const [logs, setLogs] = React.useState<AuditLogEntry[]>([]);
        const [loading, setLoading] = React.useState(false);
        const [expanded, setExpanded] = React.useState(false);

        React.useEffect(() => {
            if (!isActive || !projectId) return;
            (async () => {
                setLoading(true);
                try {
                    const credentials = await TokenStorage.getCredentials();
                    if (!credentials) return;
                    const data = await fetchAuditLog(credentials, projectId, { limit: 20 });
                    setLogs(data.logs);
                } catch {
                    // best effort
                } finally {
                    setLoading(false);
                }
            })();
        }, [isActive, projectId]);

        if (loading && logs.length === 0) return <ActivityIndicator style={{ marginVertical: 12 }} />;
        if (logs.length === 0) return null;

        const visibleLogs = expanded ? logs : logs.slice(0, PREVIEW_COUNT);
        const hasMore = logs.length > PREVIEW_COUNT;

        return (
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <Ionicons name="time" size={16} color={theme.colors.text} />
                    <Text style={styles.headerText}>{t("collaboration.auditLog")}</Text>
                </View>
                {visibleLogs.map((log) => {
                    const icon = ACTION_ICONS[log.action] ?? "ellipse";
                    const who = log.account?.username ?? log.account?.firstName ?? "system";
                    return (
                        <View key={log.id} style={styles.logRow}>
                            <Ionicons name={icon as any} size={14} color={theme.colors.textSecondary} />
                            <View style={styles.logContent}>
                                <Text style={styles.logSummary} numberOfLines={2}>
                                    <Text style={{ fontWeight: "600" }}>@{who}</Text>
                                    {" "}{log.summary}
                                </Text>
                                <Text style={styles.logTime}>{formatTimeAgo(log.createdAt)}</Text>
                            </View>
                        </View>
                    );
                })}
                {hasMore && !expanded && (
                    <Pressable style={styles.showMoreRow} onPress={() => setExpanded(true)}>
                        <Text style={styles.showMoreText}>{t("collaboration.viewMore")}</Text>
                        <Ionicons name="chevron-down" size={14} color={theme.colors.accentPurple} />
                    </Pressable>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
    },
    headerRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        marginBottom: 10,
    },
    headerText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
    },
    logRow: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.groupped.background,
    },
    logContent: {
        flex: 1,
    },
    logSummary: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        lineHeight: 18,
    },
    logTime: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    showMoreRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 4,
        paddingVertical: 10,
        marginTop: 4,
        borderTopWidth: 1,
        borderTopColor: theme.colors.groupped.background,
    },
    showMoreText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.accentPurple,
    },
}));
