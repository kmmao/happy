import { describe, it, expect } from "vitest";
import {
  parseWebhookPRMerge,
  parseWebhookIssue,
  getEventTypeHeader,
  getDeliveryId,
} from "./webhookParsers";

// ── PR Merge Parsing ──────────────────────────────────────

describe("parseWebhookPRMerge", () => {
  // ── GitHub ─────────────────────────────────────────

  describe("GitHub", () => {
    it("should parse a merged pull request", () => {
      const body = {
        action: "closed",
        pull_request: {
          number: 42,
          title: "Add feature X",
          html_url: "https://github.com/owner/repo/pull/42",
          merged: true,
          merged_by: { login: "merger-user" },
          head: { ref: "feature/add-x" },
          body: "Fixes #10\nAlso closes #20",
        },
        repository: { html_url: "https://github.com/owner/repo" },
      };

      const result = parseWebhookPRMerge("github", body, "pull_request");

      expect(result).toEqual({
        prNumber: 42,
        prTitle: "Add feature X",
        prUrl: "https://github.com/owner/repo/pull/42",
        mergedBy: "merger-user",
        headBranch: "feature/add-x",
        repoUrl: "https://github.com/owner/repo",
        linkedIssueNumbers: [10, 20],
      });
    });

    it("should return null for non-merged closed PR", () => {
      const body = {
        action: "closed",
        pull_request: {
          number: 42,
          merged: false,
          head: { ref: "branch" },
          body: "Fixes #10",
        },
        repository: { html_url: "https://github.com/owner/repo" },
      };

      expect(parseWebhookPRMerge("github", body, "pull_request")).toBeNull();
    });

    it("should return null for non-pull_request event type", () => {
      const body = {
        action: "closed",
        pull_request: { merged: true },
      };

      expect(parseWebhookPRMerge("github", body, "issues")).toBeNull();
    });

    it("should return null for non-closed action", () => {
      const body = {
        action: "opened",
        pull_request: { merged: true },
      };

      expect(parseWebhookPRMerge("github", body, "pull_request")).toBeNull();
    });

    it("should fallback to sender login when merged_by is missing", () => {
      const body = {
        action: "closed",
        pull_request: {
          number: 1,
          title: "PR",
          html_url: "https://github.com/o/r/pull/1",
          merged: true,
          head: { ref: "main" },
          body: "Fixes #5",
        },
        sender: { login: "sender-user" },
        repository: { html_url: "https://github.com/o/r" },
      };

      const result = parseWebhookPRMerge("github", body, "pull_request");
      expect(result?.mergedBy).toBe("sender-user");
    });
  });

  // ── Gitea ──────────────────────────────────────────

  describe("Gitea", () => {
    it("should parse a merged pull request", () => {
      const body = {
        action: "closed",
        pull_request: {
          number: 7,
          title: "Fix bug",
          html_url: "https://gitea.example.com/owner/repo/pulls/7",
          merged: true,
          merged_by: { login: "gitea-user" },
          head: { ref: "fix/7-crash" },
          body: "Resolves #7",
        },
        repository: { html_url: "https://gitea.example.com/owner/repo" },
      };

      const result = parseWebhookPRMerge("gitea", body, "pull_request");

      expect(result).toEqual({
        prNumber: 7,
        prTitle: "Fix bug",
        prUrl: "https://gitea.example.com/owner/repo/pulls/7",
        mergedBy: "gitea-user",
        headBranch: "fix/7-crash",
        repoUrl: "https://gitea.example.com/owner/repo",
        linkedIssueNumbers: [7],
      });
    });

    it("should return null for non-merged PR", () => {
      const body = {
        action: "closed",
        pull_request: { merged: false, head: { ref: "x" }, body: "" },
      };

      expect(parseWebhookPRMerge("gitea", body, "pull_request")).toBeNull();
    });
  });

  // ── GitLab ─────────────────────────────────────────

  describe("GitLab", () => {
    it("should parse a merged merge request", () => {
      const body = {
        object_attributes: {
          iid: 99,
          title: "Add dark mode",
          url: "https://gitlab.com/owner/repo/-/merge_requests/99",
          state: "merged",
          action: "merge",
          description: "Closes #15\nFixes #16",
          source_branch: "feature/15-dark-mode",
        },
        user: { username: "gl-user" },
        project: { web_url: "https://gitlab.com/owner/repo" },
      };

      const result = parseWebhookPRMerge("gitlab", body, "Merge Request Hook");

      expect(result).toEqual({
        prNumber: 99,
        prTitle: "Add dark mode",
        prUrl: "https://gitlab.com/owner/repo/-/merge_requests/99",
        mergedBy: "gl-user",
        headBranch: "feature/15-dark-mode",
        repoUrl: "https://gitlab.com/owner/repo",
        linkedIssueNumbers: [15, 16],
      });
    });

    it("should return null for non-merged state", () => {
      const body = {
        object_attributes: { state: "opened", action: "open" },
      };

      expect(
        parseWebhookPRMerge("gitlab", body, "Merge Request Hook"),
      ).toBeNull();
    });

    it("should return null for wrong event type", () => {
      const body = {
        object_attributes: { state: "merged", action: "merge" },
      };

      expect(parseWebhookPRMerge("gitlab", body, "Issue Hook")).toBeNull();
    });

    it("should return null for merge state but non-merge action", () => {
      const body = {
        object_attributes: { state: "merged", action: "update" },
      };

      expect(
        parseWebhookPRMerge("gitlab", body, "Merge Request Hook"),
      ).toBeNull();
    });
  });

  // ── Unknown provider ───────────────────────────────

  it("should return null for unknown provider", () => {
    expect(parseWebhookPRMerge("bitbucket", {}, "pull_request")).toBeNull();
  });

  // ── Issue number extraction (via parseWebhookPRMerge) ──

  describe("extractLinkedIssueNumbers (via GitHub PR)", () => {
    function parseGitHubPR(prBody: string, headBranch: string) {
      return parseWebhookPRMerge(
        "github",
        {
          action: "closed",
          pull_request: {
            number: 1,
            title: "t",
            html_url: "https://github.com/o/r/pull/1",
            merged: true,
            head: { ref: headBranch },
            body: prBody,
          },
          repository: { html_url: "https://github.com/o/r" },
        },
        "pull_request",
      );
    }

    // ── PR body patterns ──

    it("should extract 'Fixes #N'", () => {
      const result = parseGitHubPR("Fixes #42", "main");
      expect(result?.linkedIssueNumbers).toEqual([42]);
    });

    it("should extract 'Fixed #N'", () => {
      const result = parseGitHubPR("Fixed #100", "main");
      expect(result?.linkedIssueNumbers).toEqual([100]);
    });

    it("should extract 'Fix #N'", () => {
      const result = parseGitHubPR("Fix #5", "main");
      expect(result?.linkedIssueNumbers).toEqual([5]);
    });

    it("should extract 'Closes #N'", () => {
      const result = parseGitHubPR("Closes #33", "main");
      expect(result?.linkedIssueNumbers).toEqual([33]);
    });

    it("should extract 'Closed #N'", () => {
      const result = parseGitHubPR("Closed #77", "main");
      expect(result?.linkedIssueNumbers).toEqual([77]);
    });

    it("should extract 'Close #N'", () => {
      const result = parseGitHubPR("Close #8", "main");
      expect(result?.linkedIssueNumbers).toEqual([8]);
    });

    it("should extract 'Resolves #N'", () => {
      const result = parseGitHubPR("Resolves #12", "main");
      expect(result?.linkedIssueNumbers).toEqual([12]);
    });

    it("should extract 'Resolved #N'", () => {
      const result = parseGitHubPR("Resolved #3", "main");
      expect(result?.linkedIssueNumbers).toEqual([3]);
    });

    it("should extract 'Resolve #N'", () => {
      const result = parseGitHubPR("Resolve #9", "main");
      expect(result?.linkedIssueNumbers).toEqual([9]);
    });

    it("should be case-insensitive", () => {
      const result = parseGitHubPR("FIXES #1\ncloses #2\nResolves #3", "main");
      expect(result?.linkedIssueNumbers).toEqual(
        expect.arrayContaining([1, 2, 3]),
      );
      expect(result?.linkedIssueNumbers).toHaveLength(3);
    });

    it("should extract multiple issues from body", () => {
      const result = parseGitHubPR(
        "Fixes #10, closes #20\nResolves #30",
        "main",
      );
      expect(result?.linkedIssueNumbers).toEqual(
        expect.arrayContaining([10, 20, 30]),
      );
      expect(result?.linkedIssueNumbers).toHaveLength(3);
    });

    it("should deduplicate issue numbers", () => {
      const result = parseGitHubPR("Fixes #5\nCloses #5", "main");
      expect(result?.linkedIssueNumbers).toEqual([5]);
    });

    it("should return empty when no keywords match", () => {
      const result = parseGitHubPR(
        "This PR adds a new feature for #42",
        "main",
      );
      expect(result?.linkedIssueNumbers).toEqual([]);
    });

    // ── Branch name patterns ──

    it("should extract from 'issue-N' branch", () => {
      const result = parseGitHubPR("", "issue-123");
      expect(result?.linkedIssueNumbers).toEqual([123]);
    });

    it("should extract from 'issue/N' branch", () => {
      const result = parseGitHubPR("", "issue/456");
      expect(result?.linkedIssueNumbers).toEqual([456]);
    });

    it("should extract from 'fix-N' branch", () => {
      const result = parseGitHubPR("", "fix-789");
      expect(result?.linkedIssueNumbers).toEqual([789]);
    });

    it("should extract from 'fix/N' branch", () => {
      const result = parseGitHubPR("", "fix/11");
      expect(result?.linkedIssueNumbers).toEqual([11]);
    });

    it("should extract from 'feat-N' branch", () => {
      const result = parseGitHubPR("", "feat-22");
      expect(result?.linkedIssueNumbers).toEqual([22]);
    });

    it("should extract from 'feature/N-description' branch", () => {
      const result = parseGitHubPR("", "feature/33-add-login");
      expect(result?.linkedIssueNumbers).toEqual([33]);
    });

    it("should extract from 'bug-N' branch", () => {
      const result = parseGitHubPR("", "bug-44");
      expect(result?.linkedIssueNumbers).toEqual([44]);
    });

    it("should extract from 'hotfix-N' branch", () => {
      const result = parseGitHubPR("", "hotfix-55");
      expect(result?.linkedIssueNumbers).toEqual([55]);
    });

    it("should extract from 'chore-N' branch", () => {
      const result = parseGitHubPR("", "chore-66");
      expect(result?.linkedIssueNumbers).toEqual([66]);
    });

    it("should extract from 'N-description' branch (leading number)", () => {
      const result = parseGitHubPR("", "77-some-feature");
      expect(result?.linkedIssueNumbers).toEqual([77]);
    });

    it("should extract from 'N/description' branch (leading number with slash)", () => {
      const result = parseGitHubPR("", "88/cleanup");
      expect(result?.linkedIssueNumbers).toEqual([88]);
    });

    it("should extract from worktree branch 'issue-N-word-word-hash'", () => {
      const result = parseGitHubPR("", "issue-31-agile-marble-5cf5");
      expect(result?.linkedIssueNumbers).toEqual([31]);
    });

    it("should not extract from random branch with numbers", () => {
      const result = parseGitHubPR("", "main");
      expect(result?.linkedIssueNumbers).toEqual([]);
    });

    // ── Combined body + branch ──

    it("should merge issues from both body and branch, deduped", () => {
      const result = parseGitHubPR("Fixes #10", "issue-10");
      expect(result?.linkedIssueNumbers).toEqual([10]);
    });

    it("should collect issues from both body and branch", () => {
      const result = parseGitHubPR("Fixes #10", "issue-20");
      expect(result?.linkedIssueNumbers).toEqual(
        expect.arrayContaining([10, 20]),
      );
      expect(result?.linkedIssueNumbers).toHaveLength(2);
    });

    // ── Missing/empty fields ──

    it("should handle empty body and branch", () => {
      const result = parseGitHubPR("", "");
      expect(result?.linkedIssueNumbers).toEqual([]);
    });

    it("should handle null body gracefully", () => {
      const result = parseWebhookPRMerge(
        "github",
        {
          action: "closed",
          pull_request: {
            number: 1,
            title: "t",
            html_url: "u",
            merged: true,
            head: { ref: "main" },
            body: null,
          },
          repository: { html_url: "https://github.com/o/r" },
        },
        "pull_request",
      );
      expect(result?.linkedIssueNumbers).toEqual([]);
    });
  });
});

