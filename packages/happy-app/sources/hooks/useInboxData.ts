/**
 * Hook for fetching and subscribing to inbox items + unread count.
 * Uses REST API for initial load, socket ephemeral events for real-time updates.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { ServerInboxItem, fetchInboxItems, fetchInboxUnreadCount, markInboxItemRead, markAllInboxRead, deleteInboxItem, clearAllInbox } from "@/sync/apiInbox";
import { sync } from "@/sync/sync";

interface InboxState {
    items: ServerInboxItem[];
    total: number;
    unreadCount: number;
    loading: boolean;
    error: string | null;
}

export interface InboxActions {
    refresh: () => Promise<void>;
    markRead: (itemId: string) => Promise<void>;
    markAllRead: () => Promise<void>;
    deleteItem: (itemId: string) => Promise<void>;
    clearAll: () => Promise<void>;
}

export function useInboxData(): InboxState & InboxActions {
    const [state, setState] = React.useState<InboxState>({
        items: [],
        total: 0,
        unreadCount: 0,
        loading: true,
        error: null,
    });

    const refresh = React.useCallback(async () => {
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const [listResult, count] = await Promise.all([
                fetchInboxItems(credentials, { limit: 50 }),
                fetchInboxUnreadCount(credentials),
            ]);

            setState((prev) => ({
                ...prev,
                items: listResult.items,
                total: listResult.total,
                unreadCount: count,
                loading: false,
                error: null,
            }));
        } catch (err) {
            setState((prev) => ({
                ...prev,
                loading: false,
                error: String(err),
            }));
        }
    }, []);

    // Initial load
    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    // Real-time: new inbox items
    React.useEffect(() => {
        return sync.onInboxNewItem((item) => {
            setState((prev) => ({
                ...prev,
                items: [item as ServerInboxItem, ...prev.items],
                total: prev.total + 1,
                unreadCount: prev.unreadCount + 1,
            }));
        });
    }, []);

    // Real-time: unread count updates
    React.useEffect(() => {
        return sync.onInboxUnreadCount((count) => {
            setState((prev) => ({ ...prev, unreadCount: count }));
        });
    }, []);

    const markRead = React.useCallback(async (itemId: string) => {
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        // Optimistic update
        setState((prev) => ({
            ...prev,
            items: prev.items.map((i) =>
                i.id === itemId ? { ...i, read: true } : i,
            ),
            unreadCount: Math.max(0, prev.unreadCount - 1),
        }));

        await markInboxItemRead(credentials, itemId);
    }, []);

    const doMarkAllRead = React.useCallback(async () => {
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        // Optimistic update
        setState((prev) => ({
            ...prev,
            items: prev.items.map((i) => ({ ...i, read: true })),
            unreadCount: 0,
        }));

        await markAllInboxRead(credentials);
    }, []);

    const doDeleteItem = React.useCallback(async (itemId: string) => {
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const wasUnread = state.items.find((i) => i.id === itemId && !i.read);

        // Optimistic update
        setState((prev) => ({
            ...prev,
            items: prev.items.filter((i) => i.id !== itemId),
            total: prev.total - 1,
            unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
        }));

        await deleteInboxItem(credentials, itemId);
    }, [state.items]);

    const doClearAll = React.useCallback(async () => {
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        // Optimistic update
        setState((prev) => ({
            ...prev,
            items: [],
            total: 0,
            unreadCount: 0,
        }));

        await clearAllInbox(credentials);
    }, []);

    return {
        ...state,
        refresh,
        markRead,
        markAllRead: doMarkAllRead,
        deleteItem: doDeleteItem,
        clearAll: doClearAll,
    };
}

/**
 * Lightweight hook that only tracks unread count (for badge display).
 * Does not load the full inbox list.
 */
export function useInboxUnreadCount(): number {
    const [count, setCount] = React.useState(0);

    React.useEffect(() => {
        (async () => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const c = await fetchInboxUnreadCount(credentials);
                setCount(c);
            } catch {
                // Silently fail — badge is non-critical
            }
        })();
    }, []);

    React.useEffect(() => {
        return sync.onInboxUnreadCount(setCount);
    }, []);

    // Also update when new items arrive
    React.useEffect(() => {
        return sync.onInboxNewItem(() => {
            setCount((prev) => prev + 1);
        });
    }, []);

    return count;
}
