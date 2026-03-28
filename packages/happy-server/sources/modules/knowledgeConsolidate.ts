import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { generateEmbedding, truncateForEmbedding } from "./embeddingService";
import { findSimilarForConsolidate } from "./knowledgeEmbedding";
import { safeParseJsonArray } from "./knowledgeSerialize";

/**
 * Input for consolidation — the new entry to check.
 */
export interface ConsolidateInput {
    title: string;
    entryType: string;
    tags: readonly string[];
    content: string;
}

/**
 * A candidate entry from the database, already parsed.
 */
export interface ConsolidateCandidate {
    id: string;
    title: string;
    tags: string[];
    content: string;
}

export type ConsolidateResult =
    | { type: "add" }
    | { type: "update"; existingId: string }
    | { type: "noop"; reason: string };

interface SimilarityInput {
    titleWords: Set<string>;
    tags: Set<string>;
}

const SIMILARITY_THRESHOLD = 0.7;
const CONTENT_GROWTH_THRESHOLD = 1.2;
const TITLE_WEIGHT = 0.6;
const TAG_WEIGHT = 0.4;

/**
 * Calculate similarity between two entries using title word overlap + tag overlap.
 * Title overlap is weighted at 60%, tag overlap at 40%.
 * When either side has no tags, tag dimension is ignored and title gets full weight.
 */
export function calculateSimilarity(a: SimilarityInput, b: SimilarityInput): number {
    const titleIntersection = [...a.titleWords].filter((w) => b.titleWords.has(w));
    const titleOverlap = titleIntersection.length / Math.max(a.titleWords.size, b.titleWords.size);

    // When either side has no tags, ignore tag dimension entirely
    if (a.tags.size === 0 || b.tags.size === 0) {
        return titleOverlap;
    }

    const tagIntersection = [...a.tags].filter((t) => b.tags.has(t));
    const tagOverlap = tagIntersection.length / Math.max(a.tags.size, b.tags.size);

    return titleOverlap * TITLE_WEIGHT + tagOverlap * TAG_WEIGHT;
}

/**
 * Determine consolidation action based on similarity to candidates.
 * Pure function — no DB access, easy to test.
 * Scans ALL candidates and picks the most similar one (not first-match).
 */
export function determineAction(
    input: ConsolidateInput,
    candidates: ConsolidateCandidate[],
): ConsolidateResult {
    if (candidates.length === 0) {
        return { type: "add" };
    }

    const newSimilarityInput: SimilarityInput = {
        titleWords: new Set(input.title.toLowerCase().split(/\s+/)),
        tags: new Set(input.tags.map((t) => t.toLowerCase())),
    };

    // Find the most similar candidate (not first-match)
    let bestMatch: { candidate: ConsolidateCandidate; similarity: number } | null = null;

    for (const candidate of candidates) {
        const candidateSimilarityInput: SimilarityInput = {
            titleWords: new Set(candidate.title.toLowerCase().split(/\s+/)),
            tags: new Set(candidate.tags.map((t) => t.toLowerCase())),
        };

        const similarity = calculateSimilarity(newSimilarityInput, candidateSimilarityInput);

        if (similarity > SIMILARITY_THRESHOLD && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = { candidate, similarity };
        }
    }

    if (!bestMatch) {
        return { type: "add" };
    }

    if (input.content.length > bestMatch.candidate.content.length * CONTENT_GROWTH_THRESHOLD) {
        return { type: "update", existingId: bestMatch.candidate.id };
    }
    return { type: "noop", reason: "Similar entry already exists" };
}

const SEMANTIC_NOOP_THRESHOLD = 0.85;
const SEMANTIC_UPDATE_THRESHOLD = 0.7;

/**
 * Mem0-style consolidation: determine if a new entry should be
 * added, should update (supersede) an existing entry, or be skipped.
 *
 * Strategy:
 * 1. Try semantic (embedding) search first — more accurate
 * 2. Fall back to keyword matching if embedding unavailable
 */
export async function consolidate(
    projectId: string,
    input: ConsolidateInput,
): Promise<ConsolidateResult> {
    // Try semantic consolidation first
    const semanticResult = await trySemanticConsolidate(projectId, input);
    if (semanticResult) {
        return semanticResult;
    }

    // Fall back to keyword-based consolidation
    return keywordConsolidate(projectId, input);
}

/**
 * Semantic consolidation using embedding similarity.
 * Returns null if embedding is unavailable (caller should fall back).
 */
async function trySemanticConsolidate(
    projectId: string,
    input: ConsolidateInput,
): Promise<ConsolidateResult | null> {
    try {
        const text = truncateForEmbedding(`${input.title} ${input.content}`);
        const embedding = await generateEmbedding(text);
        if (!embedding) return null;

        const similar = await findSimilarForConsolidate(projectId, input.entryType, embedding);
        if (similar.length === 0) return { type: "add" };

        const best = similar[0];
        if (best.similarity > SEMANTIC_NOOP_THRESHOLD) {
            // Very high similarity — check if new content adds value
            if (input.content.length > best.content.length * CONTENT_GROWTH_THRESHOLD) {
                return { type: "update", existingId: best.id };
            }
            return { type: "noop", reason: `Semantic similarity ${best.similarity.toFixed(2)} exceeds threshold` };
        }

        if (best.similarity > SEMANTIC_UPDATE_THRESHOLD) {
            // Moderate similarity (0.7-0.85) — related but distinct
            // Only supersede if new content is substantially longer
            if (input.content.length > best.content.length * CONTENT_GROWTH_THRESHOLD) {
                return { type: "update", existingId: best.id };
            }
            // Not long enough to supersede, but distinct enough to keep
            return { type: "add" };
        }

        return { type: "add" };
    } catch (err) {
        log({ module: "knowledge-consolidate" }, `Semantic consolidation failed, falling back to keyword: ${err}`);
        return null;
    }
}

/**
 * Keyword-based consolidation (original logic, used as fallback).
 */
async function keywordConsolidate(
    projectId: string,
    input: ConsolidateInput,
): Promise<ConsolidateResult> {
    const dbEntries = await db.projectKnowledge.findMany({
        where: {
            projectId,
            entryType: input.entryType,
            status: "active",
        },
        orderBy: { createdAt: "desc" },
        take: 20,
    });

    const candidates: ConsolidateCandidate[] = dbEntries.map((e) => ({
        id: e.id,
        title: e.title,
        tags: safeParseJsonArray(e.tags),
        content: e.content,
    }));

    return determineAction(input, candidates);
}
