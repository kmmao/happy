import * as React from "react";
import type {
    AgentRoleSummary,
    WorldMemberSummary,
} from "@/sync/apiProjects";
import {
    fetchAgentRoles,
    fetchWorldMembers,
} from "@/sync/apiProjects";
import { useProjectScopedAsyncData } from "./useProjectScopedAsyncData";

interface WorldMembersData {
    readonly members: WorldMemberSummary[];
    readonly agentRoles: AgentRoleSummary[];
}

interface UseWorldMembersDataResult {
    readonly members: WorldMemberSummary[];
    readonly setMembers: React.Dispatch<React.SetStateAction<WorldMemberSummary[]>>;
    readonly agentRoles: AgentRoleSummary[];
    readonly setAgentRoles: React.Dispatch<React.SetStateAction<AgentRoleSummary[]>>;
    readonly loading: boolean;
    readonly error: string | null;
    readonly refresh: () => Promise<void>;
}

type SetStateAction<T> = React.SetStateAction<T>;

const createEmptyWorldMembersData = (): WorldMembersData => ({
    members: [],
    agentRoles: [],
});

function resolveStateAction<T>(previousValue: T, nextValue: SetStateAction<T>): T {
    return typeof nextValue === "function"
        ? (nextValue as (value: T) => T)(previousValue)
        : nextValue;
}

export function useWorldMembersData(
    projectServerId: string | null | undefined,
    isActive: boolean,
): UseWorldMembersDataResult {
    const loadMembersData = React.useCallback(
        async (
            credentials: Parameters<typeof fetchWorldMembers>[0],
            activeProjectId: string,
        ): Promise<WorldMembersData> => {
            const [members, agentRoles] = await Promise.all([
                fetchWorldMembers(credentials, activeProjectId),
                fetchAgentRoles(credentials, activeProjectId).catch(
                    () => [] as AgentRoleSummary[],
                ),
            ]);

            return {
                members,
                agentRoles,
            };
        },
        [],
    );

    const {
        data,
        setData,
        loading,
        error,
        refresh,
    } = useProjectScopedAsyncData({
        projectServerId,
        isActive,
        createEmptyData: createEmptyWorldMembersData,
        load: loadMembersData,
    });

    const setMembers = React.useCallback<React.Dispatch<SetStateAction<WorldMemberSummary[]>>>(
        (nextMembers) => {
            setData((previousData) => ({
                ...previousData,
                members: resolveStateAction(previousData.members, nextMembers),
            }));
        },
        [setData],
    );

    const setAgentRoles = React.useCallback<React.Dispatch<SetStateAction<AgentRoleSummary[]>>>(
        (nextRoles) => {
            setData((previousData) => ({
                ...previousData,
                agentRoles: resolveStateAction(previousData.agentRoles, nextRoles),
            }));
        },
        [setData],
    );

    return {
        members: data.members,
        setMembers,
        agentRoles: data.agentRoles,
        setAgentRoles,
        loading,
        error,
        refresh,
    };
}
