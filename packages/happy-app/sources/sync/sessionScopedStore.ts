import { log } from "@/log";

export interface SessionScopedStore {
    disposeSession(sessionId: string): void;
}

const stores: SessionScopedStore[] = [];

export function registerSessionScopedStore(store: SessionScopedStore): void {
    if (!stores.includes(store)) {
        stores.push(store);
    }
}

export function disposeSessionScopedState(sessionId: string): void {
    for (const store of stores) {
        try {
            store.disposeSession(sessionId);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            log.warn(
                `session scoped store dispose failed for ${sessionId}: ${message}`,
            );
        }
    }
}

export function __resetSessionScopedStoresForTest(): void {
    stores.length = 0;
}
