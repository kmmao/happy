const VALID_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SupervisorSeverity = (typeof VALID_SEVERITIES)[number];

/**
 * Parse auto-approve severity list from supervisorConfig JSON.
 * Returns the configured severities for the given mode, or sensible defaults.
 */
export function parseAutoApproveSeverities(
    supervisorConfig: string | null,
    mode: "semi-auto" | "auto",
): SupervisorSeverity[] {
    try {
        if (supervisorConfig) {
            const cfg = JSON.parse(supervisorConfig);
            const aa = cfg?.autoApprove;
            if (aa && typeof aa === "object") {
                const key = mode === "auto" ? "autoSeverities" : "semiAutoSeverities";
                if (Array.isArray(aa[key]) && aa[key].length > 0) {
                    return aa[key].filter(
                        (s: unknown): s is SupervisorSeverity =>
                            typeof s === "string" && (VALID_SEVERITIES as readonly string[]).includes(s),
                    );
                }
            }
        }
    } catch { /* invalid JSON — use defaults */ }
    // Defaults: semi-auto → low+medium, auto → all
    return mode === "auto"
        ? ["low", "medium", "high", "critical"]
        : ["low", "medium"];
}
