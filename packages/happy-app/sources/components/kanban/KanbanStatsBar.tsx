import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { StatusDot } from "@/components/StatusDot";

interface KanbanStatsBarProps {
    totalTasks: number;
    activeSessionCount: number;
}

export const KanbanStatsBar = React.memo(
    ({ totalTasks, activeSessionCount }: KanbanStatsBarProps) => {
        const { theme } = useUnistyles();

        return (
            <View style={styles.container}>
                <Text
                    style={[
                        styles.stat,
                        { color: theme.colors.textSecondary },
                    ]}
                >
                    {t("kanban.stats.totalTasks", { count: totalTasks })}
                </Text>
                {activeSessionCount > 0 && (
                    <View style={styles.activeContainer}>
                        <StatusDot color="#34C759" isPulsing size={6} />
                        <Text
                            style={[
                                styles.stat,
                                { color: theme.colors.textSecondary },
                            ]}
                        >
                            {t("kanban.stats.activeSessions", {
                                count: activeSessionCount,
                            })}
                        </Text>
                    </View>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create(() => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 4,
        gap: 12,
    },
    stat: {
        fontSize: 12,
        ...Typography.default(),
    },
    activeContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
}));
