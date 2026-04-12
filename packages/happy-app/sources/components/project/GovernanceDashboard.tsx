import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateWorldPolicy } from "@/sync/apiWorld";
import type { AutonomyStats, SupervisorMode } from "@kmmao/happy-wire";

interface GovernanceDashboardProps {
    projectId: string;
    stats: AutonomyStats;
    onPolicyUpdated: () => void;
}

const MODES: { value: SupervisorMode; label: () => string; desc: () => string }[] = [
    { value: "disabled", label: () => t("autonomy.modeDisabled"), desc: () => t("governance.modeDisabledDesc") },
    { value: "suggest", label: () => t("autonomy.modeSuggest"), desc: () => t("governance.modeSuggestDesc") },
    { value: "semi-auto", label: () => t("autonomy.modeSemiAuto"), desc: () => t("governance.modeSemiAutoDesc") },
    { value: "auto", label: () => t("autonomy.modeAuto"), desc: () => t("governance.modeAutoDesc") },
];

const MODE_COLORS: Record<SupervisorMode, string> = {
    disabled: "#9CA3AF",
    suggest: "#F59E0B",
    "semi-auto": "#3B82F6",
    auto: "#10B981",
};

export const GovernanceDashboard = React.memo(function GovernanceDashboard({
    projectId,
    stats,
    onPolicyUpdated,
}: GovernanceDashboardProps) {
    const { theme } = useUnistyles();
    const currentMode = stats.mode;

    const [updating, setUpdating] = React.useState(false);
    const setMode = React.useCallback(async (mode: SupervisorMode) => {
        if (updating) return;
        setUpdating(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            await updateWorldPolicy(credentials, projectId, { supervisorMode: mode });
            onPolicyUpdated();
        } finally {
            setUpdating(false);
        }
    }, [updating, projectId, onPolicyUpdated]);

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.text} />
                <Text style={styles.title}>{t("governance.title")}</Text>
            </View>

            <Text style={styles.sectionLabel}>{t("governance.policyMode")}</Text>
            <Text style={styles.sectionHint}>{t("governance.policyModeDesc")}</Text>

            <View style={styles.modeGrid}>
                {MODES.map((mode) => {
                    const isActive = mode.value === currentMode;
                    const color = MODE_COLORS[mode.value];
                    return (
                        <Pressable
                            key={mode.value}
                            style={[
                                styles.modeButton,
                                { borderColor: isActive ? color : undefined, backgroundColor: isActive ? color + "15" : undefined },
                            ]}
                            onPress={() => void setMode(mode.value)}
                        >
                            <Text style={[styles.modeLabel, isActive && { color }]}>
                                {mode.label()}
                            </Text>
                            <Text style={styles.modeDesc} numberOfLines={2}>
                                {mode.desc()}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
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
        gap: 10,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    sectionLabel: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.text,
    },
    sectionHint: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: -6,
    },
    modeGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    modeButton: {
        width: "47%",
        borderWidth: 1.5,
        borderColor: theme.colors.divider,
        borderRadius: 12,
        padding: 10,
        gap: 4,
    },
    modeLabel: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.text,
    },
    modeDesc: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
}));
