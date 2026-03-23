import React from "react";
import { View, Text, Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useUnistyles } from "react-native-unistyles";

type CLIType = "claude" | "codex" | "gemini";

interface CLIWarningBannerProps {
    cli: CLIType;
    onDismiss: (cli: CLIType, type: "temporary" | "machine" | "global") => void;
}

const CLI_CONFIG: Record<CLIType, {
    titleKey: "components.cliWarningBanner.claudeNotDetected" | "components.cliWarningBanner.codexNotDetected" | "components.cliWarningBanner.geminiNotDetected";
    installTextKey: "components.cliWarningBanner.claudeInstallText" | "components.cliWarningBanner.codexInstallText" | "components.cliWarningBanner.geminiInstallText";
    docsUrl: string;
    docsLabelKey: "components.cliWarningBanner.claudeDocsLabel" | "components.cliWarningBanner.codexDocsLabel" | "components.cliWarningBanner.geminiDocsLabel";
}> = {
    claude: {
        titleKey: "components.cliWarningBanner.claudeNotDetected",
        installTextKey: "components.cliWarningBanner.claudeInstallText",
        docsUrl: "https://docs.anthropic.com/en/docs/claude-code/installation",
        docsLabelKey: "components.cliWarningBanner.claudeDocsLabel",
    },
    codex: {
        titleKey: "components.cliWarningBanner.codexNotDetected",
        installTextKey: "components.cliWarningBanner.codexInstallText",
        docsUrl: "https://github.com/openai/openai-codex",
        docsLabelKey: "components.cliWarningBanner.codexDocsLabel",
    },
    gemini: {
        titleKey: "components.cliWarningBanner.geminiNotDetected",
        installTextKey: "components.cliWarningBanner.geminiInstallText",
        docsUrl: "https://ai.google.dev/gemini-api/docs/get-started",
        docsLabelKey: "components.cliWarningBanner.geminiDocsLabel",
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
                        {t(config.titleKey)}
                    </Text>
                    <View style={{ flex: 1, minWidth: 20 }} />
                    <Text
                        style={{
                            fontSize: 10,
                            color: theme.colors.textSecondary,
                            ...Typography.default(),
                        }}
                    >
                        {t("components.cliWarningBanner.dontShowPopupFor")}
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
                            {t("components.cliWarningBanner.thisMachine")}
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
                            {t("components.cliWarningBanner.anyMachine")}
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
                    {t(config.installTextKey)}
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
                        {t(config.docsLabelKey)}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});
