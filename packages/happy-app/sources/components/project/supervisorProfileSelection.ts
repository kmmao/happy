export interface SupervisorProfileSelectionState {
    readonly selectedProfileId: string | null;
    readonly syncedDefaultProfileId: string | null;
}

export interface SupervisorProfileOption {
    readonly id: string;
    readonly name?: string | null;
    readonly isBuiltIn?: boolean;
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

export function getMissingSupervisorProfileName(
    profileId: string | null | undefined,
    availableProfiles: readonly SupervisorProfileOption[],
): string | null {
    const normalizedProfileId = profileId ?? null;
    if (!normalizedProfileId) {
        return null;
    }

    const matchingProfile = availableProfiles.find((profile) => profile.id === normalizedProfileId);
    if (matchingProfile) {
        return null;
    }

    return normalizedProfileId;
}

export function getSupervisorAvailableProfiles(
    builtInProfiles: readonly SupervisorProfileOption[],
    userProfiles: readonly SupervisorProfileOption[],
): SupervisorProfileOption[] {
    const builtInIds = new Set(builtInProfiles.map((profile) => profile.id));
    const overridesById = new Map(
        userProfiles.map((profile) => [profile.id, profile]),
    );

    const mergedBuiltIns = builtInProfiles.map((profile) => {
        const override = overridesById.get(profile.id);
        return {
            id: profile.id,
            name: override?.name ?? profile.name,
            isBuiltIn: true,
        };
    });

    const customProfiles = userProfiles
        .filter((profile) => !builtInIds.has(profile.id))
        .map((profile) => ({
            id: profile.id,
            name: profile.name,
            isBuiltIn: false,
        }));

    return [...mergedBuiltIns, ...customProfiles];
}
