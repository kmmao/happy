import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { throwIfNotOk } from '@/utils/http';
import { getServerUrl } from './serverConfig';

export async function registerPushToken(credentials: AuthCredentials, token: string): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/push-tokens`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
        });

        throwIfNotOk(response, 'Failed to register push token');

        const data = await response.json();
        if (!data.success) {
            throw new Error('Failed to register push token');
        }
    });
}