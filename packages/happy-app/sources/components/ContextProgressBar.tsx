import * as React from "react";
import { View, Text } from "react-native";
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
}> = ({ contextSize, alwaysShow, modelCode, sdkContextWindow, theme, sdkContextUsage, extraSummary }) => {
    const hasPreciseData = Boolean(sdkContextUsage && sdkContextUsage.maxTokens > 0);
    const usedTokens = hasPreciseData ? sdkContextUsage!.totalTokens : contextSize;
    // Honest display: window size comes from SDK report or modelCode mapping;
    // we no longer fall back to 1M when usage exceeds the window. A session
    // that picked the default tier (200K) and went over shows >100% rather
    // than silently being rebranded as 1M. The 1M tier is now an explicit
    // modelMode choice (e.g. `opus-4-7-1m`).
    const resolvedContextWindow = getContextWindowSize(
        modelCode,
        hasPreciseData ? sdkContextUsage!.maxTokens : sdkContextWindow,
    );
    const breakdownItems = React.useMemo(
        () => getContextBreakdownItems(sdkContextUsage, t),
        [sdkContextUsage],
    );
    const breakdownSource = React.useMemo(
        () => getContextBreakdownSource(sdkContextUsage),
        [sdkContextUsage],
    );
    const percentageUsed = (usedTokens / resolvedContextWindow) * 100;
    const percentageRemaining = Math.max(0, 100 - percentageUsed);
    const shouldShowLabel = alwaysShow || percentageRemaining <= 10;

    if (!shouldShowLabel) {
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
            </View>
            <ContextBreakdownPanel
                items={breakdownItems}
                source={breakdownSource}
                theme={theme}
            />
        </View>
    );
};
