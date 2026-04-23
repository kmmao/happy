import { log } from "@/utils/log";
import { createHash } from "crypto";

type LLMProvider = "ollama" | "anthropic" | "none";

function detectProvider(): LLMProvider {
    const explicit = process.env.PROFILE_PROVIDER;
    if (explicit === "ollama" || explicit === "anthropic") return explicit;
    if (process.env.ANTHROPIC_API_KEY) return "anthropic";
    if (process.env.OLLAMA_URL) return "ollama";
    return "none";
}

const SYSTEM_PROMPT =
    "You are an option relevance scorer. Given conversation context and candidate follow-up options, " +
    "rate each option's relevance as a next step from 0-100. Consider: task continuity, logical sequencing, " +
    "specificity to current work. Output ONLY a JSON array of integers, one score per option, in the same order as the input.";

async function callAnthropic(userMessage: string): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
    const model = process.env.ANTHROPIC_OPTION_SCORE_MODEL || "claude-haiku-4-5-20251001";

    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model,
            max_tokens: 64,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { content: { type: string; text: string }[] };
    return data.content[0]?.text ?? null;
}

async function callOllama(userMessage: string): Promise<string | null> {
    const url = process.env.OLLAMA_URL || "http://localhost:11434";
    const model = process.env.OLLAMA_CHAT_MODEL || "gpt-oss:20b";

    const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userMessage },
            ],
            stream: false,
            options: { temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return data.message?.content ?? null;
}

interface CacheEntry {
    scores: number[];
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 200;

function cacheKey(options: string[], contextSummary: string): string {
    const raw = JSON.stringify({ options, contextSummary });
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
    }
}

function buildUserMessage(options: string[], contextSummary: string, sessionTitle: string | null): string {
    const lines: string[] = [];
    lines.push("Context:");
    lines.push(contextSummary);
    if (sessionTitle) {
        lines.push(`Task: ${sessionTitle.slice(0, 100)}`);
    }
    lines.push("");
    lines.push("Options:");
    options.forEach((opt, i) => {
        lines.push(`${i + 1}. ${opt}`);
    });
    return lines.join("\n");
}

function parseScores(text: string, expectedCount: number): number[] | null {
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return null;

    try {
        const parsed = JSON.parse(match[0]) as unknown;
        if (!Array.isArray(parsed)) return null;
        if (parsed.length !== expectedCount) return null;

        const scores: number[] = [];
        for (const v of parsed) {
            if (typeof v !== "number" || !Number.isFinite(v)) return null;
            scores.push(Math.max(0, Math.min(100, Math.round(v))));
        }
        return scores;
    } catch {
        return null;
    }
}

export interface OptionScoreResult {
    scores: number[];
    cached: boolean;
}

export async function scoreOptionsWithLLM(
    options: string[],
    contextSummary: string,
    sessionTitle: string | null,
): Promise<OptionScoreResult> {
    const provider = detectProvider();
    if (provider === "none") {
        throw new Error("No LLM provider configured");
    }

    evictExpired();

    const key = cacheKey(options, contextSummary);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return { scores: cached.scores, cached: true };
    }

    const userMessage = buildUserMessage(options, contextSummary, sessionTitle);

    const callFn = provider === "anthropic" ? callAnthropic : callOllama;
    const raw = await callFn(userMessage);
    if (!raw) {
        throw new Error("LLM returned empty response");
    }

    const scores = parseScores(raw, options.length);
    if (!scores) {
        log({ module: "optionScorer", level: "warn" }, `Failed to parse LLM response: ${raw.slice(0, 200)}`);
        throw new Error("Failed to parse LLM scores");
    }

    if (cache.size >= CACHE_MAX_SIZE) {
        evictExpired();
        if (cache.size >= CACHE_MAX_SIZE) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
        }
    }

    cache.set(key, { scores, expiresAt: Date.now() + CACHE_TTL_MS });

    return { scores, cached: false };
}
