/**
 * Pure reader for the Claude Code Workflow runtime's per-run progress JSON.
 *
 * Unlike `journal.jsonl` (an append-only log of started/result lines that the
 * CLI `/workflows` TUI does NOT read), the runtime maintains a single
 * incrementally-rewritten snapshot file that backs the live progress view:
 *   ~/.claude/projects/<encodedCwd>/<sessionId>/workflows/wf_<id>.json
 * (note: a SIBLING of subagents/, not inside subagents/workflows/wf_<id>/).
 *
 * Its `workflowProgress[]` array carries fully-structured, accurate data per
 * entry — verified against a real wf_90e81e12 run:
 *   {"type":"workflow_phase","index":1,"title":"Explore"}
 *   {"type":"workflow_agent","label":"explore:root","phaseTitle":"Explore",
 *    "phaseIndex":1,"agentId":"a4f6…","agentType":"Explore",
 *    "model":"claude-haiku-4-5-20251001","state":"done","tokens":28456,
 *    "durationMs":36592,"promptPreview":"…","resultPreview":"…","startedAt":…}
 *
 * `state` is one of queued / running / done / error / cancelled (and possibly
 * others). `tokens` is a SINGLE integer total (no input/output split).
 *
 * This reader is defensive: a missing file or any parse failure yields null,
 * and every field is individually tolerated as absent — so the watcher can
 * fall back to its journal/jsonl reader for older Claude Code versions that
 * don't write this file.
 */

import * as fs from "fs";

export interface WorkflowProgressPhase {
  index: number;
  title: string;
}

export interface WorkflowProgressAgent {
  agentId: string;
  label?: string;
  phaseTitle?: string;
  phaseIndex?: number;
  agentType?: string;
  model?: string;
  /** Single integer total token count (no input/output breakdown). */
  tokens?: number;
  /** queued | running | done | error | errored | failed | cancelled | … */
  state: string;
  promptPreview?: string;
  resultPreview?: string;
  durationMs?: number;
  startedAt?: number;
}

export interface WorkflowProgressSnapshot {
  phases: WorkflowProgressPhase[];
  agents: WorkflowProgressAgent[];
  status?: string;
  agentCount?: number;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Read and parse the progress JSON at `progressPath`. Returns null when the
 * file is absent, unreadable, or not valid JSON — never throws.
 */
export function readWorkflowProgress(
  progressPath: string,
): WorkflowProgressSnapshot | null {
  let content: string;
  try {
    content = fs.readFileSync(progressPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const progress = Array.isArray(obj.workflowProgress) ? obj.workflowProgress : [];

  const phases: WorkflowProgressPhase[] = [];
  const agents: WorkflowProgressAgent[] = [];
  for (const raw of progress) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (e.type === "workflow_phase") {
      const index = num(e.index);
      const title = str(e.title);
      if (index !== undefined && title !== undefined) {
        phases.push({ index, title });
      }
    } else if (e.type === "workflow_agent") {
      const agentId = str(e.agentId);
      if (agentId === undefined) continue;
      agents.push({
        agentId,
        label: str(e.label),
        phaseTitle: str(e.phaseTitle),
        phaseIndex: num(e.phaseIndex),
        agentType: str(e.agentType),
        model: str(e.model),
        tokens: num(e.tokens),
        state: str(e.state) ?? "unknown",
        promptPreview: str(e.promptPreview),
        resultPreview: str(e.resultPreview),
        durationMs: num(e.durationMs),
        startedAt: num(e.startedAt),
      });
    }
  }

  return {
    phases,
    agents,
    status: str(obj.status),
    agentCount: num(obj.agentCount),
  };
}
