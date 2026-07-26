import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { pushSend } from "./pushSend";

const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface InboxCreateInput {
    accountId: string;
    category: string;       // task | trigger | supervisor | session | system
    eventType: string;      // e.g. "task.completed"
    severity?: string;      // info | warning | error (default: info)
    title: string;
    body?: string;
    referenceUrl?: string;
    refType?: string;
    refId?: string;
    groupKey?: string;
    skipPush?: boolean;     // Skip push notification (e.g. supervisor already pushes)
}

/**
 * Create an inbox item, emit ephemeral to connected clients, and optionally push.
 * Fire-and-forget — caller should `void inboxCreate(...)`.
 */
export async function inboxCreate(input: InboxCreateInput): Promise<void> {
    try {
        // Dedup: if groupKey provided, check for recent duplicate
        if (input.groupKey) {
            const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
            const existing = await db.inboxItem.findFirst({
                where: {
                    accountId: input.accountId,
                    groupKey: input.groupKey,
                    createdAt: { gte: cutoff },
                },
                select: { id: true },
            });
            if (existing) {
                return; // Skip duplicate
            }
        }

        const item = await db.inboxItem.create({
            data: {
                accountId: input.accountId,
                category: input.category,
                eventType: input.eventType,
                severity: input.severity ?? "info",
                title: input.title,
                body: input.body,
                referenceUrl: input.referenceUrl,
                refType: input.refType,
                refId: input.refId,
                groupKey: input.groupKey,
            },
        });

        const serialized = {
            id: item.id,
            category: item.category,
            eventType: item.eventType,
            severity: item.severity,
            title: item.title,
            body: item.body ?? undefined,
            read: false,
            referenceUrl: item.referenceUrl ?? undefined,
            refType: item.refType ?? undefined,
            refId: item.refId ?? undefined,
            groupKey: item.groupKey ?? undefined,
            createdAt: item.createdAt.getTime(),
        };

        // Emit new item ephemeral (specific channel for backward compat).
        await emitSyncEphemeral(input.accountId, {
            t: "inbox-new-item",
            item: serialized,
        });

        // Emit unified world event channel.
        {
            const mapSeverity = (s: string): "info" | "warning" | "critical" =>
                s === "error" || s === "critical" ? "critical" : s === "warning" ? "warning" : "info";
            await emitSyncEphemeral(input.accountId, {
                t: "world-event-created",
                event: {
                    id: `inbox-${item.id}`,
                    eventType: input.category === "trigger" ? item.eventType : `decision.${item.eventType}`,
                    title: item.title,
                    summary: item.body ?? "",
                    occurredAt: item.createdAt.getTime(),
                    severity: mapSeverity(item.severity),
                    source: {
                        type: item.refType === "project" ? "project" : "system",
                        projectId: item.refType === "project" ? (item.refId ?? null) : null,
                    },
                    originalId: item.id,
                },
            });
        }

        // Emit updated unread count.
        const unreadCount = await db.inboxItem.count({
            where: { accountId: input.accountId, read: false },
        });
        await emitSyncEphemeral(input.accountId, {
            t: "inbox-unread-count",
            count: unreadCount,
        });

        // Push notification (unless skipped)
        if (!input.skipPush) {
            void pushSend(input.accountId, {
                title: input.title,
                body: input.body ?? "",
                data: {
                    type: "inbox",
                    inboxItemId: item.id,
                    referenceUrl: input.referenceUrl,
                },
                badge: unreadCount,
            });
        }
    } catch (err) {
        log({ module: "inbox", level: "error" }, `Failed to create inbox item: ${err}`);
    }
}
