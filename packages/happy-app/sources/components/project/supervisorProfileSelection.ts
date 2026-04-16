export interface SupervisorProfileSelectionState {
    readonly selectedProfileId: string | null;
    readonly syncedDefaultProfileId: string | null;
}

export function getSupervisorDefaultProfileId(
    supervisorConfig: string | null | undefined,
): string | null {
    if (!supervisorConfig) {
        return null;
    }

    try {
        const parsedConfig = JSON.parse(supervisorConfig) as {
            defaultProfileId?: string | null;
        };
        return parsedConfig.defaultProfileId ?? null;
    } catch {
        return null;
    }
}

export function createSupervisorProfileSelectionState(
    defaultProfileId: string | null | undefined,
): SupervisorProfileSelectionState {
    const normalizedDefaultProfileId = defaultProfileId ?? null;
    return {
        selectedProfileId: normalizedDefaultProfileId,
        syncedDefaultProfileId: normalizedDefaultProfileId,
    };
}

export function selectSupervisorProfile(
    state: SupervisorProfileSelectionState,
    profileId: string | null,
): SupervisorProfileSelectionState {
    return {
        ...state,
        selectedProfileId: profileId,
    };
}

export function syncSupervisorProfileSelectionState(
    state: SupervisorProfileSelectionState,
    defaultProfileId: string | null | undefined,
): SupervisorProfileSelectionState {
    const normalizedDefaultProfileId = defaultProfileId ?? null;
    const userKeepsFollowingDefault = state.selectedProfileId === state.syncedDefaultProfileId;
    const userSelectedDefaultOption = state.selectedProfileId === null;

    return {
        selectedProfileId: userKeepsFollowingDefault || userSelectedDefaultOption
            ? normalizedDefaultProfileId
            : state.selectedProfileId,
        syncedDefaultProfileId: normalizedDefaultProfileId,
    };
}
