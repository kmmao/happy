import * as React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { Typography } from "@/constants/Typography";

interface StopFailureData {
    error: string;
    errorType?: string | null;
    lastAssistantMessage?: string | null;
}

interface Props {
    stopFailure: StopFailureData;
}

export const StopFailureBanner = React.memo(({ stopFailure }: Props) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const [dismissed, setDismissed] = React.useState(false);

    // Reset dismissed state when error changes (new StopFailure event)
    React.useEffect(() => {
        setDismissed(false);
        setExpanded(false);
    }, [stopFailure.error]);

    if (dismissed) return null;

    const hasLastMessage = !!stopFailure.lastAssistantMessage;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.warningCritical }]}>
            <View style={styles.header}>
                <Ionicons name="warning-outline" size={16} color={theme.colors.warningCritical} />
                <Text style={[styles.title, { color: theme.colors.warningCritical }]}>
                    {t("stopFailure.title")}
                </Text>
                {stopFailure.errorType && (
                    <Text style={[styles.errorType, { color: theme.colors.textSecondary }]}>
                        {stopFailure.errorType}
                    </Text>
                )}
                <Pressable onPress={() => setDismissed(true)} hitSlop={8} style={styles.dismissButton}>
                    <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
                </Pressable>
            </View>

            <Text style={[styles.errorMessage, { color: theme.colors.text }]} numberOfLines={5}>
                {stopFailure.error}
            </Text>

            {hasLastMessage && (
                <>
                    <Pressable
                        onPress={() => setExpanded((prev) => !prev)}
                        style={styles.expandRow}
                    >
                        <Text style={[styles.expandLabel, { color: theme.colors.textLink }]}>
                            {t("stopFailure.lastMessage")}
                        </Text>
                        <Ionicons
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={14}
                            color={theme.colors.textLink}
                        />
                    </Pressable>
                    {expanded && (
                        <ScrollView style={[styles.messageScroll, { backgroundColor: theme.colors.surfaceHighest }]}>
                            <Text style={[styles.messageText, { color: theme.colors.text }]}>
                                {stopFailure.lastAssistantMessage}
                            </Text>
                        </ScrollView>
                    )}
                </>
            )}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        marginHorizontal: 12,
        marginVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        padding: 14,
        gap: 8,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    title: {
        fontSize: 13,
        fontWeight: "600",
        flex: 1,
        ...Typography.default(),
    },
    errorType: {
        fontSize: 11,
        ...Typography.default(),
    },
    dismissButton: {
        marginLeft: 4,
    },
    errorMessage: {
        fontSize: 14,
        lineHeight: 20,
        ...Typography.default(),
    },
    expandRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    expandLabel: {
        fontSize: 13,
        fontWeight: "500",
        ...Typography.default(),
    },
    messageScroll: {
        maxHeight: 120,
        borderRadius: 8,
        padding: 10,
    },
    messageText: {
        fontSize: 13,
        lineHeight: 18,
        ...Typography.default(),
    },
}));
