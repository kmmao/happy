import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import type { RoadmapFeature, FeatureStatus } from "@/sync/roadmapTypes";
import type { Theme } from "@/theme";
import { COMPLEXITY_LABELS, MOSCOW_LABELS } from "@/sync/roadmapLabels";

function getStatusColor(status: FeatureStatus, theme: Theme): string {
    switch (status) {
        case "planned": return theme.colors.status.default;
        case "in_progress": return theme.colors.box.warning.border;
        case "completed": return theme.colors.success;
        case "cancelled": return theme.colors.status.error;
    }
}

interface RoadmapFeatureItemProps {
    feature: RoadmapFeature;
    onPress: () => void;
    isLast?: boolean;
}

export const RoadmapFeatureItem = React.memo(
    ({ feature, onPress, isLast }: RoadmapFeatureItemProps) => {
        const { theme } = useUnistyles();
        const statusColor = getStatusColor(feature.status, theme);

        return (
            <Pressable
                style={[
                    styles.container,
                    !isLast && { borderBottomWidth: 0.5, borderBottomColor: theme.colors.divider },
                ]}
                onPress={onPress}
            >
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <View style={styles.content}>
                    <Text
                        style={[styles.title, { color: theme.colors.text }]}
                        numberOfLines={1}
                    >
                        {feature.title}
                    </Text>
                    <View style={styles.metaRow}>
                        <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>
                            {MOSCOW_LABELS[feature.moscow]()}
                        </Text>
                        <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>
                            {COMPLEXITY_LABELS[feature.complexity]()}
                        </Text>
                    </View>
                </View>
                <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={theme.colors.textSecondary}
                />
            </Pressable>
        );
    },
);

const styles = StyleSheet.create(() => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    content: {
        flex: 1,
        gap: 2,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 14,
    },
    metaRow: {
        flexDirection: "row",
        gap: 12,
    },
    meta: {
        ...Typography.default(),
        fontSize: 12,
    },
}));
