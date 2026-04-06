import * as React from "react";
import { ScrollView } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Project, projectManager, getProjectDisplayName } from "@/sync/projectManager";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Modal } from "@/modal";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateProject } from "@/sync/apiProjects";
import { getClaudeModelModes, ModelMode } from "@/components/modelModeOptions";

interface ProjectConfig {
    alias?: string;
    defaultModel?: string;
}

function parseProjectConfig(metadata: string | null | undefined): ProjectConfig {
    if (!metadata) return {};
    try {
        return JSON.parse(metadata) as ProjectConfig;
    } catch {
        return {};
    }
}

interface ProjectConfigTabProps {
    project: Project;
}

export const ProjectConfigTab = React.memo(
    ({ project }: ProjectConfigTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const [config, setConfig] = React.useState<ProjectConfig>(() =>
            parseProjectConfig(project.serverMetadata),
        );
        const [saving, setSaving] = React.useState(false);

        // Sync config when project metadata changes externally
        React.useEffect(() => {
            setConfig(parseProjectConfig(project.serverMetadata));
        }, [project.serverMetadata]);

        const machineName =
            project.machineMetadata?.displayName ||
            project.machineMetadata?.host ||
            project.key.machineId;

        const createdDate = new Date(project.createdAt).toLocaleDateString();

        const models = React.useMemo(() => getClaudeModelModes(), []);

        const saveConfig = React.useCallback(
            async (newConfig: ProjectConfig) => {
                if (!project.serverId) return;
                setSaving(true);
                try {
                    const credentials = await TokenStorage.getCredentials();
                    if (!credentials) {
                        Modal.toast(t("projects.configSaveFailed"));
                        return;
                    }

                    const metadata = JSON.stringify(newConfig);
                    await updateProject(credentials, project.serverId, { metadata });

                    // Update local cache (follows existing pattern in supervisor-settings)
                    const localProject = projectManager.getProject(project.id);
                    if (localProject) {
                        localProject.serverMetadata = metadata;
                    }

                    setConfig(newConfig);
                    Modal.toast(t("projects.configSaved"));
                } catch {
                    Modal.toast(t("projects.configSaveFailed"));
                } finally {
                    setSaving(false);
                }
            },
            [project.serverId, project.id],
        );

        const handleSetAlias = React.useCallback(async () => {
            const currentName = getProjectDisplayName(project);
            const newAlias = await Modal.prompt(
                t("projects.configAliasPromptTitle"),
                t("projects.configAliasPromptMessage"),
                {
                    defaultValue: config.alias || "",
                    placeholder: currentName,
                    cancelText: t("common.cancel"),
                    confirmText: t("common.save"),
                },
            );

            if (newAlias === null) return;
            const trimmed = newAlias.trim();
            await saveConfig({
                ...config,
                alias: trimmed || undefined,
            });
        }, [config, project, saveConfig]);

        const handleSelectModel = React.useCallback(
            async (model: ModelMode) => {
                const newModelKey =
                    model.key === "default" ? undefined : model.key;
                if (newModelKey === config.defaultModel) return;
                await saveConfig({
                    ...config,
                    defaultModel: newModelKey,
                });
            },
            [config, saveConfig],
        );

        const handleToggleArchive = React.useCallback(async () => {
            if (!project.serverId) return;

            const isArchived = project.archived ?? false;
            const confirmMessage = isArchived
                ? t("projects.configUnarchiveConfirm")
                : t("projects.configArchiveConfirm");

            const confirmed = await Modal.confirm(
                isArchived
                    ? t("projects.configUnarchive")
                    : t("projects.configArchive"),
                confirmMessage,
            );
            if (!confirmed) return;

            setSaving(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) {
                    Modal.toast(t("projects.configSaveFailed"));
                    return;
                }

                await updateProject(credentials, project.serverId, {
                    archived: !isArchived,
                });

                // Update local cache (follows existing pattern in supervisor-settings)
                const localProject = projectManager.getProject(project.id);
                if (localProject) {
                    localProject.archived = !isArchived;
                }

                Modal.toast(t("projects.configSaved"));
            } catch {
                Modal.toast(t("projects.configSaveFailed"));
            } finally {
                setSaving(false);
            }
        }, [project.serverId, project.id, project.archived]);

        return (
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
            >
                {/* Project Info (read-only) */}
                <ItemGroup title={t("projects.configProjectInfo")}>
                    <Item
                        title={t("projects.configPath")}
                        detail={project.key.path}
                        copy={project.key.path}
                    />
                    <Item
                        title={t("projects.configMachine")}
                        detail={machineName}
                    />
                    <Item
                        title={t("projects.configCreatedAt")}
                        detail={createdDate}
                    />
                </ItemGroup>

                {/* Project Alias */}
                <ItemGroup
                    title={t("projects.configAlias")}
                    footer={t("projects.configAliasDescription")}
                >
                    <Item
                        title={t("projects.configAlias")}
                        detail={config.alias || t("projects.configAliasNotSet")}
                        onPress={handleSetAlias}
                        showChevron
                        disabled={saving || !project.serverId}
                    />
                </ItemGroup>

                {/* Default Model */}
                <ItemGroup
                    title={t("projects.configDefaultModel")}
                    footer={t("projects.configDefaultModelDescription")}
                >
                    {models.map((model) => {
                        const isSelected =
                            model.key === "default"
                                ? !config.defaultModel
                                : model.key === config.defaultModel;
                        return (
                            <Item
                                key={model.key}
                                title={model.name}
                                subtitle={model.description ?? undefined}
                                rightElement={
                                    isSelected ? (
                                        <Ionicons
                                            name="checkmark"
                                            size={20}
                                            color={theme.colors.header.tint}
                                        />
                                    ) : undefined
                                }
                                onPress={() => handleSelectModel(model)}
                                disabled={saving || !project.serverId}
                            />
                        );
                    })}
                </ItemGroup>

                {/* World Constitution */}
                <ItemGroup title={t("world.title")}>
                    <Item
                        title={t("world.title")}
                        subtitle={t("world.narrativeDesc")}
                        onPress={() => router.push(`/project/${project.id}/world-laws` as any)}
                        showChevron
                        disabled={!project.serverId}
                    />
                </ItemGroup>

                {/* Archive */}
                <ItemGroup>
                    <Item
                        title={
                            project.archived
                                ? t("projects.configUnarchive")
                                : t("projects.configArchive")
                        }
                        destructive={!project.archived}
                        onPress={handleToggleArchive}
                        disabled={saving || !project.serverId}
                        loading={saving}
                    />
                </ItemGroup>
            </ScrollView>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        paddingBottom: 32,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },
}));
