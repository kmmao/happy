import { decodeBase64 } from "@/encryption/base64";
import type { AuthCredentials } from "@/auth/tokenStorage";

export function hasCredentialSecret(
    credentials: AuthCredentials | null | undefined,
): credentials is AuthCredentials & { secret: string } {
    return typeof credentials?.secret === "string" && credentials.secret.length > 0;
}

function decodeCredentialKey(encoded: string): Uint8Array | null {
    for (const encoding of ["base64url", "base64"] as const) {
        try {
            const decoded = decodeBase64(encoded, encoding);
            if (decoded.length > 0) {
                return decoded;
            }
        } catch {
            // Try the next supported encoding.
        }
    }
    return null;
}

export function getCredentialContentDataKey(
    credentials: AuthCredentials | null | undefined,
): Uint8Array | null {
    const encodedPublicKey = credentials?.encryption?.publicKey;
    if (!encodedPublicKey) {
        return null;
    }

    const decoded = decodeCredentialKey(encodedPublicKey);
    if (!decoded || decoded.length !== 32) {
        return null;
    }

    return decoded;
}
