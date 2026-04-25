import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { detectProviderFromEnv } from "@/modules/optionScorer";
import { decryptAiBackendProfile } from "@/modules/aiBackendProfileCrypto";
import { getAiBackendProfileEnvironmentVariables } from "@/modules/aiBackendProfileEnv";

const BUILT_IN_DIMENSION_KEYS = new Set([
    "security",
    "dependencies",
    "architecture",
    "techDebt",
    "codeQuality",
    "testCoverage",
    "documentation",
    "performance",
    "uiUx",
]);

function titleToKey(title: string): string {
    const words = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .split(" ")
        .filter(Boolean);
    return words
        .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
        .join("");
}

/**
 * CRUD routes for user-defined supervisor analysis dimensions.
 * Custom dimensions extend the built-in 9 with project-specific prompts.
 */
export function supervisorDimensionRoutes(app: Fastify) {
    // GET /v1/projects/:id/supervisor/dimensions — List all custom dimensions
    app.get(
        "/v1/projects/:id/supervisor/dimensions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const dimensions = await db.supervisorDimension.findMany({
                where: { projectId: id, accountId: userId },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                select: {
                    id: true,
                    key: true,
                    title: true,
                    prompt: true,
                    enabled: true,
                    sortOrder: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            return reply.send({ dimensions });
        },
    );

    // POST /v1/projects/:id/supervisor/dimensions — Create a custom dimension
    app.post(
        "/v1/projects/:id/supervisor/dimensions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    title: z.string().min(1).max(50),
                    prompt: z.string().min(1).max(5000),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const { title, prompt } = request.body;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const key = titleToKey(title);

            if (!key) {
                return reply.code(400).send({
                    error: "Title must contain at least one alphanumeric character",
                });
            }

            if (BUILT_IN_DIMENSION_KEYS.has(key)) {
                return reply.code(400).send({
                    error: `Key "${key}" conflicts with a built-in dimension. Please choose a different title.`,
                });
            }

            const existing = await db.supervisorDimension.findUnique({
                where: { projectId_key: { projectId: id, key } },
                select: { id: true },
            });

            if (existing) {
                return reply.code(409).send({
                    error: `A dimension with key "${key}" already exists. Please choose a different title.`,
                });
            }

            const maxSortOrder = await db.supervisorDimension.aggregate({
                where: { projectId: id, accountId: userId },
                _max: { sortOrder: true },
            });
            const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

            const dimension = await db.supervisorDimension.create({
                data: {
                    projectId: id,
                    accountId: userId,
                    key,
                    title,
                    prompt,
                    sortOrder: nextSortOrder,
                },
                select: {
                    id: true,
                    key: true,
                    title: true,
                    prompt: true,
                    enabled: true,
                    sortOrder: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            return reply.code(201).send({ dimension });
        },
    );

    // PATCH /v1/projects/:id/supervisor/dimensions/:dimId — Update a dimension
    app.patch(
        "/v1/projects/:id/supervisor/dimensions/:dimId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), dimId: z.string() }),
                body: z.object({
                    title: z.string().min(1).max(50).optional(),
                    prompt: z.string().min(1).max(5000).optional(),
                    enabled: z.boolean().optional(),
                    sortOrder: z.number().int().min(0).optional(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, dimId } = request.params;
            const { title, prompt, enabled, sortOrder } = request.body;

            const dimension = await db.supervisorDimension.findFirst({
                where: { id: dimId, projectId: id, accountId: userId },
                select: { id: true },
            });

            if (!dimension) {
                return reply.code(404).send({ error: "Dimension not found" });
            }

            const updated = await db.supervisorDimension.update({
                where: { id: dimId },
                data: {
                    ...(title !== undefined && { title }),
                    ...(prompt !== undefined && { prompt }),
                    ...(enabled !== undefined && { enabled }),
                    ...(sortOrder !== undefined && { sortOrder }),
                },
                select: {
                    id: true,
                    key: true,
                    title: true,
                    prompt: true,
                    enabled: true,
                    sortOrder: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            return reply.send({ dimension: updated });
        },
    );

    // DELETE /v1/projects/:id/supervisor/dimensions/:dimId — Delete a dimension
    app.delete(
        "/v1/projects/:id/supervisor/dimensions/:dimId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), dimId: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, dimId } = request.params;

            const dimension = await db.supervisorDimension.findFirst({
                where: { id: dimId, projectId: id, accountId: userId },
                select: { id: true },
            });

            if (!dimension) {
                return reply.code(404).send({ error: "Dimension not found" });
            }

            await db.supervisorDimension.delete({ where: { id: dimId } });

            return reply.code(204).send();
        },
    );

    // POST /v1/projects/:id/supervisor/dimensions/generate-prompt — AI-generate a prompt
    app.post(
        "/v1/projects/:id/supervisor/dimensions/generate-prompt",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    title: z.string().min(1).max(50),
                    profileId: z.string().nullable().optional(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const { title, profileId } = request.body;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const credentials = await resolveCredentials(
                userId,
                profileId ?? null,
            );
            if (!credentials) {
                return reply.code(422).send({
                    error: "No LLM provider available. Configure an API key to use AI prompt generation.",
                });
            }

            const generatedPrompt = await generateDimensionPrompt(
                credentials,
                title,
            );

            if (!generatedPrompt) {
                return reply.code(500).send({
                    error: "Failed to generate prompt. Please try again or write it manually.",
                });
            }

            return reply.send({ prompt: generatedPrompt });
        },
    );
}

async function resolveCredentials(
    accountId: string,
    profileId: string | null,
) {
    if (!profileId) return fallbackFromServerEnv();

    const rows = await db.$queryRaw<
        Array<{
            profileKey: string;
            encryptedPayload: Uint8Array<ArrayBuffer>;
        }>
    >`
        SELECT "profileKey", "encryptedPayload"
        FROM "AiBackendProfile"
        WHERE "profileKey" = ${profileId}
          AND "accountId" = ${accountId}
          AND "archivedAt" IS NULL
        LIMIT 1
    `;

    if (!rows[0]) return fallbackFromServerEnv();

    const profile = decryptAiBackendProfile(
        accountId,
        rows[0].profileKey,
        rows[0].encryptedPayload,
    );
    const env = getAiBackendProfileEnvironmentVariables(profile);
    return detectProviderFromEnv(env);
}

function fallbackFromServerEnv() {
    return detectProviderFromEnv({
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "",
        OLLAMA_URL: process.env.OLLAMA_URL ?? "",
    });
}

async function generateDimensionPrompt(
    credentials: NonNullable<ReturnType<typeof detectProviderFromEnv>>,
    title: string,
): Promise<string | null> {
    const systemPrompt =
        "You are a software project health analysis expert. " +
        "Generate concise analysis instructions for a custom dimension in a project health check. " +
        "The instructions should tell an AI agent what to look for, what commands to run, and what patterns to check. " +
        "Write 3-6 bullet points. Each bullet should be a concrete, actionable check. " +
        "Output ONLY the bullet points, no title or preamble.";

    const userMessage = `Generate analysis instructions for the following health check dimension:\n\nDimension title: "${title}"\n\nProvide 3-6 bullet points describing what to check and how.`;

    if (credentials.provider === "anthropic") {
        return callAnthropic(credentials, systemPrompt, userMessage);
    }
    if (credentials.provider === "openai") {
        return callOpenAI(credentials, systemPrompt, userMessage);
    }
    return null;
}

async function callAnthropic(
    creds: NonNullable<ReturnType<typeof detectProviderFromEnv>>,
    systemPrompt: string,
    userMessage: string,
): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.anthropic.com").replace(
        /\/+$/,
        "",
    );
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
                max_tokens: 512,
                system: systemPrompt,
                messages: [{ role: "user", content: userMessage }],
            }),
            signal: AbortSignal.timeout(15_000),
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
    systemPrompt: string,
    userMessage: string,
): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.openai.com").replace(
        /\/+$/,
        "",
    );
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
                max_tokens: 512,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
            }),
            signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) return null;

        const data = (await response.json()) as {
            choices?: Array<{
                message?: { content?: string };
            }>;
        };
        return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch {
        return null;
    }
}
