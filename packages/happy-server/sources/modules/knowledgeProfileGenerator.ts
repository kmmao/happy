import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { z } from "zod";

const ProfileSchema = z.object({
    techStack: z.array(z.string()),
    architectureType: z.string().optional(),
    knownPitfalls: z.array(z.string()),
    coreConventions: z.array(z.string()),
    lastUpdatedAt: z.number(),
    lastUpdatedBy: z.string().optional(),
});

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const PROFILE_MODEL = "claude-haiku-4-5-20251001";
const MAX_RETRIES = 3;

function getAnthropicKey(): string | null {
    const key = process.env.ANTHROPIC_API_KEY || "";
    return key.length > 0 ? key : null;
}

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

/**
 * Regenerate a project profile from the latest knowledge entries.
 * Uses Haiku for cost efficiency. Validates output with Zod + retries.
 */
export async function regenerateProfile(projectId: string): Promise<{
    success: boolean;
    version?: number;
    error?: string;
}> {
    const apiKey = getAnthropicKey();
    if (!apiKey) {
        return { success: false, error: "ANTHROPIC_API_KEY not configured" };
    }

    try {
        // Fetch latest active knowledge entries
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

        // Build the prompt
        const entrySummaries = entries.map((e, i) =>
            `${i + 1}. [${e.entryType}] ${e.title}\n   ${e.content.slice(0, 300)}`,
        ).join("\n\n");

        const userMessage = `Here are ${entries.length} knowledge entries from a software project:\n\n${entrySummaries}\n\nGenerate the project profile JSON.`;

        // Call Haiku with retries
        let profileJson: z.infer<typeof ProfileSchema> | null = null;
        let lastError: string | undefined;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(ANTHROPIC_API_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": apiKey,
                        "anthropic-version": "2023-06-01",
                    },
                    body: JSON.stringify({
                        model: PROFILE_MODEL,
                        max_tokens: 1024,
                        system: SYSTEM_PROMPT,
                        messages: [{ role: "user", content: userMessage }],
                    }),
                    signal: AbortSignal.timeout(15000),
                });

                if (!response.ok) {
                    const errBody = await response.text();
                    lastError = `API error ${response.status}: ${errBody.slice(0, 500)}`;
                    continue;
                }

                const data = await response.json() as {
                    content: { type: string; text: string }[];
                };
                const text = data.content[0]?.text ?? "";

                // Extract JSON from response (may be wrapped in markdown code block)
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    lastError = "No JSON object found in response";
                    continue;
                }

                const parsed = JSON.parse(jsonMatch[0]);
                // Inject timestamp
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

        // Atomic upsert — no TOCTOU race between read and write
        const content = JSON.stringify(profileJson);
        const result = await db.projectProfile.upsert({
            where: { projectId },
            create: { projectId, content },
            update: { content, version: { increment: 1 } },
        });

        log({ module: "knowledge-profile" }, `Profile upserted for project ${projectId} (v${result.version})`);
        return { success: true, version: result.version };
    } catch (err) {
        log({ module: "knowledge-profile" }, `Profile regeneration failed for ${projectId}: ${err}`);
        return { success: false, error: String(err) };
    }
}
