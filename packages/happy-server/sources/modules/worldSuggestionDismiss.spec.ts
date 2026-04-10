import { beforeEach, describe, expect, it, vi } from "vitest";

const { emitEphemeral, buildWorldSuggestionUpdatedEphemeral, dbMock } = vi.hoisted(() => ({
    emitEphemeral: vi.fn(),
    buildWorldSuggestionUpdatedEphemeral: vi.fn((payload: unknown) => payload),
    dbMock: {
        worldSuggestion: {
            findFirst: vi.fn(async () => ({ id: "suggestion-1" })),
            update: vi.fn(async () => ({})),
        },
    },
}));

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral },
    buildWorldSuggestionUpdatedEphemeral,
}));

import { worldSuggestionDismiss } from "./worldSuggestionDismiss";

describe("worldSuggestionDismiss", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("dismisses suspended suggestion", async () => {
        await worldSuggestionDismiss("user-1", "project-1", "suggestion-1");

        expect(dbMock.worldSuggestion.findFirst).toHaveBeenCalledWith({
            where: {
                id: "suggestion-1",
                accountId: "user-1",
                projectId: "project-1",
                status: { in: ["open", "suspended"] },
            },
            select: { id: true },
        });
        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-1" },
            data: {
                status: "dismissed",
                actedAt: expect.any(Date),
            },
        });
        expect(buildWorldSuggestionUpdatedEphemeral).toHaveBeenCalledWith({
            projectId: "project-1",
            suggestionId: "suggestion-1",
            status: "dismissed",
        });
    });
});
