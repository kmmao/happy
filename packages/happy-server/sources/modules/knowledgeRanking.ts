/**
 * Knowledge relevance ranking — picks the most relevant ProjectKnowledge entries
 * for a Session's context hints.
 *
 * Extracted from the `fetch-knowledge` socket handler, where the scoring lived
 * inline in a ~417-line file with no test surface. The rule has real edge
 * behavior worth pinning: scoring is a case-insensitive substring count of the
 * hints against the entry's `title + tags + content`; ties break by recency
 * (newer `createdAt` first); the top `limit` survive.
 *
 * Generic over the entry shape so it can be tested with plain fixtures rather
 * than Prisma rows.
 */

export interface RankableKnowledgeEntry {
    title: string;
    tags: string;
    content: string;
    createdAt: Date;
}

/**
 * Return the `limit` entries most relevant to `contextHints`, ordered by
 * descending hint-match score then descending recency. Each hint contributes at
 * most 1 to an entry's score (presence, not frequency).
 */
export function rankKnowledgeByContextHints<T extends RankableKnowledgeEntry>(
    entries: T[],
    contextHints: string[],
    limit: number,
): T[] {
    const hints = contextHints.map((h) => h.toLowerCase());
    const scored = entries.map((entry) => {
        const text = `${entry.title} ${entry.tags} ${entry.content}`.toLowerCase();
        const score = hints.reduce((acc, hint) => acc + (text.includes(hint) ? 1 : 0), 0);
        return { entry, score };
    });
    scored.sort(
        (a, b) => b.score - a.score || b.entry.createdAt.getTime() - a.entry.createdAt.getTime(),
    );
    return scored.slice(0, limit).map((s) => s.entry);
}
