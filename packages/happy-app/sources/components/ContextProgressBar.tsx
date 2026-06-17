import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { Typography } from "@/constants/Typography";
import { Theme } from "@/theme";
import { t } from "@/text";
import {
    formatTokenCount,
    formatTokenCountShort,
    getContextWindowSize,
} from "@/utils/formatUsage";
import type { AnimatedTokensCostValue } from "./AnimatedTokensCost";
import {
    getContextBreakdownItems,
    getContextBreakdownSource,
    type ContextUsageData,
} from "./contextBreakdown";
import { ContextBreakdownPanel } from "./ContextBreakdownPanel";

export const getContextWarning = (
    contextSize: number,
    alwaysShow: boolean = false,
    theme: Theme,
    totalTokens?: number,
    modelCode?: string | null,
    sdkContextWindow?: number,
) => {
    const knownWindowSize = getContextWindowSize(modelCode, sdkContextWindow);
    const contextWindowSize =
        contextSize > knownWindowSize ? 1_000_000 : knownWindowSize;
    const percentageUsed = (contextSize / contextWindowSize) * 100;
    const percentageRemaining = Math.max(0, Math.min(100, 100 - percentageUsed));

    const contextText = t("agentInput.context.remaining", {
        percent: Math.round(percentageRemaining),
    });
    const tokenSuffix =
        alwaysShow && totalTokens ? ` · ${formatTokenCount(totalTokens)}` : "";

    if (percentageRemaining <= 5) {
        return {
            text: contextText + tokenSuffix,
            color: theme.colors.warningCritical,
        };
    } else if (percentageRemaining <= 10) {
        return {
            text: contextText + tokenSuffix,
            color: theme.colors.warning,
        };
    } else if (alwaysShow) {
        return {
            text: contextText + tokenSuffix,
            color: theme.colors.textSecondary,
        };
    }
    return null;
};

export const getProgressBarColor = (
    percentageRemaining: number,
    theme: Theme,
): string => {
    if (percentageRemaining <= 5) {
        return theme.colors.warningCritical;
    } else if (percentageRemaining <= 20) {
        return "#FF9500";
    }
    return theme.colors.success;
};

export type { ContextUsageData } from "./contextBreakdown";

export const ContextProgressBar: React.FC<{
    contextSize: number;
    alwaysShow: boolean;
    modelCode?: string | null;
    sdkContextWindow?: number;
    theme: Theme;
    sdkContextUsage?: ContextUsageData | null;
    extraSummary?: AnimatedTokensCostValue | null;
    /**
     * AUTO/1M toggle rendered to the right of the percentage label. When
     * provided, the bar renders even when usage is below the 10% warning
     * threshold so the chip stays reachable.
     */
    autoCompact?: {
        enabled: boolean;
        onToggle: (next: boolean) => void;
    };
}> = ({ contextSize, alwaysShow, modelCode, sdkContextWindow, theme, sdkContextUsage, extraSummary, autoCompact }) => {
    const hasPreciseData = Boolean(sdkContextUsage && sdkContextUsage.maxTokens > 0);
    const usedTokens = hasPreciseData ? sdkContextUsage!.totalTokens : contextSize;
    const resolvedContextWindow = (() => {
        const reportedWindow = hasPreciseData
            ? sdkContextUsage!.maxTokens
            : sdkContextWindow;
        const knownWindowSize = getContextWindowSize(modelCode, reportedWindow);
        return usedTokens > knownWindowSize ? 1_000_000 : knownWindowSize;
    })();
    const breakdownItems = React.useMemo(
        () => getContextBreakdownItems(sdkContextUsage, t),
        [sdkContextUsage],
    );
    const breakdownSource = React.useMemo(
        () => getContextBreakdownSource(sdkContextUsage),
        [sdkContextUsage],
    );
    const percentageUsed = Math.min(100, (usedTokens / resolvedContextWindow) * 100);
    const percentageRemaining = Math.max(0, 100 - percentageUsed);
    // Show the bar whenever there's a toggle to render — the chip must stay
    // reachable, not gated on the original "<=10% left" warning threshold.
    const shouldShowLabel = alwaysShow || percentageRemaining <= 10;
    const shouldShow = shouldShowLabel || Boolean(autoCompact);

    if (!shouldShow) {
        return null;
    }

    const barColor = getProgressBarColor(percentageRemaining, theme);
    const maxTokens = resolvedContextWindow;
    const label = `${Math.round(percentageRemaining)}% left · ${formatTokenCountShort(usedTokens)}/${formatTokenCountShort(maxTokens)}`;

    return (
        <View style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2 }}>
            <View
                style={{
                    height: 3,
                    backgroundColor: theme.colors.divider,
                    borderRadius: 3,
                    overflow: "hidden",
                    marginBottom: 3,
                }}
            >
                <View
                    style={{
                        height: "100%",
                        width: `${percentageUsed}%`,
                        backgroundColor: barColor,
                        borderRadius: 3,
                    }}
                />
            </View>
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 8,
                }}
            >
                {shouldShowLabel ? (
                    <Text
                        style={{
                            fontSize: 10,
                            color: barColor,
                            textAlign: "right",
                            ...Typography.default(),
                            flexShrink: 1,
                        }}
                        numberOfLines={1}
                    >
                        {label}
                        {extraSummary?.tokensLabel ? (
                    <Text style={{ color: theme.colors.textSecondary }}>
                        {` · `}
                        <Text style={{ color: theme.colors.textLink }}>
                            {extraSummary.tokensLabel}
                        </Text>
                        {extraSummary.costLabel ? (
                            <Text style={{ color: theme.colors.accentOrange }}>
                                {` · ${extraSummary.costLabel}`}
                            </Text>
                        ) : null}
                        {extraSummary.durationLabel ? (
                            <Text style={{ color: theme.colors.success }}>
                                {` · ${extraSummary.durationLabel}`}
                            </Text>
                        ) : null}
                    </Text>
                ) : null}
                    </Text>
                ) : null}
                {autoCompact ? (
                    <Pressable
                        onPress={() => autoCompact.onToggle(!autoCompact.enabled)}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={
                            autoCompact.enabled
                                ? t("agentInput.context.autoCompactHintOn")
                                : t("agentInput.context.autoCompactHintOff")
                        }
                        style={({ pressed }) => ({
                            paddingHorizontal: 6,
                            paddingVertical: 1,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: autoCompact.enabled
                                ? theme.colors.success
                                : theme.colors.textLink,
                            backgroundColor: autoCompact.enabled
                                ? "transparent"
                                : theme.colors.textLink + "1A",
                            opacity: pressed ? 0.55 : 1,
                        })}
                    >
                        <Text
                            style={{
                                fontSize: 9,
                                ...Typography.default("semiBold"),
                                color: autoCompact.enabled
                                    ? theme.colors.success
                                    : theme.colors.textLink,
                            }}
                        >
                            {autoCompact.enabled
                                ? t("agentInput.context.autoCompactOn")
                                : t("agentInput.context.autoCompactOff")}
                        </Text>
                    </Pressable>
                ) : null}
            </View>
            <ContextBreakdownPanel
                items={breakdownItems}
                source={breakdownSource}
                theme={theme}
            />
        </View>
    );
};
