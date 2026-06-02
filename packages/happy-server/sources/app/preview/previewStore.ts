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
    machineId: string;
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

/**
 * Streaming response subscriber — receives response-start, body chunks, end,
 * and error events for a single proxy request.
 */
export interface ProxyResponseSubscriber {
    onStart(data: { status: number; statusText: string; headers: Record<string, string>; hasBody: boolean }): void;
    onBody(chunk: Buffer): void;
    onEnd(): void;
    onError(message: string): void;
}

class PreviewStore {
    private candidates = new Map<string, StoredCandidate>();
    private connections = new Map<string, StoredConnection>(); // tunnelId → connection
    private sessionConnections = new Map<string, string>(); // sessionId → tunnelId
    private pendingRequests = new Map<string, PendingProxyRequest>(); // requestId → resolver
    private streamSubscribers = new Map<string, ProxyResponseSubscriber>(); // requestId → streaming subscriber
    private requestTunnel = new Map<string, string>(); // requestId → tunnelId (for byte counting)

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
     * Get the most recent candidate for a session, optionally scoped to a
     * specific machine. When machineId is given, only candidates from that
     * machine are considered — prevents cross-machine candidate pollution.
     */
    getCandidateBySession(sessionId: string, machineId?: string): StoredCandidate | undefined {
        let latest: StoredCandidate | undefined;
        for (const candidate of this.candidates.values()) {
            if (candidate.sessionId !== sessionId) continue;
            if (machineId && candidate.machineId !== machineId) continue;
            if (!latest || candidate.reportedAt > latest.reportedAt) {
                latest = candidate;
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
     * Used for one-shot request/response (legacy non-streaming path).
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
     * Subscribe to a streaming proxy response.
     * The subscriber's callbacks fire as response-start/body/end/error events
     * arrive from the CLI daemon. Returns an unsubscribe function.
     */
    subscribeProxyResponse(
        requestId: string,
        tunnelId: string,
        subscriber: ProxyResponseSubscriber,
    ): () => void {
        this.streamSubscribers.set(requestId, subscriber);
        this.requestTunnel.set(requestId, tunnelId);
        return () => {
            this.streamSubscribers.delete(requestId);
            this.requestTunnel.delete(requestId);
        };
    }

    /**
     * Touch lastActiveAt for the tunnel owning a request. Used by gateway
     * to keep the connection alive during long-running streams.
     */
    touchByRequest(requestId: string): void {
        const tunnelId = this.requestTunnel.get(requestId);
        if (!tunnelId) return;
        const conn = this.connections.get(tunnelId);
        if (conn) conn.lastActiveAt = Date.now();
    }

    /**
     * Resolve the response start (status, headers).
     */
    resolveResponseStart(requestId: string, data: any): void {
        // Streaming subscriber (preferred)
        const sub = this.streamSubscribers.get(requestId);
        if (sub) {
            this.touchByRequest(requestId);
            sub.onStart({
                status: data.status,
                statusText: data.statusText,
                headers: data.headers ?? {},
                hasBody: data.hasBody ?? false,
            });
            return;
        }
        // Legacy one-shot
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
        const sub = this.streamSubscribers.get(requestId);
        if (sub) {
            this.touchByRequest(requestId);
            try {
                sub.onBody(Buffer.from(chunk, "base64"));
            } catch {
                sub.onError("Invalid base64 chunk");
            }
            return;
        }
        // Legacy one-shot path (unused with subscribers)
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            pending.resolve({ type: "body", chunk });
        }
    }

    /**
     * Resolve the response end (final chunk).
     */
    resolveResponseEnd(requestId: string): void {
        const sub = this.streamSubscribers.get(requestId);
        if (sub) {
            this.streamSubscribers.delete(requestId);
            this.requestTunnel.delete(requestId);
            sub.onEnd();
            return;
        }
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
        const sub = this.streamSubscribers.get(requestId);
        if (sub) {
            this.streamSubscribers.delete(requestId);
            this.requestTunnel.delete(requestId);
            sub.onError(error);
            return;
        }
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.reject(new Error(error));
        }
    }

    // ── F6: Idle / lease cleanup ──────────────────────────────────────────

    /**
     * Iterate all connections — used by lease cleanup job.
     */
    listConnections(): StoredConnection[] {
        return Array.from(this.connections.values());
    }

    /**
     * Touch a connection's lastActiveAt timestamp.
     */
    touchConnection(tunnelId: string): void {
        const conn = this.connections.get(tunnelId);
        if (conn) conn.lastActiveAt = Date.now();
    }

    /**
     * F5: extend lease — bumps leaseExpiresAt by `extendMs` from now,
     * and also touches lastActiveAt. Returns the updated connection or
     * undefined if not found. Used by the App's lease refresh button.
     */
    refreshLease(tunnelId: string, extendMs: number): StoredConnection | undefined {
        const conn = this.connections.get(tunnelId);
        if (!conn) return undefined;
        const now = Date.now();
        conn.leaseExpiresAt = now + extendMs;
        conn.lastActiveAt = now;
        return conn;
    }
}

export const previewStore = new PreviewStore();
