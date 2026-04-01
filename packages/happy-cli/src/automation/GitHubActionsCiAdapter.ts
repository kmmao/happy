import type { CiTriggerData } from "@/api/apiMachine";
import { normalizeRemoteUrl } from "./GitRemote";

export interface GitHubActionsWebhookAdapterInput {
  eventName: string;
  payload: any;
  repoPath?: string;
  targetLoopId?: string;
}

function getRepoUrl(payload: any): string | undefined {
  return normalizeRemoteUrl(
    payload?.repository?.html_url
      ?? payload?.repository?.clone_url
      ?? payload?.repository?.url,
  );
}

function deriveCommon(payload: any, input: GitHubActionsWebhookAdapterInput) {
  return {
    type: "ci-trigger" as const,
    eventId: String(payload?.workflow_run?.id ?? payload?.check_run?.id ?? payload?.check_suite?.id ?? payload?.delivery ?? `${input.eventName}:${Date.now()}`),
    provider: "github",
    repoPath: input.repoPath ?? "",
    repoUrl: getRepoUrl(payload) ?? "",
    targetLoopId: input.targetLoopId,
  };
}

export function buildCiTriggerFromGitHubActionsWebhook(
  input: GitHubActionsWebhookAdapterInput,
): CiTriggerData | undefined {
  const base = deriveCommon(input.payload, input);
  if (input.eventName === "workflow_run") {
    const run = input.payload?.workflow_run;
    if (!run) return undefined;
    return {
      ...base,
      kind: "workflow_run",
      status: String(run.status ?? "completed"),
      conclusion: run.conclusion ?? undefined,
      workflowName: run.name ?? input.payload?.workflow?.name ?? undefined,
      branch: run.head_branch ?? undefined,
      sha: run.head_sha ?? undefined,
      title: run.display_title ?? run.name ?? "workflow_run",
      details: run.html_url ?? undefined,
    };
  }
  if (input.eventName === "check_run") {
    const checkRun = input.payload?.check_run;
    if (!checkRun) return undefined;
    return {
      ...base,
      kind: "check_run",
      status: String(checkRun.status ?? "completed"),
      conclusion: checkRun.conclusion ?? undefined,
      checkName: checkRun.name ?? undefined,
      branch: input.payload?.check_run?.check_suite?.head_branch ?? input.payload?.repository?.default_branch ?? undefined,
      sha: checkRun.head_sha ?? undefined,
      title: checkRun.name ?? "check_run",
      details: checkRun.html_url ?? undefined,
    };
  }
  if (input.eventName === "check_suite") {
    const checkSuite = input.payload?.check_suite;
    if (!checkSuite) return undefined;
    return {
      ...base,
      kind: "check_suite",
      status: String(checkSuite.status ?? "completed"),
      conclusion: checkSuite.conclusion ?? undefined,
      branch: checkSuite.head_branch ?? undefined,
      sha: checkSuite.head_sha ?? undefined,
      title: `${checkSuite.app?.name ?? "GitHub"} check suite`,
      details: checkSuite.url ?? undefined,
    };
  }
  return undefined;
}
