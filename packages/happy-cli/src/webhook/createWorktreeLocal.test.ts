import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWorktreeLocal, removeWorktreeForced } from "./createWorktreeLocal";
import { execFileSync, execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Integration tests for createWorktreeLocal.
 * Uses real git repos in a temporary directory.
 */
describe("createWorktreeLocal", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "happy-worktree-test-"));
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmpDir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Pipeline step 2: branch names include issue number ──

  it("should create branch with issue-N prefix when issueNumber provided", async () => {
    const result = await createWorktreeLocal(tmpDir, 27);
    expect(result.success).toBe(true);
    expect(result.branchName).toMatch(/^issue-27-[a-z]+-[a-z]+-[0-9a-f]{4}$/);
    expect(result.parentBranch).toBe("main");
    expect(result.worktreePath).toContain(".dev/worktree/issue-27-");
  });

  it("should create branch without issue prefix when no issueNumber", async () => {
    const result = await createWorktreeLocal(tmpDir);
    expect(result.success).toBe(true);
    expect(result.branchName).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
    expect(result.branchName).not.toMatch(/^issue-/);
  });

  it("should use different issue numbers correctly", async () => {
    const result42 = await createWorktreeLocal(tmpDir, 42);
    expect(result42.success).toBe(true);
    expect(result42.branchName).toMatch(/^issue-42-/);

    const result123 = await createWorktreeLocal(tmpDir, 123);
    expect(result123.success).toBe(true);
    expect(result123.branchName).toMatch(/^issue-123-/);
  });

  it("should set parentBranch to current branch", async () => {
    const result = await createWorktreeLocal(tmpDir, 10);
    expect(result.parentBranch).toBe("main");
  });

  it("should fail for non-git directory", async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "non-git-"));
    try {
      const result = await createWorktreeLocal(nonGitDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Not a Git repository");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  // ── Worktree is actually usable ──

  it("should create a real git worktree on disk", async () => {
    const result = await createWorktreeLocal(tmpDir, 5);
    expect(result.success).toBe(true);

    // Verify the branch exists in git
    const branches = execFileSync("git", ["branch", "--list", result.branchName], {
      cwd: tmpDir,
    }).toString();
    expect(branches).toContain(result.branchName);
  });

  // ── removeWorktreeForced ──

  it("should remove worktree and branch cleanly", async () => {
    const result = await createWorktreeLocal(tmpDir, 99);
    expect(result.success).toBe(true);

    await removeWorktreeForced(tmpDir, result.branchName);

    // Branch should be gone
    const branches = execFileSync("git", ["branch", "--list", result.branchName], {
      cwd: tmpDir,
    }).toString();
    expect(branches.trim()).toBe("");
  });
});
