type SessionStartStorage = {
    updateSessionPermissionMode: (sessionId: string, mode: string) => void;
    updateSessionModelMode: (sessionId: string, mode: string) => void;
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

export function applySessionStartPreferences(
    storage: SessionStartStorage,
    params: {
        sessionId: string;
        permissionModeKey: string;
        modelModeKey?: string | null;
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
    },
) {
    storage.updateSessionPermissionMode(
        params.sessionId,
        params.permissionModeKey,
    );

    if (params.modelModeKey) {
        storage.updateSessionModelMode(params.sessionId, params.modelModeKey);
    }

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
