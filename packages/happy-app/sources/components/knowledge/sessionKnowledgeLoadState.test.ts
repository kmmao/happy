import { describe, expect, it } from "vitest";
import { getSessionKnowledgeLoadState } from "./sessionKnowledgeLoadState";

describe("getSessionKnowledgeLoadState", () => {
    it("loads only changes tab when sheet first becomes visible", () => {
        expect(
            getSessionKnowledgeLoadState({
                visible: true,
                activeTab: "changes",
                hasLoadedChanges: false,
                hasLoadedReferences: false,
            }),
        ).toEqual({
            shouldLoadChanges: true,
            shouldLoadReferences: false,
        });
    });

    it("loads references when user switches to references tab", () => {
        expect(
            getSessionKnowledgeLoadState({
                visible: true,
                activeTab: "references",
                hasLoadedChanges: true,
                hasLoadedReferences: false,
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
                hasLoadedReferences: true,
            }),
        ).toEqual({
            shouldLoadChanges: false,
            shouldLoadReferences: false,
        });
    });
});
