import { type Message } from "@/sync/typesMessage";

const MAX_TURNS = 3;
const MAX_TURN_USER = 150;
const MAX_TURN_AGENT = 200;
const MAX_GOAL_TEXT = 250;
const MAX_TITLE = 100;
const MAX_TOTAL = 1800;

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max - 3) + "...";
}

function extractPlainText(msg: Message): string {
    if (msg.kind === "user-text") return msg.text;
    if (msg.kind === "agent-text") return msg.text;
    return "";
}

export function buildOptionScoringContext(
    messages: readonly Message[],
    sessionTitle: string | null,
): string {
    // messages is newest-first. Collect last MAX_TURNS turns and track total turn count.
    const turns: Array<{ user: string; agent: string | null }> = [];
    let pendingAgent: string | null = null;
    let goalUser: string | null = null;
    let totalTurns = 0;

    for (const msg of messages) {
        if (msg.kind === "agent-text" && !msg.isThinking) {
            if (pendingAgent === null) {
                pendingAgent = truncate(extractPlainText(msg), MAX_TURN_AGENT);
            }
        } else if (msg.kind === "user-text") {
            const userText = extractPlainText(msg).trim();
            if (!userText) continue;
            totalTurns++;
            if (turns.length < MAX_TURNS) {
                turns.push({ user: truncate(userText, MAX_TURN_USER), agent: pendingAgent });
            }
            pendingAgent = null;
            goalUser = truncate(userText, MAX_GOAL_TEXT);
        }
    }

    const parts: string[] = [];

    if (sessionTitle) {
        parts.push(`Task: ${truncate(sessionTitle, MAX_TITLE)}`);
    }

    // Include original goal only when the session is longer than MAX_TURNS
    // (otherwise goal is already visible in the recent turns)
    if (goalUser && totalTurns > MAX_TURNS) {
        parts.push(`Goal: ${goalUser}`);
    }

    if (turns.length > 0) {
        parts.push("Recent:");
        // Reverse to chronological order (oldest first)
        [...turns].reverse().forEach((t) => {
            parts.push(`  U: ${t.user}`);
            if (t.agent) parts.push(`  A: ${t.agent}`);
        });
    }

    const result = parts.join("\n");
    return result.length <= MAX_TOTAL ? result : result.slice(0, MAX_TOTAL);
}
