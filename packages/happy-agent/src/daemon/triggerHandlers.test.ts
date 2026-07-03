import { describe, it, expect } from "vitest";
import { buildTaskSpawnEnv, type TaskTriggerData } from "./triggerHandlers";

function taskData(overrides: Partial<TaskTriggerData> = {}): TaskTriggerData {
  return {
    type: "task-trigger",
    taskId: "t1",
    prompt: "do it",
    directory: "/repo",
    priority: "user",
    ...overrides,
  };
}

describe("buildTaskSpawnEnv", () => {
  it("sets the core HAPPY_TASK_* vars and derives the report URL from serverUrl", () => {
    const env = buildTaskSpawnEnv(taskData(), "/tmp/p.md", "https://srv");
    expect(env.HAPPY_INITIAL_PROMPT_FILE).toBe("/tmp/p.md");
    expect(env.HAPPY_TASK_ID).toBe("t1");
    expect(env.HAPPY_TASK_PRIORITY).toBe("user");
    expect(env.HAPPY_TASK_SERVER_URL).toBe("https://srv");
    expect(env.HAPPY_TASK_REPORT_URL).toBe("https://srv/v1/tasks/t1/result");
    expect(env.HAPPY_TASK_RESULT_TOKEN).toBe(""); // defaults to empty
  });

  it("carries the result token when present", () => {
    const env = buildTaskSpawnEnv(taskData({ resultToken: "tok" }), "/p", "https://srv");
    expect(env.HAPPY_TASK_RESULT_TOKEN).toBe("tok");
  });

  it("applies profile env FIRST so task-specific vars win on collision", () => {
    const env = buildTaskSpawnEnv(
      taskData({
        runtimeProfile: {
          environmentVariables: {
            CUSTOM: "from-profile",
            HAPPY_TASK_ID: "profile-should-lose",
          },
        } as unknown as TaskTriggerData["runtimeProfile"],
      }),
      "/p",
      "https://srv",
    );
    expect(env.CUSTOM).toBe("from-profile"); // profile-only var survives
    expect(env.HAPPY_TASK_ID).toBe("t1"); // task var overrides the profile's
  });

  it("expands skill contents into indexed vars plus a count", () => {
    const env = buildTaskSpawnEnv(
      taskData({
        skillContents: [
          { name: "a", content: "A" },
          { name: "b", content: "B" },
        ],
      }),
      "/p",
      "https://srv",
    );
    expect(env.HAPPY_TASK_SKILL_COUNT).toBe("2");
    expect(env.HAPPY_TASK_SKILL_0_NAME).toBe("a");
    expect(env.HAPPY_TASK_SKILL_0_CONTENT).toBe("A");
    expect(env.HAPPY_TASK_SKILL_1_NAME).toBe("b");
    expect(env.HAPPY_TASK_SKILL_1_CONTENT).toBe("B");
  });

  it("adds no skill vars when there are no skill contents", () => {
    const env = buildTaskSpawnEnv(taskData({ skillContents: [] }), "/p", "https://srv");
    expect(env.HAPPY_TASK_SKILL_COUNT).toBeUndefined();
    expect(Object.keys(env).some((k) => k.startsWith("HAPPY_TASK_SKILL_"))).toBe(false);
  });
});
