import type { Session } from "@/sync/storageTypes";
import {
    resolvePinnedModelIdFromSelection,
} from "@/sync/pinnedModel";

type SessionStartStorage = {
    updateSessionPermissionMode: (sessionId: string, mode: string) => void;
    updateSessionModelMode: (sessionId: string, mode: string) => void;
    updateSessionPinnedModelId: (sessionId: string, modelId: string | null) => void;
    updateSessionSdkSettings: (
        sessionId: string,
        settings: {
            thinkingMode?: string | null;
            thinkingBudget?: number | null;
            effortLevel?: string | null;
            maxBudgetUsd?: number | null;
            taskBudgetTokens?: number | null;
        },
    ) => void;
    updateSessionCustomModels: (
        sessionId: string,
        customModels: Array<{
            id: string;
            name: string;
            description?: string | null;
        }> | null,
    ) => void;
    updateSessionModelMappings: (
        sessionId: string,
        modelMappings: Record<string, string> | null,
    ) => void;
    updateSessionProfile: (
        sessionId: string,
        profile: { profileId: string | null; profileName: string | null },
    ) => void;
};

export type SessionStartPreferenceParams = {
    sessionId: string;
    permissionModeKey: string;
    modelModeKey?: string | null;
    pinnedModelId?: string | null;
    sdkSettings?: {
        thinkingMode?: string | null;
        thinkingBudget?: number | null;
        effortLevel?: string | null;
        maxBudgetUsd?: number | null;
        taskBudgetTokens?: number | null;
    };
    customModels?: Array<{
        id: string;
        name: string;
        description?: string | null;
    }> | null;
    modelMappings?: Record<string, string> | null;
    profile?: {
        id: string | null;
        name: string | null;
    } | null;
};

type ForkSourceSession = Pick<
    Session,
    | "id"
    | "permissionMode"
    | "modelMode"
    | "pinnedModelId"
    | "customModels"
    | "modelMappings"
    | "profileId"
    | "profileName"
    | "thinkingMode"
    | "thinkingBudget"
    | "effortLevel"
    | "maxBudgetUsd"
    | "taskBudgetTokens"
>;

export function buildForkSessionStartPreferences(
    sourceSession: ForkSourceSession,
    forkSessionId: string,
): SessionStartPreferenceParams {
    return {
        sessionId: forkSessionId,
        permissionModeKey: sourceSession.permissionMode || "default",
        modelModeKey: sourceSession.modelMode ?? null,
        pinnedModelId:
            sourceSession.pinnedModelId ??
            resolvePinnedModelIdFromSelection(
                sourceSession.modelMode ?? null,
                sourceSession.modelMappings,
            ),
        sdkSettings: {
            thinkingMode: sourceSession.thinkingMode ?? null,
            thinkingBudget: sourceSession.thinkingBudget ?? null,
            effortLevel: sourceSession.effortLevel ?? null,
            maxBudgetUsd: sourceSession.maxBudgetUsd ?? null,
            taskBudgetTokens: sourceSession.taskBudgetTokens ?? null,
        },
        customModels: sourceSession.customModels ?? null,
        modelMappings: sourceSession.modelMappings ?? null,
        profile:
            sourceSession.profileId || sourceSession.profileName
                ? {
                      id: sourceSession.profileId ?? null,
                      name: sourceSession.profileName ?? null,
                  }
                : null,
    };
}

export function applySessionStartPreferences(
    storage: SessionStartStorage,
    params: SessionStartPreferenceParams,
) {
    storage.updateSessionPermissionMode(
        params.sessionId,
        params.permissionModeKey,
    );

    if (params.modelModeKey) {
        storage.updateSessionModelMode(params.sessionId, params.modelModeKey);
    }
    storage.updateSessionPinnedModelId(
        params.sessionId,
        params.pinnedModelId ??
            resolvePinnedModelIdFromSelection(
                params.modelModeKey ?? null,
                params.modelMappings,
            ),
    );

    const sdkSettings = Object.fromEntries(
        Object.entries(params.sdkSettings ?? {}).filter(
            ([, value]) => value !== undefined && value !== null,
        ),
    );
    if (Object.keys(sdkSettings).length > 0) {
        storage.updateSessionSdkSettings(params.sessionId, sdkSettings);
    }

    if (params.customModels && params.customModels.length > 0) {
        storage.updateSessionCustomModels(params.sessionId, params.customModels);
    }

    if (params.modelMappings) {
        storage.updateSessionModelMappings(
            params.sessionId,
            params.modelMappings,
        );
    }

    if (params.profile) {
        storage.updateSessionProfile(params.sessionId, {
            profileId: params.profile.id,
            profileName: params.profile.name,
        });
    }
}
