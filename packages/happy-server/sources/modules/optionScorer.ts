import { log } from "@/utils/log";
import { createHash } from "crypto";
import {
    llmProviderCall,
    resolveLlmModel,
    type LlmCallOptions,
    type ScoringCredentials,
    type ScoringProvider,
} from "./llmProviderCall";

// Re-exported so the existing consumers (scoringCredentials, optionGenerator,
// the four LLM routes) keep importing these from here. The definitions live in
// llmProviderCall, which owns the provider wire contract.
export { detectProviderFromEnv } from "./llmProviderCall";
export type { ScoringCredentials, ScoringProvider };

const SYSTEM_PROMPT =
    "You are an option relevance scorer. Given conversation context and candidate follow-up options, " +
    "rate each option's relevance as a next step from 0-100. Consider: task continuity, logical sequencing, " +
    "specificity to current work. Output ONLY a JSON array of integers, one score per option, in the same order as the input.";

const DEFAULT_SCORING_MODELS: Record<ScoringProvider, string> = {
    anthropic: "claude-sonnet-4-6",
    openai: "gpt-4o-mini",
    ollama: "llama3",
};

/** Scoring wants terse, near-deterministic output on a short leash. */
const SCORING_CALL_OPTIONS: LlmCallOptions = {
    systemPrompt: SYSTEM_PROMPT,
    defaultModels: DEFAULT_SCORING_MODELS,
    maxTokens: 64,
    timeoutMs: 15000,
    temperature: 0.1,
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

    const raw = await llmProviderCall(credentials, userMessage, SCORING_CALL_OPTIONS);
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

    const modelUsed = resolveLlmModel(credentials, DEFAULT_SCORING_MODELS);
    cache.set(key, { scores, expiresAt: Date.now() + CACHE_TTL_MS, modelUsed, provider: credentials.provider });

    return { scores, cached: false, modelUsed, provider: credentials.provider };
}
