import * as React from "react";
import { ActivityIndicator, Pressable, TextInput, View, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { useHappyAction } from "@/hooks/useHappyAction";
import { useProjects } from "@/hooks/useProjects";
import { TokenStorage } from "@/auth/tokenStorage";
import { submitTask, WorktreeSetupError } from "./submitTask";
import { Modal } from "@/modal";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { ProfilePicker } from "@/components/ProfilePicker";
import { useSettings } from "@/sync/storage";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";
import { getSupervisorAvailableProfiles } from "@/components/project/supervisorProfileSelection";
import { useRuntimeProfileEffective } from "@/hooks/useRuntimeProfilePreview";

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
    const [selectedProfileId, setSelectedProfileId] = React.useState<string | null>(null);
    const [worktreeIsolation, setWorktreeIsolation] = React.useState(false);

    const settings = useSettings();
    const allProfiles = React.useMemo(() => {
        const builtInProfiles = DEFAULT_PROFILES.map((profile) => ({
            id: profile.id,
            name: profile.name,
            isBuiltIn: true as const,
        }));
        const userDefinedProfiles = (settings.profiles ?? []).map((p) => ({ id: p.id, name: p.name }));
        return getSupervisorAvailableProfiles(builtInProfiles, userDefinedProfiles);
    }, [settings.profiles]);

    const machineProjects = React.useMemo(
        () => projects.filter((p) => p.key.machineId === machineId),
        [projects, machineId],
    );

    const effective = useRuntimeProfileEffective(selectedProjectId, "task-manual");

    const canSubmit = prompt.trim().length > 0 && typeof machineId === "string";

    const [loading, doCreate] = useHappyAction(
        React.useCallback(async () => {
            if (!machineId || !prompt.trim()) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            try {
                await submitTask({
                    credentials,
                    machineId,
                    prompt,
                    priority,
                    maxAttempts,
                    selectedProjectId,
                    selectedProfileId,
                    machineProjects,
                    worktreeIsolation,
                });
                router.back();
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                if (error instanceof WorktreeSetupError) {
                    if (error.kind === "not_git_repo") {
                        Modal.alert(t("common.error"), t("newSession.worktree.notGitRepo"));
                        return;
                    }
                    Modal.alert(
                        t("common.error"),
                        t("newSession.worktree.failed", {
                            error: detail || "Unknown error",
                        }),
                    );
                    return;
                }
                throw error;
            }
        }, [machineId, prompt, priority, maxAttempts, selectedProjectId, selectedProfileId, router, machineProjects]),
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

            {/* Profile */}
            <ItemGroup title={t("triggers.profileSection")}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                    <ProfilePicker
                        value={selectedProfileId}
                        onChange={setSelectedProfileId}
                        profiles={allProfiles}
                        defaultOptionLabel={t("supervisor.defaultProfileDefault")}
                        description={t("triggers.profileDesc")}
                        effectiveLabel={effective?.label}
                    />
                </View>
            </ItemGroup>

            {/* Worktree Isolation */}
            <ItemGroup title={t("tasks.worktreeIsolation")} footer={t("tasks.worktreeIsolationDesc")}>
                <Item
                    title={t("tasks.worktreeIsolation")}
                    rightElement={
                        <Ionicons
                            name={worktreeIsolation ? "checkbox" : "square-outline"}
                            size={22}
                            color={worktreeIsolation ? theme.colors.textLink : theme.colors.textSecondary}
                        />
                    }
                    onPress={() => setWorktreeIsolation((v) => !v)}
                />
            </ItemGroup>

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
                                ? resolveActiveTint(theme)
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
