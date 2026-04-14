/**
 * Remove a WorldMember from a project.
 * The project owner cannot be removed.
 * All string FK references (Task, Decision, AgentMessage, delegation chains) are
 * cleared inside the same serializable transaction before the delete, so no stale
 * pointers remain in the database.
 */

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { auditLog } from "@/modules/worldAuditLog";

export async function worldMemberRemove(
    memberId: string,
    opts?: { actorId?: string; projectId?: string },
): Promise<void> {
    const member = await db.worldMember.findUnique({
        where: { id: memberId },
        select: { id: true, role: true, accountId: true, projectId: true, displayName: true },
    });

    if (!member) {
        throw Object.assign(new Error("Member not found"), { statusCode: 404 });
    }

    if (member.role === "owner") {
        throw Object.assign(
            new Error("Cannot remove the project owner"),
            { statusCode: 403 },
        );
    }

    await inTx(async (tx) => {
        // Clear Task assignments
        await tx.task.updateMany({
            where: { assignedMemberId: memberId },
            data: { assignedMemberId: null },
        });

        // Clear Decision assignments
        await tx.decision.updateMany({
            where: { assignedTo: memberId },
            data: { assignedTo: null },
        });

        // Clear delegation chains pointing to this member
        await tx.worldMember.updateMany({
            where: { delegateTo: memberId },
            data: { delegateTo: null },
        });

        // Clear AgentMessage routing
        await tx.agentMessage.updateMany({
            where: { toMemberId: memberId },
            data: { toMemberId: null },
        });

        // Delete the member
        await tx.worldMember.delete({ where: { id: memberId } });
    });

    // Fire-and-forget audit log after successful deletion
    const projectId = opts?.projectId ?? member.projectId;
    const actorId = opts?.actorId ?? member.accountId;
    await auditLog({
        accountId: actorId,
        projectId,
        action: "member.remove",
        entityType: "member",
        entityId: memberId,
        summary: `Removed member ${member.displayName ?? member.accountId} (${member.role})`,
        before: { id: member.id, role: member.role, accountId: member.accountId },
    });
}
