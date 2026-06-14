/**
 * Startup deduplication for Project records.
 *
 * Detects duplicate projects sharing the same (accountId, path) and merges
 * all related data into the newest record, then deletes the old ones.
 *
 * This guards against data-restore or migration incidents that bypass the
 * unique constraint (accountId, machineId, path).
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";

interface DuplicateGroup {
    readonly accountId: string;
    readonly path: string;
    readonly ids: readonly string[];
}

/**
 * Run once at server startup. Safe to call multiple times (idempotent).
 */
export async function deduplicateProjects(): Promise<void> {
    const groups = await db.$queryRaw<DuplicateGroup[]>`
        SELECT "accountId", path, array_agg(id ORDER BY "createdAt" DESC) as ids
        FROM "Project"
        GROUP BY "accountId", path
        HAVING COUNT(*) > 1
    `;

    if (groups.length === 0) return;

    log(
        { module: "project-dedup" },
        `Found ${groups.length} duplicate project group(s), merging...`,
    );

    for (const group of groups) {
        const [keepId, ...oldIds] = group.ids;
        await mergeProjects(keepId, oldIds, group.path);
    }

    log(
        { module: "project-dedup" },
        `Deduplication complete`,
    );
}

async function mergeProjects(
    keepId: string,
    oldIds: readonly string[],
    path: string,
): Promise<void> {
    await db.$transaction(async (tx) => {
        // Migrate all foreign-key references from old → keep
        // ADR-0022 Phase 4 — the physical table named SupervisorLoop was
        // renamed to AgentLoop. Match the new name so the raw UPDATE
        // here stays in sync with the Prisma client.
        const tables = [
            "Session",
            "SupervisorRun",
            "SupervisorAction",
            "AgentLoop",
            "ProjectKnowledge",
        ] as const;

        for (const table of tables) {
            const result = await tx.$executeRawUnsafe(
                `UPDATE "${table}" SET "projectId" = $1 WHERE "projectId" = ANY($2::text[])`,
                keepId,
                oldIds as unknown as string[],
            );
            if (result > 0) {
                log(
                    { module: "project-dedup" },
                    `  Migrated ${result} ${table} row(s) for path=${path}`,
                );
            }
        }

        // Delete orphaned ProjectProfile (keep record should already have its own)
        await tx.$executeRawUnsafe(
            `DELETE FROM "ProjectProfile" WHERE "projectId" = ANY($1::text[])`,
            oldIds as unknown as string[],
        );

        // Delete old Project records
        await tx.$executeRawUnsafe(
            `DELETE FROM "Project" WHERE id = ANY($1::text[])`,
            oldIds as unknown as string[],
        );

        log(
            { module: "project-dedup" },
            `  Merged ${oldIds.length} duplicate(s) into ${keepId} for path=${path}`,
        );
    });
}
