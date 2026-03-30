import { db } from "@/storage/db";
import { safeParseJsonArray } from "./knowledgeSerialize";
import { getProjectRelations, type KnowledgeRelationRow } from "./knowledgeRelation";

const MAX_CHAIN_DEPTH = 10;

/**
 * A knowledge entry row with the fields needed for chain building.
 */
export interface ChainEntry {
    id: string;
    entryType: string;
    action: string;
    status: string;
    title: string;
    content: string;
    tags: string;
    confidence: string;
    supersedesId: string | null;
    relatedIds: string; // Kept for backward compat (deprecated — prefer KnowledgeRelation table)
    createdAt: Date;
}

export type ChainRelationType = "supersedes" | "related" | "contradicts" | "refines" | "combines";

interface ChainRelation {
    from: string;
    to: string;
    type: ChainRelationType;
}

interface SerializedChainEntry {
    id: string;
    entryType: string;
    action: string;
    status: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    supersedesId: string | null;
    createdAt: string;
}



/**
 * Build a knowledge evolution chain from a set of entries.
 * Pure function — no DB access, easy to test.
 *
 * Walks the supersession chain (up and down) and graph relations.
 * Falls back to relatedIds JSON for entries not yet migrated.
 * Limited to MAX_CHAIN_DEPTH to prevent infinite loops.
 */
export function buildChain(
    entryId: string,
    allEntries: ChainEntry[],
    graphRelations?: KnowledgeRelationRow[],
): { chain: SerializedChainEntry[]; relations: ChainRelation[] } {
    const entryMap = new Map(allEntries.map((e) => [e.id, e]));
    const collected = new Set<string>();
    const relations: ChainRelation[] = [];

    // Build adjacency from KnowledgeRelation rows (graph relations)
    const graphByEntry = new Map<string, { peerId: string; type: ChainRelationType }[]>();
    if (graphRelations) {
        for (const gr of graphRelations) {
            const fromList = graphByEntry.get(gr.fromEntryId) ?? [];
            fromList.push({ peerId: gr.toEntryId, type: gr.relationType as ChainRelationType });
            graphByEntry.set(gr.fromEntryId, fromList);

            const toList = graphByEntry.get(gr.toEntryId) ?? [];
            toList.push({ peerId: gr.fromEntryId, type: gr.relationType as ChainRelationType });
            graphByEntry.set(gr.toEntryId, toList);
        }
    }

    function collect(id: string, depth: number) {
        if (depth >= MAX_CHAIN_DEPTH || collected.has(id) || collected.size >= MAX_CHAIN_DEPTH) return;
        const entry = entryMap.get(id);
        if (!entry) return;

        collected.add(id);

        // Walk up: entry supersedes another
        if (entry.supersedesId && !collected.has(entry.supersedesId)) {
            relations.push({ from: id, to: entry.supersedesId, type: "supersedes" });
            collect(entry.supersedesId, depth + 1);
        }

        // Walk down: find entries that supersede this one
        for (const other of allEntries) {
            if (other.supersedesId === id && !collected.has(other.id)) {
                relations.push({ from: other.id, to: id, type: "supersedes" });
                collect(other.id, depth + 1);
            }
        }

        // Graph relations (from KnowledgeRelation table)
        const peers = graphByEntry.get(id);
        if (peers) {
            for (const { peerId, type } of peers) {
                if (!collected.has(peerId)) {
                    relations.push({ from: id, to: peerId, type });
                    collect(peerId, depth + 1);
                }
            }
        }

        // Fallback: legacy relatedIds JSON (for entries not yet migrated)
        if (!peers || peers.length === 0) {
            const relatedIds = safeParseJsonArray(entry.relatedIds);
            for (const relatedId of relatedIds) {
                if (!collected.has(relatedId)) {
                    relations.push({ from: id, to: relatedId, type: "related" });
                    collect(relatedId, depth + 1);
                }
            }
        }
    }

    collect(entryId, 0);

    // Sort chain by createdAt ascending
    const chain = [...collected]
        .map((id) => entryMap.get(id)!)
        .filter(Boolean)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((e): SerializedChainEntry => ({
            id: e.id,
            entryType: e.entryType,
            action: e.action,
            status: e.status,
            title: e.title,
            content: e.content,
            tags: safeParseJsonArray(e.tags),
            confidence: e.confidence,
            supersedesId: e.supersedesId,
            createdAt: e.createdAt.toISOString(),
        }));

    return { chain, relations };
}

/**
 * Fetch the evolution chain for a knowledge entry from the database.
 * Fetches all entries in the same project and builds the chain graph.
 * Uses KnowledgeRelation table with fallback to relatedIds JSON.
 *
 * PRECONDITION: caller must verify project belongs to the requesting user.
 */
export async function fetchKnowledgeChain(
    projectId: string,
    entryId: string,
): Promise<{ chain: SerializedChainEntry[]; relations: ChainRelation[] }> {
    // Fetch entries + graph relations in parallel
    const [allEntries, graphRelations] = await Promise.all([
        db.projectKnowledge.findMany({
            where: { projectId },
            select: {
                id: true,
                entryType: true,
                action: true,
                status: true,
                title: true,
                content: true,
                tags: true,
                confidence: true,
                supersedesId: true,
                relatedIds: true,
                createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 200,
        }),
        getProjectRelations(projectId),
    ]);

    return buildChain(entryId, allEntries, graphRelations);
}
