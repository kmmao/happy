import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { parseJournalLine, readJournalEntries } from "./workflowJournal";

describe("parseJournalLine", () => {
  it("parses a started entry", () => {
    const result = parseJournalLine(
      '{"type":"started","key":"v2:abc","agentId":"a1"}',
    );
    expect(result).toEqual({
      type: "started",
      key: "v2:abc",
      agentId: "a1",
      result: undefined,
    });
  });

  it("parses a result entry and preserves result text", () => {
    const result = parseJournalLine(
      '{"type":"result","key":"v2:abc","agentId":"a1","result":"final answer"}',
    );
    expect(result).toEqual({
      type: "result",
      key: "v2:abc",
      agentId: "a1",
      result: "final answer",
    });
  });

  it("returns null on empty / whitespace-only lines", () => {
    expect(parseJournalLine("")).toBeNull();
    expect(parseJournalLine("   \t  ")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseJournalLine("{not json")).toBeNull();
    expect(parseJournalLine("null")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseJournalLine('{"type":"started"}')).toBeNull();
    expect(parseJournalLine('{"agentId":"a1"}')).toBeNull();
    expect(parseJournalLine('{"type":42,"agentId":"a1"}')).toBeNull();
  });

  it("preserves unknown future types instead of dropping them", () => {
    const result = parseJournalLine(
      '{"type":"phase-start","key":"v2:x","agentId":"a1"}',
    );
    expect(result?.type).toBe("phase-start");
  });
});

describe("readJournalEntries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfj-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns [] when the file does not exist", () => {
    expect(readJournalEntries(path.join(tmpDir, "missing.jsonl"))).toEqual([]);
  });

  it("reads multi-line journal in order, skipping malformed lines", () => {
    const filePath = path.join(tmpDir, "journal.jsonl");
    fs.writeFileSync(
      filePath,
      [
        '{"type":"started","key":"v2:k1","agentId":"a1"}',
        "not-json",
        '{"type":"started","key":"v2:k2","agentId":"a2"}',
        '{"type":"result","key":"v2:k1","agentId":"a1","result":"R1"}',
        "",
      ].join("\n"),
    );
    const entries = readJournalEntries(filePath);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ type: "started", agentId: "a1" });
    expect(entries[1]).toMatchObject({ type: "started", agentId: "a2" });
    expect(entries[2]).toMatchObject({
      type: "result",
      agentId: "a1",
      result: "R1",
    });
  });
});
