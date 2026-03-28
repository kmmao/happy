import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { storeKnowledgeEmbedding } from "./knowledgeEmbedding";
import { z } from "zod";

/**
 * Knowledge refiner: two-stage processing for raw knowledge entries.
 *
 * Stage 1: Rule-based filter — skip low-value entries (generic titles, short content, tool logs)
 * Stage 2: LLM refinement  — distill raw conversation into structured knowledge via Haiku/Ollama
 *
 * Runs asynchronously (fire-and-forget) after db.create in knowledgeHandler.
 * On failure, original data is preserved — no changes made.
 *
 * Reuses provider config from knowledgeProfileGenerator:
 *   PROFILE_PROVIDER=ollama|anthropic
 *   ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_PROFILE_MODEL
 *   OLLAMA_URL, OLLAMA_CHAT_MODEL
 *
 * Additional env:
 *   KNOWLEDGE_REFINE=true|false (default: true)
 */

// ─── Types ───

export interface RefineInput {
    id: string;
    title: string;
    content: string;
    entryType: string;
    tags: string;
    confidence: string;
    structured: string | null;
}

interface FilterResult {
    pass: boolean;
    reason?: string;
}

// ─── Zod schema for LLM output ───

const RefinedKnowledgeSchema = z.object({
    title: z.string().max(200),
    content: z.string().max(2000),
    entryType: z.enum(["discovery", "decision", "fix", "convention", "warning"]),
    confidence: z.enum(["high", "medium", "low"]),
    tags: z.array(z.string().max(50)).max(10),
    structured: z.object({
        request: z.string().optional(),
        findings: z.string().optional(),
        analysis: z.string().optional(),
        outcome: z.string().optional(),
        nextSteps: z.string().optional(),
    }),
});

type RefinedKnowledge = z.infer<typeof RefinedKnowledgeSchema>;

// ─── Constants ───

const MAX_RETRIES = 2;
const MIN_CONTENT_LENGTH = 50;

const SKIP_TITLE_PATTERNS: RegExp[] = [
    /^\[?request interrupted/i,
    /^modified\s/i,
    /^untitled/i,
];

const SKIP_CONTENT_PATTERNS: RegExp[] = [
    /^```[\s\S]*```\s*$/,
    /^(Running|Executing|Calling|Searching)\s/i,
];

const REFINE_SYSTEM_PROMPT = `You are a software knowledge distiller. Given a raw conversation fragment from a coding session, extract the core knowledge and output structured JSON.

Output ONLY valid JSON matching this schema:
{
  "title": "concise descriptive title in the SAME LANGUAGE as the content (max 200 chars)",
  "content": "distilled knowledge narrative in the SAME LANGUAGE as the input (max 2000 chars)",
  "entryType": "discovery|decision|fix|convention|warning",
  "confidence": "high|medium|low",
  "tags": ["relevant", "tags"],
  "structured": {
    "request": "what was the user trying to do (optional)",
    "findings": "what was discovered (optional)",
    "analysis": "root cause or evaluation (optional)",
    "outcome": "what was the result (optional)",
    "nextSteps": "follow-up actions or recommendations (optional)"
  }
}

Rules:
- title: rewrite as a clear, searchable summary (NOT the raw user message)
- content: distill the key knowledge — remove conversational filler, tool output, and code dumps
- entryType: classify based on the nature of the knowledge
- confidence: high = clear solution/finding, medium = partial, low = speculative
- tags: extract 2-5 relevant technology/topic tags
- structured fields: fill in whichever fields apply, omit the rest
- IMPORTANT: preserve the original language (Chinese input → Chinese output, English → English)
- If the input has no extractable knowledge, return {"title":"","content":"","entryType":"discovery","confidence":"low","tags":[],"structured":{}}
- Be concise — focus on what someone would need to know in the future`;

// ─── Stage 1: Rule-based filter ───

export function shouldRefine(input: RefineInput): FilterResult {
    // Only skip if structured has LLM-refined fields (findings/analysis/nextSteps).
    // Raw CLI structured ({request, outcome}) still needs refinement.
    if (input.structured) {
        try {
            const parsed = JSON.parse(input.structured);
            if (parsed.findings || parsed.analysis || parsed.nextSteps) {
                return { pass: false, reason: "already-refined" };
            }
        } catch {
            // invalid JSON, proceed to refine
        }
    }

    for (const pattern of SKIP_TITLE_PATTERNS) {
        if (pattern.test(input.title.trim())) {
            return { pass: false, reason: `skip-title: ${input.title.slice(0, 50)}` };
        }
    }

    if (input.content.length < MIN_CONTENT_LENGTH) {
        return { pass: false, reason: `content-too-short: ${input.content.length}` };
    }

    const trimmed = input.content.trim();
    for (const pattern of SKIP_CONTENT_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { pass: false, reason: "content-is-tool-output" };
        }
    }

    return { pass: true };
}

