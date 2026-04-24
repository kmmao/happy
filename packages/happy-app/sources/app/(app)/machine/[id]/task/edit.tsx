import * as React from "react";
import { ActivityIndicator, Pressable, TextInput, View, Text } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchTask, updateTask } from "@/sync/apiTasks";
import { Modal } from "@/modal";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";

const PRIORITIES = ["user", "urgent", "background"] as const;

function priorityLabel(p: string): string {
    if (p === "user") return t("tasks.priorityUser");
    if (p === "urgent") return t("tasks.priorityUrgent");
    if (p === "background") return t("tasks.priorityBackground");
    return p;
}

function EditTaskPage() {
    const { taskId } = useLocalSearchParams<{ taskId: string }>();
    const router = useRouter();
    const navigation = useNavigation();
    const { theme } = useUnistyles();

    const [prompt, setPrompt] = React.useState("");
    const [priority, setPriority] = React.useState<string>("user");
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    React.useLayoutEffect(() => {
        navigation.setOptions({ headerTitle: t("tasks.editTask") });
    }, [navigation]);

    React.useEffect(() => {
        if (!taskId) return;
        void (async () => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const task = await fetchTask(credentials, taskId);
                setPrompt(task.promptPreview ?? "");
                setPriority(task.priority ?? "user");
            } catch {
                // ignore
            } finally {
                setLoading(false);
            }
        })();
    }, [taskId]);

    const canSave = prompt.trim().length > 0 && !saving;

    const handleSave = React.useCallback(async () => {
        if (!taskId || !canSave) return;
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error(t("common.error"));
            await updateTask(credentials, taskId, { prompt: prompt.trim(), priority });
            router.back();
        } catch (e: any) {
            Modal.alert(t("common.error"), e?.message ?? t("common.error"));
        } finally {
            setSaving(false);
        }
    }, [taskId, canSave, prompt, priority, router]);

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <ItemList>
            <ItemGroup title={t("tasks.prompt")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textArea, { color: theme.colors.text }]}
                        placeholder={t("tasks.promptPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={prompt}
                        onChangeText={setPrompt}
                        multiline
                        numberOfLines={6}
                        textAlignVertical="top"
                        autoCapitalize="sentences"
                        autoCorrect
                        autoFocus
                    />
                </View>
            </ItemGroup>

            <ItemGroup title={t("tasks.priority")}>
                <View style={styles.segmentedRow}>
                    {PRIORITIES.map((p) => (
                        <Pressable
                            key={p}
                            style={[
                                styles.segmentedButton,
                                {
                                    backgroundColor: priority === p
                                        ? theme.colors.textLink
                                        : theme.colors.surfaceHigh,
                                    borderColor: theme.colors.divider,
                                    borderWidth: priority === p ? 0 : 1,
                                },
                            ]}
                            onPress={() => setPriority(p)}
                        >
                            <Text
                                style={[
                                    styles.segmentedButtonText,
                                    { color: priority === p ? "#FFF" : theme.colors.text },
                                ]}
                            >
                                {priorityLabel(p)}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </ItemGroup>

            <View style={styles.buttonContainer}>
                <Pressable
                    style={[
                        styles.saveButton,
                        {
                            backgroundColor: canSave
                                ? resolveActiveTint(theme)
                                : theme.colors.textSecondary,
                        },
                    ]}
                    onPress={() => void handleSave()}
                    disabled={!canSave}
                >
                    {saving ? (
                        <ActivityIndicator color="#FFF" />
                    ) : (
                        <Text style={styles.saveButtonText}>
                            {t("common.save")}
                        </Text>
                    )}
                </Pressable>
            </View>
        </ItemList>
    );
}

export default React.memo(EditTaskPage);

const styles = StyleSheet.create({
    centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    textArea: {
        ...Typography.default(),
        fontSize: 15,
        minHeight: 120,
    },
    segmentedRow: {
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    segmentedButton: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 10,
        alignItems: "center",
    },
    segmentedButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
    },
    buttonContainer: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    saveButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
    },
    saveButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#FFFFFF",
    },
});
