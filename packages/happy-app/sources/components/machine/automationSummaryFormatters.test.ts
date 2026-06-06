import { describe, expect, it, vi } from "vitest";

// Stub @/text so we don't pull React Native's index.js into the bundler.
// `t(key, params?)` returns a stable, assertable sentinel — the key itself
// for parameterless calls and `key|<json>` for parameterised calls. This
// keeps the assertions checking helper behaviour (which key + which params)
// rather than English copy, which is the right contract for i18n code.
vi.mock("@/text", () => ({
    t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}|${JSON.stringify(params)}` : key,
}));

import {
    formatRate,
    getGuardianStateLabel,
    getJobSubtitle,
    getJobTitle,
    getStatusColor,
    getStatusLabel,
    truncateGuardianKey,
    type AutomationJobLike,
} from "./automationSummaryFormatters";

function makeJob(overrides: Partial<AutomationJobLike>): AutomationJobLike {
    return {
        id: "job-1",
        dedupeKey: "key-1",
        status: "queued",
        updatedAt: 1_700_000_000_000,
        ...overrides,
    };
}

describe("truncateGuardianKey", () => {
    it("keeps the agent-loop: prefix and trims the suffix to 8 chars", () => {
        expect(truncateGuardianKey("agent-loop:abcdefghijklmnop"))
            .toBe("agent-loop:abcdefgh");
    });

    it("returns the key unchanged when no agent-loop prefix is present", () => {
        expect(truncateGuardianKey("custom:somekey")).toBe("custom:somekey");
    });

    it("does not crash on keys shorter than the prefix length", () => {
        // 'agent-loop:abc' has only 3 chars after the prefix — slicing past
        // the end is fine in JS but worth pinning down for the summary card.
        expect(truncateGuardianKey("agent-loop:abc")).toBe("agent-loop:abc");
    });
});

describe("getStatusLabel", () => {
    it("maps each known status to its i18n key", () => {
        expect(getStatusLabel("queued")).toBe("machine.automationQueued");
        expect(getStatusLabel("completed")).toBe("machine.automationCompleted");
        expect(getStatusLabel("failed")).toBe("machine.automationFailed");
        expect(getStatusLabel("cancelled")).toBe("machine.automationCancelled");
    });

    it("collapses dispatching and running into the same key", () => {
        expect(getStatusLabel("dispatching")).toBe("machine.automationRunning");
        expect(getStatusLabel("running")).toBe("machine.automationRunning");
    });

    it("passes unknown statuses through verbatim", () => {
        expect(getStatusLabel("blocked")).toBe("blocked");
        expect(getStatusLabel("")).toBe("");
    });
});

describe("getStatusColor", () => {
    it("returns brand colors for each known status", () => {
        expect(getStatusColor("queued")).toBe("#FF9500");
        expect(getStatusColor("running")).toBe("#0A84FF");
        expect(getStatusColor("dispatching")).toBe("#0A84FF");
        expect(getStatusColor("completed")).toBe("#34C759");
        expect(getStatusColor("failed")).toBe("#FF3B30");
        expect(getStatusColor("cancelled")).toBe("#8E8E93");
    });

    it("returns undefined for unknown status (caller falls back to theme)", () => {
        expect(getStatusColor("blocked")).toBeUndefined();
        expect(getStatusColor("")).toBeUndefined();
    });
});

describe("getJobTitle", () => {
    it("prefers label when present", () => {
        const job = makeJob({ label: "Daily Cleanup", dedupeKey: "supervisor:cleanup" });
        expect(getJobTitle(job)).toBe("Daily Cleanup");
    });

    it("falls back to dedupeKey when label is missing", () => {
        const job = makeJob({ dedupeKey: "supervisor:cleanup" });
        expect(getJobTitle(job)).toBe("supervisor:cleanup");
    });

    it("treats empty-string label as missing", () => {
        const job = makeJob({ label: "", dedupeKey: "supervisor:cleanup" });
        expect(getJobTitle(job)).toBe("supervisor:cleanup");
    });
});

describe("getJobSubtitle", () => {
    it("returns errorMessage verbatim when present (it pre-empts all other stanzas)", () => {
        const job = makeJob({
            errorMessage: "Daemon exited unexpectedly",
            loopIteration: 3,
            sessionId: "abc-def-ghi",
            recovered: true,
        });
        expect(getJobSubtitle(job)).toBe("Daemon exited unexpectedly");
    });

    it("includes loopIteration stanza when present (with current param)", () => {
        const job = makeJob({ loopIteration: 5 });
        expect(getJobSubtitle(job)).toContain(
            "supervisor.loopIterationUnlimited|{\"current\":5}",
        );
    });

    it("shortens continuityKey to prefix + 8 chars for agent-loop:* keys", () => {
        const job = makeJob({ continuityKey: "agent-loop:abcdefghijklmnop" });
        expect(getJobSubtitle(job)).toContain("agent-loop:abcdefgh");
    });

    it("uses raw continuityKey when it doesn't match the agent-loop prefix", () => {
        const job = makeJob({ continuityKey: "custom-key:xyz" });
        expect(getJobSubtitle(job)).toContain("custom-key:xyz");
    });

    it("truncates sessionId to 12 chars + ellipsis", () => {
        const job = makeJob({ sessionId: "abcdefghijklmnopqrstuvwxyz" });
        const subtitle = getJobSubtitle(job);
        expect(subtitle).toContain("abcdefghijkl…");
        expect(subtitle).not.toContain("abcdefghijklm");
    });

    it("appends the 'recovered' indicator when the job was recovered", () => {
        const job = makeJob({ recovered: true });
        expect(getJobSubtitle(job)).toContain("machine.automationRecoveredShort");
    });

    it("joins all stanzas with ' • '", () => {
        const job = makeJob({
            loopIteration: 2,
            sessionId: "session-id-1",
            recovered: true,
        });
        const stanzas = getJobSubtitle(job).split(" • ");
        expect(stanzas.length).toBe(3);
    });

    it("falls back to formatted updatedAt when no optional stanzas are present", () => {
        const job = makeJob({ updatedAt: 1_700_000_000_000 });
        const subtitle = getJobSubtitle(job);
        // The exact locale string varies by runtime; what matters is that
        // we always produce something parseable as a date — the empty
        // string would be a bug (the summary card would collapse).
        expect(subtitle.length).toBeGreaterThan(0);
        expect(Number.isFinite(new Date(subtitle).getTime())).toBe(true);
    });
});

describe("getGuardianStateLabel", () => {
    it("returns the 'recovered' label only when attached AND recovered", () => {
        expect(getGuardianStateLabel(true, true)).toBe(
            "machine.automationGuardianRecovered",
        );
    });

    it("returns 'attached' when attached but not recovered", () => {
        expect(getGuardianStateLabel(true, false)).toBe(
            "machine.automationGuardianAttached",
        );
        expect(getGuardianStateLabel(true, undefined)).toBe(
            "machine.automationGuardianAttached",
        );
    });

    it("returns 'persisted' when not attached, regardless of recovered flag", () => {
        expect(getGuardianStateLabel(false, true)).toBe(
            "machine.automationGuardianPersisted",
        );
        expect(getGuardianStateLabel(false, false)).toBe(
            "machine.automationGuardianPersisted",
        );
        expect(getGuardianStateLabel(undefined, undefined)).toBe(
            "machine.automationGuardianPersisted",
        );
    });
});

describe("formatRate", () => {
    it("formats a 0..1 number as a rounded percentage", () => {
        expect(formatRate(0)).toBe("0%");
        expect(formatRate(0.5)).toBe("50%");
        expect(formatRate(1)).toBe("100%");
    });

    it("rounds (rather than truncates) intermediate values", () => {
        expect(formatRate(0.494)).toBe("49%");
        expect(formatRate(0.495)).toBe("50%");
        expect(formatRate(0.999)).toBe("100%");
    });

    it("treats null/undefined/NaN as 0% so the audit row never blanks out", () => {
        expect(formatRate(undefined)).toBe("0%");
        expect(formatRate(NaN)).toBe("0%");
    });
});
