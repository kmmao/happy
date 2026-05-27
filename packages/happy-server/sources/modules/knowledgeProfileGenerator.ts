import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { resolveKnowledgeConfig } from "./knowledgeConfigResolver";
import { z } from "zod";

/**
 * Profile generator with dual LLM provider support:
 * - Ollama (local, free) — when OLLAMA_URL is set
 * - Anthropic Haiku (cloud, paid) — when ANTHROPIC_API_KEY is set
 *
 * Config via env vars:
 *   PROFILE_PROVIDER=ollama|anthropic  (default: auto-detect)
 *   OLLAMA_URL=http://localhost:11434
 *   OLLAMA_CHAT_MODEL=gpt-oss:20b     (default)
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   ANTHROPIC_BASE_URL=https://api.anthropic.com (default, supports proxies)
 *   ANTHROPIC_PROFILE_MODEL=claude-haiku-4-5-20251001 (default)
 */

const ProfileSchema = z.object({
    techStack: z.array(z.string()),
    architectureType: z.string().optional(),
    knownPitfalls: z.array(z.string()),
    coreConventions: z.array(z.string()),
    lastUpdatedAt: z.number(),
    lastUpdatedBy: z.string().optional(),
});

const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are a project knowledge analyst. Given a list of knowledge entries extracted from a software project, generate a concise project profile as JSON.

Output ONLY valid JSON matching this schema:
{
  "techStack": ["string"],
  "architectureType": "string (optional)",
  "knownPitfalls": ["string"],
  "coreConventions": ["string"],
  "lastUpdatedAt": number (Unix timestamp ms),
  "lastUpdatedBy": "auto-profile-generator"
}

Rules:
- techStack: list programming languages, frameworks, and key tools (max 15)
- architectureType: e.g., "monorepo", "microservices", "monolith" (omit if unclear)
- knownPitfalls: things that have gone wrong or need caution (max 10)
- coreConventions: coding standards and patterns (max 10)
- Be concise — each string should be under 100 characters
- Derive everything from the knowledge entries, don't hallucinate`;

// ─── Provider detection ───

type ProfileProvider = "ollama" | "anthropic" | "none";

function detectProvider(): ProfileProvider {
    const explicit = process.env.PROFILE_PROVIDER;
    if (explicit === "ollama" || explicit === "anthropic") return explicit;

    if (getAnthropicKey()) return "anthropic";
    if (getOllamaUrl()) return "ollama";
    return "none";
}

function getAnthropicKey(): string | null {
    const key = process.env.ANTHROPIC_API_KEY || "";
    return key.length > 0 ? key : null;
}

function getAnthropicBaseUrl(): string {
    return (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
}

function getOllamaUrl(): string {
    return process.env.OLLAMA_URL || "http://localhost:11434";
}

function getOllamaChatModel(): string {
    return process.env.OLLAMA_CHAT_MODEL || "gpt-oss:20b";
}

// ─── Anthropic provider ───

async function callAnthropic(userMessage: string): Promise<string | null> {
    const apiKey = getAnthropicKey();
    if (!apiKey) return null;

    const response = await fetch(`${getAnthropicBaseUrl()}/v1/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: process.env.ANTHROPIC_PROFILE_MODEL || "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 500)}`);
    }

    const data = await response.json() as { content: { type: string; text: string }[] };
    return data.content[0]?.text ?? null;
}

// ─── Ollama provider ───

async function callOllama(userMessage: string): Promise<string | null> {
    const url = getOllamaUrl();

    const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: getOllamaChatModel(),
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userMessage },
            ],
            stream: false,
            options: { temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errBody.slice(0, 500)}`);
    }

    const data = await response.json() as { message: { content: string } };
    return data.message?.content ?? null;
}

// ─── Public API ───

/**
 * Regenerate a project profile from the latest knowledge entries.
 * Auto-detects LLM provider. Validates output with Zod + retries.
 */
export async function regenerateProfile(projectId: string): Promise<{
    success: boolean;
    version?: number;
    error?: string;
}> {
    // Total knowledge-base switch (project-level) gates everything: when the
    // base is disabled, never spend an LLM call regenerating its profile —
    // even when reached via the auto-trigger or the manual REST route.
    const config = await resolveKnowledgeConfig(projectId);
    if (!config.enabled) {
        return { success: false, error: "Knowledge base disabled for this project" };
    }

    const provider = detectProvider();
    if (provider === "none") {
        return { success: false, error: "No LLM provider configured (set ANTHROPIC_API_KEY or OLLAMA_URL)" };
    }

    try {
        const entries = await db.projectKnowledge.findMany({
            where: { projectId, status: "active" },
            orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
            take: 30,
            select: {
                entryType: true,
                title: true,
                content: true,
                tags: true,
                confidence: true,
            },
        });

        if (entries.length === 0) {
            return { success: false, error: "No knowledge entries to generate profile from" };
        }

        const entrySummaries = entries.map((e, i) =>
            `${i + 1}. [${e.entryType}] ${e.title}\n   ${e.content.slice(0, 300)}`,
        ).join("\n\n");

        const userMessage = `Here are ${entries.length} knowledge entries from a software project:\n\n${entrySummaries}\n\nGenerate the project profile JSON.`;

        let profileJson: z.infer<typeof ProfileSchema> | null = null;
        let lastError: string | undefined;

        const callLLM = provider === "anthropic" ? callAnthropic : callOllama;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const text = await callLLM(userMessage);
                if (!text) {
                    lastError = "Empty response from LLM";
                    continue;
                }

                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    lastError = "No JSON object found in response";
                    continue;
                }

                const parsed = JSON.parse(jsonMatch[0]);
                parsed.lastUpdatedAt = Date.now();
                parsed.lastUpdatedBy = "auto-profile-generator";

                profileJson = ProfileSchema.parse(parsed);
                break;
            } catch (err) {
                lastError = `Attempt ${attempt + 1} failed: ${err}`;
            }
        }

        if (!profileJson) {
            return { success: false, error: lastError ?? "All retries failed" };
        }

        const content = JSON.stringify(profileJson);
        const result = await db.projectProfile.upsert({
            where: { projectId },
            create: { projectId, content },
            update: { content, version: { increment: 1 } },
        });

        log({ module: "knowledge-profile" }, `Profile upserted for ${projectId} (v${result.version}, provider=${provider})`);
        return { success: true, version: result.version };
    } catch (err) {
        log({ module: "knowledge-profile" }, `Profile regeneration failed for ${projectId}: ${err}`);
        return { success: false, error: String(err) };
    }
}
