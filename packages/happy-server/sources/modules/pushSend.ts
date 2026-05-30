import Expo, { type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { db } from "@/storage/db";
import { isUserActive } from "@/app/push/focusTracker";
import { log } from "@/utils/log";

const expo = new Expo();
const BRIEF_PUSH_BODY_LIMIT = 100;

interface PushPayload {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    badge?: number;
    sound?: "default" | null;
    categoryId?: string;
}

export interface BriefPushInput {
    summary?: unknown;
    detail?: unknown;
}

function normalizePushText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function truncatePushBody(value: string): string {
    if (value.length <= BRIEF_PUSH_BODY_LIMIT) return value;
    return `${value.slice(0, BRIEF_PUSH_BODY_LIMIT - 1).trimEnd()}…`;
}

function extractBriefDetailLine(detail: string, label: "Goal" | "Current focus"): string | undefined {
    const match = detail.match(new RegExp(`${label}:\\s*([^\\n]+)`, "i"));
    return match ? normalizePushText(match[1]) : undefined;
}

export function buildBriefPushBody(brief: BriefPushInput): string {
    const detail = typeof brief.detail === "string" ? brief.detail : "";
    const summary = typeof brief.summary === "string" ? normalizePushText(brief.summary) : "";
    const goal = extractBriefDetailLine(detail, "Goal");
    const currentFocus = extractBriefDetailLine(detail, "Current focus");
    const structuredSummary = [
        goal ? `Goal: ${goal}` : undefined,
        currentFocus ? `Current focus: ${currentFocus}` : undefined,
    ].filter(Boolean).join(" ");

    return truncatePushBody(structuredSummary || summary || "Loop completed");
}

interface PushSendOptions {
    /**
     * If true, skip sending the push when the recipient has at least one
     * active non-machine socket (mobile/web/desktop) connected. The intent
     * is "don't buzz the phone if they're already looking at the App" —
     * realtime socket updates already cover the same information in-app.
     *
     * Off by default to preserve the previous always-send behavior for
     * callers that haven't opted in.
     */
    suppressIfActive?: boolean;
}

/**
 * Send push notifications to all devices registered for a given account.
 * Automatically cleans up invalid tokens (DeviceNotRegistered).
 */
export async function pushSend(
    accountId: string,
    payload: PushPayload,
    options: PushSendOptions = {},
): Promise<void> {
    if (options.suppressIfActive && isUserActive(accountId)) {
        log({ module: "push" }, `Suppressed push for ${accountId}: user active`);
        return;
    }

    const tokenRecords = await db.accountPushToken.findMany({
        where: { accountId },
        select: { token: true },
    });

    if (tokenRecords.length === 0) return;

    const messages: ExpoPushMessage[] = tokenRecords
        .filter((r) => Expo.isExpoPushToken(r.token))
        .map((r) => ({
            to: r.token,
            title: payload.title,
            body: payload.body,
            data: payload.data,
            sound: payload.sound ?? "default",
            badge: payload.badge,
            categoryId: payload.categoryId,
            channelId: "default",
            priority: "high" as const,
        }));

    if (messages.length === 0) return;

    const chunks = expo.chunkPushNotifications(messages);
    const invalidTokens: string[] = [];

    for (const chunk of chunks) {
        try {
            const tickets: ExpoPushTicket[] =
                await expo.sendPushNotificationsAsync(chunk);

            for (let i = 0; i < tickets.length; i++) {
                const ticket = tickets[i];
                if (ticket.status === "error") {
                    if (
                        ticket.details?.error === "DeviceNotRegistered" &&
                        chunk[i].to
                    ) {
                        const to = chunk[i].to;
                        const token =
                            typeof to === "string" ? to : undefined;
                        if (token) invalidTokens.push(token);
                    }
                }
            }
        } catch {
            // Network error — skip chunk, tokens remain for retry
        }
    }

    // Clean up invalid tokens
    if (invalidTokens.length > 0) {
        await db.accountPushToken.deleteMany({
            where: {
                accountId,
                token: { in: invalidTokens },
            },
        });
    }
}

/**
 * Map push notification types to notification preference keys.
 */
const PUSH_TYPE_TO_PREF: Record<string, string> = {
    analysis_complete: "onAnalysisComplete",
    critical_finding: "onAnalysisComplete",
    fix_complete: "onIssueCreated",
    error: "onError",
};

/**
 * Check if a supervisor notification type is enabled for a project.
 * Returns true if preferences are null (default: all enabled).
 */
async function isSupervisorNotifyEnabled(
    projectId: string,
    notificationType: string,
): Promise<boolean> {
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: { supervisorNotifyPrefs: true },
    });

    // null means all enabled (default)
    if (!project || project.supervisorNotifyPrefs === null) return true;

    const prefs = project.supervisorNotifyPrefs.split(",").map((s) => s.trim());
    const prefKey = PUSH_TYPE_TO_PREF[notificationType];
    if (!prefKey) return true; // Unknown type — send anyway

    return prefs.includes(prefKey);
}

/**
 * Send a supervisor notification to the project owner.
 * Respects per-project notification preferences.
 */
export async function pushSupervisorNotification(
    accountId: string,
    opts: {
        projectId: string;
        runId: string;
        type: "analysis_complete" | "critical_finding" | "fix_complete" | "error";
        title: string;
        body: string;
    },
): Promise<void> {
    const enabled = await isSupervisorNotifyEnabled(opts.projectId, opts.type);
    if (!enabled) {
        log(
            { module: "push" },
            `Supervisor notification suppressed (type: ${opts.type}, project: ${opts.projectId})`,
        );
        return;
    }

    await pushSend(
        accountId,
        {
            title: opts.title,
            body: opts.body,
            data: {
                type: "supervisor",
                projectId: opts.projectId,
                runId: opts.runId,
                notificationType: opts.type,
            },
            categoryId: "supervisor",
        },
        // Supervisor notifications announce work the user requested
        // ("analysis complete", "fix complete", "critical finding").
        // When the user already has a non-machine client connected they
        // see the same outcome in-app via realtime updates — skip the
        // push to avoid an extra buzz on the same event.
        { suppressIfActive: true },
    );
}
