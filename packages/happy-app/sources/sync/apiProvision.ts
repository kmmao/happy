import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';

//
// Types
//

export interface ProvisionTokenItem {
    id: string;
    label: string | null;
    revokedAt: string | null;
    createdAt: string;
}

export interface ProvisionCreateResponse {
    id: string;
    provisionToken: string;
    expiresAt: string;
}

//
// API Functions
//

/**
 * Create a new provision token for the current account.
 * Returns the token string (only visible once).
 */
export async function provisionCreate(
    credentials: AuthCredentials,
    params: { label?: string; ttlHours?: number } = {}
): Promise<ProvisionCreateResponse> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/provision`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                label: params.label ?? null,
                ttlHours: params.ttlHours ?? 72,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to create provision token: ${response.status}`);
        }

        return await response.json() as ProvisionCreateResponse;
    });
}

/**
 * List all provision tokens for the current account.
 */
export async function provisionList(
    credentials: AuthCredentials
): Promise<ProvisionTokenItem[]> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/provision`, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to list provision tokens: ${response.status}`);
        }

        return await response.json() as ProvisionTokenItem[];
    });
}

/**
 * Revoke a provision token (invalidates the bearer token).
 */
export async function provisionRevoke(
    credentials: AuthCredentials,
    tokenId: string
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/provision/${tokenId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to revoke provision token: ${response.status}`);
        }
    });
}
