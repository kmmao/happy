import * as React from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useProject } from "@/hooks/useProjects";
import { storage } from "@/sync/storage";
import { sessionReadFile, sessionBash } from "@/sync/ops";
import { t } from "@/text";
import { screenLayoutMaxWidth } from "@/components/layout";

export default React.memo(function ContextMdScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();
    const { theme } = useUnistyles();
    const project = useProject(id);

    const [content, setContent] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [savedState, setSavedState] = React.useState<"idle" | "saved" | "error">("idle");

    const activeSessionId = React.useMemo(() => {
        if (!project) return null;
        const sessions = storage.getState().sessions;
        return project.sessionIds.find((sid) => sessions[sid]?.active) ?? null;
    }, [project]);

    React.useLayoutEffect(() => {
        navigation.setOptions({ headerTitle: t("projectConfig.contextMdTitle") });
    }, [navigation]);

    React.useEffect(() => {
        if (!activeSessionId) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            const result = await sessionReadFile(activeSessionId, ".happy/CONTEXT.md");
            if (!cancelled) {
                if (result.success && result.content) {
                    setContent(result.content);
                }
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [activeSessionId]);

    const handleSave = React.useCallback(async () => {
        if (!activeSessionId) return;
        setSaving(true);
        setSavedState("idle");
        try {
            const bytes = new TextEncoder().encode(content);
            let bin = "";
            for (const b of bytes) bin += String.fromCharCode(b);
            const b64 = btoa(bin);
            const result = await sessionBash(activeSessionId, {
                command: `mkdir -p .happy && python3 -c "import base64,sys; sys.stdout.buffer.write(base64.b64decode('${b64}'))" > .happy/CONTEXT.md`,
                timeout: 10000,
            });
            setSavedState(result.success ? "saved" : "error");
        } catch {
            setSavedState("error");
        } finally {
            setSaving(false);
        }
    }, [activeSessionId, content]);

    if (!project) return null;

    return (
        <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <ScrollView
                style={styles.flex}
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.inner}>
                    {loading ? (
                        <ActivityIndicator style={styles.loader} />
                    ) : (
                        <>
                            <TextInput
                                style={[
                                    styles.editor,
                                    {
                                        color: theme.colors.text,
                                        borderColor: theme.colors.divider,
                                        backgroundColor: theme.colors.surface,
                                    },
                                ]}
                                value={content}
                                onChangeText={setContent}
                                multiline
                                textAlignVertical="top"
                                placeholder={t("projectConfig.contextMdPlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCorrect={false}
                                autoCapitalize="none"
                            />
                            <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                                {t("projectConfig.contextMdHint")}
                            </Text>
                            <Pressable
                                style={[
                                    styles.saveButton,
                                    { backgroundColor: theme.colors.header.tint },
                                    saving && styles.saveButtonDisabled,
                                ]}
                                onPress={handleSave}
                                disabled={saving}
                            >
                                {saving ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <Text style={styles.saveButtonText}>
                                        {t("projectConfig.contextMdSave")}
                                    </Text>
                                )}
                            </Pressable>
                            {savedState === "saved" && (
                                <Text style={[styles.feedback, { color: theme.colors.success }]}>
                                    {t("projectConfig.contextMdSaved")}
                                </Text>
                            )}
                            {savedState === "error" && (
                                <Text style={[styles.feedback, { color: theme.colors.deleteAction }]}>
                                    {t("projectConfig.contextMdSaveError")}
                                </Text>
                            )}
                        </>
                    )}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
});

const styles = StyleSheet.create((theme, rt) => ({
    flex: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    container: {
        flexGrow: 1,
        padding: 16,
        alignItems: "center",
    },
    inner: {
        width: "100%",
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
        gap: 12,
    },
    loader: {
        marginTop: 40,
    },
    editor: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        padding: 14,
        minHeight: 260,
        ...Typography.default("regular"),
        fontSize: 14,
        lineHeight: 20,
    },
    hint: {
        ...Typography.default("regular"),
        fontSize: 12,
    },
    saveButton: {
        height: 48,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    saveButtonDisabled: {
        opacity: 0.6,
    },
    saveButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#FFFFFF",
    },
    feedback: {
        ...Typography.default("regular"),
        fontSize: 13,
        textAlign: "center",
    },
}));
