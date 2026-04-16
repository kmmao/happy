import type { ModelMode, PermissionMode } from "@/components/modelModeOptions";
import { resolveCurrentOption } from "@/components/modelModeOptions";
import type { AIBackendProfile } from "@/sync/settings";

export function resolveProfileDefaultPermissionMode(
    profile: Pick<AIBackendProfile, "defaultPermissionMode">,
    availableModes: PermissionMode[],
): PermissionMode | null {
    return resolveCurrentOption(availableModes, [profile.defaultPermissionMode]);
}

export function resolveProfileDefaultModelMode(
    profile: Pick<AIBackendProfile, "defaultModelMode">,
    availableModels: ModelMode[],
): ModelMode | null {
    return resolveCurrentOption(availableModels, [profile.defaultModelMode]);
}
