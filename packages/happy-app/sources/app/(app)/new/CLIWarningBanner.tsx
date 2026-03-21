import React from "react";
import { View, Text, Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";

type CLIType = "claude" | "codex" | "gemini";

interface CLIWarningBannerProps {
    cli: CLIType;
    onDismiss: (cli: CLIType, type: "temporary" | "machine" | "global") => void;
}

const CLI_CONFIG: Record<CLIType, {
    title: string;
    installText: string;
    docsUrl: string;
    docsLabel: string;
}> = {
    claude: {
        title: "Claude CLI Not Detected",
        installText: "Install: npm install -g @anthropic-ai/claude-code \u2022",
        docsUrl: "https://docs.anthropic.com/en/docs/claude-code/installation",
        docsLabel: "View Installation Guide \u2192",
    },
    codex: {
        title: "Codex CLI Not Detected",
        installText: "Install: npm install -g codex-cli \u2022",
        docsUrl: "https://github.com/openai/openai-codex",
        docsLabel: "View Installation Guide \u2192",
    },
    gemini: {
        title: "Gemini CLI Not Detected",
        installText: "Install gemini CLI if available \u2022",
        docsUrl: "https://ai.google.dev/gemini-api/docs/get-started",
        docsLabel: "View Gemini Docs \u2192",
    },
};

export const CLIWarningBanner = React.memo(function CLIWarningBanner({
    cli,
    onDismiss,
}: CLIWarningBannerProps) {
    const { theme } = useUnistyles();
    const config = CLI_CONFIG[cli];

    return (
        <View
            style={{
                backgroundColor: theme.colors.box.warning.background,
                borderRadius: 10,
                padding: 12,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: theme.colors.box.warning.border,
            }}
        >
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: 6,
                }}
            >
                <View
                    style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 6,
                        marginRight: 16,
                    }}
                >
                    <Ionicons
                        name="warning"
                        size={16}
                        color={theme.colors.warning}
                    />
                    <Text
                        style={{
                            fontSize: 13,
                            fontWeight: "600",
                            color: theme.colors.text,
                            ...Typography.default("semiBold"),
                        }}
                    >
                        {config.title}
                    </Text>
                    <View style={{ flex: 1, minWidth: 20 }} />
                    <Text
                        style={{
                            fontSize: 10,
                            color: theme.colors.textSecondary,
                            ...Typography.default(),
                        }}
                    >
                        Don't show this popup for
                    </Text>
                    <Pressable
                        onPress={() => onDismiss(cli, "machine")}
                        style={{
                            borderRadius: 4,
                            borderWidth: 1,
                            borderColor: theme.colors.textSecondary,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 10,
                                color: theme.colors.textSecondary,
                                ...Typography.default(),
                            }}
                        >
                            this machine
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={() => onDismiss(cli, "global")}
                        style={{
                            borderRadius: 4,
                            borderWidth: 1,
                            borderColor: theme.colors.textSecondary,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 10,
                                color: theme.colors.textSecondary,
                                ...Typography.default(),
                            }}
                        >
                            any machine
                        </Text>
                    </Pressable>
                </View>
                <Pressable
                    onPress={() => onDismiss(cli, "temporary")}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons
                        name="close"
                        size={18}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
            </View>
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 4,
                }}
            >
                <Text
                    style={{
                        fontSize: 11,
                        color: theme.colors.textSecondary,
                        ...Typography.default(),
                    }}
                >
                    {config.installText}
                </Text>
                <Pressable
                    onPress={() => {
                        if (Platform.OS === "web") {
                            window.open(config.docsUrl, "_blank");
                        }
                    }}
                >
                    <Text
                        style={{
                            fontSize: 11,
                            color: theme.colors.textLink,
                            ...Typography.default(),
                        }}
                    >
                        {config.docsLabel}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});
