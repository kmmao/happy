import { Prisma } from "@prisma/client";

/**
 * The distinct Machine ids a Session is bound to via its AccessKeys — i.e. the
 * daemons that should be told when the Session ends. Both `sessionDelete` and
 * `sessionArchive` need this exact "read the accessKeys, dedupe machineIds"
 * query to fan out `session-terminate`; naming it once keeps the two lifecycle
 * operations reading the same list the same way (and gives the dedupe a home
 * should the AccessKey→Machine relationship ever grow more than one row per
 * machine).
 *
 * Must run inside the caller's transaction so it sees the pre-delete rows.
 */
export async function getSessionMachineIds(
    tx: Prisma.TransactionClient,
    sessionId: string,
): Promise<string[]> {
    const accessKeys = await tx.accessKey.findMany({
        where: { sessionId },
        select: { machineId: true },
    });
    return [...new Set(accessKeys.map((ak) => ak.machineId))];
}
