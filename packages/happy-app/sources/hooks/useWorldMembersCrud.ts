import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
import { t } from "@/text";
import {
    createWorldMember,
    deleteWorldMember,
    updateWorldMember,
    type WorldMemberSummary,
} from "@/sync/apiProjects";
import {
    prependById,
    removeById,
    replaceById,
} from "@/components/project/worldCrudState";

export interface SaveWorldMemberInput {
    readonly mode: "create" | "update";
    readonly memberId?: string;
    readonly existingRole?: string;
    readonly accountId?: string;
    readonly role: string;
    readonly expertise: string[];
    readonly lawAuthority: string;
    readonly decisionScope: string;
    readonly goalAuthority: string;
    readonly notifyLevel: string;
    readonly availability: string;
    readonly maxConcurrency: number;
    readonly assignedRoleIds: string[];
}

interface UseWorldMembersCrudParams {
    readonly projectServerId: string | null | undefined;
    readonly setMembers: React.Dispatch<React.SetStateAction<WorldMemberSummary[]>>;
}

interface UseWorldMembersCrudResult {
    readonly saveMember: (input: SaveWorldMemberInput) => Promise<boolean>;
    readonly deleteMember: (member: WorldMemberSummary) => Promise<boolean>;
}

export function useWorldMembersCrud({
    projectServerId,
    setMembers,
}: UseWorldMembersCrudParams): UseWorldMembersCrudResult {
    const saveMember = React.useCallback(
        async (input: SaveWorldMemberInput): Promise<boolean> => {
            if (!projectServerId) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                const savedMember = input.mode === "create"
                    ? await createWorldMember(credentials, projectServerId, {
                        accountId: input.accountId?.trim() ?? "",
                        role: input.role,
                        expertise: input.expertise,
                        lawAuthority: input.lawAuthority,
                        decisionScope: input.decisionScope,
                        goalAuthority: input.goalAuthority,
                        notifyLevel: input.notifyLevel,
                        availability: input.availability,
                        maxConcurrency: input.maxConcurrency,
                        assignedRoleIds: input.assignedRoleIds.length > 0
                            ? input.assignedRoleIds
                            : undefined,
                    })
                    : await updateWorldMember(credentials, projectServerId, input.memberId!, {
                        role: input.existingRole === "owner" ? undefined : input.role,
                        expertise: input.expertise,
                        lawAuthority: input.lawAuthority,
                        decisionScope: input.decisionScope,
                        goalAuthority: input.goalAuthority,
                        maxConcurrency: input.maxConcurrency,
                        notifyLevel: input.notifyLevel,
                        availability: input.availability,
                        assignedRoleIds: input.assignedRoleIds,
                    });

                setMembers((previousMembers) =>
                    input.mode === "create"
                        ? prependById(previousMembers, savedMember)
                        : replaceById(previousMembers, savedMember),
                );
                Modal.toast(t("members.saved"));
                return true;
            } catch {
                Modal.toast(t("members.saveError"));
                return false;
            }
        },
        [projectServerId, setMembers],
    );

    const deleteMember = React.useCallback(
        async (member: WorldMemberSummary): Promise<boolean> => {
            if (!projectServerId) return false;
            if (member.role === "owner") {
                Modal.toast(t("members.cannotRemoveOwner"));
                return false;
            }

            const confirmed = await Modal.confirm(
                t("members.removeConfirmTitle"),
                t("members.removeConfirmBody"),
            );
            if (!confirmed) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                await deleteWorldMember(credentials, projectServerId, member.id);
                setMembers((previousMembers) => removeById(previousMembers, member.id));
                Modal.toast(t("members.removed"));
                return true;
            } catch {
                Modal.toast(t("members.saveError"));
                return false;
            }
        },
        [projectServerId, setMembers],
    );

    return {
        saveMember,
        deleteMember,
    };
}
