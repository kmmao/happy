import { describe, expect, it } from "vitest";
import { buildCiTriggerFromGitHubActionsWebhook } from "./GitHubActionsCiAdapter";

describe("GitHubActionsCiAdapter", () => {
  it("maps workflow_run payloads into ci triggers", () => {
    const trigger = buildCiTriggerFromGitHubActionsWebhook({
      eventName: "workflow_run",
      repoPath: "/tmp/repo",
      payload: {
        repository: { html_url: "https://github.com/acme/repo" },
        workflow_run: {
          id: 123,
          status: "completed",
          conclusion: "failure",
          name: "CI",
          head_branch: "main",
          head_sha: "abc123",
          display_title: "CI failed",
          html_url: "https://github.com/acme/repo/actions/runs/123",
        },
      },
    });

    expect(trigger).toEqual(expect.objectContaining({
      type: "ci-trigger",
      kind: "workflow_run",
      repoPath: "/tmp/repo",
      repoUrl: "https://github.com/acme/repo",
      workflowName: "CI",
      conclusion: "failure",
      branch: "main",
      sha: "abc123",
    }));
  });
});
