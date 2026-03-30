import { db } from "@/storage/db";
import { z } from "zod";

/**
 * Project-level knowledge base configuration.
 * Stored as JSON in Project.knowledgeConfig.
 * null = inherit hardcoded defaults.
 * Partial fields allowed — missing fields fall back to defaults.
 */

// ─── Schema ───

export const KnowledgeConfigSchema = z.object({
    enabled: z.boolean().optional(),
    mode: z.enum(["auto", "full", "minimal"]).optional(),
    sensitivity: z.enum(["conservative", "balanced", "aggressive"]).optional(),
    trackFileEdits: z.boolean().optional(),
    trackToolCalls: z.boolean().optional(),
    trackTokens: z.boolean().optional(),
    decayEnabled: z.boolean().optional(),
    mergeEnabled: z.boolean().optional(),
    refineEnabled: z.boolean().optional(),
});

export type KnowledgeConfig = z.infer<typeof KnowledgeConfigSchema>;

// ─── Hardcoded defaults (matches App settings.ts defaults) ───

const DEFAULTS: Required<KnowledgeConfig> = {
    enabled: false,
    mode: "auto",
    sensitivity: "balanced",
    trackFileEdits: true,
    trackToolCalls: true,
    trackTokens: true,
    decayEnabled: false,
    mergeEnabled: false,
    refineEnabled: true,
};

export type ResolvedKnowledgeConfig = Required<KnowledgeConfig>;

/**
 * Parse a raw JSON string into KnowledgeConfig.
 * Returns null on failure (invalid JSON or schema mismatch).
 */
export function parseKnowledgeConfig(raw: string | null): KnowledgeConfig | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return KnowledgeConfigSchema.parse(parsed);
    } catch {
        return null;
    }
}

/**
 * Merge partial project config with defaults.
 * Every field is guaranteed to be present in the result.
 */
export function mergeWithDefaults(config: KnowledgeConfig | null): ResolvedKnowledgeConfig {
    if (!config) return { ...DEFAULTS };
    return {
        enabled: config.enabled ?? DEFAULTS.enabled,
        mode: config.mode ?? DEFAULTS.mode,
        sensitivity: config.sensitivity ?? DEFAULTS.sensitivity,
        trackFileEdits: config.trackFileEdits ?? DEFAULTS.trackFileEdits,
        trackToolCalls: config.trackToolCalls ?? DEFAULTS.trackToolCalls,
        trackTokens: config.trackTokens ?? DEFAULTS.trackTokens,
        decayEnabled: config.decayEnabled ?? DEFAULTS.decayEnabled,
        mergeEnabled: config.mergeEnabled ?? DEFAULTS.mergeEnabled,
        refineEnabled: config.refineEnabled ?? DEFAULTS.refineEnabled,
    };
}

/**
 * Resolve the effective knowledge config for a project.
 * Reads from DB, merges with defaults.
 */
export async function resolveKnowledgeConfig(
    projectId: string,
): Promise<ResolvedKnowledgeConfig> {
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: { knowledgeConfig: true },
    });
    const parsed = parseKnowledgeConfig(project?.knowledgeConfig ?? null);
    return mergeWithDefaults(parsed);
}

/**
 * Check if a project has a custom knowledge config (vs inheriting defaults).
 */
export function hasCustomConfig(raw: string | null): boolean {
    return raw !== null && raw !== "";
}

/**
 * Get the hardcoded defaults (for API responses).
 */
export function getDefaults(): ResolvedKnowledgeConfig {
    return { ...DEFAULTS };
}
