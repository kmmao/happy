import { describe, expect, it, vi } from "vitest";
import { runTaskJob } from "./TaskRunner";

describe("runTaskJob", () => {
  it("injects task reporting environment variables and instructions", async () => {
    const spawnSession = vi.fn(async () => ({
      type: "success" as const,
      sessionId: "session-1",
    }));

    await runTaskJob(
      {
        type: "task-trigger",
        taskId: "task-1",
        prompt: "Fix the blocked workflow",
        directory: "/tmp",
        priority: "user",
        resultToken: "task-token-123",
      },
      {
        spawnSession,
        serverUrl: "https://server.test",
      },
    );

    const calls = spawnSession.mock.calls as unknown as any[][];
    expect(calls.length).toBe(1);
    const call = calls[0]?.[0] as any;
    expect(call.environmentVariables).toMatchObject({
      HAPPY_TASK_ID: "task-1",
      HAPPY_TASK_PRIORITY: "user",
      HAPPY_TASK_SERVER_URL: "https://server.test",
      HAPPY_TASK_RESULT_TOKEN: "task-token-123",
      HAPPY_TASK_REPORT_URL: "https://server.test/v1/tasks/result",
    });
    expect(call.environmentVariables.HAPPY_TASK_AUTH_TOKEN).toBeUndefined();
    expect(call.environmentVariables.HAPPY_INITIAL_PROMPT_FILE).toBeTypeOf("string");
  });

  it("writes result reporting instructions into the task prompt", async () => {
    let promptPath = "";
    const spawnSession = vi.fn(async (options: any) => {
      promptPath = options.environmentVariables.HAPPY_INITIAL_PROMPT_FILE;
      return {
        type: "success" as const,
        sessionId: "session-1",
      };
    });

    await runTaskJob(
      {
        type: "task-trigger",
        taskId: "task-1",
        prompt: "Implement the feature",
        directory: "/tmp",
        priority: "user",
        resultToken: "task-token-123",
      },
      {
        spawnSession,
        serverUrl: "https://server.test",
      },
    );

    const { readFile } = await import("node:fs/promises");
    const prompt = await readFile(promptPath, "utf-8");

    expect(prompt).toContain("## Task Result Reporting");
    expect(prompt).toContain("HAPPY_TASK_REPORT_URL");
    expect(prompt).toContain("HAPPY_TASK_RESULT_TOKEN");
    expect(prompt).not.toContain("HAPPY_TASK_AUTH_TOKEN");
    expect(prompt).toContain('outcome: "blocked"');
    expect(prompt).toContain("summary");
  });

  it("expands tilde directory before writing prompt file", async () => {
    let promptPath = "";
    const spawnSession = vi.fn(async (options: any) => {
      promptPath = options.environmentVariables.HAPPY_INITIAL_PROMPT_FILE;
      return {
        type: "success" as const,
        sessionId: "session-1",
      };
    });

    await runTaskJob(
      {
        type: "task-trigger",
        taskId: "task-tilde",
        prompt: "Handle projectless task",
        directory: "~",
        priority: "user",
        resultToken: "task-token-123",
      },
      {
        spawnSession,
      },
    );

    expect(promptPath.startsWith("~")).toBe(false);
  });

  it("forces Codex automation tasks onto GPT-5.5", async () => {
    const spawnSession = vi.fn(async () => ({
      type: "success" as const,
      sessionId: "session-codex",
    }));

    await runTaskJob(
      {
        type: "task-trigger",
        taskId: "task-codex",
        prompt: "Investigate the failure",
        directory: "/tmp",
        priority: "user",
        agentType: "codex",
        modelOverride: "gpt-5.4-mini",
      },
      {
        spawnSession,
      },
    );

    const call = (spawnSession.mock.calls as unknown as any[][])[0]?.[0] as any;
    expect(call.environmentVariables.OPENAI_MODEL).toBe("gpt-5.5");
  });
});
