import { log } from "@/utils/log";
import { createHash } from "crypto";

const SYSTEM_PROMPT =
    "You are an option relevance scorer. Given conversation context and candidate follow-up options, " +
    "rate each option's relevance as a next step from 0-100. Consider: task continuity, logical sequencing, " +
    "specificity to current work. Output ONLY a JSON array of integers, one score per option, in the same order as the input.";

export type ScoringProvider = "anthropic" | "openai" | "ollama";

export interface ScoringCredentials {
    provider: ScoringProvider;
    apiKey: string;
    baseUrl?: string;
    model?: string;
}

const DEFAULT_SCORING_MODELS: Record<ScoringProvider, string> = {
    anthropic: "claude-sonnet-4-6",
    openai: "gpt-4o-mini",
    ollama: "llama3",
};

export function detectProviderFromEnv(env: Record<string, string>): ScoringCredentials | null {
    if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) {
        return {
            provider: "anthropic",
            apiKey: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY,
            baseUrl: env.ANTHROPIC_BASE_URL,
        };
    }
    if (env.OPENAI_API_KEY) {
        return {
            provider: "openai",
            apiKey: env.OPENAI_API_KEY,
            baseUrl: env.OPENAI_BASE_URL,
        };
    }
    if (env.OLLAMA_URL) {
        return {
            provider: "ollama",
            apiKey: "",
            baseUrl: env.OLLAMA_URL,
        };
    }
    return null;
}

async function callAnthropic(creds: ScoringCredentials, userMessage: string): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    const model = creds.model || DEFAULT_SCORING_MODELS.anthropic;

    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": creds.apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model,
            max_tokens: 64,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { content: { type: string; text: string }[] };
    return data.content[0]?.text ?? null;
}

async function callOpenAI(creds: ScoringCredentials, userMessage: string): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
    const model = creds.model || DEFAULT_SCORING_MODELS.openai;

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${creds.apiKey}`,
        },
        body: JSON.stringify({
            model,
            max_tokens: 64,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userMessage },
            ],
            temperature: 0.1,
        }),
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? null;
}

async function callOllama(creds: ScoringCredentials, userMessage: string): Promise<string | null> {
    const url = creds.baseUrl || "http://localhost:11434";
    const model = creds.model || DEFAULT_SCORING_MODELS.ollama;

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
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return data.message?.content ?? null;
}

const CALL_FNS: Record<ScoringProvider, (creds: ScoringCredentials, msg: string) => Promise<string | null>> = {
    anthropic: callAnthropic,
    openai: callOpenAI,
    ollama: callOllama,
};

interface CacheEntry {
    scores: number[];
    expiresAt: number;
    modelUsed: string;
    provider: ScoringProvider;
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

export function buildUserMessage(options: string[], contextSummary: string, sessionTitle: string | null): string {
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

export function parseScores(text: string, expectedCount: number): number[] | null {
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
    modelUsed: string;
    provider: ScoringProvider;
}

export async function scoreOptionsWithLLM(
    credentials: ScoringCredentials,
    options: string[],
    contextSummary: string,
    sessionTitle: string | null,
): Promise<OptionScoreResult> {
    evictExpired();

    const key = cacheKey(options, contextSummary);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return { scores: cached.scores, cached: true, modelUsed: cached.modelUsed, provider: cached.provider };
    }

    const userMessage = buildUserMessage(options, contextSummary, sessionTitle);

    const callFn = CALL_FNS[credentials.provider];
    const raw = await callFn(credentials, userMessage);
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

    const modelUsed = credentials.model || DEFAULT_SCORING_MODELS[credentials.provider];
    cache.set(key, { scores, expiresAt: Date.now() + CACHE_TTL_MS, modelUsed, provider: credentials.provider });

    return { scores, cached: false, modelUsed, provider: credentials.provider };
}
