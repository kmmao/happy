import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";

export const RoadmapEmptyState = React.memo(() => {
    const { theme } = useUnistyles();

    return (
        <View style={styles.container}>
            <Ionicons
                name="flag-outline"
                size={48}
                color={theme.colors.textSecondary}
            />
            <Text style={[styles.title, { color: theme.colors.text }]}>
                {t("roadmap.emptyTitle")}
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                {t("roadmap.emptySubtitle")}
            </Text>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 48,
        gap: 12,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 17,
    },
    subtitle: {
        ...Typography.default(),
        fontSize: 14,
        textAlign: "center",
        paddingHorizontal: 32,
    },
}));
