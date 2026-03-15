import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { ItemGroup } from "@/components/ItemGroup";
import type { SupervisorCostSummary } from "@/sync/apiSupervisor";

interface SupervisorCostSectionProps {
    costSummary: SupervisorCostSummary;
}

export const SupervisorCostSection = React.memo(
    ({ costSummary }: SupervisorCostSectionProps) => {
        if (costSummary.runsCount === 0) return null;

        return (
            <ItemGroup title={t("supervisor.costSection")}>
                <View style={styles.costCard}>
                    <View style={styles.costRow}>
                        <Text style={styles.costLabel}>
                            {t("supervisor.costRunsCount")}
                        </Text>
                        <Text style={styles.costValue}>
                            {costSummary.runsCount}
                        </Text>
                    </View>
                    <View style={styles.costRow}>
                        <Text style={styles.costLabel}>
                            {t("supervisor.costTotalTokens")}
                        </Text>
                        <Text style={styles.costValue}>
                            {costSummary.totalTokens.toLocaleString()}
                        </Text>
                    </View>
                    <View style={styles.costRow}>
                        <Text style={styles.costLabel}>
                            {t("supervisor.costTotalUsd")}
                        </Text>
                        <Text style={styles.costValue}>
                            ${costSummary.totalCostUsd.toFixed(4)}
                        </Text>
                    </View>
                    <Text style={styles.costPeriod}>
                        {t("supervisor.costPeriod", {
                            days: costSummary.days,
                        })}
                    </Text>
                </View>
            </ItemGroup>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    costCard: {
        padding: 16,
        gap: 8,
    },
    costRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    costLabel: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    costValue: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    costPeriod: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        textAlign: "center",
        marginTop: 4,
    },
}));
