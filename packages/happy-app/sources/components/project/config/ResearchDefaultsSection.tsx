import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Project } from "@/sync/projectManager";
import { loadResearchPrefs } from "@/sync/persistence";

interface Props {
    project: Project;
}

const TOTAL_DIMENSIONS = 10;

export const ResearchDefaultsSection = React.memo<Props>(({ project }) => {
    const { theme } = useUnistyles();
    const serverId = project.serverId;

    const prefs = React.useMemo(() => {
        if (!serverId) return null;
        return loadResearchPrefs(serverId);
    }, [serverId]);

    const enabledDimCount = React.useMemo(() => {
        if (!prefs?.dimensions) return 2;
        return Object.values(prefs.dimensions).filter(Boolean).length;
    }, [prefs]);

    const direction = prefs?.featureDirection ?? "";
    const rulesLineCount = prefs?.customRules
        ? prefs.customRules.split("\n").filter(Boolean).length
        : 0;

    return (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.header}>
                <View style={[styles.iconBadge, { backgroundColor: `${theme.colors.accentBlue}1A` }]}>
                    <Ionicons name="search-outline" size={16} color={theme.colors.accentBlue} />
                </View>
                <Text style={[styles.title, { color: theme.colors.text }]}>
                    {t("projectConfig.sectionResearch")}
                </Text>
            </View>
            <View style={styles.summaryRows}>
                <SummaryRow
                    label={t("projectConfig.researchDimensions")}
                    value={`${enabledDimCount}/${TOTAL_DIMENSIONS} ${t("projectConfig.dimensionsEnabled")}`}
                    theme={theme}
                />
                {direction.length > 0 && (
                    <SummaryRow
                        label={t("projectConfig.researchDirection")}
                        value={direction.split("\n")[0]!}
                        theme={theme}
                    />
                )}
                {rulesLineCount > 0 && (
                    <SummaryRow
                        label={t("projectConfig.researchRules")}
                        value={`${rulesLineCount} ${t("projectConfig.rulesLines")}`}
                        theme={theme}
                    />
                )}
            </View>
            <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                {t("projectConfig.researchHint")}
            </Text>
        </View>
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
    hint: {
        ...Typography.default("regular"),
        fontSize: 12,
        marginTop: 8,
    },
}));
