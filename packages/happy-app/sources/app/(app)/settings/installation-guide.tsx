import React from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Typography } from "@/constants/Typography";
import { useLayout } from "@/components/layout";
import { Modal } from "@/modal";
import { t } from "@/text";

type Platform = "mac" | "windows" | "linux";

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    // Platform selector
    platformSelector: {
        flexDirection: "row" as const,
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 10,
        padding: 3,
        marginBottom: 24,
    },
    platformButton: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        paddingVertical: 8,
        borderRadius: 8,
    },
    platformButtonActive: {
        backgroundColor: theme.colors.surface,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    platformButtonText: {
        ...Typography.default("regular"),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginLeft: 4,
    },
    platformButtonTextActive: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.text,
        marginLeft: 4,
    },
    // Section
    sectionContainer: {
        marginBottom: 24,
    },
    sectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        lineHeight: 26,
        color: theme.colors.text,
        marginBottom: 12,
    },
    // Step card
    stepContainer: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    stepHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginBottom: 8,
    },
    stepNumber: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.surfaceHigh,
        backgroundColor: theme.colors.accentBlue,
        width: 24,
        height: 24,
        borderRadius: 12,
        textAlign: "center" as const,
        lineHeight: 24,
        marginRight: 10,
        overflow: "hidden" as const,
    },
    stepTitle: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.text,
        flex: 1,
    },
    stepDescription: {
        ...Typography.default("regular"),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.textSecondary,
        marginBottom: 4,
    },
    // Code block with copy
    codeContainer: {
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        marginTop: 8,
        overflow: "hidden" as const,
    },
    codeContent: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
    },
    codeText: {
        ...Typography.mono("regular"),
        fontSize: 13,
        lineHeight: 20,
        color: theme.colors.textLink,
        flex: 1,
        flexShrink: 1,
        paddingLeft: 12,
        paddingTop: 10,
        paddingBottom: 10,
        paddingRight: 4,
    },
    copyButton: {
        padding: 10,
        flexShrink: 0,
        alignSelf: "flex-start" as const,
    },
    // Tip
    tipContainer: {
        flexDirection: "row" as const,
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 8,
        padding: 10,
        marginTop: 8,
    },
    tipIcon: {
        flexShrink: 0,
        marginTop: 2,
    },
    tipText: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        flex: 1,
        flexShrink: 1,
        marginLeft: 6,
    },
    // Note
    noteContainer: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 12,
        padding: 16,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.accentOrange,
        marginBottom: 24,
    },
    noteTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.accentOrange,
        marginBottom: 4,
    },
    noteText: {
        ...Typography.default("regular"),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
}));

function CodeBlock({ code, theme }: { code: string; theme: { colors: { textSecondary: string } } }) {
    const handleCopy = async () => {
        await Clipboard.setStringAsync(code);
        Modal.toast(t("installGuide.copied"));
    };

    return (
        <View style={styles.codeContainer}>
            <View style={styles.codeContent}>
                <Text style={styles.codeText} selectable>{code}</Text>
                <Pressable onPress={handleCopy} style={styles.copyButton}>
                    <Ionicons name="copy-outline" size={18} color={theme.colors.textSecondary} />
                </Pressable>
            </View>
        </View>
    );
}

function Tip({ text }: { text: string }) {
    return (
        <View style={styles.tipContainer}>
            <Ionicons name="bulb-outline" size={14} color="#FF9500" style={styles.tipIcon} />
            <Text style={styles.tipText}>{text}</Text>
        </View>
    );
}

function Step({
    number,
    title,
    description,
    code,
    tip,
    theme,
}: {
    number: number;
    title: string;
    description: string;
    code?: string;
    tip?: string;
    theme: { colors: { textSecondary: string } };
}) {
    return (
        <View style={styles.stepContainer}>
            <View style={styles.stepHeader}>
                <Text style={styles.stepNumber}>{number}</Text>
                <Text style={styles.stepTitle}>{title}</Text>
            </View>
            <Text style={styles.stepDescription}>{description}</Text>
            {code && <CodeBlock code={code} theme={theme} />}
            {tip && <Tip text={tip} />}
        </View>
    );
}

