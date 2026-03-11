import { describe, it, expect } from "vitest";
import { buildIssuePrompt } from "./buildIssuePrompt";
import type { WebhookIssueData, WorktreeInfo } from "./buildIssuePrompt";
import type { IssueComment } from "./fetchIssueComments";

function makeIssue(overrides?: Partial<WebhookIssueData>): WebhookIssueData {
  return {
    issueNumber: 27,
    issueTitle: "Test webhook pipeline",
    issueBody: "Verify the webhook auto-archive flow",
    issueAuthor: "kmmao",
    issueLabels: ["auto-fix"],
    issueUrl: "https://github.com/kmmao/happy/issues/27",
    repoUrl: "https://github.com/kmmao/happy",
    ...overrides,
  };
}

function makeWorktree(overrides?: Partial<WorktreeInfo>): WorktreeInfo {
  return {
    branchName: "issue-27-smooth-canyon-a1b2",
    parentBranch: "main",
    ...overrides,
  };
}

describe("buildIssuePrompt", () => {
  // ── Pipeline step 3: PR body includes "Fixes #N" ──

  it("should include 'Fixes #N' in the PR creation instruction", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    expect(prompt).toContain('--body "Fixes #27"');
  });

  it("should use the correct issue number in Fixes reference", () => {
    const prompt = buildIssuePrompt(
      makeIssue({ issueNumber: 42 }),
      [],
      makeWorktree(),
    );
    expect(prompt).toContain('--body "Fixes #42"');
  });

  // ── Pipeline step 2: branch name in PR creation ──

  it("should reference the worktree branch in push and PR commands", () => {
    const worktree = makeWorktree({ branchName: "issue-27-bright-ocean-c3d4" });
    const prompt = buildIssuePrompt(makeIssue(), [], worktree);
    expect(prompt).toContain("git push -u origin issue-27-bright-ocean-c3d4");
    expect(prompt).toContain('--head "issue-27-bright-ocean-c3d4"');
  });

  it("should use the parent branch as PR base", () => {
    const worktree = makeWorktree({ parentBranch: "develop" });
    const prompt = buildIssuePrompt(makeIssue(), [], worktree);
    expect(prompt).toContain('--base "develop"');
  });

  // ── Pipeline step 6: commit references issue ──

  it("should include issue number in the commit instruction", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    expect(prompt).toContain("closes #27");
  });

  // ── Issue metadata ──

  it("should include issue title and number in header", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    expect(prompt).toContain("# Issue #27: Test webhook pipeline");
  });

  it("should include issue body in description section", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    expect(prompt).toContain("Verify the webhook auto-archive flow");
  });

  it("should include labels", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    expect(prompt).toContain("Labels: auto-fix");
  });

  it("should show '(No description provided)' for empty body", () => {
    const prompt = buildIssuePrompt(
      makeIssue({ issueBody: "" }),
      [],
      makeWorktree(),
    );
    expect(prompt).toContain("(No description provided)");
  });

  // ── Comments ──

  it("should include comments section when comments exist", () => {
    const comments: IssueComment[] = [
      { author: "user1", body: "Please fix ASAP", createdAt: 1710000000000 },
    ];
    const prompt = buildIssuePrompt(makeIssue(), comments, makeWorktree());
    expect(prompt).toContain("## Comments");
    expect(prompt).toContain("@user1");
    expect(prompt).toContain("Please fix ASAP");
  });

  it("should omit comments section when no comments", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    expect(prompt).not.toContain("## Comments");
  });

  // ── Image extraction ──

  it("should extract image URLs from issue body", () => {
    const prompt = buildIssuePrompt(
      makeIssue({ issueBody: "Bug screenshot: ![img](https://example.com/bug.png)" }),
      [],
      makeWorktree(),
    );
    expect(prompt).toContain("## Referenced Images");
    expect(prompt).toContain("https://example.com/bug.png");
  });

  it("should extract image URLs from HTML img tags", () => {
    const prompt = buildIssuePrompt(
      makeIssue({ issueBody: '<img src="https://example.com/ui.jpg" />' }),
      [],
      makeWorktree(),
    );
    expect(prompt).toContain("https://example.com/ui.jpg");
  });

  // ── Worktree section ──

  it("should include worktree metadata", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    expect(prompt).toContain("## Worktree");
    expect(prompt).toContain("Branch: issue-27-smooth-canyon-a1b2");
    expect(prompt).toContain("Parent branch: main");
  });

  // ── Full pipeline instruction set ──

  it("should include all 9 task steps", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    for (let i = 1; i <= 9; i++) {
      expect(prompt).toContain(`${i}. `);
    }
  });

  it("should instruct reading CLAUDE.md first", () => {
    const prompt = buildIssuePrompt(makeIssue(), [], makeWorktree());
    expect(prompt).toContain("Read CLAUDE.md");
  });
});
