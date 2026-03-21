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
    return null; // No display needed
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

export const ContextProgressBar: React.FC<{
    contextSize: number;
    alwaysShow: boolean;
    modelCode?: string | null;
    sdkContextWindow?: number;
    theme: Theme;
}> = ({ contextSize, alwaysShow, modelCode, sdkContextWindow, theme }) => {
    // Use SDK-provided window size if available; fall back to model-aware heuristic
    const knownWindowSize = getContextWindowSize(modelCode, sdkContextWindow);
    const contextWindowSize =
        contextSize > knownWindowSize ? 1_000_000 : knownWindowSize;
    const percentageUsed = Math.min(100, (contextSize / contextWindowSize) * 100);
    const percentageRemaining = Math.max(0, 100 - percentageUsed);
    const shouldShow = alwaysShow || percentageRemaining <= 10;

    // When context bar is hidden, return null — CompactStatus (InputFAB) already shows tokens/cost
    if (!shouldShow) {
        return null;
    }

    const barColor = getProgressBarColor(percentageRemaining, theme);
    const label = `${Math.round(percentageRemaining)}% left · ${formatTokenCountShort(contextSize)}/${formatTokenCountShort(contextWindowSize)}`;

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
            >
                {label}
            </Text>
        </View>
    );
};
