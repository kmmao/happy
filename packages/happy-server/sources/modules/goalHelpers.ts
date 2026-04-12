/**
 * Shared helpers for the Goal subsystem.
 *
 * Extracted from goalRoutes.ts and goalCreate.ts to eliminate duplication.
 */

/** Parse a JSON string that is expected to be an array of strings. Returns [] on invalid input. */
export function safeParseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Narrative + laws are the universal baseline for all sessions;
 * injected once at the top of each task prompt.
 */
export function buildWorldSessionBaseline(project: { narrative: string | null; laws: string | null }): string | null {
    const narrative = project.narrative?.trim();
    const laws = project.laws?.trim();
    if (!narrative && !laws) {
        return null;
    }
    const parts: string[] = [
        "## World session baseline",
        "",
        "The **narrative** and **laws** below apply to every agent session for this project. Formal decisions, inter-role messages, and any context not shown here must be fetched on demand (e.g. via app/API tools) when a workflow requires them.",
        "",
    ];
    if (narrative) {
        parts.push("### Narrative", narrative, "");
    }
    if (laws) {
        parts.push("### Laws", laws, "");
    }
    return parts.join("\n").trimEnd();
}

/**
 * Role-specific slice for a task (on-demand).
 * World narrative/laws are not repeated here — see baseline above.
 */
export function buildRoleIdentityPrefix(
    suggestedRole: string | undefined,
    roleMap: Map<string, { name: string; type: string; description: string | null; duties: string }>,
): string | null {
    if (!suggestedRole) return null;
    const role = roleMap.get(suggestedRole);
    if (!role) return null;

    const parts: string[] = [];
    parts.push(`## Your Role: ${role.name} (${role.type})`);
    if (role.description) {
        parts.push(`\n${role.description}`);
    }

    const duties = safeParseJsonArray(role.duties);
    if (duties.length > 0) {
        parts.push(`\n### Duties`);
        for (const duty of duties) {
            parts.push(`- ${duty}`);
        }
    }

    return parts.join("\n");
}
