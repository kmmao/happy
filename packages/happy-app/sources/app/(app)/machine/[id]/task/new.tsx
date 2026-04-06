import * as React from "react";
import { ActivityIndicator, Pressable, TextInput, View, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useHappyAction } from "@/hooks/useHappyAction";
import { useProjects } from "@/hooks/useProjects";
import { TokenStorage } from "@/auth/tokenStorage";
import { createTask } from "@/sync/apiTasks";
import { createWorktree } from "@/utils/createWorktree";
import { Modal } from "@/modal";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";

const PRIORITIES = ["user", "urgent", "background"] as const;

function priorityLabel(p: string): string {
    if (p === "user") return t("tasks.priorityUser");
    if (p === "urgent") return t("tasks.priorityUrgent");
    if (p === "background") return t("tasks.priorityBackground");
    return p;
}

function NewTaskPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const projects = useProjects();

    const [prompt, setPrompt] = React.useState("");
    const [priority, setPriority] = React.useState<string>("user");
    const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null);
    const [maxAttempts, setMaxAttempts] = React.useState("3");

    const machineProjects = React.useMemo(
        () => projects.filter((p) => p.key.machineId === machineId),
        [projects, machineId],
    );

    const canSubmit = prompt.trim().length > 0;

    const [loading, doCreate] = useHappyAction(
        React.useCallback(async () => {
            if (!machineId || !prompt.trim()) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            let taskDirectory: string | undefined;
            if (selectedProjectId) {
                const proj = machineProjects.find(
                    (p) => (p.serverId ?? p.id) === selectedProjectId,
                );
                if (proj?.key.path) {
                    const wt = await createWorktree(machineId, proj.key.path);
                    if (!wt.success) {
                        if (wt.error === "Not a Git repository") {
                            Modal.alert(t("common.error"), t("newSession.worktree.notGitRepo"));
                        } else {
                            Modal.alert(
                                t("common.error"),
                                t("newSession.worktree.failed", {
                                    error: wt.error ?? "Unknown error",
                                }),
                            );
                        }
                        return;
                    }
                    taskDirectory = wt.worktreePath;
                }
            }

            await createTask(credentials, {
                machineId,
                prompt: prompt.trim(),
                priority,
                maxAttempts: Math.max(1, parseInt(maxAttempts, 10) || 3),
                projectId: selectedProjectId ?? undefined,
                directory: taskDirectory,
            });
            router.back();
        }, [machineId, prompt, priority, maxAttempts, selectedProjectId, router, machineProjects]),
    );

    return (
        <ItemList>
            {/* Prompt */}
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
                    />
                </View>
            </ItemGroup>

            {/* Priority */}
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

            {/* Project (optional) */}
            {machineProjects.length > 0 && (
                <ItemGroup title={t("tasks.project")} footer={t("tasks.worktreeWhenProject")}>
                    <Item
                        title={t("tasks.projectNone")}
                        onPress={() => setSelectedProjectId(null)}
                        rightElement={
                            selectedProjectId === null ? (
                                <Ionicons name="checkmark" size={20} color={theme.colors.header.tint} />
                            ) : undefined
                        }
                    />
                    {machineProjects.map((project) => (
                        <Item
                            key={project.id}
                            title={project.key.path}
                            onPress={() => setSelectedProjectId(project.serverId ?? project.id)}
                            rightElement={
                                (selectedProjectId === project.serverId || selectedProjectId === project.id) ? (
                                    <Ionicons name="checkmark" size={20} color={theme.colors.header.tint} />
                                ) : undefined
                            }
                        />
                    ))}
                </ItemGroup>
            )}

            {/* Max Attempts */}
            <ItemGroup title={t("tasks.maxAttempts")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textInput, { color: theme.colors.text }]}
                        placeholder="3"
                        placeholderTextColor={theme.colors.textSecondary}
                        value={maxAttempts}
                        onChangeText={setMaxAttempts}
                        keyboardType="number-pad"
                    />
                </View>
            </ItemGroup>

            {/* Submit */}
            <View style={styles.buttonContainer}>
                <Pressable
                    style={[
                        styles.createButton,
                        {
                            backgroundColor: canSubmit && !loading
                                ? theme.colors.header.tint
                                : theme.colors.textSecondary,
                        },
                    ]}
                    onPress={doCreate}
                    disabled={!canSubmit || loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#FFF" />
                    ) : (
                        <Text style={styles.createButtonText}>
                            {t("tasks.newTask")}
                        </Text>
                    )}
                </Pressable>
            </View>
        </ItemList>
    );
}

export default React.memo(NewTaskPage);

const styles = StyleSheet.create({
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    textArea: {
        ...Typography.default(),
        fontSize: 15,
        minHeight: 120,
    },
    textInput: {
        ...Typography.default(),
        fontSize: 15,
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
    createButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
    },
    createButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#FFFFFF",
    },
});
