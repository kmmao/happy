import { AgentState, Metadata, MachineMetadata } from '../storageTypes';
import { DecryptedMessage } from '../storageTypes';
import { LruCache } from './lruCache';

/**
 * In-memory cache for decrypted session data to avoid expensive re-decryption.
 * Uses sessionId/machineId + version as keys for versioned blobs, and messageId
 * for messages (immutable). The LRU semantics (touch-on-read, evict-on-write,
 * prefix-delete) are owned by {@link LruCache}; this class only builds keys and
 * maps each entity to its typed cache.
 */
export class EncryptionCache {
    private agentStateCache = new LruCache<AgentState>(1000);
    private metadataCache = new LruCache<Metadata>(1000);
    private messageCache = new LruCache<DecryptedMessage>(1000);
    private machineMetadataCache = new LruCache<MachineMetadata>(500);
    private daemonStateCache = new LruCache<any>(500);

    getCachedAgentState(sessionId: string, version: number): AgentState | null {
        return this.agentStateCache.get(`${sessionId}:${version}`) ?? null;
    }

    setCachedAgentState(sessionId: string, version: number, data: AgentState): void {
        this.agentStateCache.set(`${sessionId}:${version}`, data);
    }

    getCachedMetadata(sessionId: string, version: number): Metadata | null {
        return this.metadataCache.get(`${sessionId}:${version}`) ?? null;
    }

    setCachedMetadata(sessionId: string, version: number, data: Metadata): void {
        this.metadataCache.set(`${sessionId}:${version}`, data);
    }

    getCachedMessage(messageId: string): DecryptedMessage | null {
        return this.messageCache.get(messageId) ?? null;
    }

    setCachedMessage(messageId: string, data: DecryptedMessage): void {
        this.messageCache.set(messageId, data);
    }

    getCachedMachineMetadata(machineId: string, version: number): MachineMetadata | null {
        return this.machineMetadataCache.get(`${machineId}:${version}`) ?? null;
    }

    setCachedMachineMetadata(machineId: string, version: number, data: MachineMetadata): void {
        this.machineMetadataCache.set(`${machineId}:${version}`, data);
    }

    /**
     * Daemon state may legitimately be cached as `null`; a miss is `undefined`,
     * so this deliberately does NOT coalesce to `null`.
     */
    getCachedDaemonState(machineId: string, version: number): any | undefined {
        return this.daemonStateCache.get(`${machineId}:${version}`);
    }

    setCachedDaemonState(machineId: string, version: number, data: any): void {
        this.daemonStateCache.set(`${machineId}:${version}`, data);
    }

    /**
     * Clear all cache entries for a specific machine (all versions).
     */
    clearMachineCache(machineId: string): void {
        this.machineMetadataCache.deletePrefix(`${machineId}:`);
        this.daemonStateCache.deletePrefix(`${machineId}:`);
    }

    /**
     * Clear all cache entries for a specific session (all versions).
     * Messages are not cleared — they're immutable and session-agnostic.
     */
    clearSessionCache(sessionId: string): void {
        this.agentStateCache.deletePrefix(`${sessionId}:`);
        this.metadataCache.deletePrefix(`${sessionId}:`);
    }

    clearAll(): void {
        this.agentStateCache.clear();
        this.metadataCache.clear();
        this.messageCache.clear();
        this.machineMetadataCache.clear();
        this.daemonStateCache.clear();
    }

    getStats() {
        return {
            agentStates: this.agentStateCache.size,
            metadata: this.metadataCache.size,
            messages: this.messageCache.size,
            machineMetadata: this.machineMetadataCache.size,
            daemonStates: this.daemonStateCache.size,
            totalEntries:
                this.agentStateCache.size +
                this.metadataCache.size +
                this.messageCache.size +
                this.machineMetadataCache.size +
                this.daemonStateCache.size,
        };
    }
}
