import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentLoopDefinition } from "./AgentLoopStore";
import { getAgentLoopSupportDir } from "./AgentLoopMemory";

export interface AgentLoopBriefSnapshot {
  loopId: string;
  loopName?: string;
  status: "completed" | "failed" | "cancelled";
  generatedAt: number;
  sessionId?: string;
  summary: string;
  detail: string;
}

export function getAgentLoopBriefFilePath(directory: string, loopId: string): string {
  return join(getAgentLoopSupportDir(directory, loopId), "brief-latest.md");
}

export function getAgentLoopBriefArchiveDir(directory: string, loopId: string): string {
  return join(getAgentLoopSupportDir(directory, loopId), "briefs");
}

function summarize(loop: AgentLoopDefinition, status: "completed" | "failed" | "cancelled", errorMessage?: string): string {
  if (status === "failed") {
    return `${loop.name ?? loop.id} failed${errorMessage ? `: ${errorMessage}` : ""}`;
  }
  if (status === "cancelled") {
    return `${loop.name ?? loop.id} was cancelled`;
  }
  const focus = loop.currentFocus ?? loop.goal ?? loop.lastReflectionSummary;
  return focus ? `${loop.name ?? loop.id} completed — ${focus}` : `${loop.name ?? loop.id} completed successfully`;
}

export function renderAgentLoopBrief(snapshot: AgentLoopBriefSnapshot): string {
  return [
    "# Happy Loop Brief",
    "",
    `- Loop: ${snapshot.loopName ?? snapshot.loopId}`,
    `- Status: ${snapshot.status}`,
    `- Generated: ${new Date(snapshot.generatedAt).toISOString()}`,
    snapshot.sessionId ? `- Session: ${snapshot.sessionId}` : undefined,
    "",
    "## Summary",
    snapshot.summary,
    "",
    "## Details",
    snapshot.detail,
    "",
  ].filter(Boolean).join("\n");
}

export async function persistAgentLoopBrief(
  directory: string,
  loopId: string,
  snapshot: AgentLoopBriefSnapshot,
): Promise<string> {
  const supportDir = getAgentLoopSupportDir(directory, loopId);
  const archiveDir = getAgentLoopBriefArchiveDir(directory, loopId);
  await mkdir(supportDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  const payload = renderAgentLoopBrief(snapshot);
  const latestPath = getAgentLoopBriefFilePath(directory, loopId);
  const archivePath = join(archiveDir, `${snapshot.generatedAt}.md`);
  await writeFile(latestPath, payload, "utf-8");
  await writeFile(archivePath, payload, "utf-8");
  return latestPath;
}

export async function readAgentLoopBrief(directory: string, loopId: string): Promise<string | undefined> {
  try {
    return await readFile(getAgentLoopBriefFilePath(directory, loopId), "utf-8");
  } catch {
    return undefined;
  }
}

export function buildAgentLoopBrief(loop: AgentLoopDefinition, params: {
  status: "completed" | "failed" | "cancelled";
  sessionId?: string;
  errorMessage?: string;
}): AgentLoopBriefSnapshot {
  const generatedAt = Date.now();
  const summary = summarize(loop, params.status, params.errorMessage);
  const detail = [
    loop.goal ? `Goal: ${loop.goal}` : undefined,
    loop.currentFocus ? `Current focus: ${loop.currentFocus}` : undefined,
    loop.lastReflectionSummary ? `Reflection: ${loop.lastReflectionSummary}` : undefined,
    loop.workingMemory ? `Working memory:\n${loop.workingMemory}` : undefined,
    params.errorMessage ? `Error: ${params.errorMessage}` : undefined,
    loop.lastError && loop.lastError !== params.errorMessage ? `Last error: ${loop.lastError}` : undefined,
    loop.recentEvents?.length ? `Recent events:\n${loop.recentEvents.slice(0, 3).map((event) => `- [${event.status}] ${event.title}`).join("\n")}` : undefined,
  ].filter(Boolean).join("\n\n") || "No additional details recorded.";
  return {
    loopId: loop.id,
    loopName: loop.name,
    status: params.status,
    generatedAt,
    sessionId: params.sessionId,
    summary,
    detail,
  };
}
