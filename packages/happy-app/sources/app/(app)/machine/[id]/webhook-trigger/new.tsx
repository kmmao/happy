import * as React from "react";
import { ActivityIndicator, Pressable, TextInput, View, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { useHappyAction } from "@/hooks/useHappyAction";
import { useProjects } from "@/hooks/useProjects";
import { TokenStorage } from "@/auth/tokenStorage";
import { createWebhookTrigger } from "@/sync/apiWebhookTriggers";
import { getServerUrl } from "@/sync/serverConfig";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { Modal } from "@/modal";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { SkillPickerModal } from "../SkillPickerModal";
import { ProfilePicker } from "@/components/ProfilePicker";
import { useSettings } from "@/sync/storage";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";
import { getSupervisorAvailableProfiles } from "@/components/project/supervisorProfileSelection";
import { useRuntimeProfileEffective } from "@/hooks/useRuntimeProfilePreview";

const PRIORITIES = ["background", "user", "urgent"] as const;

function priorityLabel(p: string): string {
    if (p === "user") return t("tasks.priorityUser");
    if (p === "urgent") return t("tasks.priorityUrgent");
    if (p === "background") return t("tasks.priorityBackground");
    return p;
}

function NewWebhookTriggerPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const projects = useProjects();

    const [name, setName] = React.useState("");
    const [slug, setSlug] = React.useState("");
    const [prompt, setPrompt] = React.useState("");
    const [priority, setPriority] = React.useState<string>("background");
    const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null);
    const [selectedSkillIds, setSelectedSkillIds] = React.useState<string[]>([]);
    const [selectedSkillNames, setSelectedSkillNames] = React.useState<string[]>([]);
    const [skillPickerVisible, setSkillPickerVisible] = React.useState(false);
    const [selectedProfileId, setSelectedProfileId] = React.useState<string | null>(null);

    const settings = useSettings();
    const allProfiles = React.useMemo(() => {
        const builtInProfiles = DEFAULT_PROFILES.map((profile) => ({
            id: profile.id,
            name: profile.name,
            isBuiltIn: true as const,
        }));
        const userDefinedProfiles = (settings.profiles ?? []).map((profile) => ({
            id: profile.id,
            name: profile.name,
        }));
        return getSupervisorAvailableProfiles(builtInProfiles, userDefinedProfiles);
    }, [settings.profiles]);

    const machineProjects = React.useMemo(
        () => projects.filter((p) => p.key.machineId === machineId),
        [projects, machineId],
    );

    const effective = useRuntimeProfileEffective(selectedProjectId, "webhook");
    const onEffectivePress = React.useMemo(() => {
        if (!effective?.isProjectDefault || !selectedProjectId) return undefined;
        const localProject = projects.find(
            (p) => p.serverId === selectedProjectId || p.id === selectedProjectId,
        );
        if (!localProject) return undefined;
        return () => router.push(`/project/${localProject.id}/supervisor-settings` as any);
    }, [effective, selectedProjectId, projects, router]);

    const canSubmit = slug.trim().length > 0 && prompt.trim().length > 0;

    const [loading, doCreate] = useHappyAction(
        React.useCallback(async () => {
            if (!machineId || !canSubmit) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const result = await createWebhookTrigger(credentials, {
                machineId,
                name: name.trim() || undefined,
                slug: slug.trim(),
                prompt: prompt.trim(),
                priority,
                projectId: selectedProjectId ?? undefined,
                skillIds: selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
                profileId: selectedProfileId ?? undefined,
            });

            // Show secret + webhook URL (one-time)
            const webhookUrl = `${getServerUrl()}/v1/triggers/${result.webhookTrigger.slug}`;
            Modal.alert(
                t("triggers.secret"),
                `${t("triggers.secretWarning")}\n\n${t("triggers.webhookUrl")}:\n${webhookUrl}\n\n${t("triggers.secret")}:\n${result.secret}`,
                [
                    {
                        text: t("triggers.copySecret"),
                        onPress: () => {
                            void import("expo-clipboard").then(({ setStringAsync }) =>
                                setStringAsync(result.secret),
                            );
                        },
                    },
                    {
                        text: t("common.ok"),
                        onPress: () => router.back(),
                    },
                ],
            );
        }, [machineId, name, slug, prompt, priority, selectedProjectId, selectedSkillIds, selectedProfileId, canSubmit, router]),
    );

    return (
        <ItemList>
            {/* Name (optional) */}
            <ItemGroup title={t("triggers.name")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textInput, { color: theme.colors.text }]}
                        placeholder={t("triggers.namePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={name}
                        onChangeText={setName}
                    />
                </View>
            </ItemGroup>

            {/* Slug */}
            <ItemGroup title={t("triggers.slug")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textInput, { color: theme.colors.text, fontFamily: "monospace" }]}
                        placeholder={t("triggers.slugPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={slug}
                        onChangeText={(text) => setSlug(text.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                        {t("triggers.slugHint")}
                    </Text>
                </View>
            </ItemGroup>

            {/* Prompt */}
            <ItemGroup title={t("triggers.prompt")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textArea, { color: theme.colors.text }]}
                        placeholder={t("triggers.promptPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={prompt}
                        onChangeText={setPrompt}
                        multiline
                        numberOfLines={6}
                        textAlignVertical="top"
                    />
                    <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                        {t("triggers.webhookPromptHint")}
                    </Text>
                </View>
            </ItemGroup>

            {/* Priority */}
            <ItemGroup title={t("triggers.priority")}>
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
                <ItemGroup title={t("triggers.project")}>
                    <Item
                        title={t("triggers.projectNone")}
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

            {/* Profile Binding (optional) */}
            <ItemGroup title={t("triggers.profileSection")}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                    <ProfilePicker
                        value={selectedProfileId}
                        onChange={setSelectedProfileId}
                        profiles={allProfiles}
                        defaultOptionLabel={t("supervisor.defaultProfileDefault")}
                        description={t("triggers.profileDesc")}
                        effectiveLabel={effective?.label}
                        onEffectivePress={onEffectivePress}
                    />
                </View>
            </ItemGroup>

            {/* Skills (optional) */}
            <ItemGroup title={t("triggers.skills")}>
                <Item
                    title={selectedSkillNames.length > 0 ? selectedSkillNames.join(", ") : t("triggers.skillsNone")}
                    onPress={() => setSkillPickerVisible(true)}
                    showChevron
                />
            </ItemGroup>

            <SkillPickerModal
                visible={skillPickerVisible}
                onClose={() => setSkillPickerVisible(false)}
                selectedIds={selectedSkillIds}
                onConfirm={(ids, names) => {
                    setSelectedSkillIds(ids);
                    setSelectedSkillNames(names);
                    setSkillPickerVisible(false);
                }}
            />

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
                            {t("triggers.createWebhook")}
                        </Text>
                    )}
                </Pressable>
            </View>
        </ItemList>
    );
}

export default React.memo(NewWebhookTriggerPage);

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
    hint: {
        fontSize: 12,
        marginTop: 6,
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
