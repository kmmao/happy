import * as React from "react";
import {
    Pressable,
    ScrollView,
    View,
    type PressableStateCallbackType,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";

export interface SessionGlassTabBarItem {
    key: string;
    label: string;
    secondary?: React.ReactNode;
    trailing?: React.ReactNode;
}

interface SessionGlassTabBarProps {
    tabs: readonly SessionGlassTabBarItem[];
    activeTab: string;
    onChange: (tabKey: string) => void;
    trailingAccessory?: React.ReactNode;
    compact?: boolean;
    scrollable?: boolean;
    tabMinWidth?: number;
    style?: StyleProp<ViewStyle>;
}

interface GlassPillProps {
    active: boolean;
    compact: boolean;
    dense: boolean;
    pressed: boolean;
    children: React.ReactNode;
}

const GlassPill = React.memo<GlassPillProps>(function GlassPill({
    active,
    compact,
    dense,
    pressed,
    children,
}) {
    const { theme } = useUnistyles();
    const blurTint = theme.dark ? "dark" : "light";
    const restingOpacity = theme.dark ? "0E" : "C8";
    const activeBorderOpacity = theme.dark ? "52" : "2E";
    const inactiveBorderOpacity = theme.dark ? "5C" : "B8";

    return (
        <View
            style={[
                styles.pillSurface,
                compact ? styles.pillSurfaceCompact : styles.pillSurfaceRegular,
                {
                    borderColor: active
                        ? theme.colors.textLink + (theme.dark ? "38" : "24")
                        : theme.colors.divider + inactiveBorderOpacity,
                    backgroundColor: active
                        ? theme.dark
                            ? "#FFFFFF12"
                            : "#FFFFFFF6"
                        : pressed
                            ? theme.dark
                                ? "#FFFFFF14"
                                : "#FFFFFFF2"
                            : theme.dark
                                ? "#FFFFFF08"
                                : "#FFFFFFD8",
                },
            ]}
        >
            <BlurView
                intensity={compact ? 22 : 26}
                tint={blurTint}
                style={StyleSheet.absoluteFill}
            />
            <LinearGradient
                colors={
                    active
                        ? theme.dark
                            ? ["#FFFFFF12", theme.colors.textLink + "08", theme.colors.surface + "D4"]
                            : ["#FFFFFFFC", theme.colors.textLink + "08", theme.colors.surfaceHigh + "EE"]
                        : pressed
                            ? theme.dark
                                ? ["#FFFFFF16", theme.colors.surfaceHigh + "D8", theme.colors.surface + "CC"]
                                : ["#FFFFFFFA", theme.colors.surfaceHigh + "F0", theme.colors.surface + "E6"]
                            : theme.dark
                                ? ["#FFFFFF10", theme.colors.surfaceHigh + "CC", theme.colors.surface + "C4"]
                                : ["#FFFFFFF4", theme.colors.surfaceHigh + "E8", theme.colors.surface + restingOpacity]
                }
                start={{ x: 0.08, y: 0 }}
                end={{ x: 0.92, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            <LinearGradient
                colors={
                    active
                        ? [theme.colors.textLink + (theme.dark ? "12" : "10"), "transparent"]
                        : ["#FFFFFF55", "transparent"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            <View
                style={[
                    styles.topHighlight,
                    dense ? styles.topHighlightDense : null,
                    {
                        backgroundColor: active
                            ? theme.dark
                                ? "#FFFFFF18"
                                : "#FFFFFFB2"
                            : pressed
                                ? theme.dark
                                    ? "#FFFFFF18"
                                    : "#FFFFFFB8"
                                : theme.dark
                                    ? "#FFFFFF10"
                                    : "#FFFFFF88",
                    },
                ]}
            />
            <View
                style={[
                    compact ? styles.pillContentCompact : styles.pillContentRegular,
                    dense ? styles.pillContentDense : null,
                ]}
            >
                {children}
            </View>
        </View>
    );
});

export const SessionGlassTabBar = React.memo<SessionGlassTabBarProps>(
    function SessionGlassTabBar({
        tabs,
        activeTab,
        onChange,
        trailingAccessory,
        compact = false,
        scrollable = false,
        tabMinWidth,
        style,
    }) {
        const { theme } = useUnistyles();

        const renderTab = React.useCallback(
            (tab: SessionGlassTabBarItem) => {
                const active = tab.key === activeTab;
                const hasSecondary = !!tab.secondary;
                return (
                    <Pressable
                        key={tab.key}
                        onPress={() => onChange(tab.key)}
                        style={[
                            styles.tabPressable,
                            scrollable ? null : styles.tabPressableFill,
                            tabMinWidth ? { minWidth: tabMinWidth } : null,
                        ]}
                    >
                        {({ pressed }: PressableStateCallbackType) => (
                            <GlassPill
                                active={active}
                                compact={compact}
                                dense={hasSecondary}
                                pressed={pressed}
                            >
                                <View
                                    style={[
                                        hasSecondary ? styles.labelStack : styles.labelRow,
                                        compact ? styles.labelWrapCompact : styles.labelWrapRegular,
                                    ]}
                                >
                                    <Text
                                        adjustsFontSizeToFit
                                        minimumFontScale={hasSecondary ? 0.8 : 0.88}
                                        numberOfLines={1}
                                        style={[
                                            styles.label,
                                            hasSecondary
                                                ? compact
                                                    ? styles.labelWithSecondaryCompact
                                                    : styles.labelWithSecondaryRegular
                                                : compact
                                                    ? styles.labelCompact
                                                    : styles.labelRegular,
                                            active ? styles.labelActive : styles.labelInactive,
                                            hasSecondary
                                                ? styles.labelOpticalAlignDense
                                                : styles.labelOpticalAlign,
                                            {
                                                color: active
                                                    ? theme.colors.text
                                                    : theme.colors.textSecondary,
                                            },
                                        ]}
                                    >
                                        {tab.label}
                                    </Text>
                                    {tab.secondary ? (
                                        <View style={styles.secondaryWrap}>{tab.secondary}</View>
                                    ) : null}
                                    {tab.trailing && !tab.secondary ? (
                                        <View style={styles.trailing}>{tab.trailing}</View>
                                    ) : null}
                                </View>
                            </GlassPill>
                        )}
                    </Pressable>
                );
            },
            [activeTab, compact, onChange, scrollable, tabMinWidth, theme],
        );

        const tabNodes = React.useMemo(() => tabs.map(renderTab), [renderTab, tabs]);

        return (
            <View
                style={[
                    styles.container,
                    compact ? styles.containerCompact : styles.containerRegular,
                    style,
                ]}
            >
                {scrollable ? (
                    <ScrollView
                        style={styles.scrollView}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                    >
                        <View style={styles.scrollContent}>
                            {tabNodes}
                        </View>
                    </ScrollView>
                ) : (
                    <View style={styles.row}>{tabNodes}</View>
                )}

                {trailingAccessory ? (
                    <View
                        style={[
                            styles.accessoryWrap,
                            compact ? styles.accessoryWrapCompact : styles.accessoryWrapRegular,
                        ]}
                    >
                        <GlassPill active={false} compact={compact} dense={false} pressed={false}>
                            <View style={styles.accessoryContent}>{trailingAccessory}</View>
                        </GlassPill>
                    </View>
                ) : null}
            </View>
        );
    },
);

const styles = StyleSheet.create(() => ({
    container: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    containerRegular: {
        minHeight: 38,
    },
    containerCompact: {
        minHeight: 32,
    },
    row: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
    },
    scrollContent: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexGrow: 0,
    },
    scrollView: {
        flex: 1,
    },
    tabPressable: {
        minWidth: 0,
    },
    tabPressableFill: {
        flex: 1,
    },
    tabPressableScroll: {
        flexShrink: 0,
    },
    pillSurface: {
        borderWidth: 1,
        overflow: "hidden",
        position: "relative",
    },
    pillSurfaceRegular: {
        height: 38,
        borderRadius: 14,
    },
    pillSurfaceCompact: {
        height: 32,
        borderRadius: 12,
    },
    topHighlight: {
        position: "absolute",
        top: 0,
        left: 8,
        right: 8,
        height: 1,
        borderRadius: 999,
    },
    topHighlightDense: {
        left: 6,
        right: 6,
    },
    pillContentRegular: {
        flex: 1,
        paddingHorizontal: 12,
        paddingTop: 0,
        paddingBottom: 0,
        justifyContent: "center",
    },
    pillContentCompact: {
        flex: 1,
        paddingHorizontal: 10,
        paddingTop: 0,
        paddingBottom: 0,
        justifyContent: "center",
    },
    pillContentDense: {
        paddingTop: 0,
        paddingBottom: 0,
    },
    labelRow: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },
    labelStack: {
        width: "100%",
        minWidth: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
    },
    labelWrapRegular: {
        height: "100%",
    },
    labelWrapCompact: {
        height: "100%",
    },
    label: {
        textAlign: "center",
        includeFontPadding: false,
    },
    labelRegular: {
        fontSize: 13,
        lineHeight: 16,
    },
    labelCompact: {
        fontSize: 12,
        lineHeight: 14,
    },
    labelWithSecondaryRegular: {
        fontSize: 10,
        lineHeight: 11,
    },
    labelWithSecondaryCompact: {
        fontSize: 9,
        lineHeight: 10,
    },
    labelOpticalAlign: {
        marginTop: 0,
        marginBottom: 0,
    },
    labelOpticalAlignDense: {
        marginTop: 0,
        marginBottom: 0,
    },
    labelActive: {
        ...Typography.default("semiBold"),
    },
    labelInactive: {
        ...Typography.default(),
    },
    trailing: {
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
    },
    secondaryWrap: {
        width: "100%",
        minWidth: 0,
        alignItems: "center",
        justifyContent: "center",
        maxWidth: "100%",
        marginTop: 0,
        opacity: 0.94,
    },
    accessoryWrap: {
        flexShrink: 0,
    },
    accessoryWrapRegular: {
        width: 38,
    },
    accessoryWrapCompact: {
        width: 32,
    },
    accessoryContent: {
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 0,
        paddingVertical: 0,
    },
}));
