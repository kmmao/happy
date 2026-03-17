import { describe, it, expect } from "vitest";
import {
    extractRepoUrl,
    normalizeRepoUrl,
    labelsMatch,
    authorAllowed,
} from "./webhookDispatch";

// ── extractRepoUrl ────────────────────────────────────────

describe("extractRepoUrl", () => {
    describe("GitHub", () => {
        it("should extract repo URL from GitHub webhook body", () => {
            const body = {
                repository: { html_url: "https://github.com/owner/repo" },
            };
            expect(extractRepoUrl("github", body)).toBe(
                "https://github.com/owner/repo",
            );
        });

        it("should return null when repository is missing", () => {
            expect(extractRepoUrl("github", {})).toBeNull();
        });

        it("should return null when html_url is missing", () => {
            expect(extractRepoUrl("github", { repository: {} })).toBeNull();
        });
    });

    describe("Gitea", () => {
        it("should extract repo URL from Gitea webhook body", () => {
            const body = {
                repository: {
                    html_url: "https://gitea.example.com/owner/repo",
                },
            };
            expect(extractRepoUrl("gitea", body)).toBe(
                "https://gitea.example.com/owner/repo",
            );
        });
    });

    describe("GitLab", () => {
        it("should extract repo URL from GitLab webhook body", () => {
            const body = {
                project: { web_url: "https://gitlab.com/owner/repo" },
            };
            expect(extractRepoUrl("gitlab", body)).toBe(
                "https://gitlab.com/owner/repo",
            );
        });

        it("should return null when project is missing", () => {
            expect(extractRepoUrl("gitlab", {})).toBeNull();
        });
    });

    it("should return null for unknown provider", () => {
        expect(
            extractRepoUrl("bitbucket", {
                repository: { html_url: "https://example.com/repo" },
            }),
        ).toBeNull();
    });

    it("should handle null body gracefully", () => {
        expect(extractRepoUrl("github", null)).toBeNull();
    });
});

// ── normalizeRepoUrl ──────────────────────────────────────

describe("normalizeRepoUrl", () => {
    it("should lowercase the URL", () => {
        expect(normalizeRepoUrl("https://GitHub.com/Owner/Repo")).toBe(
            "https://github.com/owner/repo",
        );
    });

    it("should remove trailing .git suffix", () => {
        expect(normalizeRepoUrl("https://github.com/owner/repo.git")).toBe(
            "https://github.com/owner/repo",
        );
    });

    it("should remove trailing slashes", () => {
        expect(normalizeRepoUrl("https://github.com/owner/repo///")).toBe(
            "https://github.com/owner/repo",
        );
    });

    it("should handle trailing slash after .git (removes slash, .git remains)", () => {
        // .git$ won't match when URL ends with /, so only slash is removed
        expect(normalizeRepoUrl("https://github.com/owner/repo.git/")).toBe(
            "https://github.com/owner/repo.git",
        );
    });

    it("should handle already-normalized URLs", () => {
        expect(normalizeRepoUrl("https://github.com/owner/repo")).toBe(
            "https://github.com/owner/repo",
        );
    });

    it("should not remove .git from middle of URL", () => {
        expect(normalizeRepoUrl("https://github.com/owner/repo.github")).toBe(
            "https://github.com/owner/repo.github",
        );
    });
});

// ── labelsMatch ───────────────────────────────────────────

describe("labelsMatch", () => {
    it("should match any issue when route has no label filter", () => {
        expect(labelsMatch(["bug", "feature"], [])).toBe(true);
    });

    it("should match any issue (even no labels) when route has no filter", () => {
        expect(labelsMatch([], [])).toBe(true);
    });

    it("should match when issue has a matching label", () => {
        expect(labelsMatch(["bug", "auto-fix"], ["auto-fix"])).toBe(true);
    });

    it("should not match when issue has no matching labels", () => {
        expect(labelsMatch(["bug", "feature"], ["auto-fix"])).toBe(false);
    });

    it("should be case-sensitive on issue labels (only route labels are lowercased)", () => {
        // Route labels are lowercased, but issue labels are compared as-is
        expect(labelsMatch(["Auto-Fix"], ["auto-fix"])).toBe(false);
        expect(labelsMatch(["auto-fix"], ["Auto-Fix"])).toBe(true);
    });

    it("should handle comma-separated route labels", () => {
        expect(labelsMatch(["feature"], ["bug, feature"])).toBe(true);
    });

    it("should handle multiple comma-separated route labels", () => {
        expect(labelsMatch(["auto-fix"], ["bug,auto-fix,feature"])).toBe(true);
    });

    it("should not match when no issue labels overlap", () => {
        expect(labelsMatch([], ["auto-fix"])).toBe(false);
    });

    it("should trim whitespace in route labels", () => {
        expect(labelsMatch(["bug"], ["  bug  "])).toBe(true);
    });

    it("should filter empty strings from route labels", () => {
        expect(labelsMatch(["bug"], [",,,bug,,,"])).toBe(true);
    });
});

// ── authorAllowed ─────────────────────────────────────────

describe("authorAllowed", () => {
    it("should allow any author when allowed list is empty", () => {
        expect(authorAllowed("anyone", [])).toBe(true);
    });

    it("should allow an author in the allowed list", () => {
        expect(authorAllowed("alice", ["alice", "bob"])).toBe(true);
    });

    it("should reject an author not in the allowed list", () => {
        expect(authorAllowed("charlie", ["alice", "bob"])).toBe(false);
    });

    it("should be case-insensitive", () => {
        expect(authorAllowed("Alice", ["alice"])).toBe(true);
    });

    it("should trim whitespace in allowed authors", () => {
        expect(authorAllowed("alice", ["  alice  "])).toBe(true);
    });

    it("should handle single allowed author", () => {
        expect(authorAllowed("bob", ["bob"])).toBe(true);
    });
});
