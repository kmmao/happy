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

interface WorldRolesData {
    readonly roles: AgentRoleSummary[];
    readonly members: WorldMemberSummary[];
}

interface UseWorldRolesDataResult {
    readonly roles: AgentRoleSummary[];
    readonly setRoles: React.Dispatch<React.SetStateAction<AgentRoleSummary[]>>;
    readonly members: WorldMemberSummary[];
    readonly setMembers: React.Dispatch<React.SetStateAction<WorldMemberSummary[]>>;
    readonly loading: boolean;
    readonly error: string | null;
    readonly refresh: () => Promise<void>;
}

type SetStateAction<T> = React.SetStateAction<T>;

const createEmptyWorldRolesData = (): WorldRolesData => ({
    roles: [],
    members: [],
});

function resolveStateAction<T>(previousValue: T, nextValue: SetStateAction<T>): T {
    return typeof nextValue === "function"
        ? (nextValue as (value: T) => T)(previousValue)
        : nextValue;
}

export function useWorldRolesData(
    projectServerId: string | null | undefined,
    isActive: boolean,
): UseWorldRolesDataResult {
    const loadRolesData = React.useCallback(
        async (
            credentials: Parameters<typeof fetchAgentRoles>[0],
            activeProjectId: string,
        ): Promise<WorldRolesData> => {
            const [roles, members] = await Promise.all([
                fetchAgentRoles(credentials, activeProjectId),
                fetchWorldMembers(credentials, activeProjectId).catch(
                    () => [] as WorldMemberSummary[],
                ),
            ]);

            return {
                roles,
                members,
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
        createEmptyData: createEmptyWorldRolesData,
        load: loadRolesData,
    });

    const setRoles = React.useCallback<React.Dispatch<SetStateAction<AgentRoleSummary[]>>>(
        (nextRoles) => {
            setData((previousData) => ({
                ...previousData,
                roles: resolveStateAction(previousData.roles, nextRoles),
            }));
        },
        [setData],
    );

    const setMembers = React.useCallback<React.Dispatch<SetStateAction<WorldMemberSummary[]>>>(
        (nextMembers) => {
            setData((previousData) => ({
                ...previousData,
                members: resolveStateAction(previousData.members, nextMembers),
            }));
        },
        [setData],
    );

    return {
        roles: data.roles,
        setRoles,
        members: data.members,
        setMembers,
        loading,
        error,
        refresh,
    };
}
