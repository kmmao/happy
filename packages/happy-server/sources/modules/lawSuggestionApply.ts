/**
 * Apply an approved law suggestion to a project's laws array.
 * Called after a law_suggestion Decision is adjudicated with "approve".
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";

interface LawEntry {
    id: string;
    category: string;
    description: string;
    severity: string;
    enabled: boolean;
}

interface LawSuggestion {
    category: string;
    description: string;
    severity: string;
}

export async function lawSuggestionApply(
    projectId: string,
    accountId: string,
    lawJson: string,
): Promise<void> {
    try {
        const suggestion: LawSuggestion = JSON.parse(lawJson);

        if (!suggestion.category || !suggestion.description || !suggestion.severity) {
            log({ module: "law-evolution", level: "error" }, `Invalid law suggestion JSON: ${lawJson}`);
            return;
        }

        const project = await db.project.findFirst({
            where: { id: projectId, accountId },
            select: { laws: true },
        });
        if (!project) return;

        // Parse existing laws
        let existingLaws: LawEntry[] = [];
        if (project.laws) {
            try {
                existingLaws = JSON.parse(project.laws) as LawEntry[];
            } catch {
                existingLaws = [];
            }
        }

        // Check for duplicate (same category + similar description)
        const isDuplicate = existingLaws.some(
            (law) =>
                law.category === suggestion.category &&
                law.description.toLowerCase() === suggestion.description.toLowerCase(),
        );
        if (isDuplicate) {
            log({ module: "law-evolution" }, `Skipping duplicate law suggestion: ${suggestion.description}`);
            return;
        }

        // Create new law entry (immutable: new array)
        const newLaw: LawEntry = {
            id: `law-${Date.now()}`,
            category: suggestion.category,
            description: suggestion.description,
            severity: suggestion.severity,
            enabled: true,
        };
        const updatedLaws = [...existingLaws, newLaw];

        await db.project.update({
            where: { id: projectId },
            data: { laws: JSON.stringify(updatedLaws) },
        });

        log({ module: "law-evolution" }, `Applied new law to project ${projectId}: [${newLaw.category}] ${newLaw.description}`);
    } catch (err) {
        log({ module: "law-evolution", level: "error" }, `Failed to apply law suggestion: ${err}`);
    }
}