// ── Issue Parsing (existing parseWebhookIssue) ────────────

describe("parseWebhookIssue", () => {
  describe("GitHub", () => {
    it("should parse an opened issue", () => {
      const body = {
        action: "opened",
        issue: {
          number: 25,
          title: "Bug report",
          body: "Something is broken",
          state: "open",
          user: { login: "reporter" },
          labels: [{ name: "bug" }, { name: "auto-fix" }],
          html_url: "https://github.com/o/r/issues/25",
        },
        repository: { html_url: "https://github.com/o/r" },
      };

      const result = parseWebhookIssue("github", body, "issues");

      expect(result).toEqual({
        issueNumber: 25,
        issueTitle: "Bug report",
        issueBody: "Something is broken",
        issueAuthor: "reporter",
        issueLabels: ["bug", "auto-fix"],
        issueUrl: "https://github.com/o/r/issues/25",
        repoUrl: "https://github.com/o/r",
        action: "opened",
      });
    });

    it("should parse a labeled issue", () => {
      const body = {
        action: "labeled",
        issue: {
          number: 1,
          title: "t",
          body: "b",
          state: "open",
          user: { login: "u" },
          labels: [{ name: "Auto-Fix" }],
          html_url: "url",
        },
        repository: { html_url: "repo" },
      };

      const result = parseWebhookIssue("github", body, "issues");
      expect(result?.action).toBe("labeled");
      expect(result?.issueLabels).toEqual(["auto-fix"]);
    });

    it("should return null for closed issue", () => {
      const body = {
        action: "opened",
        issue: { state: "closed", number: 1 },
      };

      expect(parseWebhookIssue("github", body, "issues")).toBeNull();
    });

    it("should return null for unsupported action", () => {
      const body = {
        action: "edited",
        issue: { state: "open", number: 1 },
      };

      expect(parseWebhookIssue("github", body, "issues")).toBeNull();
    });

    it("should return null for non-issues event type", () => {
      expect(parseWebhookIssue("github", {}, "push")).toBeNull();
    });
  });

  describe("Gitea", () => {
    it("should normalize label_updated to labeled", () => {
      const body = {
        action: "label_updated",
        issue: {
          number: 3,
          title: "t",
          body: "b",
          state: "open",
          user: { login: "u" },
          labels: [],
          html_url: "url",
        },
        label: { name: "auto-fix" },
        repository: { html_url: "repo" },
      };

      const result = parseWebhookIssue("gitea", body, "issue_label");
      expect(result?.action).toBe("labeled");
      expect(result?.issueLabels).toEqual(["auto-fix"]);
    });

    it("should merge body.label into issue.labels when label_updated", () => {
      const body = {
        action: "label_updated",
        issue: {
          number: 3,
          title: "t",
          body: "b",
          state: "open",
          user: { login: "u" },
          labels: [{ name: "existing" }],
          html_url: "url",
        },
        label: { name: "new-label" },
        repository: { html_url: "repo" },
      };

      const result = parseWebhookIssue("gitea", body, "issue_label");
      expect(result?.issueLabels).toEqual(["existing", "new-label"]);
    });

    it("should not duplicate label when already in issue.labels", () => {
      const body = {
        action: "label_updated",
        issue: {
          number: 3,
          title: "t",
          body: "b",
          state: "open",
          user: { login: "u" },
          labels: [{ name: "auto-fix" }],
          html_url: "url",
        },
        label: { name: "auto-fix" },
        repository: { html_url: "repo" },
      };

      const result = parseWebhookIssue("gitea", body, "issue_label");
      expect(result?.issueLabels).toEqual(["auto-fix"]);
    });
  });

  describe("GitLab", () => {
    it("should parse an opened issue", () => {
      const body = {
        object_attributes: {
          iid: 10,
          title: "GL issue",
          description: "desc",
          action: "open",
          state: "opened",
          url: "https://gitlab.com/o/r/-/issues/10",
        },
        user: { username: "gl-author" },
        labels: [{ title: "Auto-fix" }],
        project: { web_url: "https://gitlab.com/o/r" },
      };

      const result = parseWebhookIssue("gitlab", body, "Issue Hook");

      expect(result).toEqual({
        issueNumber: 10,
        issueTitle: "GL issue",
        issueBody: "desc",
        issueAuthor: "gl-author",
        issueLabels: ["auto-fix"],
        issueUrl: "https://gitlab.com/o/r/-/issues/10",
        repoUrl: "https://gitlab.com/o/r",
        action: "opened",
      });
    });

    it("should parse update with label changes as labeled", () => {
      const body = {
        object_attributes: {
          iid: 11,
          title: "t",
          description: "d",
          action: "update",
          state: "opened",
          url: "u",
        },
        user: { username: "u" },
        labels: [{ title: "bug" }],
        changes: { labels: { previous: [], current: [{ title: "bug" }] } },
        project: { web_url: "p" },
      };

      const result = parseWebhookIssue("gitlab", body, "Issue Hook");
      expect(result?.action).toBe("labeled");
    });

    it("should return null for update without label changes", () => {
      const body = {
        object_attributes: {
          iid: 11,
          title: "t",
          description: "d",
          action: "update",
          state: "opened",
          url: "u",
        },
        user: { username: "u" },
        labels: [],
        project: { web_url: "p" },
      };

      expect(parseWebhookIssue("gitlab", body, "Issue Hook")).toBeNull();
    });
  });

  it("should return null for unknown provider", () => {
    expect(parseWebhookIssue("bitbucket", {}, "issues")).toBeNull();
  });
});

