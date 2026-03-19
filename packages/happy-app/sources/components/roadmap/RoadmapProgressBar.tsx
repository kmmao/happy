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
        const progress = total > 0 ? completed / total : 0;

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
                                backgroundColor: theme.colors.header.tint,
                                width: `${progress * 100}%`,
                            },
                        ]}
                    />
                </View>
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                    {t("roadmap.progress", { completed, total })}
                </Text>
            </View>
        );
    },
);

const styles = StyleSheet.create(() => ({
    container: {
        gap: 4,
    },
    track: {
        height: 4,
        borderRadius: 2,
        overflow: "hidden",
    },
    fill: {
        height: "100%",
        borderRadius: 2,
    },
    label: {
        ...Typography.default(),
        fontSize: 11,
    },
}));
