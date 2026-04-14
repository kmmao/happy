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
                t("world.worldAliasPromptTitle"),
                t("world.worldAliasPromptMessage"),
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
                ? t("world.worldReviveConfirm")
                : t("world.worldTerminateConfirm");

            const confirmed = await Modal.confirm(
                isArchived
                    ? t("world.worldRevive")
                    : t("world.worldTerminate"),
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
                <ItemGroup
                    title={t("world.worldAlias")}
                    footer={t("world.worldAliasDescription")}
                >
                    <Item
                        title={t("world.worldAlias")}
                        detail={config.alias || t("world.worldAliasNotSet")}
                        onPress={handleSetAlias}
                        showChevron
                        disabled={saving || !project.serverId}
                    />
                </ItemGroup>

                <ItemGroup>
                    <Item
                        title={
                            project.archived
                                ? t("world.worldRevive")
                                : t("world.worldTerminate")
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
