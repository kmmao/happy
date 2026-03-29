import { z } from "zod";
import * as crypto from "crypto";
import { type Fastify } from "../types";
import { log } from "@/utils/log";

const VoiceTokenResponseSchema = z.discriminatedUnion('allowed', [
    z.object({
        allowed: z.literal(true),
        token: z.string(),
        agentId: z.string(),
        elevenUserId: z.string(),
        usedSeconds: z.number(),
        limitSeconds: z.number(),
    }),
    z.object({
        allowed: z.literal(false),
        reason: z.enum(['voice_limit_reached', 'subscription_required']),
        usedSeconds: z.number(),
        limitSeconds: z.number(),
        agentId: z.string(),
    }),
]);

const VOICE_FREE_LIMIT_SECONDS = 3600;

/**
 * Agent configuration template — replicated to user accounts automatically.
 * Must match the centrally managed Agent on the platform ElevenLabs account.
 */
const AGENT_TEMPLATE = {
    name: "Happy Coder Voice Assistant",
    conversation_config: {
        agent: {
            first_message: "Hey! I'm connected to your coding session. What would you like me to tell Claude Code?",
            language: "zh",
            prompt: {
                prompt: `You are the voice interface for Happy Coder, a tool that controls Claude Code remotely.

Your role:
- Relay user's voice commands to Claude Code via the messageClaudeCode tool
- Handle permission requests from Claude Code (allow/deny) via processPermissionRequest
- Report Claude Code's responses and status updates to the user verbally

Context:
- You will receive dynamic variables: {{sessionId}} and {{initialConversationContext}}
- You will receive contextual updates about session events, messages, and permission requests
- The initialConversationContext contains the full session history when voice starts

Rules:
- When the user gives a coding instruction, call messageClaudeCode immediately with the instruction
- When Claude Code asks for permission, clearly explain what it wants to do, then ask the user to allow or deny
- When you receive a ready event (Claude Code done working), report the summary to the user immediately
- Keep your verbal responses concise — the user wants speed, not lengthy explanations
- If the user says something ambiguous, ask for clarification before calling a tool
- Respond in the same language the user speaks to you`,
                llm: "gpt-4.1-nano-2025-04-14",
                temperature: 0.0,
                tools: [
                    {
                        type: "client",
                        name: "messageClaudeCode",
                        description: "Send a message or instruction to Claude Code in the active coding session. Use this whenever the user wants to communicate with Claude Code.",
                        parameters: {
                            type: "object",
                            required: ["message"],
                            properties: {
                                message: {
                                    type: "string",
                                    description: "The message to send to Claude Code. This should be the user's instruction or question.",
                                },
                            },
                        },
                    },
                    {
                        type: "client",
                        name: "processPermissionRequest",
                        description: "Process a permission request from Claude Code. Call this when the user decides to allow or deny a tool usage request from Claude Code.",
                        parameters: {
                            type: "object",
                            required: ["decision"],
                            properties: {
                                decision: {
                                    type: "string",
                                    description: "The user's decision on the permission request. Must be either 'allow' or 'deny'.",
                                    enum: ["allow", "deny"],
                                },
                            },
                        },
                    },
                ],
            },
        },
        tts: {
            model_id: "eleven_v3_conversational",
            voice_id: "eXpIbVcVbLo8ZJQDlDnl",
        },
        conversation: {
            max_duration_seconds: 600,
        },
    },
};

/** In-memory cache: hash(userApiKey) → agentId */
const userAgentCache = new Map<string, string>();

function hashKey(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Find or create an Agent on the user's ElevenLabs account.
 * Caches the result in memory so we only create once per server restart per key.
 */
async function getOrCreateUserAgent(userApiKey: string): Promise<string> {
    const keyHash = hashKey(userApiKey);
    const cached = userAgentCache.get(keyHash);
    if (cached) return cached;

    // Check if user already has a Happy Coder agent
    try {
        const listResp = await fetch("https://api.elevenlabs.io/v1/convai/agents?page_size=100", {
            headers: { "xi-api-key": userApiKey },
        });
        if (listResp.ok) {
            const data = (await listResp.json()) as { agents?: Array<{ agent_id: string; name: string }> };
            const existing = data.agents?.find(a => a.name === AGENT_TEMPLATE.name);
            if (existing) {
                log({ module: "voice" }, `Found existing user agent: ${existing.agent_id}`);
                userAgentCache.set(keyHash, existing.agent_id);
                return existing.agent_id;
            }
        }
    } catch (err) {
        log({ module: "voice" }, `Failed to list user agents: ${err}`);
    }

    // Create new agent on user's account
    const createResp = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
        method: "POST",
        headers: {
            "xi-api-key": userApiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(AGENT_TEMPLATE),
    });

    if (!createResp.ok) {
        const body = await createResp.text();
        throw new Error(`Failed to create agent on user account: ${createResp.status} ${body}`);
    }

    const created = (await createResp.json()) as { agent_id: string };
    log({ module: "voice" }, `Created new agent on user account: ${created.agent_id}`);
    userAgentCache.set(keyHash, created.agent_id);
    return created.agent_id;
}

function deriveElevenUserId(happyUserId: string): string {
    const hmac = crypto.createHmac("sha256", process.env.HANDY_MASTER_SECRET!);
    hmac.update(happyUserId);
    const digest = hmac.digest();
    const base64url = digest
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return `u_${base64url}`;
}

