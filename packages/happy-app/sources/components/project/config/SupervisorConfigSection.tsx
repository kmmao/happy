import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useRouter } from "expo-router";
import { Project } from "@/sync/projectManager";

interface Props {
    project: Project;
}

function formatMode(mode: string | null | undefined): string {
    switch (mode) {
        case "suggest":
            return t("projectConfig.modeSuggest");
        case "semi-auto":
            return t("projectConfig.modeSemiAuto");
        case "auto":
            return t("projectConfig.modeAuto");
        default:
            return t("projectConfig.modeSuggest");
    }
}

export const SupervisorConfigSection = React.memo<Props>(({ project }) => {
    const { theme } = useUnistyles();
    const router = useRouter();

    const mode = project.supervisorMode ?? "suggest";
    const scheduleEnabled = project.supervisorScheduleEnabled ?? false;
    const intervalHours = project.supervisorScheduleIntervalHours ?? 24;
    const dims = project.supervisorEnabledDimensions;
    const enabledDimCount = dims ? dims.split(",").filter(Boolean).length : 0;
    const pushEnabled = project.supervisorPushTriggerEnabled ?? false;

    return (
        <Pressable
            style={[styles.card, { backgroundColor: theme.colors.surface }]}
            onPress={() => router.push(`/project/${project.id}/supervisor-settings` as any)}
        >
            <View style={styles.header}>
                <View style={[styles.iconBadge, { backgroundColor: `${theme.colors.success}1A` }]}>
                    <Ionicons name="pulse-outline" size={16} color={theme.colors.success} />
                </View>
                <Text style={[styles.title, { color: theme.colors.text }]}>
                    {t("projectConfig.sectionSupervisor")}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
            </View>
            <View style={styles.summaryRows}>
                <SummaryRow
                    label={t("projectConfig.supervisorMode")}
                    value={formatMode(mode)}
                    theme={theme}
                />
                <SummaryRow
                    label={t("projectConfig.supervisorSchedule")}
                    value={scheduleEnabled ? `${t("common.enabled")} · ${intervalHours}h` : t("common.disabled")}
                    theme={theme}
                />
                <SummaryRow
                    label={t("projectConfig.supervisorDimensions")}
                    value={`${enabledDimCount} ${t("projectConfig.dimensionsEnabled")}`}
                    theme={theme}
                />
                {pushEnabled && (
                    <SummaryRow
                        label={t("projectConfig.supervisorPush")}
                        value={t("common.enabled")}
                        theme={theme}
                    />
                )}
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
        ...Typography.default("semiBold"),
        fontSize: 13,
        maxWidth: "60%",
        textAlign: "right",
    },
}));
