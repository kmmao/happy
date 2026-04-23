import { type Message } from "@/sync/typesMessage";

const MAX_USER_TEXT = 200;
const MAX_AGENT_TEXT = 300;
const MAX_TOTAL = 1000;

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
    let lastUserText: string | null = null;
    let lastAgentText: string | null = null;

    for (const msg of messages) {
        if (msg.kind === "user-text" && !lastUserText) {
            lastUserText = truncate(extractPlainText(msg), MAX_USER_TEXT);
        }
        if (msg.kind === "agent-text" && !msg.isThinking && !lastAgentText) {
            lastAgentText = truncate(extractPlainText(msg), MAX_AGENT_TEXT);
        }
        if (lastUserText && lastAgentText) break;
    }

    const parts: string[] = [];
    if (lastUserText) parts.push(`- User: ${lastUserText}`);
    if (lastAgentText) parts.push(`- Agent: ${lastAgentText}`);
    if (sessionTitle) parts.push(`- Task: ${truncate(sessionTitle, 100)}`);

    const result = parts.join("\n");
    return result.length <= MAX_TOTAL ? result : result.slice(0, MAX_TOTAL);
}
