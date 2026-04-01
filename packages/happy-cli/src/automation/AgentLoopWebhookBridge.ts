import { relative, resolve, sep } from "node:path";
import type { WebhookTriggerData } from "@/api/apiMachine";
import type { AgentLoopDefinition } from "./AgentLoopStore";

export interface AgentLoopWebhookEvent {
  source: string;
  title: string;
  details?: string;
  autoRun: boolean;
}

const CI_SIGNAL_KEYWORDS = [
  "ci",
  "workflow",
  "check",
  "flake",
  "flaky",
  "test failure",
  "failing test",
  "pipeline",
  "build failure",
  "integration test",
];

function isLoopWithinRepo(loopDirectory: string, repoPath: string): boolean {
  const resolvedLoop = resolve(loopDirectory);
  const resolvedRepo = resolve(repoPath);
  if (resolvedLoop === resolvedRepo) {
    return true;
  }
  const rel = relative(resolvedRepo, resolvedLoop);
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== "..";
}

function isCiRelatedWebhook(payload: WebhookTriggerData): boolean {
  const labelText = payload.issueLabels.join(" ").toLowerCase();
  const searchable = `${payload.issueTitle}\n${payload.issueBody}\n${labelText}`.toLowerCase();
  return CI_SIGNAL_KEYWORDS.some((keyword) => searchable.includes(keyword));
}

export function selectLoopsForWebhookBridge(
  loops: AgentLoopDefinition[],
  payload: WebhookTriggerData,
): AgentLoopDefinition[] {
  return loops.filter((loop) => loop.enabled && loop.githubBridgeEnabled && isLoopWithinRepo(loop.directory, payload.repoPath));
}

export function buildLoopEventsFromWebhook(payload: WebhookTriggerData): AgentLoopWebhookEvent[] {
  const labels = payload.issueLabels.length > 0 ? payload.issueLabels.join(", ") : "none";
  const details = [
    `author=${payload.issueAuthor}`,
    `labels=${labels}`,
    `url=${payload.issueUrl}`,
  ].join(" | ");

  const events: AgentLoopWebhookEvent[] = [
    {
      source: `${payload.provider}-webhook`,
      title: `Issue #${payload.issueNumber}: ${payload.issueTitle}`,
      details,
      autoRun: true,
    },
  ];

  if (isCiRelatedWebhook(payload)) {
    events.push({
      source: "ci-webhook",
      title: `CI signal from issue #${payload.issueNumber}: ${payload.issueTitle}`,
      details,
      autoRun: true,
    });
  }

  return events;
}
