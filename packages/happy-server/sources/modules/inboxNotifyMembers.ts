/**
 * Multi-member inbox notification dispatcher.
 *
 * Given a project-level event, resolves all WorldMembers and creates
 * InboxItems for each member whose notifyLevel permits the event.
 *
 * Falls back to project owner (accountId) when no explicit members exist.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { log } from "@/utils/log";

interface NotifyMembersInput {
    /** Fallback account (project owner) — used when no WorldMembers exist */
    accountId: string;
    projectId: string;
    category: string;
    eventType: string;
    severity?: string;          // info | warning | error
    title: string;
    body?: string;
    referenceUrl?: string;
    refType?: string;
    refId?: string;
    groupKey?: string;
    skipPush?: boolean;
    /** If set, only notify this specific member (e.g. decision assignee) */
    targetMemberId?: string;
}

type NotifyLevel = "all" | "critical" | "assigned" | "none";

/**
 * Determines whether a member should receive a notification based on their notifyLevel.
 *
 * - "all"      → receives everything
 * - "critical" → only severity=error or category=decision
 * - "assigned" → only if they are the targetMemberId
 * - "none"     → receives nothing
 */
function shouldNotify(
    notifyLevel: NotifyLevel,
    severity: string,
    category: string,
    memberId: string,
    targetMemberId?: string,
): boolean {
    switch (notifyLevel) {
        case "all":
            return true;
        case "critical":
            return severity === "error" || category === "decision";
        case "assigned":
            return targetMemberId === memberId;
        case "none":
            return false;
        default:
            return true;
    }
}

/**
 * Send inbox notifications to relevant WorldMembers.
 * Fire-and-forget — caller should `void inboxNotifyMembers(...)`.
 */
export async function inboxNotifyMembers(input: NotifyMembersInput): Promise<void> {
    try {
        const members = await db.worldMember.findMany({
            where: { projectId: input.projectId },
            select: {
                id: true,
                accountId: true,
                notifyLevel: true,
            },
        });

        const severity = input.severity ?? "info";

        // No explicit members → fall back to single-user notification
        if (members.length === 0) {
            void inboxCreate({
                accountId: input.accountId,
                category: input.category,
                eventType: input.eventType,
                severity,
                title: input.title,
                body: input.body,
                referenceUrl: input.referenceUrl,
                refType: input.refType,
                refId: input.refId,
                groupKey: input.groupKey,
                skipPush: input.skipPush,
            });
            return;
        }

        // Notify each eligible member
        const notified: string[] = [];
        for (const member of members) {
            if (!shouldNotify(
                member.notifyLevel as NotifyLevel,
                severity,
                input.category,
                member.id,
                input.targetMemberId,
            )) {
                continue;
            }

            void inboxCreate({
                accountId: member.accountId,
                category: input.category,
                eventType: input.eventType,
                severity,
                title: input.title,
                body: input.body,
                referenceUrl: input.referenceUrl,
                refType: input.refType,
                refId: input.refId,
                groupKey: input.groupKey
                    ? `${input.groupKey}:${member.accountId}`
                    : undefined,
                skipPush: input.skipPush,
            });
            notified.push(member.id);
        }

        if (notified.length > 0) {
            log({ module: "inbox" }, `Notified ${notified.length} members for ${input.eventType}`);
        }
    } catch (err) {
        log({ module: "inbox", level: "error" }, `inboxNotifyMembers failed: ${err}`);
    }
}
