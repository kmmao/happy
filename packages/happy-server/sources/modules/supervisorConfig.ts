const VALID_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SupervisorSeverity = (typeof VALID_SEVERITIES)[number];

/**
 * The parsed, normalized shape of a `Project.supervisorConfig` JSON blob.
 *
 * This module is the SINGLE owner of that blob's schema. Every field a caller
 * needs is extracted and type-guarded here, once, so no caller re-runs
 * `JSON.parse` against the raw string or re-derives the per-field guards.
 * Malformed JSON and missing/ill-typed fields both degrade to the documented
 * defaults rather than throwing — the whole blob is best-effort by design.
 *
 * Note: `dimensions` is NOT here — it is the separate CSV column
 * `Project.supervisorEnabledDimensions`, parsed by `parseEnabledDimensions`.
 */
export interface SupervisorConfig {
    /**
     * Per-mode auto-approve severity allowlists as configured.
     * `null` = not configured for that mode → caller applies the mode's
     * defaults via `resolveAutoApproveSeverities`. A configured-but-all-invalid
     * list resolves to `[]` (approve nothing), which is distinct from `null`.
     */
    autoApprove: {
        autoSeverities: SupervisorSeverity[] | null;
        semiAutoSeverities: SupervisorSeverity[] | null;
    };
    /** Concurrency caps; `undefined` = let the CLI use its own defaults. */
    concurrency: {
        maxAnalysisSessions: number | undefined;
        maxFixSessions: number | undefined;
    };
    /** Cap on findings per run; `undefined` = CLI default. */
    maxFindings: number | undefined;
    /** Runtime profile to resolve for this project's supervisor runs. */
    defaultProfileId: string | null;
    /** In analyze-first mode, auto-queue the fix after analysis completes. */
    analyzeAutoFix: boolean;
}

const EMPTY_CONFIG: SupervisorConfig = {
    autoApprove: { autoSeverities: null, semiAutoSeverities: null },
    concurrency: { maxAnalysisSessions: undefined, maxFixSessions: undefined },
    maxFindings: undefined,
    defaultProfileId: null,
    analyzeAutoFix: false,
};

function num(v: unknown): number | undefined {
    return typeof v === "number" ? v : undefined;
}

/**
 * `null` when the source is not a configured list (not an array, or empty).
 * A configured non-empty list returns the valid subset — possibly `[]` if
 * every entry is invalid. Callers distinguish `null` (use defaults) from `[]`
 * (explicitly approve nothing).
 */
function severityList(v: unknown): SupervisorSeverity[] | null {
    if (!Array.isArray(v) || v.length === 0) return null;
    return v.filter(
        (s: unknown): s is SupervisorSeverity =>
            typeof s === "string" && (VALID_SEVERITIES as readonly string[]).includes(s),
    );
}

/**
 * Parse the raw `Project.supervisorConfig` JSON string into the typed shape.
 * Never throws; returns fully-defaulted config on null/malformed input.
 */
export function parseSupervisorConfig(raw: string | null | undefined): SupervisorConfig {
    if (!raw) return EMPTY_CONFIG;
    let cfg: unknown;
    try {
        cfg = JSON.parse(raw);
    } catch {
        return EMPTY_CONFIG;
    }
    if (!cfg || typeof cfg !== "object") return EMPTY_CONFIG;
    const c = cfg as Record<string, unknown>;
    const aa = c.autoApprove && typeof c.autoApprove === "object" ? (c.autoApprove as Record<string, unknown>) : {};
    const cc = c.concurrency && typeof c.concurrency === "object" ? (c.concurrency as Record<string, unknown>) : {};
    return {
        autoApprove: {
            autoSeverities: severityList(aa.autoSeverities),
            semiAutoSeverities: severityList(aa.semiAutoSeverities),
        },
        concurrency: {
            maxAnalysisSessions: num(cc.maxAnalysisSessions),
            maxFixSessions: num(cc.maxFixSessions),
        },
        maxFindings: num(c.maxFindings),
        defaultProfileId: (c.defaultProfileId as string | null | undefined) ?? null,
        analyzeAutoFix: c.analyzeAutoFix === true,
    };
}

const DEFAULT_AUTO_SEVERITIES: SupervisorSeverity[] = ["low", "medium", "high", "critical"];
const DEFAULT_SEMI_AUTO_SEVERITIES: SupervisorSeverity[] = ["low", "medium"];

/**
 * Resolve the effective auto-approve severities for a mode, applying the
 * documented defaults (semi-auto → low+medium, auto → all) only when the mode
 * was not configured.
 */
export function resolveAutoApproveSeverities(
    config: SupervisorConfig,
    mode: "semi-auto" | "auto",
): SupervisorSeverity[] {
    if (mode === "auto") {
        return config.autoApprove.autoSeverities ?? DEFAULT_AUTO_SEVERITIES;
    }
    return config.autoApprove.semiAutoSeverities ?? DEFAULT_SEMI_AUTO_SEVERITIES;
}

/**
 * Back-compat convenience: parse the raw blob and resolve auto-approve
 * severities in one call. Prefer `parseSupervisorConfig` +
 * `resolveAutoApproveSeverities` when the caller already holds the parsed config.
 */
export function parseAutoApproveSeverities(
    supervisorConfig: string | null,
    mode: "semi-auto" | "auto",
): SupervisorSeverity[] {
    return resolveAutoApproveSeverities(parseSupervisorConfig(supervisorConfig), mode);
}

/**
 * Parse the CSV `Project.supervisorEnabledDimensions` column (NOT part of the
 * JSON blob) into a trimmed, non-empty list. `undefined` = not configured.
 */
export function parseEnabledDimensions(raw: string | null | undefined): string[] | undefined {
    if (!raw) return undefined;
    const dims = raw.split(",").map((d) => d.trim()).filter(Boolean);
    return dims.length > 0 ? dims : undefined;
}
