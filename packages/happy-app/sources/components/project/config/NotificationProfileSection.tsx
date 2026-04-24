import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useRouter } from "expo-router";
import { Project } from "@/sync/projectManager";
import { getSupervisorDefaultProfileId } from "../supervisorProfileSelection";

interface Props {
    project: Project;
}

interface NotificationPrefs {
    onAnalysisComplete?: boolean;
    onIssueCreated?: boolean;
    onPRCreated?: boolean;
    onError?: boolean;
}

function parseNotifications(configJson: string | null | undefined): NotificationPrefs {
    if (!configJson) return {};
    try {
        const parsed = JSON.parse(configJson) as { notifications?: NotificationPrefs };
        return parsed.notifications ?? {};
    } catch {
        return {};
    }
}

export const NotificationProfileSection = React.memo<Props>(({ project }) => {
    const { theme } = useUnistyles();
    const router = useRouter();

    const notifications = React.useMemo(
        () => parseNotifications(project.supervisorConfig),
        [project.supervisorConfig],
    );

    const enabledCount = [
        notifications.onAnalysisComplete,
        notifications.onIssueCreated,
        notifications.onPRCreated,
        notifications.onError,
    ].filter(Boolean).length;

    const profileId = getSupervisorDefaultProfileId(project.supervisorConfig);

    return (
        <Pressable
            style={[styles.card, { backgroundColor: theme.colors.surface }]}
            onPress={() => router.push(`/project/${project.id}/supervisor-settings` as any)}
        >
            <View style={styles.header}>
                <View style={[styles.iconBadge, { backgroundColor: `${theme.colors.accentOrange}1A` }]}>
                    <Ionicons name="notifications-outline" size={16} color={theme.colors.accentOrange} />
                </View>
                <Text style={[styles.title, { color: theme.colors.text }]}>
                    {t("projectConfig.sectionNotifications")}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
            </View>
            <View style={styles.summaryRows}>
                <SummaryRow
                    label={t("projectConfig.notificationsEnabled")}
                    value={`${enabledCount}/4`}
                    theme={theme}
                />
                <SummaryRow
                    label={t("projectConfig.defaultProfile")}
                    value={profileId ?? t("projectConfig.profileDefault")}
                    theme={theme}
                />
            </View>
        </Pressable>
    );
});

function SummaryRow({ label, value, theme }: { label: string; value: string; theme: any }) {
    return (
        <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>
                {label}
            </Text>
            <Text style={[styles.summaryValue, { color: theme.colors.text }]} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 12,
        padding: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 12,
    },
    iconBadge: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        flex: 1,
    },
    summaryRows: {
        gap: 6,
    },
    summaryRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    summaryLabel: {
        ...Typography.default("regular"),
        fontSize: 13,
    },
    summaryValue: {
        ...Typography.default("regular"),
        fontSize: 13,
        maxWidth: "60%",
        textAlign: "right",
    },
}));
