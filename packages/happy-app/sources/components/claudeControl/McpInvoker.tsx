import * as React from "react";
import { View, Text, TextInput, Pressable, ScrollView, Switch } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import {
    invokeMcpCall,
    generateMcpConfirmToken,
} from "@/sync/apiClaudeControl";
import { useHappyAction } from "@/hooks/useHappyAction";
import type { McpCallResponse } from "@kmmao/happy-wire";

interface McpInvokerProps {
    sessionId: string;
    initialTool?: string;
    onClose: () => void;
}

function errorText(
    code: NonNullable<McpCallResponse["errorCode"]>,
): string {
    switch (code) {
        case "not_whitelisted":
            return t("claudeControl.mcp.errorNotWhitelisted");
        case "server_unavailable":
            return t("claudeControl.mcp.errorServerUnavailable");
        case "tool_not_found":
            return t("claudeControl.mcp.errorToolNotFound");
        case "invalid_arguments":
            return t("claudeControl.mcp.errorInvalidArguments");
        case "permission_denied":
            return t("claudeControl.mcp.errorPermissionDenied");
        case "unknown":
            return t("claudeControl.mcp.errorUnknown");
    }
}

/**
 * 2-step MCP tool invoker. Step 1 collects tool name + JSON arguments; step
 * 2 requires an explicit "I understand" checkbox before the Invoke button
 * enables. Generates a clientConfirmToken nonce per invocation that CLI
 * logs for the audit trail.
 *
 * The remote CLI is default-deny — expect `errorNotWhitelisted` unless the
 * operator has opted in via `HAPPY_SIDEBAR_MCP_WHITELIST`. Full MCP client
 * invocation is stubbed on the CLI side; response often returns
 * `errorServerUnavailable` as a safe placeholder.
 */
