import { z } from "zod";
import * as crypto from "crypto";
import { AccessToken, RoomServiceClient, type VideoGrant } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { LIVEKIT_VERIFY_RATE_LIMIT } from "../utils/enableRateLimit";
import { type Fastify } from "../types";
import { activityCache } from "@/app/presence/sessionCache";
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

const LiveKitTokenResponseSchema = z.object({
    token: z.string(),
    url: z.string(),
    roomName: z.string(),
});

const LiveKitVerifyResponseSchema = z.object({
    valid: z.boolean(),
    error: z.string().optional(),
    activeRooms: z.number().optional(),
});

const LIVEKIT_AGENT_NAME = "happy-voice";
const LIVEKIT_ROOM_PREFIX = "happy-voice";
const VOICE_FREE_LIMIT_SECONDS = 3600;

function normalizeLiveKitCloudUrl(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') {
        return null;
    }

    if (parsed.hostname !== 'livekit.cloud' && !parsed.hostname.endsWith('.livekit.cloud')) {
        return null;
    }

    parsed.protocol = 'https:';
    return parsed.toString().replace(/\/$/, '');
}

function getLiveKitConfig(input?: {
    userApiKey?: string;
    userApiSecret?: string;
    userLivekitUrl?: string;
}): { apiKey: string; apiSecret: string; url: string } | null {
    const apiKey = input?.userApiKey || process.env.LIVEKIT_API_KEY;
    const apiSecret = input?.userApiSecret || process.env.LIVEKIT_API_SECRET;
    const url = input?.userLivekitUrl || process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !url) {
        return null;
    }

    const normalizedUrl = normalizeLiveKitCloudUrl(url);
    if (!normalizedUrl) {
        return null;
    }

    return { apiKey, apiSecret, url: normalizedUrl };
}

async function createLiveKitToken(input: {
    apiKey: string;
    apiSecret: string;
    identity: string;
    roomName: string;
    metadata?: string;
}): Promise<string> {
    const token = new AccessToken(input.apiKey, input.apiSecret, {
        identity: input.identity,
        metadata: input.metadata,
        ttl: '10m',
    });

    const grant: VideoGrant = {
        room: input.roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
    };

    token.addGrant(grant);
    token.roomConfig = new RoomConfiguration({
        agents: [
            new RoomAgentDispatch({
                agentName: LIVEKIT_AGENT_NAME,
                metadata: input.metadata,
            }),
        ],
    });

    return await token.toJwt();
}


/**
 * Agent configuration template — replicated to user accounts automatically.
 * Must match the centrally managed Agent on the platform ElevenLabs account.
 */
const AGENT_TEMPLATE = {
    name: "Sangreal Coder Voice Assistant",
    conversation_config: {
        agent: {
            first_message: "Hey! I'm connected to your coding session. What would you like me to tell Claude Code?",
            language: "zh",
            prompt: {
                prompt: `You are the voice interface for Sangreal Coder, a tool that controls Claude Code remotely.

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
            voice_id: "gU2KtIu9OZWy3KqiqNj6",
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

    // Check if user already has a Sangreal Coder agent
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
    /**
     * POST /v1/voice/tts/proxy
     *
     * Server-side proxy for Voicebox TTS requests. Avoids CORS and mixed-content
     * restrictions when the web app (HTTPS) needs to reach a local or remote
     * Voicebox service.
     *
     * The client sends `{ text, endpoint?, language? }`. The server forwards the
     * request to the Voicebox REST API and streams the audio response back.
     */
    app.post('/v1/voice/tts/proxy', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                text: z.string().min(1).max(5000),
                endpoint: z.string().url().optional(),
                language: z.string().optional(),
            }),
        },
    }, async (request, reply) => {
        const { text, endpoint, language } = request.body;

        const VOICEBOX_DEFAULT = 'http://localhost:17493';
        const targetEndpoint = endpoint || VOICEBOX_DEFAULT;

        log({ module: 'voice' }, `TTS proxy request: endpoint=${targetEndpoint} textLen=${text.length}`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const upstreamResp = await fetch(`${targetEndpoint}/tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    ...(language ? { language } : {}),
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!upstreamResp.ok) {
                log({ module: 'voice' }, `Voicebox TTS upstream error: ${upstreamResp.status}`);
                return reply.code(502).send({ error: `Voicebox returned ${upstreamResp.status}` });
            }

            const contentType = upstreamResp.headers.get('content-type') || 'audio/wav';
            reply.header('Content-Type', contentType);
            reply.header('Cache-Control', 'no-store');

            const audioBuffer = await upstreamResp.arrayBuffer();
            return reply.send(Buffer.from(audioBuffer));
        } catch (error: unknown) {
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            const msg = isTimeout ? 'Voicebox TTS request timed out' : 'Failed to reach Voicebox service';
            log({ module: 'voice' }, `TTS proxy error: ${error}`);
            return reply.code(502).send({ error: msg });
        }
    });

    app.post('/v1/voice/livekit-token', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                sessionId: z.string().min(1),
                userApiKey: z.string().optional(),
                userApiSecret: z.string().optional(),
                userLivekitUrl: z.string().url().optional(),
            }),
            response: {
                200: LiveKitTokenResponseSchema,
                403: z.object({
                    error: z.string(),
                }),
                500: z.object({
                    error: z.string(),
                }),
            },
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, userApiKey, userApiSecret, userLivekitUrl } = request.body;
        const isSessionValid = await activityCache.isSessionValid(sessionId, userId);

        if (!isSessionValid) {
            return reply.code(403).send({ error: 'Session not found' });
        }

        const livekitConfig = getLiveKitConfig({ userApiKey, userApiSecret, userLivekitUrl });

        if (!livekitConfig) {
            return reply.code(500).send({ error: 'LiveKit voice service is not configured' });
        }

        const roomName = `${LIVEKIT_ROOM_PREFIX}-${userId}-${sessionId}`;
        const metadata = JSON.stringify({ sessionId });
        const token = await createLiveKitToken({
            ...livekitConfig,
            identity: `${userId}-${sessionId}-${crypto.randomUUID()}`,
            roomName,
            metadata,
        });

        reply.header('Cache-Control', 'no-store');
        return reply.send({
            token,
            url: livekitConfig.url,
            roomName,
        });
    });

    app.post('/v1/voice/livekit-verify', {
        preHandler: app.authenticate,
        config: { rateLimit: LIVEKIT_VERIFY_RATE_LIMIT },
        schema: {
            body: z.object({
                apiKey: z.string().min(1),
                apiSecret: z.string().min(1),
                livekitUrl: z.string().url().optional(),
            }),
            response: {
                200: LiveKitVerifyResponseSchema,
            },
        },
    }, async (request, reply) => {
        const { apiKey, apiSecret, livekitUrl } = request.body;
        const url = livekitUrl || process.env.LIVEKIT_URL;

        if (!url) {
            return reply.send({ valid: false, error: 'LiveKit URL not configured' });
        }

        const normalizedUrl = normalizeLiveKitCloudUrl(url);

        if (!normalizedUrl) {
            return reply.send({ valid: false, error: 'Invalid LiveKit URL' });
        }

        try {
            const client = new RoomServiceClient(normalizedUrl, apiKey, apiSecret);
            const rooms = await client.listRooms([]);
            return reply.send({ valid: true, activeRooms: rooms.length });
        } catch {
            return reply.send({ valid: false, error: 'Invalid LiveKit credentials' });
        }
    });

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
