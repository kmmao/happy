import { describe, expect, it } from "vitest";
import { getSessionKnowledgeLoadState } from "./sessionKnowledgeLoadState";

describe("getSessionKnowledgeLoadState", () => {
    it("loads both changes and references when sheet first becomes visible on changes tab", () => {
        expect(
            getSessionKnowledgeLoadState({
                visible: true,
                activeTab: "changes",
                hasLoadedChanges: false,
            }),
        ).toEqual({
            shouldLoadChanges: true,
            shouldLoadReferences: true,
        });
    });

    it("loads both when user is on references tab", () => {
        expect(
            getSessionKnowledgeLoadState({
                visible: true,
                activeTab: "references",
                hasLoadedChanges: true,
            }),
        ).toEqual({
            shouldLoadChanges: true,
            shouldLoadReferences: true,
        });
    });

    it("does not request anything while sheet is hidden", () => {
        expect(
            getSessionKnowledgeLoadState({
                visible: false,
                activeTab: "changes",
                hasLoadedChanges: true,
            }),
        ).toEqual({
            shouldLoadChanges: false,
            shouldLoadReferences: false,
        });
    });
});
