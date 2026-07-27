import { findLanguageByCode } from '@/constants/Languages';

/**
 * Session configuration for the OpenAI Realtime "calls" API.
 *
 * The gateway (sub2api `POST /v1/live`) forwards this object to the upstream
 * verbatim, so everything the assistant knows — its prompt, its tools, its
 * voice — is decided here on the client instead of in a remotely managed agent.
 */

/**
 * Tool schemas mirroring the implementations in `../../realtimeClientTools.ts`.
 * Names must match the keys of `realtimeClientTools` exactly.
 */
export const REALTIME_TOOLS = [
    {
        type: 'function',
        name: 'messageClaudeCode',
        description:
            'Send a message or instruction to Claude Code in the active coding session. Use this whenever the user wants to communicate with Claude Code.',
        parameters: {
            type: 'object',
            required: ['message'],
            properties: {
                message: {
                    type: 'string',
                    description:
                        "The message to send to Claude Code. This should be the user's instruction or question.",
                },
            },
        },
    },
    {
        type: 'function',
        name: 'processPermissionRequest',
        description:
            'Process a permission request from Claude Code. Call this when the user decides to allow or deny a tool usage request from Claude Code.',
        parameters: {
            type: 'object',
            required: ['decision'],
            properties: {
                decision: {
                    type: 'string',
                    description: "The user's decision on the permission request.",
                    enum: ['allow', 'deny'],
                },
            },
        },
    },
] as const;

const BASE_INSTRUCTIONS = `You are the voice interface for Happy Coder, a tool that controls Claude Code remotely.

Your role:
- Relay the user's voice commands to Claude Code via the messageClaudeCode tool
- Handle permission requests from Claude Code (allow/deny) via processPermissionRequest
- Report Claude Code's responses and status updates to the user verbally

Rules:
- When the user gives a coding instruction, call messageClaudeCode immediately with the instruction
- When Claude Code asks for permission, clearly explain what it wants to do, then ask the user to allow or deny
- When Claude Code finishes working, report the summary to the user immediately
- Keep your verbal responses concise — the user wants speed, not lengthy explanations
- If the user says something ambiguous, ask for clarification before calling a tool
- You receive contextual updates about session events, messages and permission requests. Treat them as background knowledge; do not read them out loud unless they are relevant.`;

/**
 * Session type expected by the gateway.
 *
 * sub2api's Live gateway forwards to ChatGPT's Codex realtime endpoint with
 * `intent=quicksilver`, and that upstream rejects anything else:
 * "Field `session.type` must be `quicksilver` when `intent=quicksilver` is
 * requested". A stock OpenAI Realtime endpoint expects `"realtime"` (and
 * requires a `model`) — switching targets means changing this constant.
 */
const SESSION_TYPE = 'quicksilver';

export interface BuildSessionConfigOptions {
    /** Happy session the assistant is attached to. */
    sessionId: string;
    /** Formatted session history injected as background knowledge. */
    initialContext?: string;
    /** User's `voiceAssistantLanguage` setting (null = auto-detect). */
    language?: string | null;
    /** Output voice override (null = gateway default). */
    voice?: string | null;
}

function buildInstructions(options: BuildSessionConfigOptions): string {
    const parts = [BASE_INSTRUCTIONS];

    const language = findLanguageByCode(options.language ?? null);
    if (language?.code) {
        parts.push(
            `Always speak ${language.name} (${language.nativeName}), regardless of the language of the context updates.`,
        );
    } else {
        parts.push('Respond in the same language the user speaks to you.');
    }

    parts.push(`The active Claude Code session id is ${options.sessionId}.`);

    const initialContext = options.initialContext?.trim();
    if (initialContext) {
        parts.push(
            `Current state of the session — use it to answer questions about what happened so far:\n${initialContext}`,
        );
    }

    return parts.join('\n\n');
}

/**
 * Build the `session` object sent alongside the SDP offer.
 *
 * No `model` is sent: the Codex realtime upstream picks the model from the
 * account and rejects the field outright ("Field `session.model` is not allowed
 * for this Codex realtime session"). Other optional fields are omitted rather
 * than sent as null so the upstream falls back to its own defaults — the Live
 * gateway forwards this object without rewriting it.
 */
export function buildSessionConfig(options: BuildSessionConfigOptions): Record<string, unknown> {
    const voice = options.voice?.trim();

    return {
        type: SESSION_TYPE,
        instructions: buildInstructions(options),
        audio: {
            input: {
                turn_detection: {
                    type: 'semantic_vad',
                },
            },
            output: {
                ...(voice ? { voice } : {}),
            },
        },
        tools: REALTIME_TOOLS,
        tool_choice: 'auto',
    };
}
