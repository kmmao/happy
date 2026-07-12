import { describe, it, expect } from "vitest";
import { parseGithubPrUrl } from "./parseGithubPrUrl";

describe("parseGithubPrUrl", () => {
    it("extracts owner/repo/number from a PR url", () => {
        expect(
            parseGithubPrUrl("Opened https://github.com/kmmao/happy/pull/132 as draft"),
        ).toEqual({ owner: "kmmao", repo: "happy", number: 132 });
    });

    it("handles repos with dots and dashes", () => {
        expect(
            parseGithubPrUrl("see github.com/my-org/my.repo/pull/7"),
        ).toEqual({ owner: "my-org", repo: "my.repo", number: 7 });
    });

    it("returns the first match when several are present", () => {
        expect(
            parseGithubPrUrl("github.com/a/b/pull/1 and github.com/c/d/pull/2"),
        ).toEqual({ owner: "a", repo: "b", number: 1 });
    });

    it("returns null when there is no PR url", () => {
        expect(parseGithubPrUrl("just some text")).toBeNull();
        expect(parseGithubPrUrl("github.com/a/b/issues/3")).toBeNull();
        expect(parseGithubPrUrl(null)).toBeNull();
        expect(parseGithubPrUrl(undefined)).toBeNull();
    });
});
