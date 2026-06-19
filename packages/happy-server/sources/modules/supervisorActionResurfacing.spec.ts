import { describe, it, expect } from "vitest";
import {
    classifyReportedActions,
    type ExistingActionRow,
} from "./supervisorActionResurfacing";

interface Finding {
    category: string;
    title: string;
    severity: "critical" | "high" | "medium" | "low";
    description: string;
}

function finding(category: string, title: string, severity: Finding["severity"] = "low"): Finding {
    return { category, title, severity, description: `${title} desc` };
}

function existing(id: string, category: string, title: string, approval: string): ExistingActionRow {
    return { id, category, title, approval };
}

describe("classifyReportedActions", () => {
    it("creates fresh actions when nothing matches", () => {
        const plan = classifyReportedActions([finding("security", "SQLi")], []);
        expect(plan.toCreate).toHaveLength(1);
        expect(plan.toUpdatePending).toHaveLength(0);
        expect(plan.toRestoreFromSkip).toHaveLength(0);
        expect(plan.toSuppressIgnored).toHaveLength(0);
    });

    it("updates in place when matching a pending action", () => {
        const plan = classifyReportedActions(
            [finding("security", "SQLi")],
            [existing("a1", "security", "SQLi", "pending")],
        );
        expect(plan.toCreate).toHaveLength(0);
        expect(plan.toUpdatePending).toEqual([
            { id: "a1", action: finding("security", "SQLi") },
        ]);
    });

    it("restores a skipped action to pending when the finding returns", () => {
        const plan = classifyReportedActions(
            [finding("techDebt", "dup code")],
            [existing("a2", "techDebt", "dup code", "skipped")],
        );
        expect(plan.toRestoreFromSkip).toEqual([
            { id: "a2", action: finding("techDebt", "dup code") },
        ]);
        expect(plan.toCreate).toHaveLength(0);
    });

    it("suppresses (id only) when matching an ignored action — stays ignored", () => {
        const plan = classifyReportedActions(
            [finding("codeQuality", "long fn")],
            [existing("a3", "codeQuality", "long fn", "ignored")],
        );
        expect(plan.toSuppressIgnored).toEqual([{ id: "a3" }]);
        expect(plan.toRestoreFromSkip).toHaveLength(0);
        expect(plan.toCreate).toHaveLength(0);
    });

    it("keys on category::title — same title in a different category is a fresh action", () => {
        const plan = classifyReportedActions(
            [finding("security", "leak")],
            [existing("a4", "techDebt", "leak", "pending")],
        );
        expect(plan.toCreate).toHaveLength(1);
        expect(plan.toUpdatePending).toHaveLength(0);
    });

    it("when several open rows share a key, pending > skipped > ignored wins", () => {
        const plan = classifyReportedActions(
            [finding("security", "XSS")],
            [
                existing("ignored-row", "security", "XSS", "ignored"),
                existing("pending-row", "security", "XSS", "pending"),
                existing("skipped-row", "security", "XSS", "skipped"),
            ],
        );
        // pending wins regardless of input order → update in place.
        expect(plan.toUpdatePending).toEqual([
            { id: "pending-row", action: finding("security", "XSS") },
        ]);
        expect(plan.toRestoreFromSkip).toHaveLength(0);
        expect(plan.toSuppressIgnored).toHaveLength(0);
    });

    it("for equal-priority rows of the same key, the first in input order wins (most recent)", () => {
        const plan = classifyReportedActions(
            [finding("security", "XSS")],
            [
                existing("recent-skip", "security", "XSS", "skipped"),
                existing("older-skip", "security", "XSS", "skipped"),
            ],
        );
        expect(plan.toRestoreFromSkip).toEqual([
            { id: "recent-skip", action: finding("security", "XSS") },
        ]);
    });

    it("classifies a mixed batch independently per finding", () => {
        const plan = classifyReportedActions(
            [
                finding("security", "new one"),
                finding("security", "pending one"),
                finding("techDebt", "skipped one"),
                finding("codeQuality", "ignored one"),
            ],
            [
                existing("p1", "security", "pending one", "pending"),
                existing("s1", "techDebt", "skipped one", "skipped"),
                existing("i1", "codeQuality", "ignored one", "ignored"),
            ],
        );
        expect(plan.toCreate.map((a) => a.title)).toEqual(["new one"]);
        expect(plan.toUpdatePending.map((u) => u.id)).toEqual(["p1"]);
        expect(plan.toRestoreFromSkip.map((u) => u.id)).toEqual(["s1"]);
        expect(plan.toSuppressIgnored.map((u) => u.id)).toEqual(["i1"]);
    });
});
