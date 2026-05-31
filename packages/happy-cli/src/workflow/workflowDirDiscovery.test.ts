import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  encodeCwd,
  extractRunId,
  findRecentRunDir,
  getWorkflowsRoot,
} from "./workflowDirDiscovery";

describe("encodeCwd", () => {
  it("replaces unix path separators with hyphens", () => {
    expect(encodeCwd("/Users/foo/proj")).toBe("-Users-foo-proj");
  });

  it("replaces windows path separators with hyphens", () => {
    expect(encodeCwd("C:\\Users\\foo\\proj")).toBe("C:-Users-foo-proj");
  });
});

describe("getWorkflowsRoot", () => {
  it("composes the canonical Claude SDK path layout", () => {
    const root = getWorkflowsRoot("sess-1", "/repo");
    expect(root).toContain(path.join(".claude", "projects", "-repo", "sess-1", "subagents", "workflows"));
  });
});

describe("extractRunId", () => {
  it("returns the basename of the run dir", () => {
    expect(extractRunId("/foo/bar/wf_abc123")).toBe("wf_abc123");
  });
});

describe("findRecentRunDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfd-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns null when the workflows root does not exist", () => {
    expect(findRecentRunDir(path.join(tmpDir, "missing"), Date.now())).toBeNull();
  });

  it("returns null when no wf_* dirs are present", () => {
    fs.mkdirSync(path.join(tmpDir, "other-dir"));
    expect(findRecentRunDir(tmpDir, Date.now())).toBeNull();
  });

  it("returns the most recently modified wf_* dir within the time window", () => {
    const older = path.join(tmpDir, "wf_old");
    const newer = path.join(tmpDir, "wf_new");
    fs.mkdirSync(older);
    fs.mkdirSync(newer);

    // Force mtime ordering: older was modified well before our cutoff.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(older, past, past);

    const dir = findRecentRunDir(tmpDir, Date.now() - 10_000);
    expect(dir).toBe(newer);
  });

  it("ignores wf_* dirs older than the cutoff (minus grace)", () => {
    const old = path.join(tmpDir, "wf_ancient");
    fs.mkdirSync(old);
    const past = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(old, past, past);

    expect(findRecentRunDir(tmpDir, Date.now())).toBeNull();
  });

  it("ignores non-directory entries starting with wf_", () => {
    fs.writeFileSync(path.join(tmpDir, "wf_not_a_dir"), "x");
    expect(findRecentRunDir(tmpDir, Date.now())).toBeNull();
  });
});