export const McpInvoker = React.memo(function McpInvoker({
    sessionId,
    initialTool = "",
    onClose,
}: McpInvokerProps) {
    const [step, setStep] = React.useState<1 | 2>(1);
    const [tool, setTool] = React.useState(initialTool);
    const [argsJson, setArgsJson] = React.useState("{}");
    const [confirmed, setConfirmed] = React.useState(false);
    const [response, setResponse] = React.useState<McpCallResponse | null>(null);
    const [parseError, setParseError] = React.useState<string | null>(null);

    const [loading, invoke] = useHappyAction(async () => {
        let parsedArgs: Record<string, unknown> = {};
        if (argsJson.trim()) {
            try {
                const parsed = JSON.parse(argsJson);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    parsedArgs = parsed as Record<string, unknown>;
                    setParseError(null);
                } else {
                    setParseError("arguments must be a JSON object");
                    return;
                }
            } catch (e) {
                setParseError(e instanceof Error ? e.message : String(e));
                return;
            }
        }
        const token = generateMcpConfirmToken();
        const res = await invokeMcpCall(sessionId, {
            tool,
            arguments: parsedArgs,
            clientConfirmToken: token,
        });
        setResponse(res);
    });

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>
                    {t("claudeControl.mcp.title")}
                </Text>
                <Pressable onPress={onClose} style={styles.closeBtn}>
                    <Text style={styles.closeText}>
                        {t("claudeControl.fileViewer.close")}
                    </Text>
                </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.body}>
                <Text style={styles.stepLabel}>
                    {step === 1
                        ? t("claudeControl.mcp.stepSelect")
                        : t("claudeControl.mcp.stepConfirm")}
                </Text>

                {step === 1 && (
                    <>
                        <Text style={styles.fieldLabel}>tool</Text>
                        <TextInput
                            value={tool}
                            onChangeText={setTool}
                            placeholder="mcp__server__tool"
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.input}
                        />
                        <Text style={styles.fieldLabel}>arguments (JSON)</Text>
                        <TextInput
                            value={argsJson}
                            onChangeText={setArgsJson}
                            placeholder='{"key":"value"}'
                            autoCapitalize="none"
                            autoCorrect={false}
                            multiline
                            style={[styles.input, styles.jsonInput]}
                        />
                        {parseError && (
                            <Text style={styles.errorText}>{parseError}</Text>
                        )}
                        <Pressable
                            onPress={() => setStep(2)}
                            disabled={!tool.trim()}
                            style={({ pressed }) => [
                                styles.primaryBtn,
                                (!tool.trim() || pressed) &&
                                    styles.primaryBtnMuted,
                            ]}
                        >
                            <Text style={styles.primaryBtnText}>
                                {t("claudeControl.mcp.stepConfirm")}
                            </Text>
                        </Pressable>
                    </>
                )}

                {step === 2 && (
                    <>
                        <Text style={styles.reviewHeading}>
                            {t("claudeControl.mcp.reviewHeading")}
                        </Text>
                        <View style={styles.reviewCard}>
                            <Text style={styles.fieldLabel}>tool</Text>
                            <Text style={styles.reviewValue}>{tool}</Text>
                            <Text style={[styles.fieldLabel, { marginTop: 8 }]}>
                                arguments
                            </Text>
                            <Text style={styles.reviewJson}>{argsJson}</Text>
                        </View>

                        <View style={styles.confirmRow}>
                            <Switch
                                value={confirmed}
                                onValueChange={setConfirmed}
                            />
                            <Text style={styles.confirmText}>
                                {t("claudeControl.mcp.confirmCheckbox")}
                            </Text>
                        </View>

                        <View style={styles.actionRow}>
                            <Pressable
                                onPress={() => setStep(1)}
                                style={({ pressed }) => [
                                    styles.secondaryBtn,
                                    pressed && { opacity: 0.7 },
                                ]}
                            >
                                <Text style={styles.secondaryBtnText}>
                                    {t("claudeControl.mcp.stepSelect")}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={invoke}
                                disabled={!confirmed || loading}
                                style={({ pressed }) => [
                                    styles.primaryBtn,
                                    (!confirmed || loading || pressed) &&
                                        styles.primaryBtnMuted,
                                ]}
                            >
                                <Text style={styles.primaryBtnText}>
                                    {t("claudeControl.mcp.invoke")}
                                </Text>
                            </Pressable>
                        </View>

                        {response && (
                            <View style={styles.responseCard}>
                                {response.success ? (
                                    <>
                                        <Text style={styles.fieldLabel}>
                                            {t("claudeControl.mcp.result")}
                                        </Text>
                                        <Text style={styles.reviewJson}>
                                            {JSON.stringify(
                                                response.result ?? null,
                                                null,
                                                2,
                                            )}
                                        </Text>
                                    </>
                                ) : (
                                    <Text style={styles.errorText}>
                                        {response.errorCode
                                            ? errorText(response.errorCode)
                                            : t(
                                                  "claudeControl.mcp.errorUnknown",
                                              )}
                                        {response.errorMessage
                                            ? `\n${response.errorMessage}`
                                            : ""}
                                    </Text>
                                )}
                            </View>
                        )}
                    </>
                )}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.primary,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    headerTitle: {
        fontSize: 15,
        fontWeight: "600",
        color: theme.colors.text,
    },
    closeBtn: {
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    closeText: {
        fontSize: 14,
        color: theme.colors.textLink,
    },
    body: {
        padding: 16,
        gap: 10,
    },
    stepLabel: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    fieldLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    input: {
        fontSize: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        color: theme.colors.text,
        backgroundColor: theme.colors.primary,
    },
    jsonInput: {
        minHeight: 100,
        fontFamily: "Menlo",
        fontSize: 12,
        textAlignVertical: "top",
    },
    reviewHeading: {
        fontSize: 15,
        fontWeight: "600",
        color: theme.colors.text,
    },
    reviewCard: {
        padding: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.divider,
        gap: 4,
    },
    reviewValue: {
        fontSize: 14,
        color: theme.colors.text,
        fontFamily: "Menlo",
    },
    reviewJson: {
        fontSize: 12,
        color: theme.colors.text,
        fontFamily: "Menlo",
    },
    confirmRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: 4,
    },
    confirmText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
    },
    actionRow: {
        flexDirection: "row",
        gap: 10,
        marginTop: 8,
    },
    primaryBtn: {
        flex: 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.textLink,
        alignItems: "center",
    },
    primaryBtnMuted: {
        opacity: 0.45,
    },
    primaryBtnText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "600",
    },
    secondaryBtn: {
        flex: 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        alignItems: "center",
    },
    secondaryBtnText: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: "600",
    },
    responseCard: {
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.divider,
    },
    errorText: {
        fontSize: 13,
        color: theme.colors.textDestructive,
    },
}));
