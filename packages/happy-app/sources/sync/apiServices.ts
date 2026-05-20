import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { throwIfNotOk } from '@/utils/http';
import { getServerUrl } from './serverConfig';

/**
 * Connect a service to the user's account
 */
export async function connectService(
    credentials: AuthCredentials,
    service: string,
    token: any
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/connect/${service}/register`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token: JSON.stringify(token) })
        });

        throwIfNotOk(response, `Failed to connect ${service}`);

        const data = await response.json() as { success: true };
        if (!data.success) {
            throw new Error(`Failed to connect ${service} account`);
        }
    });
}

/**
 * Disconnect a connected service from the user's account
 */
export async function disconnectService(credentials: AuthCredentials, service: string): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/connect/${service}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${credentials.token}`
            }
        });

        if (response.status === 404) {
            const error = await response.json();
            throw new Error(error.error || `${service} account not connected`);
        }
        throwIfNotOk(response, `Failed to disconnect ${service}`);

        const data = await response.json() as { success: true };
        if (!data.success) {
            throw new Error(`Failed to disconnect ${service} account`);
        }
    });
}