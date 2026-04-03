import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from '@/sync/serverConfig';
import type { Sub2ApiConfig, AccountUsage } from './sub2apiTypes';

function getHeaders(credentials: AuthCredentials) {
    return {
        'Authorization': `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
    };
}

/**
 * Check if sub2api is configured on the server.
 */
export async function getConfig(credentials: AuthCredentials): Promise<{ configured: boolean; baseUrl?: string; email?: string }> {
    const resp = await fetch(`${getServerUrl()}/v1/sub2api/config`, {
        headers: getHeaders(credentials),
    });
    if (!resp.ok) throw new Error(`Failed to get config (${resp.status})`);
    return await resp.json();
}

/**
 * Save sub2api config to server (server tests connectivity first).
 */
export async function saveConfig(credentials: AuthCredentials, config: Sub2ApiConfig): Promise<void> {
    const resp = await fetch(`${getServerUrl()}/v1/sub2api/config`, {
        method: 'POST',
        headers: getHeaders(credentials),
        body: JSON.stringify(config),
    });
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || `Failed to save config (${resp.status})`);
    }
}

/**
 * Clear sub2api config from server.
 */
export async function clearConfig(credentials: AuthCredentials): Promise<void> {
    const resp = await fetch(`${getServerUrl()}/v1/sub2api/config`, {
        method: 'DELETE',
        headers: getHeaders(credentials),
    });
    if (!resp.ok) throw new Error(`Failed to clear config (${resp.status})`);
}

/**
 * Fetch all account usage via server proxy.
 * Server handles: login → list accounts → fetch usage.
 */
export async function fetchUsage(credentials: AuthCredentials): Promise<AccountUsage[]> {
    const resp = await fetch(`${getServerUrl()}/v1/sub2api/usage`, {
        headers: getHeaders(credentials),
    });
    if (resp.status === 404) return []; // Not configured
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || `Failed to fetch usage (${resp.status})`);
    }
    const data = await resp.json();
    return data.accounts;
}
