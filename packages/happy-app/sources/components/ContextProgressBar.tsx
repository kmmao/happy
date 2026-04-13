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

export type ContextUsageData = {
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    model?: string;
    categories?: Array<{ name: string; tokens: number; color?: string }>;
    isAutoCompactEnabled?: boolean;
    autoCompactThreshold?: number;
    messageBreakdown?: {
        toolCallTokens: number;
        toolResultTokens: number;
        attachmentTokens: number;
        assistantMessageTokens: number;
        userMessageTokens: number;
    };
};

export const ContextProgressBar: React.FC<{
    contextSize: number;
    alwaysShow: boolean;
    modelCode?: string | null;
    sdkContextWindow?: number;
    theme: Theme;
    sdkContextUsage?: ContextUsageData | null;
    extraSummary?: AnimatedTokensCostValue | null;
}> = ({ contextSize, alwaysShow, modelCode, sdkContextWindow, theme, sdkContextUsage, extraSummary }) => {
    const hasPreciseData = sdkContextUsage && sdkContextUsage.maxTokens > 0;
    const percentageUsed = hasPreciseData
        ? Math.min(100, sdkContextUsage.percentage)
        : (() => {
            const knownWindowSize = getContextWindowSize(modelCode, sdkContextWindow);
            const contextWindowSize = contextSize > knownWindowSize ? 1_000_000 : knownWindowSize;
            return Math.min(100, (contextSize / contextWindowSize) * 100);
        })();
    const percentageRemaining = Math.max(0, 100 - percentageUsed);
    const shouldShow = alwaysShow || percentageRemaining <= 10;

    if (!shouldShow) {
        return null;
    }

    const barColor = getProgressBarColor(percentageRemaining, theme);
    const usedTokens = hasPreciseData ? sdkContextUsage.totalTokens : contextSize;
    const maxTokens = hasPreciseData
        ? sdkContextUsage.maxTokens
        : (() => {
            const knownWindowSize = getContextWindowSize(modelCode, sdkContextWindow);
            return contextSize > knownWindowSize ? 1_000_000 : knownWindowSize;
        })();
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
            <Text
                style={{
                    fontSize: 10,
                    color: barColor,
                    textAlign: "right",
                    ...Typography.default(),
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
    );
};
