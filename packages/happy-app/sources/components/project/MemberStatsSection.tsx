import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchMemberStats, type MemberStatSummary } from "@/sync/apiProjects";

const AVAILABILITY_COLORS: Record<string, string> = {
    active: "#10B981",
    away: "#F59E0B",
    delegate: "#8B5CF6",
};

interface MemberStatsSectionProps {
    projectId: string;
    isActive: boolean;
}

export const MemberStatsSection = React.memo(
    ({ projectId, isActive }: MemberStatsSectionProps) => {
        const { theme } = useUnistyles();
        const [stats, setStats] = React.useState<MemberStatSummary[]>([]);
        const [loading, setLoading] = React.useState(false);

        React.useEffect(() => {
            if (!isActive || !projectId) return;
            (async () => {
                setLoading(true);
                try {
                    const credentials = await TokenStorage.getCredentials();
                    if (!credentials) return;
                    const data = await fetchMemberStats(credentials, projectId);
                    setStats(data);
                } catch {
                    // best effort
                } finally {
                    setLoading(false);
                }
            })();
        }, [isActive, projectId]);

        if (loading && stats.length === 0) return <ActivityIndicator style={{ marginVertical: 12 }} />;
        if (stats.length === 0) return null;

        return (
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <Ionicons name="people" size={16} color={theme.colors.text} />
                    <Text style={styles.headerText}>{t("collaboration.groupActivity")}</Text>
                </View>
                {stats.map((s) => {
                    const name = s.displayName ?? s.account?.firstName ?? s.account?.username ?? s.accountId.slice(0, 8);
                    return (
                        <View key={s.memberId} style={styles.memberRow}>
                            <View style={[styles.dot, { backgroundColor: AVAILABILITY_COLORS[s.availability] ?? "#6B7280" }]} />
                            <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                            <Text style={styles.memberRole}>{s.role}</Text>
                            <View style={styles.statBadge}>
                                <Text style={styles.statText}>{s.decisionsResolved}d</Text>
                            </View>
                            <View style={styles.statBadge}>
                                <Text style={styles.statText}>{s.auditActions}a</Text>
                            </View>
                        </View>
                    );
                })}
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
    memberRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 6,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    memberName: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
        flex: 1,
    },
    memberRole: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    statBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: theme.colors.groupped.background,
    },
    statText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
}));
