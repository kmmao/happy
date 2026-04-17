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

        expect(findRow(rows, "Knowledge")).toMatchObject({
            icon: "database",
            label: "Knowledge",
            value: "3 captured · latest: Latest fix",
            isInteractive: true,
        });
        expect(findRow(rows, "Knowledge Used")).toMatchObject({
            icon: "link",
            label: "Knowledge Used",
            value: "1 referenced · latest: Referenced convention · 0 hit · 0 hot",
            isInteractive: true,
        });
    });

    it("always renders the referenced row (zero state) so users see current activity", () => {
        const rows = buildKnowledgeSummaryRows({
            knowledgeCount: 0,
            capturedEntries: [],
            referencedEntries: [],
            t: testTranslate,
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            icon: "link",
            label: "Knowledge Used",
            value: "0 referenced",
            isInteractive: true,
        });
    });

    it("renders captured row alongside zero-state referenced row", () => {
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

        expect(rows).toHaveLength(2);
        expect(findRow(rows, "Knowledge")).toMatchObject({
            icon: "database",
            value: "1 captured · latest: Only captured item",
        });
        expect(findRow(rows, "Knowledge Used")).toMatchObject({
            icon: "link",
            value: "0 referenced",
        });
    });

    it("appends TTL hit/hot suffix when server reports TTL fields", () => {
        const rows = buildKnowledgeSummaryRows({
            knowledgeCount: 0,
            capturedEntries: [],
            referencedEntries: [
                {
                    id: "a",
                    title: "Hot entry",
                    createdAt: 100,
                    hitCount: 2,
                    hotStatus: "hot",
                },
                {
                    id: "b",
                    title: "Evicted entry",
                    createdAt: 110,
                    hitCount: 0,
                    hotStatus: "evicted",
                },
            ],
            t: testTranslate,
        });

        const used = findRow(rows, "Knowledge Used");
        expect(used?.value).toContain("2 referenced");
        expect(used?.value).toContain("1 hit");
        expect(used?.value).toContain("1 hot");
    });
});
