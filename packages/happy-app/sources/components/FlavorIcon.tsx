import * as React from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

const flavorIcons = {
    claude: require("@/assets/images/icon-claude.png"),
    codex: require("@/assets/images/icon-gpt.png"),
    gemini: require("@/assets/images/icon-gemini.png"),
    deepseek: require("@/assets/images/icon-deepseek.png"),
    zai: require("@/assets/images/icon-zai.png"),
    minimax: require("@/assets/images/icon-minimax.png"),
    kimi: require("@/assets/images/icon-kimi.png"),
    "azure-openai": require("@/assets/images/icon-azure-openai.png"),
    opencode: require("@/assets/images/openclaw-icon-color.png"),
    acp: require("@/assets/images/openclaw-icon-color.png"),
};

function normalizeProviderKey(value: string | null | undefined): keyof typeof flavorIcons | null {
    const key = value?.toLowerCase();
    if (!key || key.trim().length === 0) {
        return null;
    }
    if (key === "deepseek") {
        return "deepseek";
    }
    if (key === "zai" || key === "z.ai" || key.includes("chatglm")) {
        return "zai";
    }
    if (key === "minimax") {
        return "minimax";
    }
    if (key === "kimi" || key.includes("moonshot")) {
        return "kimi";
    }
    if (key === "azure-openai" || (key.includes("azure") && key.includes("openai"))) {
        return "azure-openai";
    }
    if (key === "openai" || key === "gpt") {
        return "codex";
    }
    if (key === "codex") {
        return "codex";
    }
    if (key === "claude" || key === "anthropic") {
        return "claude";
    }
    if (key === "opencode") {
        return "opencode";
    }
    if (key === "acp") {
        return "acp";
    }
    if (key === "gemini") {
        return "gemini";
    }
    return null;
}

function resolveIconKey(
    provider: string | null | undefined,
    flavor: string | null | undefined,
): keyof typeof flavorIcons {
    return normalizeProviderKey(provider) ?? normalizeProviderKey(flavor) ?? "claude";
}

interface FlavorIconProps {
    flavor: string | null | undefined;
    provider?: string | null;
    size?: number;
}

const styles = StyleSheet.create({
    iconMask: {
        borderRadius: 999,
        overflow: "hidden",
    },
    iconFill: {
        borderRadius: 999,
    },
});

export const FlavorIcon = React.memo(
    ({ flavor, provider, size = 24 }: FlavorIconProps) => {
        const { theme } = useUnistyles();
        const normalizedFlavor = resolveIconKey(provider, flavor);
        const icon = flavorIcons[normalizedFlavor];

        return (
            <View style={[styles.iconMask, { width: size, height: size }]}>
                <Image
                    source={icon}
                    style={[styles.iconFill, { width: size, height: size }]}
                    contentFit="contain"
                    tintColor={
                        normalizedFlavor === "codex" ? theme.colors.text : undefined
                    }
                />
            </View>
        );
    },
);
