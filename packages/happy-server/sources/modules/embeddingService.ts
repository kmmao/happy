import { log } from "@/utils/log";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

// Rough estimate: 1 token ≈ 4 chars for English, ≈ 2 chars for CJK
// Max ~512 tokens → ~2048 chars is a safe limit
const MAX_EMBEDDING_CHARS = 2048;

function getApiKey(): string | null {
    const key = process.env.OPENAI_API_KEY || process.env.EMBEDDING_API_KEY || "";
    return key.length > 0 ? key : null;
}

/**
 * Truncate text to fit within the embedding token budget.
 * Uses a character-based estimate (conservative).
 */
export function truncateForEmbedding(text: string): string {
    if (text.length <= MAX_EMBEDDING_CHARS) return text;
    return text.slice(0, MAX_EMBEDDING_CHARS);
}

/**
 * Generate an embedding vector for a single text.
 * Returns null on failure (graceful degradation — callers fall back to keyword matching).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
        const response = await fetch(OPENAI_EMBEDDINGS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: truncateForEmbedding(text),
                dimensions: EMBEDDING_DIMENSIONS,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            log({ module: "embedding" }, `OpenAI embedding API error (${response.status}): ${errorText.slice(0, 200)}`);
            return null;
        }

        const data = await response.json() as { data: { embedding: number[] }[] };
        return data.data[0].embedding;
    } catch (err) {
        log({ module: "embedding" }, `Embedding generation failed: ${err}`);
        return null;
    }
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * Returns null on failure.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return [];

    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
        const response = await fetch(OPENAI_EMBEDDINGS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: texts.map(truncateForEmbedding),
                dimensions: EMBEDDING_DIMENSIONS,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            log({ module: "embedding" }, `OpenAI batch embedding API error (${response.status}): ${errorText.slice(0, 200)}`);
            return null;
        }

        const data = await response.json() as { data: { embedding: number[]; index: number }[] };
        // OpenAI returns embeddings sorted by index
        const sorted = [...data.data].sort((a, b) => a.index - b.index);
        return sorted.map((item) => item.embedding);
    } catch (err) {
        log({ module: "embedding" }, `Batch embedding generation failed: ${err}`);
        return null;
    }
}

export { EMBEDDING_DIMENSIONS };
