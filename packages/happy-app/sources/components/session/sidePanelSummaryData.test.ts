import { describe, expect, it } from "vitest";
import {
    buildKnowledgeSummaryRows,
    type KnowledgeSummaryRow,
} from "./sidePanelSummaryData";

function findRow(rows: KnowledgeSummaryRow[], label: string) {
    return rows.find((row) => row.label === label);
}

const testTranslate = (
    key:
        | "sidePanel.knowledgeCaptured"
        | "sidePanel.knowledgeReferenced"
        | "sidePanel.knowledgeCapturedValue"
        | "sidePanel.knowledgeReferencedValue"
        | "sidePanel.knowledgeLatestPrefix"
        | "sidePanel.knowledgeHitSuffix"
        | "sidePanel.knowledgeHotSuffix",
    params?: { count?: number },
): string => {
    const count = String(params?.count ?? "");
    switch (key) {
        case "sidePanel.knowledgeCaptured":
            return "Knowledge";
        case "sidePanel.knowledgeReferenced":
            return "Knowledge Used";
        case "sidePanel.knowledgeCapturedValue":
            return `${count} captured`;
        case "sidePanel.knowledgeReferencedValue":
            return `${count} referenced`;
        case "sidePanel.knowledgeLatestPrefix":
            return "latest";
        case "sidePanel.knowledgeHitSuffix":
            return ` · ${count} hit`;
        case "sidePanel.knowledgeHotSuffix":
            return ` · ${count} hot`;
    }
};

describe("buildKnowledgeSummaryRows", () => {
    it("returns captured and referenced rows with latest titles", () => {
        const rows = buildKnowledgeSummaryRows({
            knowledgeCount: 3,
            capturedEntries: [
                {
                    id: "entry-1",
                    title: "Earlier discovery",
                    createdAt: 100,
                },
                {
                    id: "entry-2",
                    title: "Latest fix",
                    createdAt: 200,
                },
            ],
            referencedEntries: [
                {
                    id: "ref-1",
                    title: "Referenced convention",
                    createdAt: 150,
                },
            ],
            t: testTranslate,
        });

        expect(findRow(rows, "Knowledge")).toEqual({
            icon: "database",
            label: "Knowledge",
            value: "3 captured · latest: Latest fix",
            isInteractive: true,
        });
        expect(findRow(rows, "Knowledge Used")).toEqual({
            icon: "link",
            label: "Knowledge Used",
            value: "1 referenced · latest: Referenced convention",
            isInteractive: true,
        });
    });

    it("returns no rows when there is no knowledge activity", () => {
        const rows = buildKnowledgeSummaryRows({
            knowledgeCount: 0,
            capturedEntries: [],
            referencedEntries: [],
            t: testTranslate,
        });

        expect(rows).toEqual([]);
    });

    it("uses entry lengths when realtime count is unavailable", () => {
        const rows = buildKnowledgeSummaryRows({
            knowledgeCount: 0,
            capturedEntries: [
                {
                    id: "entry-1",
                    title: "Only captured item",
                    createdAt: 100,
                },
            ],
            referencedEntries: [],
            t: testTranslate,
        });

        expect(rows).toEqual([
            {
                icon: "database",
                label: "Knowledge",
                value: "1 captured · latest: Only captured item",
                isInteractive: true,
            },
        ]);
    });
});
