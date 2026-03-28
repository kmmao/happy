import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { generateEmbedding, truncateForEmbedding } from "@/modules/embeddingService";
import { safeParseJsonArray } from "@/modules/knowledgeSerialize";
import { log } from "@/utils/log";

// Similarity threshold used in raw SQL below: 0.3
// Lower than consolidation (0.7) — broad discovery intent for cross-project search

const SearchQuerySchema = z.object({
    q: z.string().min(1).max(500),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Cross-project knowledge search routes.
 * Searches across all projects owned by the authenticated user.
 */
export function knowledgeSearchRoutes(app: Fastify) {
    app.get(
        "/v1/knowledge/search",
        {
            preHandler: app.authenticate,
            schema: {
                querystring: SearchQuerySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { q, limit, offset } = request.query;

            // Get all project IDs for this user
            const userProjects = await db.project.findMany({
                where: { accountId: userId },
                select: { id: true, path: true },
            });

            if (userProjects.length === 0) {
                return reply.send({ results: [], total: 0 });
            }

            const projectIds = userProjects.map((p) => p.id);
            const projectPathMap = new Map(userProjects.map((p) => [p.id, p.path]));

            // Try semantic search first
            const semanticResults = await trySemanticSearch(projectIds, projectPathMap, q, limit, offset);
            if (semanticResults) {
                return reply.send(semanticResults);
            }

            // Fallback: keyword search (ILIKE on title + content)
            const where = {
                projectId: { in: projectIds },
                status: "active" as const,
                OR: [
                    { title: { contains: q, mode: "insensitive" as const } },
                    { content: { contains: q, mode: "insensitive" as const } },
                ],
            };

            const [entries, total] = await Promise.all([
                db.projectKnowledge.findMany({
                    where,
                    orderBy: [{ createdAt: "desc" }],
                    take: limit,
                    skip: offset,
                }),
                db.projectKnowledge.count({ where }),
            ]);

            return reply.send({
                results: entries.map((e) => ({
                    id: e.id,
                    projectId: e.projectId,
                    projectPath: projectPathMap.get(e.projectId) ?? "",
                    entryType: e.entryType,
                    title: e.title,
                    content: e.content,
                    tags: safeParseJsonArray(e.tags),
                    confidence: e.confidence,
                    createdAt: e.createdAt.toISOString(),
                })),
                total,
            });
        },
    );
}

async function trySemanticSearch(
    projectIds: string[],
    projectPathMap: Map<string, string>,
    query: string,
    limit: number,
    offset: number,
): Promise<{ results: unknown[]; total: number } | null> {
    try {
        const queryText = truncateForEmbedding(query);
        const queryEmbedding = await generateEmbedding(queryText);
        if (!queryEmbedding) return null;

        const vectorStr = `[${queryEmbedding.join(",")}]`;

        // Parameterized cross-project vector search
        const results = await db.$queryRawUnsafe<{
            id: string;
            projectId: string;
            entryType: string;
            title: string;
            content: string;
            tags: string;
            confidence: string;
            similarity: number;
            createdAt: Date;
        }[]>(
            `SELECT id, "projectId", "entryType", title, content, tags, confidence,
                    1 - ("embedding" <=> $1::vector) AS similarity,
                    "createdAt"
             FROM "ProjectKnowledge"
             WHERE "projectId" = ANY($2::text[])
               AND "status" = 'active'
               AND "embedding" IS NOT NULL
               AND 1 - ("embedding" <=> $1::vector) > 0.3
             ORDER BY "embedding" <=> $1::vector
             LIMIT $3 OFFSET $4`,
            vectorStr,
            projectIds,
            limit,
            offset,
        );

        // Semantic search succeeded — return results (even if empty)
        if (results.length === 0) {
            return { results: [], total: 0 };
        }

        // Approximate total: HNSW can't accelerate COUNT with distance filter,
        // so we use a lower-bound estimate instead of an expensive full scan.
        const approximateTotal = results.length < limit
            ? offset + results.length  // Last page — exact count
            : -1;                      // More results may exist

        return {
            results: results.map((e) => ({
                id: e.id,
                projectId: e.projectId,
                projectPath: projectPathMap.get(e.projectId) ?? "",
                entryType: e.entryType,
                title: e.title,
                content: e.content,
                tags: safeParseJsonArray(e.tags),
                confidence: e.confidence,
                similarity: Number(e.similarity),
                createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
            })),
            total: approximateTotal,
        };
    } catch (err) {
        log({ module: "knowledge-search" }, `Semantic cross-project search failed: ${err}`);
        return null;
    }
}
