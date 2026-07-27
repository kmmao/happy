import { type Fastify } from "../types";
import { z } from "zod";
import { detectProviderFromEnv } from "@/modules/llmProviderCall";
import { getAiBackendProfileEnvironmentVariables } from "@/modules/aiBackendProfileEnv";
import { loadDecryptedProfile, serverEnvScoringCredentials } from "@/modules/scoringCredentials";

// ---------------------------------------------------------------------------
// AI prompt & parsing — mirrors AgentLoopSuggestionAI.ts on the CLI side
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
    "You are an expert at designing autonomous AI agent loops for software development projects. " +
    "Given a project's context (directory listing, package.json, CLAUDE.md, README), " +
    "generate 3-6 specific, targeted autonomous agent loops that would be genuinely useful for this project. " +
    "\n\n" +
    "Each loop MUST:\n" +
    "- Have a single, focused responsibility tailored to THIS project (not generic templates)\n" +
    "- Be actionable by Claude running autonomously without human guidance\n" +
    "- Have a realistic execution interval appropriate to the task frequency\n" +
    "- Include a detailed prompt (50-150 words) that Claude can execute independently\n" +
    "- Reference actual project details (framework, package names, paths) where possible\n" +
    "\n" +
    "Return a JSON array. Each item:\n" +
    "{\n" +
    '  "name": "string (concise, 2-4 words)",\n' +
    '  "description": "string (one sentence)",\n' +
    '  "rationale": "string (why this loop is useful for this project)",\n' +
    '  "prompt": "string (detailed autonomous instructions, 50-150 words)",\n' +
    '  "goal": "string (desired outcome, 15-30 words)",\n' +
    '  "currentFocus": "string (optional, specific current focus)",\n' +
    '  "intervalMinutes": number (30/60/120/360/720/1440),\n' +
    '  "fileWatchEnabled": boolean,\n' +
    '  "githubBridgeEnabled": boolean,\n' +
    '  "ciBridgeEnabled": boolean,\n' +
    '  "maxConsecutiveFailures": number (2-5),\n' +
    '  "tags": ["string"]\n' +
    "}\n\n" +
    "Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.";

interface AILoopRaw {
    name: string;
    description: string;
    rationale?: string;
    prompt: string;
    goal?: string;
    currentFocus?: string;
    intervalMinutes: number;
    fileWatchEnabled?: boolean;
    githubBridgeEnabled?: boolean;
    ciBridgeEnabled?: boolean;
    maxConsecutiveFailures?: number;
    tags?: string[];
}

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);
}

function parseJsonResponse(text: string): AILoopRaw[] {
    const cleaned = text
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
    return JSON.parse(cleaned) as AILoopRaw[];
}

function mapRawToSuggestion(item: AILoopRaw, directory: string) {
    return {
        key: slugify(item.name),
        name: item.name,
        description: item.description ?? "",
        rationale: item.rationale ?? "AI-generated based on project context analysis.",
        directory,
        intervalMs: Math.max(5 * 60_000, (item.intervalMinutes ?? 60) * 60_000),
        agent: "claude" as const,
        fileWatchEnabled: item.fileWatchEnabled ?? false,
        githubBridgeEnabled: item.githubBridgeEnabled ?? false,
        ciBridgeEnabled: item.ciBridgeEnabled ?? false,
        maxConsecutiveFailures: item.maxConsecutiveFailures ?? 3,
        retryBackoffMs: 5 * 60_000,
        prompt: item.prompt,
        goal: item.goal ?? "",
        currentFocus: item.currentFocus,
        tags: item.tags ?? [],
        confidence: "medium" as const,
        alreadyConfigured: false,
    };
}

// ---------------------------------------------------------------------------
// Credential resolution — same pattern as supervisorDimensionRoutes
// ---------------------------------------------------------------------------

async function resolveCredentials(accountId: string, profileId: string | null) {
    if (!profileId) return serverEnvScoringCredentials();

    const profile = await loadDecryptedProfile(accountId, profileId);
    if (!profile) return serverEnvScoringCredentials();

    const env = getAiBackendProfileEnvironmentVariables(profile);
    return detectProviderFromEnv(env);
}

// ---------------------------------------------------------------------------
// AI call helpers
// ---------------------------------------------------------------------------

async function callAnthropic(
    creds: NonNullable<ReturnType<typeof detectProviderFromEnv>>,
    userMessage: string,
): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    const model = creds.model || "claude-haiku-4-5-20251001";

    try {
        const response = await fetch(`${baseUrl}/v1/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": creds.apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model,
                max_tokens: 2048,
                system: SYSTEM_PROMPT,
                messages: [{ role: "user", content: userMessage }],
            }),
            signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) return null;

        const data = (await response.json()) as {
            content?: Array<{ type: string; text?: string }>;
        };
        return data.content?.[0]?.text?.trim() ?? null;
    } catch {
        return null;
    }
}

async function callOpenAI(
    creds: NonNullable<ReturnType<typeof detectProviderFromEnv>>,
    userMessage: string,
): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
    const model = creds.model || "gpt-4o-mini";

    try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${creds.apiKey}`,
            },
            body: JSON.stringify({
                model,
                max_tokens: 2048,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userMessage },
                ],
            }),
            signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) return null;

        const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * POST /v1/agent-loops/suggest-ai
 *
 * App sends project context (gathered from CLI via "loop-get-context" RPC)
 * and the server uses the user's stored AI credentials (AiBackendProfile or
 * server env fallback) to generate loop suggestions — same pattern as
 * supervisorDimensionRoutes.ts generateDimensionPrompt.
 */
export function agentLoopSuggestRoutes(app: Fastify) {
    app.post(
        "/v1/agent-loops/suggest-ai",
        {
            preHandler: app.authenticate,
            schema: {
                body: z.object({
                    directory: z.string().min(1),
                    context: z.string().min(1),
                    profileId: z.string().nullable().optional(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { directory, context, profileId } = request.body;

            const credentials = await resolveCredentials(userId, profileId ?? null);
            if (!credentials) {
                return reply.code(422).send({
                    error: "No LLM provider available. Configure an API key in your profile to use AI loop generation.",
                });
            }

            const userMessage =
                `Generate autonomous agent loops for this project:\n\n${context}\n\n` +
                `The loops should run in the directory: ${directory}`;

            let rawText: string | null = null;
            if (credentials.provider === "anthropic") {
                rawText = await callAnthropic(credentials, userMessage);
            } else if (credentials.provider === "openai") {
                rawText = await callOpenAI(credentials, userMessage);
            }

            if (!rawText) {
                return reply.code(500).send({
                    error: "Failed to generate loop suggestions. Please try again.",
                });
            }

            try {
                const rawItems = parseJsonResponse(rawText);
                const suggestions = rawItems
                    .filter((item) => item.name && item.prompt)
                    .map((item) => mapRawToSuggestion(item, directory));
                return reply.send({ suggestions });
            } catch {
                return reply.code(500).send({
                    error: "Failed to parse AI response. Please try again.",
                });
            }
        },
    );
}
