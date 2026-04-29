import * as React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Modal } from "@/modal";
import { t } from "@/text";
import { Theme } from "@/theme";
import { formatTokenCount } from "@/utils/formatUsage";
import {
    getContextBreakdownSummary,
    getContextBreakdownSourceInfo,
    type ContextBreakdownItem,
    type ContextBreakdownSource,
} from "./contextBreakdown";

type Props = {
    items: ContextBreakdownItem[];
    source?: ContextBreakdownSource | null;
    theme: Theme;
};

export const ContextBreakdownPanel = React.memo(({ items, source, theme }: Props) => {
    const [expanded, setExpanded] = React.useState(false);
    const summary = React.useMemo(() => getContextBreakdownSummary(items), [items]);
    const sourceInfo = React.useMemo(
        () => getContextBreakdownSourceInfo(source, t),
        [source],
    );

    React.useEffect(() => {
        if (items.length === 0) {
            setExpanded(false);
        }
    }, [items.length]);

    if (items.length === 0) {
        return null;
    }

    return (
        <View style={styles.section}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    expanded
                        ? t("agentInput.context.collapseBreakdown")
                        : t("agentInput.context.expandBreakdown")
                }
                hitSlop={8}
                onPress={() => setExpanded((prev) => !prev)}
                style={({ pressed }) => [
                    styles.headerButton,
                    {
                        backgroundColor: theme.colors.surfacePressed,
                        borderColor: theme.colors.divider,
                        opacity: pressed ? 0.85 : 1,
                    },
                ]}
            >
                <View style={styles.headerContent}>
                    <View style={styles.titleRow}>
                        <Text style={[styles.title, { color: theme.colors.text }]}>
                            {t("agentInput.context.breakdownTitle")}
                        </Text>
                        {sourceInfo ? (
                            <Pressable
                                style={[
                                    styles.sourceBadge,
                                    {
                                        backgroundColor: theme.colors.surfaceHighest,
                                        borderColor: theme.colors.divider,
                                    },
                                ]}
                                onPress={(event) => {
                                    event.stopPropagation();
                                    Modal.alert(sourceInfo.title, sourceInfo.message);
                                }}
                                hitSlop={6}
                                accessibilityRole="button"
                                accessibilityLabel={sourceInfo.title}
                                accessibilityHint={sourceInfo.message}
                                // @ts-expect-error RN Web supports title for tooltip
                                title={sourceInfo.message}
                            >
                                <Text
                                    style={[
                                        styles.sourceBadgePrefix,
                                        { color: theme.colors.textSecondary },
                                    ]}
                                >
                                    {t("agentInput.context.sourceLabel")}
                                </Text>
                                <Text
                                    style={[
                                        styles.sourceBadgeValue,
                                        { color: theme.colors.textLink },
                                    ]}
                                >
                                    {sourceInfo.label}
                                </Text>
                                <Ionicons
                                    color={theme.colors.textSecondary}
                                    name="information-circle-outline"
                                    size={12}
                                />
                            </Pressable>
                        ) : null}
                    </View>
                    {summary ? (
                        <Text
                            numberOfLines={1}
                            style={[styles.summary, { color: theme.colors.textSecondary }]}
                        >
                            {summary}
                        </Text>
                    ) : null}
                </View>
                <Ionicons
                    color={theme.colors.textSecondary}
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={14}
                />
            </Pressable>
            {expanded ? (
                <View
                    style={[
                        styles.panel,
                        {
                            backgroundColor: theme.colors.surfaceHigh,
                            borderColor: theme.colors.divider,
                        },
                    ]}
                >
                    {items.map((item) => {
                        const accentColor = item.color || theme.colors.textLink;
                        const fillWidth = `${Math.max(item.percentage, 2)}%` as const;

                        return (
                            <View key={item.key} style={styles.itemBlock}>
                                <View style={styles.itemHeader}>
                                    <View style={styles.itemLabelWrap}>
                                        <View
                                            style={[
                                                styles.dot,
                                                { backgroundColor: accentColor },
                                            ]}
                                        />
                                        <Text
                                            style={[
                                                styles.itemLabel,
                                                { color: theme.colors.text },
                                            ]}
                                        >
                                            {item.label}
                                        </Text>
                                    </View>
                                    <Text
                                        style={[
                                            styles.itemValue,
                                            { color: accentColor },
                                        ]}
                                    >
                                        {`${item.percentage}% · ${formatTokenCount(item.tokens)}`}
                                    </Text>
                                </View>
                                <View
                                    style={[
                                        styles.itemBarTrack,
                                        { backgroundColor: theme.colors.divider },
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.itemBarFill,
                                            {
                                                backgroundColor: accentColor,
                                                width: fillWidth,
                                            },
                                        ]}
                                    />
                                </View>
                            </View>
                        );
                    })}
                </View>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create((_, rt) => ({
    section: {
        marginTop: 4,
    },
    headerButton: {
        minHeight: 36,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    headerContent: {
        flex: 1,
        gap: 2,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
    },
    title: {
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
    sourceBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    sourceBadgePrefix: {
        fontSize: 9,
        textTransform: "uppercase",
        ...Typography.default("semiBold"),
    },
    sourceBadgeValue: {
        fontSize: 10,
        ...Typography.default("semiBold"),
    },
    summary: {
        fontSize: 10,
        ...Typography.default(),
    },
    panel: {
        marginTop: 6,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 10,
        gap: 10,
    },
    itemBlock: {
        gap: 6,
    },
    itemHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    itemLabelWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flex: 1,
        minWidth: 0,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 999,
        flexShrink: 0,
    },
    itemLabel: {
        fontSize: 11,
        ...Typography.default(),
    },
    itemValue: {
        fontSize: 11,
        textAlign: "right",
        ...Typography.default("semiBold"),
    },
    itemBarTrack: {
        height: 5,
        borderRadius: 999,
        overflow: "hidden",
    },
    itemBarFill: {
        height: "100%",
        borderRadius: 999,
    },
}));
