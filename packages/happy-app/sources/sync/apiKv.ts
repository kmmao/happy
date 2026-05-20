import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { throwIfNotOk } from '@/utils/http';
import { getServerUrl } from './serverConfig';

//
// Types
//

export interface KvItem {
    key: string;
    value: string;
    version: number;
}

export interface KvListParams {
    prefix?: string;
    limit?: number;
    cursor?: string;
}

export interface KvListResponse {
    items: KvItem[];
    nextCursor?: string;
}

export interface KvBulkGetRequest {
    keys: string[];
}

export interface KvBulkGetResponse {
    values: KvItem[];
}

export interface KvMutation {
    key: string;
    value: string | null;  // null to delete
    version: number;       // -1 for new keys
}

export interface KvMutateRequest {
    mutations: KvMutation[];
}

export interface KvMutateSuccessResponse {
    success: true;
    results: Array<{
        key: string;
        version: number;
    }>;
}

export interface KvMutateErrorResponse {
    success: false;
    errors: Array<{
        key: string;
        error: 'version-mismatch';
        version: number;
        value: string | null;
    }>;
}

export type KvMutateResponse = KvMutateSuccessResponse | KvMutateErrorResponse;

//
// API Functions
//

/**
 * Get a single value by key
 */
export async function kvGet(
    credentials: AuthCredentials,
    key: string
): Promise<KvItem | null> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/kv/${encodeURIComponent(key)}`, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`
            }
        });

        if (response.status === 404) {
            return null;
        }

        throwIfNotOk(response, 'Failed to get KV value');

        const data = await response.json() as KvItem;
        return data;
    });
}

/**
 * List key-value pairs with optional prefix filter
 */
export async function kvList(
    credentials: AuthCredentials,
    params: KvListParams = {}
): Promise<KvListResponse> {
    const API_ENDPOINT = getServerUrl();

    const queryParams = new URLSearchParams();
    if (params.prefix) {
        queryParams.append('prefix', params.prefix);
    }
    if (params.limit !== undefined) {
        queryParams.append('limit', Math.min(params.limit, 1000).toString());
    }
    if (params.cursor) {
        queryParams.append('cursor', params.cursor);
    }

    const url = queryParams.toString()
        ? `${API_ENDPOINT}/v1/kv?${queryParams.toString()}`
        : `${API_ENDPOINT}/v1/kv`;

    return await backoff(async () => {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`
            }
        });

        throwIfNotOk(response, 'Failed to list KV items');

        const data = await response.json() as KvListResponse;
        return data;
    });
}

/**
 * Get multiple values by keys (up to 100)
 */
export async function kvBulkGet(
    credentials: AuthCredentials,
    keys: string[]
): Promise<KvBulkGetResponse> {
    if (keys.length === 0) {
        return { values: [] };
    }

    if (keys.length > 100) {
        throw new Error('Cannot bulk get more than 100 keys at once');
    }

    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/kv/bulk`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ keys })
        });

        throwIfNotOk(response, 'Failed to bulk get KV values');

        const data = await response.json() as KvBulkGetResponse;
        return data;
    });
}

/**
 * Atomically mutate multiple key-value pairs
 * Supports create, update, and delete operations
 * Uses optimistic concurrency control with version numbers
 */
export async function kvMutate(
    credentials: AuthCredentials,
    mutations: KvMutation[]
): Promise<KvMutateResponse> {
    if (mutations.length === 0) {
        return { success: true, results: [] };
    }

    if (mutations.length > 100) {
        throw new Error('Cannot mutate more than 100 keys at once');
    }

    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/kv`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mutations })
        });

        if (response.status === 409) {
            const data = await response.json() as KvMutateErrorResponse;
            return data;
        }

        throwIfNotOk(response, 'Failed to mutate KV values');

        const data = await response.json() as KvMutateSuccessResponse;
        return data;
    });
}

//
// Helper Functions
//

/**
 * Set a single key-value pair
 * Creates new key if version is -1, updates existing if version matches
 */
export async function kvSet(
    credentials: AuthCredentials,
    key: string,
    value: string,
    version: number = -1
): Promise<number> {
    const result = await kvMutate(credentials, [{
        key,
        value,
        version
    }]);

    if (result.success === false) {
        const error = result.errors[0];
        throw new Error(`Failed to set key "${key}": ${error.error} (current version: ${error.version})`);
    }

    return result.results[0].version;
}

/**
 * Delete a single key
 */
export async function kvDelete(
    credentials: AuthCredentials,
    key: string,
    version: number
): Promise<void> {
    const result = await kvMutate(credentials, [{
        key,
        value: null,
        version
    }]);

    if (result.success === false) {
        const error = result.errors[0];
        throw new Error(`Failed to delete key "${key}": ${error.error} (current version: ${error.version})`);
    }
}

/**
 * List all key-value pairs matching params, auto-paginating with cursor.
 * Use this when you need more than 1000 items.
 */
export async function kvListAll(
    credentials: AuthCredentials,
    params: Omit<KvListParams, 'cursor' | 'limit'> & { pageSize?: number }
): Promise<KvItem[]> {
    const pageSize = params.pageSize ?? 1000;
    const allItems: KvItem[] = [];
    let cursor: string | undefined;

    do {
        const response = await kvList(credentials, {
            prefix: params.prefix,
            limit: pageSize,
            cursor,
        });
        allItems.push(...response.items);
        cursor = response.nextCursor;
    } while (cursor);

    return allItems;
}

/**
 * Get keys with a specific prefix
 */
export async function kvGetByPrefix(
    credentials: AuthCredentials,
    prefix: string,
    limit: number = 100
): Promise<KvItem[]> {
    const response = await kvList(credentials, { prefix, limit: Math.min(limit, 1000) });
    return response.items;
}