async function getUsedVoiceSeconds(
    elevenLabsApiKey: string,
    elevenUserId: string
): Promise<number> {
    const url = new URL("https://api.elevenlabs.io/v1/convai/conversations");
    url.searchParams.set("user_id", elevenUserId);
    url.searchParams.set("page_size", "100");

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
            "xi-api-key": elevenLabsApiKey,
            "Accept": "application/json",
        },
    });

    if (!response.ok) {
        throw new Error(`ElevenLabs conversation history request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
        conversations?: Array<{ call_duration_secs?: number }>;
    };

    let totalSeconds = 0;
    for (const conv of data.conversations ?? []) {
        totalSeconds += conv.call_duration_secs ?? 0;
    }
    return totalSeconds;
}

async function hasActiveSubscription(userId: string): Promise<boolean> {
    const revenueCatApiKey = process.env.REVENUECAT_API_KEY;
    if (!revenueCatApiKey) {
        log({ module: "voice" }, "REVENUECAT_API_KEY not configured, treating as no subscription");
        return false;
    }

    try {
        const response = await fetch(
            `https://api.revenuecat.com/v1/subscribers/${userId}`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${revenueCatApiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            log({ module: "voice" }, `RevenueCat check failed for user ${userId}: ${response.status}`);
            return false;
        }

        const data = (await response.json()) as any;
        return !!data.subscriber?.entitlements?.active?.pro;
    } catch (error) {
        log({ module: "voice" }, `RevenueCat check error for user ${userId}: ${error}`);
        return false;
    }
}

export function voiceRoutes(app: Fastify) {
    app.post('/v1/voice/token', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                agentId: z.string(),
                userApiKey: z.string().optional(),
            }),
            response: {
                200: VoiceTokenResponseSchema,
                500: z.object({
                    error: z.string(),
                }),
            },
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { agentId: platformAgentId, userApiKey } = request.body;

        const keySource = userApiKey ? 'user' : 'server';
        const keyPreview = (userApiKey || process.env.ELEVENLABS_API_KEY || '').slice(0, 8);
        log({ module: 'voice' }, `Voice token request from user ${userId} | key=${keySource} prefix=${keyPreview}...`);

        const elevenLabsApiKey = userApiKey || process.env.ELEVENLABS_API_KEY;
        if (!elevenLabsApiKey) {
            return reply.code(500).send({ error: 'Voice service not configured. Please add your ElevenLabs API key in Settings → Voice.' });
        }

        const elevenUserId = deriveElevenUserId(userId);

        // When user provides their own key, create/find Agent on their account
        // so conversations are billed to the user's ElevenLabs account
        let targetAgentId = platformAgentId;
        if (userApiKey) {
            try {
                targetAgentId = await getOrCreateUserAgent(userApiKey);
                log({ module: 'voice' }, `Using user's agent: ${targetAgentId}`);
            } catch (error) {
                log({ module: 'voice' }, `Failed to get/create user agent: ${error}`);
                return reply.code(500).send({ error: 'Failed to create voice agent on your ElevenLabs account. Please check your API key.' });
            }
        }

        // Only check usage and paywall when using server's key
        let usedSeconds = 0;
        if (!userApiKey) {
            try {
                usedSeconds = await getUsedVoiceSeconds(elevenLabsApiKey, elevenUserId);
            } catch (error) {
                log({ module: 'voice' }, `Failed to check voice usage for user ${userId}: ${error}`);
                return reply.code(500).send({ error: 'Failed to check voice usage' });
            }

            log({ module: 'voice' }, `User ${userId} has used ${usedSeconds}s of ${VOICE_FREE_LIMIT_SECONDS}s`);

            if (usedSeconds >= VOICE_FREE_LIMIT_SECONDS) {
                const subscribed = await hasActiveSubscription(userId);
                if (!subscribed) {
                    return reply.send({
                        allowed: false as const,
                        reason: 'voice_limit_reached' as const,
                        usedSeconds,
                        limitSeconds: VOICE_FREE_LIMIT_SECONDS,
                        agentId: targetAgentId,
                    });
                }
            }
        }

        // Mint conversation token using the appropriate key and agent
        try {
            const tokenResponse = await fetch(
                `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${targetAgentId}`,
                {
                    method: 'GET',
                    headers: {
                        'xi-api-key': elevenLabsApiKey,
                        'Accept': 'application/json',
                    },
                }
            );

            if (!tokenResponse.ok) {
                const status = tokenResponse.status;
                log({ module: 'voice' }, `Failed to get ElevenLabs token: ${status}`);
                if (status === 401 || status === 403) {
                    return reply.code(500).send({ error: 'Invalid ElevenLabs API key. Please check your key in Settings → Voice.' });
                }
                return reply.code(500).send({ error: 'Failed to get voice token' });
            }

            const tokenData = (await tokenResponse.json()) as { token: string };

            log({ module: 'voice' }, `Voice token issued for user ${userId} | agent=${targetAgentId}`);
            return reply.send({
                allowed: true as const,
                token: tokenData.token,
                agentId: targetAgentId,
                elevenUserId,
                usedSeconds,
                limitSeconds: userApiKey ? 0 : VOICE_FREE_LIMIT_SECONDS,
            });
        } catch (error) {
            log({ module: 'voice' }, `ElevenLabs token request error: ${error}`);
            return reply.code(500).send({ error: 'Failed to get voice token' });
        }
    });
}
