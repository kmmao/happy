import * as React from "react";
import { View } from "react-native";
import { Project, projectManager, getProjectDisplayName } from "@/sync/projectManager";
import { t } from "@/text";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Modal } from "@/modal";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateProject } from "@/sync/apiProjects";

interface ProjectConfig {
    alias?: string;
}

function parseProjectConfig(metadata: string | null | undefined): ProjectConfig {
    if (!metadata) return {};
    try {
        return JSON.parse(metadata) as ProjectConfig;
    } catch {
        return {};
    }
}

interface WorldConfigSectionProps {
    project: Project;
}

export const WorldConfigSection = React.memo(
    ({ project }: WorldConfigSectionProps) => {
        const [config, setConfig] = React.useState<ProjectConfig>(() =>
            parseProjectConfig(project.serverMetadata),
        );
        const [saving, setSaving] = React.useState(false);

        React.useEffect(() => {
            setConfig(parseProjectConfig(project.serverMetadata));
        }, [project.serverMetadata]);

        const machineName =
            project.machineMetadata?.displayName ||
            project.machineMetadata?.host ||
            project.key.machineId;

        const createdDate = new Date(project.createdAt).toLocaleDateString();

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
            <View>
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
            </View>
        );
    },
);