// ── Full Flow: Issue Webhook → PR Merge → Session Archive ──

describe("webhook → worktree → PR merge flow", () => {
  it("step 1: webhook triggers issue parsing with correct data", () => {
    const body = {
      action: "labeled",
      issue: {
        number: 33,
        title: "test: verify session archive stays after PR merge",
        body: "Test to verify the full flow.",
        state: "open",
        user: { login: "kmmao" },
        labels: [{ name: "auto-fix" }],
        html_url: "https://github.com/kmmao/happy/issues/33",
      },
      repository: { html_url: "https://github.com/kmmao/happy" },
    };

    const result = parseWebhookIssue("github", body, "issues");

    expect(result).not.toBeNull();
    expect(result!.issueNumber).toBe(33);
    expect(result!.issueLabels).toEqual(["auto-fix"]);
    expect(result!.action).toBe("labeled");
  });

  it("step 2: PR with 'Fixes #N' links to the correct issue", () => {
    const body = {
      action: "closed",
      pull_request: {
        number: 34,
        title: "test: verify session archive stays after PR merge",
        html_url: "https://github.com/kmmao/happy/pull/34",
        merged: true,
        merged_by: { login: "kmmao" },
        head: { ref: "issue-33-eager-crystal-df87" },
        body: "Fixes #33\n\n## Summary\n- Added tests for webhook→PR merge flow",
      },
      repository: { html_url: "https://github.com/kmmao/happy" },
    };

    const result = parseWebhookPRMerge("github", body, "pull_request");

    expect(result).not.toBeNull();
    expect(result!.prNumber).toBe(34);
    expect(result!.headBranch).toBe("issue-33-eager-crystal-df87");
    // Both PR body and branch name should link to issue #33
    expect(result!.linkedIssueNumbers).toEqual([33]);
  });

  it("step 2b: branch name 'issue-N-*' alone is enough to link", () => {
    const body = {
      action: "closed",
      pull_request: {
        number: 35,
        title: "some PR",
        html_url: "https://github.com/o/r/pull/35",
        merged: true,
        head: { ref: "issue-33-eager-crystal-df87" },
        body: "No closing keywords here",
      },
      repository: { html_url: "https://github.com/o/r" },
    };

    const result = parseWebhookPRMerge("github", body, "pull_request");

    expect(result!.linkedIssueNumbers).toEqual([33]);
  });

  it("step 3: after PR merge, linked issues are found for session archival", () => {
    // This test verifies the parser extracts all the data needed
    // for processRoutePRMerge to find and archive sessions.
    const prBody = {
      action: "closed",
      pull_request: {
        number: 50,
        title: "feat: implement feature",
        html_url: "https://github.com/kmmao/happy/pull/50",
        merged: true,
        merged_by: { login: "kmmao" },
        head: { ref: "issue-42-cool-branch" },
        body: "Fixes #42\nAlso closes #43",
      },
      repository: { html_url: "https://github.com/kmmao/happy" },
    };

    const result = parseWebhookPRMerge("github", prBody, "pull_request");

    expect(result).not.toBeNull();
    expect(result!.linkedIssueNumbers).toEqual(
      expect.arrayContaining([42, 43]),
    );
    expect(result!.linkedIssueNumbers).toHaveLength(2);
    expect(result!.repoUrl).toBe("https://github.com/kmmao/happy");
  });
});

