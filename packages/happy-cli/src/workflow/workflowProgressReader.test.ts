import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { readWorkflowProgress } from "./workflowProgressReader";

/**
 * Fixture distilled from a real wf_90e81e12 run (explore-project-structure):
 * 2 workflow_phase entries + workflow_agent entries carrying the real
 * opts.label / phaseTitle / model / tokens / state.
 */
const FIXTURE = {
  status: "completed",
  agentCount: 8,
  workflowProgress: [
    { type: "workflow_phase", index: 1, title: "Explore" },
    { type: "workflow_phase", index: 2, title: "Synthesize" },
    {
      type: "workflow_agent",
      index: 1,
      label: "explore:root",
      phaseIndex: 1,
      phaseTitle: "Explore",
      agentId: "a4f6f161bb236f946",
      agentType: "Explore",
      model: "claude-haiku-4-5-20251001",
      state: "done",
      tokens: 28456,
      durationMs: 36592,
      promptPreview: "Explore the directory `/Users/.../happy` …",
      resultPreview: '{"name":"Happy Coder",…}',
      startedAt: 1780307480941,
    },
    {
      type: "workflow_agent",
      index: 2,
      label: "explore:happy-cli",
      phaseIndex: 1,
      phaseTitle: "Explore",
      agentId: "ab31c256ac25e3213",
      agentType: "Explore",
      model: "claude-haiku-4-5-20251001",
      state: "running",
      tokens: 28635,
      promptPreview: "Explore the directory happy-cli …",
    },
    {
      type: "workflow_agent",
      index: 8,
      label: "synthesize",
      phaseIndex: 2,
      phaseTitle: "Synthesize",
      agentId: "a90b1c2d3e4f5a6b7",
      agentType: "None",
      model: "claude-haiku-4-5-20251001",
      state: "queued",
    },
  ],
};

describe("readWorkflowProgress", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfpr-"));
    filePath = path.join(tmpDir, "wf_test.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns null when the file is missing", () => {
    expect(readWorkflowProgress(path.join(tmpDir, "nope.json"))).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    fs.writeFileSync(filePath, "{not json");
    expect(readWorkflowProgress(filePath)).toBeNull();
  });

  it("parses phases and agents from a real-shape snapshot", () => {
    fs.writeFileSync(filePath, JSON.stringify(FIXTURE));
    const snap = readWorkflowProgress(filePath)!;
    expect(snap).not.toBeNull();

    expect(snap.status).toBe("completed");
    expect(snap.agentCount).toBe(8);

    expect(snap.phases).toEqual([
      { index: 1, title: "Explore" },
      { index: 2, title: "Synthesize" },
    ]);

    expect(snap.agents).toHaveLength(3);
    expect(snap.agents[0]).toEqual({
      agentId: "a4f6f161bb236f946",
      label: "explore:root",
      phaseTitle: "Explore",
      phaseIndex: 1,
      agentType: "Explore",
      model: "claude-haiku-4-5-20251001",
      tokens: 28456,
      state: "done",
      promptPreview: "Explore the directory `/Users/.../happy` …",
      resultPreview: '{"name":"Happy Coder",…}',
      durationMs: 36592,
      startedAt: 1780307480941,
    });

    // Running agent: no durationMs / resultPreview yet.
    expect(snap.agents[1]).toMatchObject({
      agentId: "ab31c256ac25e3213",
      label: "explore:happy-cli",
      state: "running",
    });
    expect(snap.agents[1].durationMs).toBeUndefined();
    expect(snap.agents[1].resultPreview).toBeUndefined();

    // Queued agent in second phase.
    expect(snap.agents[2]).toMatchObject({
      agentId: "a90b1c2d3e4f5a6b7",
      phaseTitle: "Synthesize",
      state: "queued",
    });
  });

  it("tolerates missing fields and skips agents without an agentId", () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        workflowProgress: [
          { type: "workflow_agent", state: "done" }, // no agentId → skipped
          { type: "workflow_agent", agentId: "x1" }, // no state → "unknown"
          { type: "workflow_phase", title: "NoIndex" }, // no index → skipped
        ],
      }),
    );
    const snap = readWorkflowProgress(filePath)!;
    expect(snap.phases).toHaveLength(0);
    expect(snap.agents).toHaveLength(1);
    expect(snap.agents[0]).toMatchObject({ agentId: "x1", state: "unknown" });
  });
});
