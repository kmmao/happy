import { log } from "@/utils/log";
import { consolidate } from "./knowledgeConsolidate";
import { inTx } from "@/storage/inTx";
import { storeKnowledgeEmbedding } from "./knowledgeEmbedding";

const MAX_ENTRIES_PER_RUN = 5;
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface SupervisorAction {
    severity: string;
    category: string;
    title: string;
    description: string;
    suggestedFix?: string;
    confidence?: number;
}

/**
 * Convert supervisor actions to knowledge entries.
 * Fire-and-forget — failures are logged but don't affect supervisor flow.
 *
 * Rules:
 * - Max 5 entries per run to avoid write storms
 * - critical/high → "warning" entryType, medium/low → "discovery"
 * - Uses consolidate() for dedup (semantic if available, keyword fallback)
 */
export async function contributeSupervisorKnowledge(
    projectId: string,
    runId: string,
    actions: SupervisorAction[],
): Promise<void> {
    try {
        const selected = [...actions]
            .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4))
            .slice(0, MAX_ENTRIES_PER_RUN);
        let created = 0;

        for (const action of selected) {
            const entryType = action.severity === "critical" || action.severity === "high"
                ? "warning"
                : "discovery";

            const content = action.suggestedFix
                ? `${action.description}\n\nSuggested fix: ${action.suggestedFix}`
                : action.description;

            const confidence = action.confidence !== undefined
                ? (action.confidence >= 80 ? "high" : action.confidence >= 50 ? "medium" : "low")
                : "medium";

            const input = {
                title: action.title,
                entryType,
                tags: [action.category, "supervisor"],
                content,
            };

            const dedupResult = await consolidate(projectId, input);

            if (dedupResult.type === "noop") {
                continue;
            }

            const entry = await inTx(async (tx) => {
                if (dedupResult.type === "update" && dedupResult.existingId) {
                    await tx.projectKnowledge.update({
                        where: { id: dedupResult.existingId },
                        data: { status: "superseded" },
                    });
                }

                return tx.projectKnowledge.create({
                    data: {
                        projectId,
                        entryType,
                        contributorType: "supervisor",
                        action: dedupResult.type === "update" ? "supersede" : "create",
                        title: action.title.slice(0, 200),
                        content: content.slice(0, 10000),
                        tags: JSON.stringify([action.category, "supervisor"]),
                        confidence,
                        sessionId: runId,
                        affectedFiles: "[]",
                        relatedIds: "[]",
                        supersedesId: dedupResult.type === "update" ? dedupResult.existingId : null,
                    },
                });
            });

            void storeKnowledgeEmbedding(entry.id, entry.title, entry.content);
            created++;
        }

        if (created > 0) {
            log(
                { module: "knowledge-contributor" },
                `Supervisor contributed ${created} knowledge entries for project ${projectId} (run ${runId})`,
            );
        }
    } catch (err) {
        log(
            { module: "knowledge-contributor" },
            `Failed to contribute supervisor knowledge for project ${projectId}: ${err}`,
        );
    }
}
