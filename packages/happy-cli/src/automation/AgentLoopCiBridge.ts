import { relative, resolve, sep } from "node:path";
import type { CiTriggerData } from "@/api/apiMachine";
import type { AgentLoopDefinition } from "./AgentLoopStore";
import { getGitRemoteUrl, normalizeRemoteUrl } from "./GitRemote";

export interface AgentLoopCiEvent {
  source: string;
  title: string;
  details?: string;
  autoRun: boolean;
}

function isLoopWithinRepo(loopDirectory: string, repoPath: string): boolean {
  const resolvedLoop = resolve(loopDirectory);
  const resolvedRepo = resolve(repoPath);
  if (resolvedLoop === resolvedRepo) {
    return true;
  }
  const rel = relative(resolvedRepo, resolvedLoop);
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== "..";
}

export function selectLoopsForCiBridge(
  loops: AgentLoopDefinition[],
  payload: CiTriggerData,
): AgentLoopDefinition[] {
  return loops.filter((loop) => {
    if (!loop.enabled || !loop.ciBridgeEnabled) {
      return false;
    }
    if (payload.targetLoopId && loop.id !== payload.targetLoopId) {
      return false;
    }
    return isLoopWithinRepo(loop.directory, payload.repoPath);
  });
}

function deriveCiSource(payload: CiTriggerData): string {
  if (payload.kind === "workflow_run") return "ci-workflow";
  if (payload.kind === "check_run") return "ci-check";
  if (payload.kind === "check_suite") return "ci-suite";
  return "ci-trigger";
}

export function buildLoopEventFromCiTrigger(payload: CiTriggerData): AgentLoopCiEvent {
  const subject = payload.workflowName ?? payload.checkName ?? payload.title ?? "CI event";
  const summary = [
    payload.status ? `status=${payload.status}` : undefined,
    payload.conclusion ? `conclusion=${payload.conclusion}` : undefined,
    payload.branch ? `branch=${payload.branch}` : undefined,
    payload.sha ? `sha=${payload.sha}` : undefined,
    payload.details ? payload.details : undefined,
  ].filter(Boolean).join(" | ");
  return {
    source: deriveCiSource(payload),
    title: `${subject}`,
    details: summary || undefined,
    autoRun: true,
  };
}


export async function selectLoopsForCiBridgeResolved(
  loops: AgentLoopDefinition[],
  payload: CiTriggerData,
): Promise<AgentLoopDefinition[]> {
  const byPath = payload.repoPath ? selectLoopsForCiBridge(loops, payload) : [];
  if (byPath.length > 0 || !payload.repoUrl) {
    return byPath;
  }

  const normalizedRepoUrl = normalizeRemoteUrl(payload.repoUrl);
  if (!normalizedRepoUrl) {
    return [];
  }

  const matches: AgentLoopDefinition[] = [];
  for (const loop of loops) {
    if (!loop.enabled || !loop.ciBridgeEnabled) {
      continue;
    }
    if (payload.targetLoopId && loop.id !== payload.targetLoopId) {
      continue;
    }
    const remoteUrl = await getGitRemoteUrl(loop.directory);
    if (normalizeRemoteUrl(remoteUrl) === normalizedRepoUrl) {
      matches.push(loop);
    }
  }
  return matches;
}
