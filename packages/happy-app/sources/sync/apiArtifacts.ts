import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { throwIfNotOk } from '@/utils/http';
import { getServerUrl } from './serverConfig';
import { Artifact, ArtifactCreateRequest, ArtifactUpdateRequest, ArtifactUpdateResponse } from './artifactTypes';

/**
 * Fetch all artifacts for the account (paginates through all pages)
 */
export async function fetchArtifacts(credentials: AuthCredentials): Promise<Artifact[]> {
    const API_ENDPOINT = getServerUrl();
    const all: Artifact[] = [];
    let cursor: string | undefined;

    do {
        const params = new URLSearchParams({ limit: '100' });
        if (cursor) params.set('cursor', cursor);

        const data = await backoff(async () => {
            const response = await fetch(`${API_ENDPOINT}/v1/artifacts?${params}`, {
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
                    'Content-Type': 'application/json'
                }
            });

            throwIfNotOk(response, 'Failed to fetch artifacts');

            return response.json() as Promise<{ artifacts: Artifact[]; nextCursor: string | null }>;
        });

        all.push(...data.artifacts);
        cursor = data.nextCursor ?? undefined;
    } while (cursor);

    return all;
}

/**
 * Fetch a single artifact with full body
 */
export async function fetchArtifact(credentials: AuthCredentials, artifactId: string): Promise<Artifact> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/artifacts/${artifactId}`, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 404) {
            throw new Error('Artifact not found');
        }
        throwIfNotOk(response, 'Failed to fetch artifact');

        const data = await response.json() as Artifact;
        return data;
    });
}

/**
 * Create a new artifact
 */
export async function createArtifact(
    credentials: AuthCredentials, 
    request: ArtifactCreateRequest
): Promise<Artifact> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/artifacts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request)
        });

        if (response.status === 409) {
            throw new Error('Artifact ID already exists');
        }
        throwIfNotOk(response, 'Failed to create artifact');

        const data = await response.json() as Artifact;
        return data;
    });
}

/**
 * Update an existing artifact
 */
export async function updateArtifact(
    credentials: AuthCredentials,
    artifactId: string,
    request: ArtifactUpdateRequest
): Promise<ArtifactUpdateResponse> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/artifacts/${artifactId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Artifact not found');
            }
            if (response.status === 409) {
                const data = await response.json() as ArtifactUpdateResponse;
                return data;
            }
            throwIfNotOk(response, "Failed to update artifact");
        }

        const data = await response.json() as ArtifactUpdateResponse;
        return data;
    });
}

/**
 * Delete an artifact
 */
export async function deleteArtifact(
    credentials: AuthCredentials,
    artifactId: string
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/artifacts/${artifactId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${credentials.token}`
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Artifact not found');
            }
            throwIfNotOk(response, "Failed to delete artifact");
        }
    });
}