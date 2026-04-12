import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { CollaborationSummary } from "@/sync/apiWorld";

interface RoleCollaborationSectionProps {
    summary: CollaborationSummary;
}

export const RoleCollaborationSection = React.memo(function RoleCollaborationSection({
    summary,
}: RoleCollaborationSectionProps) {
    const { theme } = useUnistyles();

    const hasBlocks = summary.blockedChains.length > 0 || summary.openConflicts > 0;
    const activeRoles = summary.roles.filter((r) => r.activeTasks > 0 || r.pendingMessages > 0 || r.blockedOn.length > 0);

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Ionicons name="git-network" size={16} color={theme.colors.accentBlue} />
                <Text style={[styles.title, { color: theme.colors.text }]}>
                    {t("collaboration.title")}
                </Text>
                {(summary.openConflicts > 0 || summary.pendingDecisions > 0) ? (
                    <View style={styles.alertBadge}>
                        <Text style={styles.alertBadgeText}>
                            {summary.openConflicts + summary.pendingDecisions}
                        </Text>
                    </View>
                ) : null}
            </View>

            {/* Metrics row */}
            <View style={styles.metricsRow}>
                <View style={styles.metricItem}>
                    <Text style={[styles.metricValue, { color: summary.openConflicts > 0 ? "#EF4444" : theme.colors.text }]}>
                        {summary.openConflicts}
                    </Text>
                    <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>
                        {t("collaboration.openConflicts")}
                    </Text>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
                <View style={styles.metricItem}>
                    <Text style={[styles.metricValue, { color: summary.pendingDecisions > 0 ? "#F59E0B" : theme.colors.text }]}>
                        {summary.pendingDecisions}
                    </Text>
                    <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>
                        {t("collaboration.pendingDecisions")}
                    </Text>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
                <View style={styles.metricItem}>
                    <Text style={[styles.metricValue, { color: summary.blockedChains.length > 0 ? "#EF4444" : theme.colors.text }]}>
                        {summary.blockedChains.length}
                    </Text>
                    <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>
                        {t("collaboration.blockedChains")}
                    </Text>
                </View>
            </View>

            {/* Blocked chains */}
            {hasBlocks && summary.blockedChains.length > 0 ? (
                <View style={styles.chainsSection}>
                    {summary.blockedChains.map((chain, i) => (
                        <View key={i} style={[styles.chainRow, { backgroundColor: theme.colors.surfaceHigh }]}>
                            <Ionicons name="warning" size={13} color="#EF4444" />
                            <Text style={[styles.chainText, { color: theme.colors.text }]} numberOfLines={1}>
                                {chain.chain.join(" → ")}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {/* Active roles */}
            {activeRoles.length > 0 ? (
                <View style={styles.rolesSection}>
                    <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                        {t("collaboration.roleActivity")}
                    </Text>
                    {activeRoles.map((role) => (
                        <View key={role.roleName} style={styles.roleRow}>
                            <View style={styles.roleInfo}>
                                <Text style={[styles.roleName, { color: theme.colors.text }]}>
                                    {role.roleName}
                                </Text>
                                <View style={styles.roleStats}>
                                    {role.activeTasks > 0 ? (
                                        <View style={[styles.roleStatBadge, { backgroundColor: "#10B98122" }]}>
                                            <Text style={[styles.roleStatText, { color: "#10B981" }]}>
                                                {role.activeTasks} active
                                            </Text>
                                        </View>
                                    ) : null}
                                    {role.pendingHandoffs > 0 ? (
                                        <View style={[styles.roleStatBadge, { backgroundColor: "#3B82F622" }]}>
                                            <Text style={[styles.roleStatText, { color: "#3B82F6" }]}>
                                                {role.pendingHandoffs} {t("collaboration.handoffs")}
                                            </Text>
                                        </View>
                                    ) : null}
                                    {role.pendingReviews > 0 ? (
                                        <View style={[styles.roleStatBadge, { backgroundColor: "#F59E0B22" }]}>
                                            <Text style={[styles.roleStatText, { color: "#F59E0B" }]}>
                                                {role.pendingReviews} {t("collaboration.reviewRequests")}
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>
                            </View>
                            {role.blockedOn.length > 0 ? (
                                <View style={styles.blockedOnRow}>
                                    <Ionicons name="pause-circle" size={13} color="#EF4444" />
                                    <Text style={[styles.blockedOnText, { color: "#EF4444" }]} numberOfLines={1}>
                                        {t("collaboration.waitingFor", { role: role.blockedOn[0]!.waitingFor })}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    ))}
                </View>
            ) : null}

            {!hasBlocks && activeRoles.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                    {t("collaboration.noBlocks")}
                </Text>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
        gap: 12,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        flex: 1,
    },
    alertBadge: {
        backgroundColor: "#EF444422",
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    alertBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#EF4444",
    },
    metricsRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    metricItem: {
        flex: 1,
        alignItems: "center",
        gap: 2,
    },
    metricValue: {
        ...Typography.default("semiBold"),
        fontSize: 20,
    },
    metricLabel: {
        ...Typography.default(),
        fontSize: 11,
        textAlign: "center",
    },
    divider: {
        width: 1,
        height: 32,
    },
    chainsSection: {
        gap: 6,
    },
    chainRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    chainText: {
        ...Typography.default(),
        fontSize: 13,
        flex: 1,
    },
    rolesSection: {
        gap: 6,
    },
    sectionLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    roleRow: {
        gap: 4,
    },
    roleInfo: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    roleName: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        flex: 1,
    },
    roleStats: {
        flexDirection: "row",
        gap: 4,
    },
    roleStatBadge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    roleStatText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    blockedOnRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: 2,
    },
    blockedOnText: {
        ...Typography.default(),
        fontSize: 12,
        flex: 1,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 13,
        textAlign: "center",
        paddingVertical: 4,
    },
}));
