/**
 * Hook for managing preview tunnel state — listens for candidate reports
 * and tunnel connection updates, provides actions to create/revoke tunnels.
 *
 * Uses ephemeral Socket.IO events for real-time state and authenticated
 * REST calls for tunnel lifecycle operations.
 */

import * as React from "react";
import { apiSocket } from "@/sync/apiSocket";
import { getServerUrl } from "@/sync/serverConfig";
import { TokenStorage } from "@/auth/tokenStorage";
import type {
    PreviewCandidate,
    PreviewConnection,
} from "@kmmao/happy-wire";

export interface UsePreviewTunnelResult {
    /** Currently reported dev server candidate, if any. */
    readonly candidate: PreviewCandidate | null;
    /** Active tunnel connection, if any. */
    readonly connection: PreviewConnection | null;
    /** Whether a tunnel creation is in progress. */
    readonly creating: boolean;
    /** Create a tunnel for the current candidate. */
    readonly createTunnel: () => Promise<void>;
    /** Revoke the active tunnel. */
    readonly revokeTunnel: () => Promise<void>;
    /** Extend the active tunnel's lease (resets countdown). */
    readonly refreshLease: () => Promise<void>;
}

async function previewFetch(
    path: string,
    init?: RequestInit,
): Promise<Response> {
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) throw new Error("Not authenticated");
    const url = `${getServerUrl()}${path}`;
    return fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${credentials.token}`,
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    });
}

export function usePreviewTunnel(sessionId: string | undefined): UsePreviewTunnelResult {
    const [candidate, setCandidate] = React.useState<PreviewCandidate | null>(null);
    const [connection, setConnection] = React.useState<PreviewConnection | null>(null);
    const [creating, setCreating] = React.useState(false);

    // Listen for ephemeral events from the server
    React.useEffect(() => {
        if (!sessionId) return;

        const handleEphemeralEvent = (payload: any) => {
            if (payload.type === "preview-candidate-reported" && payload.sessionId === sessionId) {
                setCandidate(payload.candidate ?? null);
            }
            if (payload.type === "preview-connection-updated" && payload.sessionId === sessionId) {
                setConnection(payload.connection ?? null);
                setCreating(false);
            }
        };

        const unsubscribe = apiSocket.addEphemeralListener(handleEphemeralEvent);
        return () => {
            unsubscribe();
        };
    }, [sessionId]);

    // Fetch initial preview state on mount
    React.useEffect(() => {
        if (!sessionId) return;
        previewFetch(`/v3/sessions/${sessionId}/preview`)
            .then(async (resp) => {
                if (!resp.ok) return;
                const data = await resp.json();
                if (data.candidate) setCandidate(data.candidate);
                if (data.connection) setConnection(data.connection);
            })
            .catch(() => {});
    }, [sessionId]);

    const createTunnel = React.useCallback(async () => {
        if (!sessionId || !candidate || creating) return;
        setCreating(true);
        try {
            const resp = await previewFetch(
                `/v3/sessions/${sessionId}/preview/create`,
                {
                    method: "POST",
                    body: JSON.stringify({ candidateId: candidate.id }),
                },
            );
            if (resp.ok) {
                const data = await resp.json();
                if (data.connection) setConnection(data.connection);
            }
        } catch {
            // Will be updated via ephemeral event
        } finally {
            setCreating(false);
        }
    }, [sessionId, candidate, creating]);

    const revokeTunnel = React.useCallback(async () => {
        if (!sessionId || !connection) return;
        try {
            await previewFetch(
                `/v3/sessions/${sessionId}/preview/revoke`,
                {
                    method: "POST",
                    body: JSON.stringify({ tunnelId: connection.tunnelId }),
                },
            );
            setConnection(null);
        } catch {}
    }, [sessionId, connection]);

    /**
     * Extend the active tunnel's lease by another DEFAULT_PREVIEW_LEASE_MS.
     * Calls the server's POST /preview/refresh which resets leaseExpiresAt
     * and lastActiveAt. The connection state is updated via the ephemeral
     * preview-connection-updated event the server broadcasts, but we also
     * patch it locally for instant feedback.
     */
    const refreshLease = React.useCallback(async () => {
        if (!sessionId || !connection) return;
        try {
            const resp = await previewFetch(
                `/v3/sessions/${sessionId}/preview/refresh`,
                {
                    method: "POST",
                    body: JSON.stringify({ tunnelId: connection.tunnelId }),
                },
            );
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.leaseExpiresAt) {
                setConnection({
                    ...connection,
                    leaseExpiresAt: data.leaseExpiresAt,
                    lastActiveAt: data.lastActiveAt ?? Date.now(),
                });
            }
        } catch {}
    }, [sessionId, connection]);

    return { candidate, connection, creating, createTunnel, revokeTunnel, refreshLease };
}
