import { describe, expect, it, vi } from "vitest";
import {
  runWithSessionResumeGuard,
} from "./sessionResumeGuard";

describe("sessionResumeGuard", () => {
  it("blocks duplicate resume requests for the same happy session id while one is in flight", async () => {
    let release!: () => void;
    const first = runWithSessionResumeGuard("session-1", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "ok";
    });

    await expect(
      runWithSessionResumeGuard("session-1", async () => "duplicate"),
    ).rejects.toMatchObject({
      message: "该会话正在恢复中，请稍候。",
      name: "RetryableError",
    });

    release();
    await expect(first).resolves.toBe("ok");
  });

  it("allows different happy session ids to run concurrently", async () => {
    const taskA = runWithSessionResumeGuard("session-a", async () => "a");
    const taskB = runWithSessionResumeGuard("session-b", async () => "b");

    await expect(Promise.all([taskA, taskB])).resolves.toEqual(["a", "b"]);
  });

  it("clears the guard after the action fails", async () => {
    const failure = new Error("boom");
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce("recovered");

    await expect(
      runWithSessionResumeGuard("session-1", action),
    ).rejects.toThrow("boom");

    await expect(
      runWithSessionResumeGuard("session-1", action),
    ).resolves.toBe("recovered");
  });

  it("clears the guard after the action succeeds", async () => {
    const action = vi.fn<() => Promise<string>>().mockResolvedValue("done");

    await expect(
      runWithSessionResumeGuard("session-1", action),
    ).resolves.toBe("done");

    await expect(
      runWithSessionResumeGuard("session-1", action),
    ).resolves.toBe("done");
  });
});
