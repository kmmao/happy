import { describe, expect, it } from "vitest";
import { buildLoopEventsFromWebhook, selectLoopsForWebhookBridge } from "./AgentLoopWebhookBridge";
import type { AgentLoopDefinition } from "./AgentLoopStore";
import type { WebhookTriggerData } from "@/api/apiMachine";

const payload: WebhookTriggerData = {
  type: "webhook-trigger",
  webhookEventId: "evt-1",
  issueNumber: 42,
  issueTitle: "Fix flaky CI",
  issueBody: "workflow on main is red",
  issueAuthor: "alice",
  issueLabels: ["bug", "ci"],
  issueUrl: "https://github.com/acme/repo/issues/42",
  repoUrl: "https://github.com/acme/repo",
  repoPath: "/tmp/repo",
  provider: "github",
};

function makeLoop(partial: Partial<AgentLoopDefinition>): AgentLoopDefinition {
  return {
    id: "loop-1",
    prompt: "x",
    directory: "/tmp/repo",
    intervalMs: 600000,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: 1,
    iteration: 0,
    continuityKey: "agent-loop:loop-1",
    agent: "claude",
    runtimeState: "idle",
    phase: "sleeping",
    phaseUpdatedAt: 1,
    ...partial,
  };
}

describe("AgentLoopWebhookBridge", () => {
  it("selects matching loops with github bridge enabled", () => {
    const selected = selectLoopsForWebhookBridge([
      makeLoop({ id: "a", directory: "/tmp/repo", githubBridgeEnabled: true }),
      makeLoop({ id: "b", directory: "/tmp/repo/subdir", githubBridgeEnabled: true }),
      makeLoop({ id: "c", directory: "/tmp/other", githubBridgeEnabled: true }),
      makeLoop({ id: "d", directory: "/tmp/repo", githubBridgeEnabled: false }),
    ], payload);

    expect(selected.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("builds github and ci loop events from ci-related webhook payload", () => {
    const events = buildLoopEventsFromWebhook(payload);
    expect(events.map((event) => event.source)).toEqual(["github-webhook", "ci-webhook"]);
    expect(events[0]?.title).toContain("Issue #42");
    expect(events[1]?.title).toContain("CI signal");
    expect(events[0]?.details).toContain("labels=bug, ci");
  });

  it("only emits generic github events for non-ci issues", () => {
    const events = buildLoopEventsFromWebhook({
      ...payload,
      issueTitle: "Update onboarding docs",
      issueBody: "README is stale",
      issueLabels: ["docs"],
    });
    expect(events.map((event) => event.source)).toEqual(["github-webhook"]);
  });
});
