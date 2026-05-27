import { AuthCredentials } from '@/auth/tokenStorage';
import { apiRequest, apiRequestVoid } from './apiRequest';

//
// Types
//

export interface ProvisionTokenItem {
    id: string;
    label: string | null;
    webappUrl: string | null;
    ttydUrl: string | null;
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
    params: { label?: string; ttlHours?: number; webappUrl?: string; ttydUrl?: string } = {}
): Promise<ProvisionCreateResponse> {
    return await apiRequest<ProvisionCreateResponse>(credentials, '/v1/provision', {
        method: 'POST',
        body: {
            label: params.label ?? null,
            ttlHours: params.ttlHours ?? 72,
            webappUrl: params.webappUrl ?? null,
            ttydUrl: params.ttydUrl ?? null,
        },
        errorMessage: 'Failed to create provision token',
    });
}

/**
 * List all provision tokens for the current account.
 */
export async function provisionList(
    credentials: AuthCredentials
): Promise<ProvisionTokenItem[]> {
    return await apiRequest<ProvisionTokenItem[]>(credentials, '/v1/provision', {
        errorMessage: 'Failed to list provision tokens',
    });
}

/**
 * Update URLs on an existing provision token.
 */
export async function provisionUpdateUrls(
    credentials: AuthCredentials,
    tokenId: string,
    urls: { webappUrl?: string; ttydUrl?: string }
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/provision/${tokenId}`, {
        method: 'PATCH',
        body: urls,
        errorMessage: 'Failed to update provision token',
    });
}

/**
 * Restore a revoked provision token.
 */
export async function provisionRestore(
    credentials: AuthCredentials,
    tokenId: string
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/provision/${tokenId}/restore`, {
        method: 'POST',
        errorMessage: 'Failed to restore provision token',
    });
}

/**
 * Revoke a provision token (invalidates the bearer token).
 */
export async function provisionRevoke(
    credentials: AuthCredentials,
    tokenId: string
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/provision/${tokenId}`, {
        method: 'DELETE',
        errorMessage: 'Failed to revoke provision token',
    });
}
