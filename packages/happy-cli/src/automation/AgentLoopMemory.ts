import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import type { AgentLoopTriggerData } from "./types";

export interface AgentLoopMemorySnapshot {
  goal?: string;
  currentFocus?: string;
  workingMemory?: string;
  lastReflectionSummary?: string;
  memoryUpdatedAt?: number;
}

export interface AgentLoopPromptArtifacts {
  supportDir: string;
  memoryFilePath: string;
  contextFilePath: string;
  prompt: string;
}

const MEMORY_HEADINGS = [
  "Goal",
  "Current Focus",
  "Working Memory",
  "Reflection Summary",
] as const;

function normalizeMultiline(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractSection(markdown: string, heading: string): string | undefined {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^## ${escapedHeading}\\n([\\s\\S]*?)(?=\\n## |$)`, "m");
  const match = markdown.match(pattern);
  return normalizeMultiline(match?.[1]);
}

function renderSection(heading: string, value: string | undefined, placeholder: string): string {
  return [`## ${heading}`, normalizeMultiline(value) ?? placeholder].join("\n");
}

export function getAgentLoopSupportDir(directory: string, loopId: string): string {
  return join(directory, ".happy", "agent-loops", loopId);
}

export function getAgentLoopMemoryFilePath(directory: string, loopId: string): string {
  return join(getAgentLoopSupportDir(directory, loopId), "memory.md");
}

export function getAgentLoopContextFilePath(directory: string, loopId: string): string {
  return join(getAgentLoopSupportDir(directory, loopId), "context.md");
}

export function renderAgentLoopMemory(snapshot: AgentLoopMemorySnapshot): string {
  return [
    "# Happy Agent Loop Memory",
    "",
    "Keep this file updated at the end of every autonomous iteration.",
    "It is the durable memory surface reused by future loop runs.",
    "",
    renderSection("Goal", snapshot.goal, "Document the enduring mission for this loop."),
    "",
    renderSection("Current Focus", snapshot.currentFocus, "Capture the active sub-problem or next frontier."),
    "",
    renderSection("Working Memory", snapshot.workingMemory, "Store facts, constraints, hypotheses, and breadcrumbs worth carrying forward."),
    "",
    renderSection("Reflection Summary", snapshot.lastReflectionSummary, "Summarize what changed this run and what should happen next."),
    "",
    `Last synced: ${new Date(snapshot.memoryUpdatedAt ?? Date.now()).toISOString()}`,
    "",
  ].join("\n");
}

export function parseAgentLoopMemory(markdown: string): AgentLoopMemorySnapshot {
  return {
    goal: extractSection(markdown, "Goal"),
    currentFocus: extractSection(markdown, "Current Focus"),
    workingMemory: extractSection(markdown, "Working Memory"),
    lastReflectionSummary: extractSection(markdown, "Reflection Summary"),
  };
}

export async function readAgentLoopMemorySnapshot(directory: string, loopId: string): Promise<AgentLoopMemorySnapshot | undefined> {
  try {
    const content = await readFile(getAgentLoopMemoryFilePath(directory, loopId), "utf-8");
    return parseAgentLoopMemory(content);
  } catch {
    return undefined;
  }
}

export async function persistAgentLoopMemorySnapshot(
  directory: string,
  loopId: string,
  snapshot: AgentLoopMemorySnapshot,
): Promise<string> {
  const supportDir = getAgentLoopSupportDir(directory, loopId);
  await mkdir(supportDir, { recursive: true });
  const memoryFilePath = getAgentLoopMemoryFilePath(directory, loopId);
  const memoryPayload = renderAgentLoopMemory({
    ...snapshot,
    memoryUpdatedAt: snapshot.memoryUpdatedAt ?? Date.now(),
  });
  await writeFile(memoryFilePath, memoryPayload, "utf-8");
  return memoryFilePath;
}

async function ensureMemoryFile(directory: string, loopId: string, snapshot: AgentLoopMemorySnapshot): Promise<string> {
  const memoryFilePath = getAgentLoopMemoryFilePath(directory, loopId);
  try {
    await access(memoryFilePath, fsConstants.F_OK);
    return memoryFilePath;
  } catch {
    return persistAgentLoopMemorySnapshot(directory, loopId, snapshot);
  }
}

function formatEventContext(data: AgentLoopTriggerData): string[] {
  if (!data.eventId) {
    return ["- Trigger source: scheduled/manual wakeup", "- Event payload: none"];
  }
  return [
    `- Trigger source: event (${data.eventSource ?? "unknown"})`,
    `- Event ID: ${data.eventId}`,
    `- Event title: ${data.eventTitle ?? "-"}`,
    data.eventDetails ? `- Event details: ${data.eventDetails}` : "- Event details: -",
  ];
}

function formatLoopContext(data: AgentLoopTriggerData): string {
  return [
    "# Happy Agent Loop Context",
    "",
    `- Loop ID: ${data.loopId}`,
    `- Loop name: ${data.loopName ?? "-"}`,
    `- Iteration: ${data.iteration}`,
    `- Agent: ${data.agent ?? "claude"}`,
    `- Trigger: ${data.trigger}`,
    `- Directory: ${data.directory}`,
    `- Project: ${data.projectId ?? "-"}`,
    `- Profile: ${data.profileId ?? "-"}`,
    ...(data.roleId ? [`- Role: ${data.roleName ?? "-"} (${data.roleType ?? "custom"})`] : []),
    "",
    "## Mission",
    data.prompt.trim(),
    "",
    "## Durable Memory Snapshot",
    `- Goal: ${data.goal ?? "-"}`,
    `- Current focus: ${data.currentFocus ?? "-"}`,
    `- Working memory: ${data.workingMemory ?? "-"}`,
    `- Reflection summary: ${data.lastReflectionSummary ?? "-"}`,
    "",
    "## Trigger Context",
    ...formatEventContext(data),
    "",
    "## Expected Output",
    "- Take the best next autonomous action for the mission.",
    "- Before finishing, update memory.md with any durable changes.",
    "- Keep Current Focus and Reflection Summary accurate for the next wakeup.",
    "",
  ].join("\n");
}

export async function prepareAgentLoopPromptArtifacts(
  data: AgentLoopTriggerData,
  roleIdentitySection?: string,
): Promise<AgentLoopPromptArtifacts> {
  const supportDir = getAgentLoopSupportDir(data.directory, data.loopId);
  await mkdir(supportDir, { recursive: true });
  const memoryFilePath = await ensureMemoryFile(data.directory, data.loopId, {
    goal: data.goal,
    currentFocus: data.currentFocus,
    workingMemory: data.workingMemory,
    lastReflectionSummary: data.lastReflectionSummary,
    memoryUpdatedAt: data.memoryUpdatedAt,
  });
  const contextFilePath = getAgentLoopContextFilePath(data.directory, data.loopId);
  await writeFile(contextFilePath, formatLoopContext(data), "utf-8");

  const prompt = [
    "# Happy Autonomous Loop",
    "",
    "You are running inside a durable autonomous loop managed by the Happy daemon.",
    "Read the loop context first, then act on the highest-value next step.",
    "",
    ...(roleIdentitySection ? [roleIdentitySection, ""] : []),
    `- Context file: ${contextFilePath}`,
    `- Memory file: ${memoryFilePath}`,
    "",
    "Before you finish this iteration:",
    "1. Update the memory file so the next run can resume context quickly.",
    "2. Refresh Current Focus with the exact next frontier.",
    "3. Refresh Reflection Summary with concrete outcomes, blockers, and follow-ups.",
    data.eventId ? "4. Resolve or triage the triggering event before lower-priority work." : "4. Advance the mission proactively without waiting for manual input.",
    "",
    "## Mission",
    data.prompt.trim(),
    "",
    "## Seed Memory",
    `Goal: ${data.goal ?? "-"}`,
    `Current Focus: ${data.currentFocus ?? "-"}`,
    `Working Memory: ${data.workingMemory ?? "-"}`,
    `Reflection Summary: ${data.lastReflectionSummary ?? "-"}`,
    "",
    "Use the files above as the source of truth for continuity.",
  ].join("\n");

  return {
    supportDir,
    memoryFilePath,
    contextFilePath,
    prompt,
  };
}

export { MEMORY_HEADINGS };

// ─── Project todo.md ─────────────────────────────────────────────────────────

export interface TodoMdEntry {
  checked: boolean;
  text: string;
  taskId?: string;
}

export function getProjectTodoMdPath(directory: string): string {
  return join(directory, ".happy", "todo.md");
}

const TASK_ID_COMMENT_RE = /<!--\s*task-id:\s*([a-z0-9_-]+)\s*-->/i;
const CHECKBOX_LINE_RE = /^- \[([ x])\] (.+)$/;

export function parseTodoMd(content: string): TodoMdEntry[] {
  const entries: TodoMdEntry[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(CHECKBOX_LINE_RE);
    if (!match) continue;
    const checked = match[1] === "x";
    const rest = match[2].trim();
    const idMatch = rest.match(TASK_ID_COMMENT_RE);
    const taskId = idMatch?.[1];
    const text = rest.replace(TASK_ID_COMMENT_RE, "").trim();
    entries.push({ checked, text, taskId });
  }
  return entries;
}

export function renderTodoMd(entries: TodoMdEntry[], syncedAt?: Date): string {
  const timestamp = (syncedAt ?? new Date()).toISOString();
  const lines = [
    "# Tasks",
    "",
    "Edit this file to update task status. Use `- [ ]` for pending and `- [x]` for completed.",
    "Add new tasks with `- [ ] description`. Task IDs are auto-assigned on next sync.",
    "",
    `<!-- last-synced: ${timestamp} -->`,
    "",
  ];
  for (const entry of entries) {
    const checkbox = entry.checked ? "[x]" : "[ ]";
    const idSuffix = entry.taskId ? ` <!-- task-id: ${entry.taskId} -->` : "";
    lines.push(`- ${checkbox} ${entry.text}${idSuffix}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function readProjectTodoMd(directory: string): Promise<TodoMdEntry[]> {
  try {
    const content = await readFile(getProjectTodoMdPath(directory), "utf-8");
    return parseTodoMd(content);
  } catch {
    return [];
  }
}

export async function writeProjectTodoMd(directory: string, entries: TodoMdEntry[], syncedAt?: Date): Promise<void> {
  const todoDir = join(directory, ".happy");
  await mkdir(todoDir, { recursive: true });
  await writeFile(getProjectTodoMdPath(directory), renderTodoMd(entries, syncedAt), "utf-8");
}