// ─── Provider detection (same pattern as knowledgeProfileGenerator) ───

type LLMProvider = "ollama" | "anthropic" | "none";

function detectProvider(): LLMProvider {
    const explicit = process.env.PROFILE_PROVIDER;
    if (explicit === "ollama" || explicit === "anthropic") return explicit;

    if (process.env.ANTHROPIC_API_KEY) return "anthropic";
    if (process.env.OLLAMA_URL) return "ollama";
    return "none";
}

// ─── LLM callers ───

async function callAnthropic(systemPrompt: string, userMessage: string): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
    const model = process.env.ANTHROPIC_PROFILE_MODEL || "claude-haiku-4-5-20251001";

    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: systemPrompt,
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

async function callOllama(systemPrompt: string, userMessage: string): Promise<string | null> {
    const url = process.env.OLLAMA_URL || "http://localhost:11434";
    const model = process.env.OLLAMA_CHAT_MODEL || "gpt-oss:20b";

    const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
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

// ─── Prompt builder ───

function buildRefinePrompt(input: RefineInput): string {
    const parts = [
        `Original title: ${input.title}`,
        `Entry type: ${input.entryType}`,
        `Confidence: ${input.confidence}`,
    ];

    try {
        const tags = JSON.parse(input.tags) as string[];
        if (tags.length > 0) {
            parts.push(`Tags: ${tags.join(", ")}`);
        }
    } catch {
        // ignore invalid tags JSON
    }

    parts.push(`\nContent:\n${input.content.slice(0, 4000)}`);

    return parts.join("\n");
}

// ─── Public API ───

/**
 * Refine a knowledge entry using LLM.
 * Fire-and-forget: failures are logged, original data preserved.
 */
export async function refineKnowledgeEntry(input: RefineInput): Promise<void> {
    if (process.env.KNOWLEDGE_REFINE === "false") return;

    try {
        const filter = shouldRefine(input);
        if (!filter.pass) {
            log({ module: "knowledge-refine" }, `Skip: "${input.title.slice(0, 50)}" (${filter.reason})`);
            return;
        }

        const provider = detectProvider();
        if (provider === "none") {
            log({ module: "knowledge-refine" }, `No LLM provider configured, skipping refine`);
            return;
        }

        const callLLM = provider === "anthropic" ? callAnthropic : callOllama;
        const userMessage = buildRefinePrompt(input);

        let refined: RefinedKnowledge | null = null;
        let lastError: string | undefined;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const text = await callLLM(REFINE_SYSTEM_PROMPT, userMessage);
                if (!text) {
                    lastError = "Empty LLM response";
                    break;
                }

                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    lastError = "No JSON in LLM response";
                    continue;
                }

                const parsed = JSON.parse(jsonMatch[0]);
                refined = RefinedKnowledgeSchema.parse(parsed);

                if (!refined.title || refined.title.length === 0) {
                    log({ module: "knowledge-refine" }, `LLM found no extractable knowledge: "${input.title.slice(0, 50)}"`);
                    return;
                }

                break;
            } catch (err) {
                lastError = `Attempt ${attempt + 1}: ${err}`;
            }
        }

        if (!refined) {
            log({ module: "knowledge-refine" }, `Failed: "${input.title.slice(0, 50)}" — ${lastError}`);
            return;
        }

        await db.projectKnowledge.update({
            where: { id: input.id },
            data: {
                title: refined.title,
                content: refined.content,
                entryType: refined.entryType,
                confidence: refined.confidence,
                tags: JSON.stringify(refined.tags),
                structured: JSON.stringify(refined.structured),
            },
        });

        // Re-generate embedding with refined content
        void storeKnowledgeEmbedding(input.id, refined.title, refined.content);

        log({ module: "knowledge-refine" }, `Refined: "${input.title.slice(0, 40)}" → "${refined.title.slice(0, 40)}" (${provider})`);
    } catch (err) {
        log({ module: "knowledge-refine" }, `Error: "${input.title.slice(0, 50)}" — ${err}`);
    }
}
