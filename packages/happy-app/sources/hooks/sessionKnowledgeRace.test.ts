import { describe, expect, it } from "vitest";
import { shouldApplyKnowledgeRequestResult } from "./sessionKnowledgeState";

describe("shouldApplyKnowledgeRequestResult", () => {
    it("applies result when request token matches latest token", () => {
        expect(
            shouldApplyKnowledgeRequestResult({
                requestToken: 2,
                latestRequestToken: 2,
            }),
        ).toBe(true);
    });

    it("ignores stale result when request token is older than latest token", () => {
        expect(
            shouldApplyKnowledgeRequestResult({
                requestToken: 1,
                latestRequestToken: 2,
            }),
        ).toBe(false);
    });
});
