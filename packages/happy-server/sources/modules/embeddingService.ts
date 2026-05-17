import { log } from "@/utils/log";

/**
 * Embedding service with dual provider support:
 * - Ollama (local, free) — preferred when OLLAMA_URL is set
 * - OpenAI (cloud, paid) — fallback when OPENAI_API_KEY is set
 *
 * Config via env vars:
 *   EMBEDDING_PROVIDER=ollama|openai   (default: auto-detect)
 *   OLLAMA_URL=http://localhost:11434   (default)
 *   OLLAMA_EMBED_MODEL=bge-m3          (default, 1024-dim, multilingual)
 *   OPENAI_API_KEY=sk-...
 *   EMBEDDING_BASE_URL=https://api.openai.com/v1 (default)
 *   OPENAI_EMBED_MODEL=text-embedding-3-small (default)
 */

// Unified to 1024 dims — bge-m3 native, OpenAI supports dimension param
const EMBEDDING_DIMENSIONS = 1024;
const MAX_EMBEDDING_CHARS = 2048;

// ─── Provider detection ───

type EmbeddingProvider = "ollama" | "openai" | "none";

function detectProvider(): EmbeddingProvider {
    const explicit = process.env.EMBEDDING_PROVIDER;
    if (explicit === "ollama" || explicit === "openai") return explicit;

    if (getOpenAIKey() || process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL) return "openai";
    if (process.env.OLLAMA_URL) return "ollama";
    return "none";
}

function getOllamaUrl(): string | null {
    return process.env.OLLAMA_URL || (process.env.EMBEDDING_PROVIDER === "ollama" ? "http://localhost:11434" : null);
}

function getOllamaModel(): string {
    return process.env.OLLAMA_EMBED_MODEL || "bge-m3";
}

function getOpenAIKey(): string | null {
    const key = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "";
    return key.length > 0 ? key : null;
}

function getOpenAIBaseUrl(): string {
    return (process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function getOpenAIModel(): string {
    return process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
}

/**
 * Truncate text to fit within the embedding token budget.
 */
export function truncateForEmbedding(text: string): string {
    if (text.length <= MAX_EMBEDDING_CHARS) return text;
    return text.slice(0, MAX_EMBEDDING_CHARS);
}

// ─── Ollama provider ───

async function ollamaEmbed(text: string): Promise<number[] | null> {
    const url = getOllamaUrl();
    if (!url) return null;

    try {
        const response = await fetch(`${url}/api/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: getOllamaModel(),
                input: truncateForEmbedding(text),
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            const errText = await response.text();
            log({ module: "embedding" }, `Ollama embed error (${response.status}): ${errText.slice(0, 200)}`);
            return null;
        }

        const data = await response.json() as { embeddings: number[][] };
        const vec = data.embeddings[0] ?? null;
        if (vec) {
            log({ module: "embedding" }, `Ollama embed ok: ${getOllamaModel()}, ${vec.length} dims, ${text.length} chars`);
        }
        return vec;
    } catch (err) {
        log({ module: "embedding" }, `Ollama embed failed: ${err}`);
        return null;
    }
}

async function ollamaEmbedBatch(texts: string[]): Promise<number[][] | null> {
    const url = getOllamaUrl();
    if (!url) return null;

    try {
        const response = await fetch(`${url}/api/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: getOllamaModel(),
                input: texts.map(truncateForEmbedding),
            }),
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            const errText = await response.text();
            log({ module: "embedding" }, `Ollama batch embed error (${response.status}): ${errText.slice(0, 200)}`);
            return null;
        }

        const data = await response.json() as { embeddings: number[][] };
        log({ module: "embedding" }, `Ollama batch embed ok: ${getOllamaModel()}, ${data.embeddings.length} texts, ${data.embeddings[0]?.length ?? 0} dims`);
        return data.embeddings;
    } catch (err) {
        log({ module: "embedding" }, `Ollama batch embed failed: ${err}`);
        return null;
    }
}

// ─── OpenAI provider ───

async function openaiEmbed(text: string): Promise<number[] | null> {
    const apiKey = getOpenAIKey();
    if (!apiKey) return null;

    try {
        const response = await fetch(`${getOpenAIBaseUrl()}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: getOpenAIModel(),
                input: truncateForEmbedding(text),
                dimensions: EMBEDDING_DIMENSIONS,
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            const errText = await response.text();
            log({ module: "embedding" }, `OpenAI embed error (${response.status}): ${errText.slice(0, 200)}`);
            return null;
        }

        const data = await response.json() as { data: { embedding: number[] }[] };
        const vec = data.data[0].embedding;
        log({ module: "embedding" }, `OpenAI embed ok: ${getOpenAIModel()}, ${vec.length} dims, ${text.length} chars`);
        return vec;
    } catch (err) {
        log({ module: "embedding" }, `OpenAI embed failed: ${err}`);
        return null;
    }
}

async function openaiEmbedBatch(texts: string[]): Promise<number[][] | null> {
    const apiKey = getOpenAIKey();
    if (!apiKey) return null;

    try {
        const response = await fetch(`${getOpenAIBaseUrl()}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: getOpenAIModel(),
                input: texts.map(truncateForEmbedding),
                dimensions: EMBEDDING_DIMENSIONS,
            }),
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            const errText = await response.text();
            log({ module: "embedding" }, `OpenAI batch embed error (${response.status}): ${errText.slice(0, 200)}`);
            return null;
        }

        const data = await response.json() as { data: { embedding: number[]; index: number }[] };
        const sorted = [...data.data].sort((a, b) => a.index - b.index);
        log({ module: "embedding" }, `OpenAI batch embed ok: ${getOpenAIModel()}, ${sorted.length} texts, ${sorted[0]?.embedding.length ?? 0} dims`);
        return sorted.map((item) => item.embedding);
    } catch (err) {
        log({ module: "embedding" }, `OpenAI batch embed failed: ${err}`);
        return null;
    }
}

// ─── Public API ───

/**
 * Generate an embedding vector for a single text.
 * Auto-detects provider: Ollama (local) → OpenAI (cloud) → null.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
    const provider = detectProvider();

    if (provider === "ollama") {
        const result = await ollamaEmbed(text);
        if (result) return result;
        // Ollama failed, try OpenAI as fallback
        if (getOpenAIKey()) return openaiEmbed(text);
        return null;
    }

    if (provider === "openai") {
        return openaiEmbed(text);
    }

    return null;
}

/**
 * Generate embeddings for multiple texts.
 * Returns empty array for empty input, null on failure.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return [];

    const provider = detectProvider();

    if (provider === "ollama") {
        const result = await ollamaEmbedBatch(texts);
        if (result) return result;
        if (getOpenAIKey()) return openaiEmbedBatch(texts);
        return null;
    }

    if (provider === "openai") {
        return openaiEmbedBatch(texts);
    }

    return null;
}

export { EMBEDDING_DIMENSIONS };
