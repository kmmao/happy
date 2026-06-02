/**
 * In-memory store for preview candidates and tunnel connections.
 *
 * Candidates: reported dev servers awaiting user action.
 * Connections: active preview tunnels proxying traffic.
 *
 * This module does not require database persistence — all state is ephemeral
 * and tied to server memory. If the server restarts, clients report new
 * candidates and recreate tunnels.
 */

import { log } from "@/utils/log";

interface StoredCandidate {
    id: string;
    sessionId: string;
    state: string;
    protocol: string;
    host: string;
    port: number;
    path?: string;
    devServerType?: string;
    command?: string;
    cwd?: string;
    pid?: number;
    reportedAt: number;
}

interface StoredConnection {
    tunnelId: string;
    candidateId: string;
    sessionId: string;
    machineId: string;
    publicUrl: string;
    status: string;
    createdAt: number;
    leaseExpiresAt: number;
    idleTimeoutMs: number;
    lastActiveAt: number;
}

interface PendingProxyRequest {
    requestId: string;
    timeout: NodeJS.Timeout;
    resolve: (data: any) => void;
    reject: (err: any) => void;
}

class PreviewStore {
    private candidates = new Map<string, StoredCandidate>();
    private connections = new Map<string, StoredConnection>(); // tunnelId → connection
    private sessionConnections = new Map<string, string>(); // sessionId → tunnelId
    private pendingRequests = new Map<string, PendingProxyRequest>(); // requestId → resolver

    /**
     * Add a candidate to the store.
     */
    addCandidate(candidate: StoredCandidate): void {
        this.candidates.set(candidate.id, candidate);
        log({ module: "preview" }, `Candidate added: ${candidate.id} for session ${candidate.sessionId}`);
    }

    /**
     * Get a candidate by ID.
     */
    getCandidate(candidateId: string): StoredCandidate | undefined {
        return this.candidates.get(candidateId);
    }

    /**
     * Get the most recent candidate for a session.
     */
    getCandidateBySession(sessionId: string): StoredCandidate | undefined {
        let latest: StoredCandidate | undefined;
        for (const candidate of this.candidates.values()) {
            if (candidate.sessionId === sessionId) {
                if (!latest || candidate.reportedAt > latest.reportedAt) {
                    latest = candidate;
                }
            }
        }
        return latest;
    }

    /**
     * Add a connection to the store.
     */
    addConnection(connection: StoredConnection): void {
        this.connections.set(connection.tunnelId, connection);
        this.sessionConnections.set(connection.sessionId, connection.tunnelId);
        log({ module: "preview" }, `Connection created: ${connection.tunnelId} for session ${connection.sessionId}`);
    }

    /**
     * Get a connection by tunnel ID.
     */
    getConnection(tunnelId: string): StoredConnection | undefined {
        return this.connections.get(tunnelId);
    }

    /**
     * Get the active connection for a session.
     */
    getConnectionBySession(sessionId: string): StoredConnection | undefined {
        const tunnelId = this.sessionConnections.get(sessionId);
        if (!tunnelId) return undefined;
        return this.connections.get(tunnelId);
    }

    /**
     * Remove a connection from the store.
     */
    removeConnection(tunnelId: string): void {
        const connection = this.connections.get(tunnelId);
        if (connection) {
            this.connections.delete(tunnelId);
            this.sessionConnections.delete(connection.sessionId);
            log({ module: "preview" }, `Connection revoked: ${tunnelId}`);
        }
    }

    /**
     * Create a pending request with automatic timeout.
     */
    createPendingRequest(requestId: string, timeoutMs: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Preview request timeout: ${requestId}`));
            }, timeoutMs);

            this.pendingRequests.set(requestId, {
                requestId,
                timeout,
                resolve,
                reject,
            });
        });
    }

    /**
     * Resolve the response start (status, headers).
     */
    resolveResponseStart(requestId: string, data: any): void {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.resolve({ type: "start", ...data });
        }
    }

    /**
     * Resolve the response body chunk.
     */
    resolveResponseBody(requestId: string, chunk: string): void {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            // For now, body chunks are collected; in future, stream directly
            pending.resolve({ type: "body", chunk });
        }
    }

    /**
     * Resolve the response end (final chunk).
     */
    resolveResponseEnd(requestId: string): void {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.resolve({ type: "end" });
        }
    }

    /**
     * Resolve the response with an error.
     */
    resolveResponseError(requestId: string, error: string): void {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.reject(new Error(error));
        }
    }
}

export const previewStore = new PreviewStore();
