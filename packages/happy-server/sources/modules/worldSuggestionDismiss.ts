/**
 * Dismiss a WorldSuggestion — mark as dismissed, no side effects.
 */

import { db } from "@/storage/db";
import { eventRouter, buildWorldSuggestionUpdatedEphemeral } from "@/app/events/eventRouter";

export async function worldSuggestionDismiss(
    accountId: string,
    projectId: string,
    suggestionId: string,
): Promise<void> {
    const suggestion = await db.worldSuggestion.findFirst({
        where: { id: suggestionId, accountId, projectId, status: "open" },
        select: { id: true },
    });
    if (!suggestion) {
        throw new Error("Suggestion not found or already acted upon");
    }

    await db.worldSuggestion.update({
        where: { id: suggestionId },
        data: {
            status: "dismissed",
            actedAt: new Date(),
        },
    });

    eventRouter.emitEphemeral({
        userId: accountId,
        payload: buildWorldSuggestionUpdatedEphemeral({
            projectId,
            suggestionId,
            status: "dismissed",
        }),
        recipientFilter: { type: "user-scoped-only" },
    });
}
