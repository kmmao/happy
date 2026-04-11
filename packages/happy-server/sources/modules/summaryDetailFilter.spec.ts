import { describe, expect, it } from "vitest";

import {
    normalizeConcreteImplementationSummary,
    normalizeSuggestionFactText,
} from "./summaryDetailFilter";

describe("normalizeSuggestionFactText", () => {
    it("returns trimmed input when present", () => {
        expect(normalizeSuggestionFactText("  Planner task failed with syntax error  ", "Unknown error")).toBe("Planner task failed with syntax error");
    });

    it("falls back for empty fact text", () => {
        expect(normalizeSuggestionFactText("   ", "Unknown error")).toBe("Unknown error");
        expect(normalizeSuggestionFactText(null, "Unknown error")).toBe("Unknown error");
    });
});

describe("normalizeConcreteImplementationSummary", () => {
    it("rejects generic completion summaries", () => {
        expect(normalizeConcreteImplementationSummary("Completed the requested changes and verified everything works as expected.")).toBeNull();
        expect(normalizeConcreteImplementationSummary("Implemented the requested fix and all tests passed successfully.")).toBeNull();
    });

    it("rejects unstable or verification-only summaries", () => {
        expect(normalizeConcreteImplementationSummary("Waiting for user to confirm the next step.")).toBeNull();
        expect(normalizeConcreteImplementationSummary("Verified the auth regression tests pass.")).toBeNull();
    });

    it("keeps summaries with concrete implementation detail", () => {
        expect(normalizeConcreteImplementationSummary("Updated token refresh middleware to reuse cached signing key and verified the auth regression tests pass.")).toBe("Updated token refresh middleware to reuse cached signing key and verified the auth regression tests pass.");
        expect(normalizeConcreteImplementationSummary("Added exponential backoff to the retry loop and capped delay at 5s.")).toBe("Added exponential backoff to the retry loop and capped delay at 5s.");
        expect(normalizeConcreteImplementationSummary("Fixed auth callback race by reusing cached nonce.")).toBe("Fixed auth callback race by reusing cached nonce.");
        expect(normalizeConcreteImplementationSummary("Fixed the auth token refresh issue by updating the middleware.")).toBe("Fixed the auth token refresh issue by updating the middleware.");
        expect(normalizeConcreteImplementationSummary("Fixed the requested auth refresh issue by updating the middleware and verified everything works as expected.")).toBe("Fixed the requested auth refresh issue by updating the middleware and verified everything works as expected.");
    });

    it("keeps mixed summaries when concrete detail appears after generic filler", () => {
        expect(normalizeConcreteImplementationSummary("Completed the requested changes: updated token refresh middleware to reuse cached signing key, and verified everything works as expected.")).toBe("Completed the requested changes: updated token refresh middleware to reuse cached signing key, and verified everything works as expected.");
        expect(normalizeConcreteImplementationSummary("Completed OAuth callback flow hardening and verified the auth regression tests pass.")).toBe("Completed OAuth callback flow hardening and verified the auth regression tests pass.");
    });

    it("keeps common implementation summaries outside the original narrow verb list", () => {
        expect(normalizeConcreteImplementationSummary("Improved retry scheduling after queue starvation." )).toBe("Improved retry scheduling after queue starvation.");
        expect(normalizeConcreteImplementationSummary("Switched auth refresh to cached JWKS." )).toBe("Switched auth refresh to cached JWKS.");
        expect(normalizeConcreteImplementationSummary("Extracted token parsing into shared validator." )).toBe("Extracted token parsing into shared validator.");
    });
});
