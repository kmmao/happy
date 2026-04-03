import { z } from "zod";
import type { ProjectKnowledge } from "@prisma/client";

const ProjectProfileSchema = z.object({
    techStack: z.array(z.string()),
    architectureType: z.string().optional(),
    knownPitfalls: z.array(z.string()),
    coreConventions: z.array(z.string()),
    lastUpdatedAt: z.number(),
    lastUpdatedBy: z.string().optional(),
});

/**
 * Safely parse a JSON array string. Returns empty array on failure.
 */
export function safeParseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Serialize a ProjectKnowledge DB row to API response format.
 * Parses JSON-stored fields (tags, affectedFiles, relatedIds, structured).
 */
export function serializeKnowledgeEntry(entry: ProjectKnowledge) {
    return {
        id: entry.id,
        projectId: entry.projectId,
        entryType: entry.entryType,
        category: entry.category,
        contributorType: entry.contributorType,
        action: entry.action,
        status: entry.status,
        title: entry.title,
        content: entry.content,
        structured: entry.structured ? JSON.parse(entry.structured) : null,
        tags: safeParseJsonArray(entry.tags),
        confidence: entry.confidence,
        model: entry.model,
        sessionId: entry.sessionId,
        affectedFiles: safeParseJsonArray(entry.affectedFiles),
        relatedIds: safeParseJsonArray(entry.relatedIds),
        supersedesId: entry.supersedesId,
        pinned: entry.pinned,
        lastAccessedAt: entry.lastAccessedAt?.getTime() ?? null,
        accessCount: entry.accessCount,
        createdAt: entry.createdAt.getTime(),
        updatedAt: entry.updatedAt.getTime(),
    };
}

/**
 * Parse a ProjectProfile content string (JSON) with Zod validation.
 * Returns null if parsing fails.
 */
export function parseProfileContent(content: string) {
    try {
        const parsed = JSON.parse(content);
        return ProjectProfileSchema.parse(parsed);
    } catch {
        return null;
    }
}
