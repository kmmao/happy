import { encryptString, decryptString } from "@/modules/encrypt";
import type { AIBackendProfile } from "@/types/aiBackendProfile";

const PROFILE_PAYLOAD_VERSION = 1;

interface StoredAiBackendProfilePayload {
    version: number;
    profile: AIBackendProfile;
}

export function encryptAiBackendProfile(
    accountId: string,
    profile: AIBackendProfile,
): Uint8Array<ArrayBuffer> {
    const payload: StoredAiBackendProfilePayload = {
        version: PROFILE_PAYLOAD_VERSION,
        profile,
    };

    return encryptString(
        ["ai-backend-profile", accountId, profile.id, "payload"],
        JSON.stringify(payload),
    );
}

export function decryptAiBackendProfile(
    accountId: string,
    profileId: string,
    encryptedPayload: Uint8Array<ArrayBuffer>,
): AIBackendProfile {
    const decrypted = decryptString(
        ["ai-backend-profile", accountId, profileId, "payload"],
        encryptedPayload,
    );
    const parsed = JSON.parse(decrypted) as StoredAiBackendProfilePayload;
    return parsed.profile;
}