// ── Header Helpers ────────────────────────────────────────

describe("getEventTypeHeader", () => {
  it("should extract GitHub event type", () => {
    expect(
      getEventTypeHeader("github", { "x-github-event": "pull_request" }),
    ).toBe("pull_request");
  });

  it("should extract Gitea event type", () => {
    expect(getEventTypeHeader("gitea", { "x-gitea-event": "issues" })).toBe(
      "issues",
    );
  });

  it("should extract GitLab event type", () => {
    expect(
      getEventTypeHeader("gitlab", { "x-gitlab-event": "Issue Hook" }),
    ).toBe("Issue Hook");
  });

  it("should return empty string for unknown provider", () => {
    expect(getEventTypeHeader("bitbucket", {})).toBe("");
  });

  it("should return empty string for missing header", () => {
    expect(getEventTypeHeader("github", {})).toBe("");
  });
});

describe("getDeliveryId", () => {
  it("should extract GitHub delivery ID", () => {
    expect(getDeliveryId("github", { "x-github-delivery": "abc-123" })).toBe(
      "abc-123",
    );
  });

  it("should extract Gitea delivery ID", () => {
    expect(getDeliveryId("gitea", { "x-gitea-delivery": "def-456" })).toBe(
      "def-456",
    );
  });

  it("should extract GitLab event UUID", () => {
    expect(getDeliveryId("gitlab", { "x-gitlab-event-uuid": "ghi-789" })).toBe(
      "ghi-789",
    );
  });

  it("should return empty string for unknown provider", () => {
    expect(getDeliveryId("bitbucket", {})).toBe("");
  });

  it("should return empty string for missing header", () => {
    expect(getDeliveryId("github", {})).toBe("");
  });
});
