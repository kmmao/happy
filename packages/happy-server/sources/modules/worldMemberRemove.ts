/**
 * Remove a WorldMember from a project.
 * The project owner cannot be removed.
 */

import { db } from "@/storage/db";

export async function worldMemberRemove(memberId: string): Promise<void> {
    const member = await db.worldMember.findUnique({
        where: { id: memberId },
        select: { id: true, role: true },
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

    await db.worldMember.delete({ where: { id: memberId } });
}
