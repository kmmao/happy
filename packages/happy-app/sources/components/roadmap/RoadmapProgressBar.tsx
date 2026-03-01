import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";

interface RoadmapProgressBarProps {
    completed: number;
    total: number;
}

export const RoadmapProgressBar = React.memo(
    ({ completed, total }: RoadmapProgressBarProps) => {
        const { theme } = useUnistyles();
        const percentage = total > 0 ? (completed / total) * 100 : 0;

        return (
            <View style={styles.container}>
                <View
                    style={[
                        styles.track,
                        { backgroundColor: theme.colors.divider },
                    ]}
                >
                    <View
                        style={[
                            styles.fill,
                            {
                                backgroundColor: theme.colors.success,
                                width: `${percentage}%`,
                            },
                        ]}
                    />
                </View>
                <Text
                    style={[
                        styles.label,
                        { color: theme.colors.textSecondary },
                    ]}
                >
                    {t("roadmap.progress", { completed, total })}
                </Text>
            </View>
        );
    },
);

const styles = StyleSheet.create(() => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    track: {
        flex: 1,
        height: 6,
        borderRadius: 3,
        overflow: "hidden",
    },
    fill: {
        height: "100%",
        borderRadius: 3,
    },
    label: {
        fontSize: 11,
        minWidth: 60,
        textAlign: "right",
        ...Typography.default(),
    },
}));
