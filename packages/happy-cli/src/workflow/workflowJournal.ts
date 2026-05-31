/**
 * Pure parser + reader for the Claude Code Workflow runtime's
 * `journal.jsonl` file.
 *
 * The workflow runtime writes one JSON-per-line record per agent lifecycle
 * event in
 *   ~/.claude/projects/<encodedCwd>/<sessionId>/subagents/workflows/wf_<id>/journal.jsonl
 *
 * Observed entry shapes (verified against a real wf_26467e0e run):
 *   {"type":"started","key":"v2:<hash>","agentId":"a7c67f4..."}
 *   {"type":"result","key":"v2:<hash>","agentId":"a3aca35...","result":"<full text>"}
 *
 * Other types may appear in the future (errored / skipped / phase-*) —
 * unknown types pass through as opaque strings on `type` so callers can
 * decide whether to handle them.
 */

import * as fs from "fs";

export interface WorkflowJournalEntry {
  type: string;
  key: string;
  agentId: string;
  /** Present on `result` entries; first ~thousands of chars of agent output. */
  result?: string;
}

/**
 * Parse a single line from journal.jsonl. Returns null for empty lines,
 * malformed JSON, or records missing the required `type` / `agentId` fields.
 */
export function parseJournalLine(line: string): WorkflowJournalEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string" || typeof obj.agentId !== "string") {
    return null;
  }
  return {
    type: obj.type,
    key: typeof obj.key === "string" ? obj.key : "",
    agentId: obj.agentId,
    result: typeof obj.result === "string" ? obj.result : undefined,
  };
}

/**
 * Read the whole journal.jsonl and return all parsed entries in order.
 * Returns an empty array if the file doesn't exist or cannot be read —
 * callers (the poller) treat absence as "no entries yet".
 */
export function readJournalEntries(filePath: string): WorkflowJournalEntry[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out: WorkflowJournalEntry[] = [];
  for (const line of content.split("\n")) {
    const entry = parseJournalLine(line);
    if (entry) out.push(entry);
  }
  return out;
}
