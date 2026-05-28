import { describe, expect, it } from "vitest";
import { SpawnSessionResultSchema } from "./spawnSession";

describe("SpawnSessionResultSchema", () => {
  it("accepts a success result carrying the new session id", () => {
    const parsed = SpawnSessionResultSchema.parse({
      type: "success",
      sessionId: "sess-1",
    });
    expect(parsed).toEqual({ type: "success", sessionId: "sess-1" });
  });

  it("accepts a directory-approval request", () => {
    const parsed = SpawnSessionResultSchema.parse({
      type: "requestToApproveDirectoryCreation",
      directory: "/work/new-project",
    });
    expect(parsed.type).toBe("requestToApproveDirectoryCreation");
  });

  it("accepts an error result", () => {
    const parsed = SpawnSessionResultSchema.parse({
      type: "error",
      errorMessage: "boom",
    });
    expect(parsed).toEqual({ type: "error", errorMessage: "boom" });
  });

  it("rejects a success result missing the session id", () => {
    expect(() =>
      SpawnSessionResultSchema.parse({ type: "success" }),
    ).toThrow();
  });

  it("rejects an unknown result type", () => {
    expect(() =>
      SpawnSessionResultSchema.parse({ type: "pending", pid: 1 }),
    ).toThrow();
  });
});