function PlatformSelector({
    selected,
    onSelect,
    theme,
}: {
    selected: Platform;
    onSelect: (p: Platform) => void;
    theme: { colors: { textSecondary: string } };
}) {
    const platforms: { key: Platform; label: string; icon: "logo-apple" | "logo-windows" | "logo-tux" }[] = [
        { key: "mac", label: "macOS", icon: "logo-apple" },
        { key: "windows", label: "Windows", icon: "logo-windows" },
        { key: "linux", label: "Linux", icon: "logo-tux" },
    ];

    return (
        <View style={styles.platformSelector}>
            {platforms.map((p) => (
                <Pressable
                    key={p.key}
                    style={[
                        styles.platformButton,
                        selected === p.key && styles.platformButtonActive,
                    ]}
                    onPress={() => onSelect(p.key)}
                >
                    <Ionicons
                        name={p.icon}
                        size={16}
                        color={selected === p.key ? theme.colors.textSecondary : theme.colors.textSecondary}
                    />
                    <Text
                        style={
                            selected === p.key
                                ? styles.platformButtonTextActive
                                : styles.platformButtonText
                        }
                    >
                        {p.label}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

const NODE_INSTALL_CMD: Record<Platform, string> = {
    mac: "brew install node",
    windows: "winget install OpenJS.NodeJS.LTS",
    linux: "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs",
};

const ZSH_INSTALL_CMD: Record<Platform, string> = {
    mac: "brew install zsh",
    windows: "",
    linux: "sudo apt-get install -y zsh && chsh -s $(which zsh)",
};

const OHMYZSH_INSTALL_CMD = 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"';

const CLAUDE_INSTALL_CMD = "curl -fsSL https://claude.ai/install.sh | bash";
const HAPPY_INSTALL_CMD = "npm install -g @kmmao/happy-coder";

function InstallationGuideScreen() {
    const layout = useLayout();
    const insets = useSafeAreaInsets();
    const { theme } = require("react-native-unistyles").useUnistyles();
    const [platform, setPlatform] = React.useState<Platform>("mac");

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.container}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingBottom: insets.bottom + 40,
                        maxWidth: layout.maxWidth,
                        alignSelf: "center",
                        width: "100%",
                    },
                ]}
                showsVerticalScrollIndicator={false}
            >
                {/* Platform Selector */}
                <PlatformSelector
                    selected={platform}
                    onSelect={setPlatform}
                    theme={theme}
                />

                {/* Step 1: Open Terminal */}
                <View style={styles.sectionContainer}>
                    <Text style={styles.sectionTitle}>
                        {t("installGuide.openTerminalSection")}
                    </Text>
                    <Step
                        number={1}
                        title={t("installGuide.openTerminalTitle")}
                        description={t(`installGuide.openTerminal_${platform}`)}
                        tip={platform === "windows" ? t("installGuide.openTerminalTipWindows") : undefined}
                        theme={theme}
                    />
                </View>

                {/* Step 2: Install Node.js */}
                <View style={styles.sectionContainer}>
                    <Text style={styles.sectionTitle}>
                        {t("installGuide.installNodeSection")}
                    </Text>
                    <Step
                        number={1}
                        title={t("installGuide.checkNodeTitle")}
                        description={t("installGuide.checkNodeDescription")}
                        code="node --version"
                        theme={theme}
                    />
                    <Step
                        number={2}
                        title={t("installGuide.installNodeTitle")}
                        description={t(`installGuide.installNode_${platform}`)}
                        code={NODE_INSTALL_CMD[platform]}
                        tip={platform === "mac" ? t("installGuide.installNodeTipMac") : undefined}
                        theme={theme}
                    />
                </View>

                {/* Step 3: Install Zsh (optional but recommended) */}
                {platform !== "windows" && (
                    <View style={styles.sectionContainer}>
                        <Text style={styles.sectionTitle}>
                            {t("installGuide.installZshSection")}
                        </Text>
                        <Step
                            number={1}
                            title={t("installGuide.installZshTitle")}
                            description={t(`installGuide.installZsh_${platform}`)}
                            code={ZSH_INSTALL_CMD[platform]}
                            theme={theme}
                        />
                        <Step
                            number={2}
                            title={t("installGuide.installOhMyZshTitle")}
                            description={t("installGuide.installOhMyZshDescription")}
                            code={OHMYZSH_INSTALL_CMD}
                            theme={theme}
                        />
                        <Step
                            number={3}
                            title={t("installGuide.zshPluginsTitle")}
                            description={t("installGuide.zshPluginsDescription")}
                            tip={t("installGuide.zshPluginsTip")}
                            theme={theme}
                        />
                    </View>
                )}

                {/* Step 4: Install Claude Code */}
                <View style={styles.sectionContainer}>
                    <Text style={styles.sectionTitle}>
                        {t("installGuide.installClaudeSection")}
                    </Text>
                    <Step
                        number={1}
                        title={t("installGuide.installClaudeTitle")}
                        description={t("installGuide.installClaudeDescription")}
                        code={platform === "windows" ? "npm install -g @anthropic-ai/claude-code" : CLAUDE_INSTALL_CMD}
                        theme={theme}
                    />
                    <Step
                        number={2}
                        title={t("installGuide.loginClaudeTitle")}
                        description={t("installGuide.loginClaudeDescription")}
                        code="claude"
                        theme={theme}
                    />
                    <Step
                        number={3}
                        title={t("installGuide.claudeApiKeyTitle")}
                        description={t("installGuide.claudeApiKeyDescription")}
                        code="export ANTHROPIC_API_KEY=sk-ant-xxxxx"
                        tip={t("installGuide.claudeApiKeyTip")}
                        theme={theme}
                    />
                </View>

                {/* Step 5: Install Happy Coder */}
                <View style={styles.sectionContainer}>
                    <Text style={styles.sectionTitle}>
                        {t("installGuide.installHappySection")}
                    </Text>
                    <Step
                        number={1}
                        title={t("installGuide.installHappyTitle")}
                        description={t("installGuide.installHappyDescription")}
                        code={HAPPY_INSTALL_CMD}
                        theme={theme}
                    />
                </View>

                {/* Step 6: Start & Connect */}
                <View style={styles.sectionContainer}>
                    <Text style={styles.sectionTitle}>
                        {t("installGuide.startConnectSection")}
                    </Text>
                    <Step
                        number={1}
                        title={t("installGuide.startSessionTitle")}
                        description={t("installGuide.startSessionDescription")}
                        code="happy"
                        theme={theme}
                    />
                    <Step
                        number={2}
                        title={t("installGuide.scanQrTitle")}
                        description={t("installGuide.scanQrDescription")}
                        theme={theme}
                    />
                </View>

                {/* Other Agents */}
                <View style={styles.sectionContainer}>
                    <Text style={styles.sectionTitle}>
                        {t("installGuide.otherAgents")}
                    </Text>
                    <Step
                        number={1}
                        title={t("installGuide.geminiTitle")}
                        description={t("installGuide.geminiDescription")}
                        code="happy connect gemini && happy gemini"
                        theme={theme}
                    />
                    <Step
                        number={2}
                        title={t("installGuide.codexTitle")}
                        description={t("installGuide.codexDescription")}
                        code="happy codex"
                        theme={theme}
                    />
                </View>

                {/* Useful Commands */}
                <View style={styles.sectionContainer}>
                    <Text style={styles.sectionTitle}>
                        {t("installGuide.usefulCommands")}
                    </Text>
                    <Step
                        number={1}
                        title={t("installGuide.doctorTitle")}
                        description={t("installGuide.doctorDescription")}
                        code="happy doctor"
                        theme={theme}
                    />
                    <Step
                        number={2}
                        title={t("installGuide.updateTitle")}
                        description={t("installGuide.updateDescription")}
                        code="npm update -g @kmmao/happy-coder"
                        theme={theme}
                    />
                </View>

                {/* Note */}
                <View style={styles.noteContainer}>
                    <Text style={styles.noteTitle}>
                        {t("installGuide.noteTitle")}
                    </Text>
                    <Text style={styles.noteText}>
                        {t("installGuide.noteDescription")}
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
}

export default React.memo(InstallationGuideScreen);
