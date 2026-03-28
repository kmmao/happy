import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { generateEmbedding, truncateForEmbedding } from "./embeddingService";

/**
 * Generate and store an embedding for a knowledge entry.
 * Fire-and-forget — failures are logged but don't block the caller.
 */
export async function storeKnowledgeEmbedding(
    entryId: string,
    title: string,
    content: string,
): Promise<void> {
    try {
        const text = truncateForEmbedding(`${title} ${content}`);
        const embedding = await generateEmbedding(text);

        if (!embedding) {
            log({ module: "knowledge-embedding" }, `Embedding generation returned null for entry ${entryId}`);
            return;
        }

        const vectorStr = `[${embedding.join(",")}]`;
        await db.$executeRawUnsafe(
            `UPDATE "ProjectKnowledge" SET "embedding" = $1::vector WHERE "id" = $2`,
            vectorStr,
            entryId,
        );

        log({ module: "knowledge-embedding" }, `Stored embedding for entry ${entryId}`);
    } catch (err) {
        log({ module: "knowledge-embedding" }, `Failed to store embedding for ${entryId}: ${err}`);
    }
}

interface SimilarEntry {
    id: string;
    title: string;
    content: string;
    tags: string;
    similarity: number;
}

/**
 * Find similar knowledge entries using cosine similarity on embeddings.
 * Returns entries sorted by similarity (highest first).
 * Falls back to empty array if pgvector is not available or no embeddings exist.
 */
export async function findSimilarByEmbedding(
    projectId: string,
    queryEmbedding: number[],
    limit: number = 5,
    minSimilarity: number = 0.5,
): Promise<SimilarEntry[]> {
    try {
        const vectorStr = `[${queryEmbedding.join(",")}]`;
        const results = await db.$queryRawUnsafe<SimilarEntry[]>(
            `SELECT id, title, content, tags,
                    1 - ("embedding" <=> $1::vector) AS similarity
             FROM "ProjectKnowledge"
             WHERE "projectId" = $2
               AND "status" = 'active'
               AND "embedding" IS NOT NULL
               AND 1 - ("embedding" <=> $1::vector) > $3
             ORDER BY "embedding" <=> $1::vector
             LIMIT $4`,
            vectorStr,
            projectId,
            minSimilarity,
            limit,
        );

        return results;
    } catch (err) {
        log({ module: "knowledge-embedding" }, `Vector search failed: ${err}`);
        return [];
    }
}

/**
 * Find similar entries for consolidation (higher threshold than general search).
 */
export async function findSimilarForConsolidate(
    projectId: string,
    entryType: string,
    queryEmbedding: number[],
): Promise<SimilarEntry[]> {
    try {
        const vectorStr = `[${queryEmbedding.join(",")}]`;
        const results = await db.$queryRawUnsafe<SimilarEntry[]>(
            `SELECT id, title, content, tags,
                    1 - ("embedding" <=> $1::vector) AS similarity
             FROM "ProjectKnowledge"
             WHERE "projectId" = $2
               AND "entryType" = $3
               AND "status" = 'active'
               AND "embedding" IS NOT NULL
             ORDER BY "embedding" <=> $1::vector
             LIMIT 5`,
            vectorStr,
            projectId,
            entryType,
        );

        return results;
    } catch (err) {
        log({ module: "knowledge-embedding" }, `Consolidation vector search failed: ${err}`);
        return [];
    }
}
