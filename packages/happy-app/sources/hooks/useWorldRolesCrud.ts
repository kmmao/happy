import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
import { t } from "@/text";
import {
    createAgentRole,
    deleteAgentRole,
    updateAgentRole,
    updateWorldMember,
    type AgentRoleSummary,
    type WorldMemberSummary,
} from "@/sync/apiProjects";
import {
    prependById,
    removeById,
    replaceById,
} from "@/components/project/worldCrudState";

export interface SaveWorldRoleInput {
    readonly mode: "create" | "update";
    readonly roleId?: string;
    readonly name: string;
    readonly type: string;
    readonly description?: string;
    readonly duties: string[];
    readonly templateType?: string;
    readonly agentType: string | null;
    readonly modelOverride: string | null;
}

interface UseWorldRolesCrudParams {
    readonly projectServerId: string | null | undefined;
    readonly members: readonly WorldMemberSummary[];
    readonly setRoles: React.Dispatch<React.SetStateAction<AgentRoleSummary[]>>;
    readonly setMembers: React.Dispatch<React.SetStateAction<WorldMemberSummary[]>>;
}

interface UseWorldRolesCrudResult {
    readonly saveRole: (input: SaveWorldRoleInput) => Promise<boolean>;
    readonly deleteRole: (role: AgentRoleSummary) => Promise<boolean>;
    readonly toggleRoleEnabled: (role: AgentRoleSummary) => Promise<boolean>;
    readonly toggleMemberBinding: (
        member: WorldMemberSummary,
        roleId: string,
    ) => Promise<boolean>;
}

export function useWorldRolesCrud({
    projectServerId,
    members,
    setRoles,
    setMembers,
}: UseWorldRolesCrudParams): UseWorldRolesCrudResult {
    const saveRole = React.useCallback(
        async (input: SaveWorldRoleInput): Promise<boolean> => {
            if (!projectServerId || !input.name.trim()) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                const savedRole = input.mode === "create"
                    ? await createAgentRole(credentials, {
                        projectId: projectServerId,
                        name: input.name.trim(),
                        type: input.type,
                        description: input.description?.trim() || undefined,
                        duties: input.duties.filter((duty) => duty.trim()),
                        agentType: input.agentType,
                        modelOverride: input.modelOverride,
                        ...(input.templateType ? { templateType: input.templateType } : {}),
                    })
                    : await updateAgentRole(credentials, input.roleId!, {
                        name: input.name.trim(),
                        type: input.type,
                        description: input.description?.trim() || undefined,
                        duties: input.duties.filter((duty) => duty.trim()),
                        agentType: input.agentType,
                        modelOverride: input.modelOverride,
                    });

                setRoles((previousRoles) =>
                    input.mode === "create"
                        ? prependById(previousRoles, savedRole)
                        : replaceById(previousRoles, savedRole),
                );
                Modal.toast(t("roles.saved"));
                return true;
            } catch {
                Modal.toast(t("roles.saveError"));
                return false;
            }
        },
        [projectServerId, setRoles],
    );

    const deleteRole = React.useCallback(
        async (role: AgentRoleSummary): Promise<boolean> => {
            const boundCount = members.filter((member) =>
                member.assignedRoleIds.includes(role.id),
            ).length;
            const confirmed = await Modal.confirm(
                t("roles.deleteConfirmTitle"),
                boundCount > 0
                    ? t("roles.deleteHasMembersBody", { count: boundCount })
                    : t("roles.deleteConfirmBody"),
            );
            if (!confirmed) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                await deleteAgentRole(credentials, role.id);
                setRoles((previousRoles) => removeById(previousRoles, role.id));
                Modal.toast(t("roles.deleted"));
                return true;
            } catch {
                Modal.toast(t("roles.saveError"));
                return false;
            }
        },
        [members, setRoles],
    );

    const toggleRoleEnabled = React.useCallback(
        async (role: AgentRoleSummary): Promise<boolean> => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                const updatedRole = await updateAgentRole(credentials, role.id, {
                    enabled: !role.enabled,
                });
                setRoles((previousRoles) => replaceById(previousRoles, updatedRole));
                return true;
            } catch {
                Modal.toast(t("roles.saveError"));
                return false;
            }
        },
        [setRoles],
    );

    const toggleMemberBinding = React.useCallback(
        async (member: WorldMemberSummary, roleId: string): Promise<boolean> => {
            if (!projectServerId) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                const nextAssignedRoleIds = member.assignedRoleIds.includes(roleId)
                    ? member.assignedRoleIds.filter((assignedRoleId) => assignedRoleId !== roleId)
                    : [...member.assignedRoleIds, roleId];

                const updatedMember = await updateWorldMember(credentials, projectServerId, member.id, {
                    assignedRoleIds: nextAssignedRoleIds,
                });

                setMembers((previousMembers) => replaceById(previousMembers, updatedMember));
                return true;
            } catch {
                Modal.toast(t("members.saveError"));
                return false;
            }
        },
        [projectServerId, setMembers],
    );

    return {
        saveRole,
        deleteRole,
        toggleRoleEnabled,
        toggleMemberBinding,
    };
}
