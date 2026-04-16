import { describe, expect, it, vi } from "vitest";
import { resolveGuardianSession } from "./resolveGuardianSession";

describe("resolveGuardianSession", () => {
  it("returns the candidate session when it is still tracked", () => {
    const forgetSession = vi.fn();
    const onStaleSession = vi.fn();

    const resolved = resolveGuardianSession({
      candidateSessionId: "session-live",
      isSessionTracked: (sessionId) => sessionId === "session-live",
      forgetSession,
      onStaleSession,
    });

    expect(resolved).toBe("session-live");
    expect(forgetSession).not.toHaveBeenCalled();
    expect(onStaleSession).not.toHaveBeenCalled();
  });

  it("forgets stale guardian sessions instead of reusing them", () => {
    const forgetSession = vi.fn();
    const onStaleSession = vi.fn();

    const resolved = resolveGuardianSession({
      candidateSessionId: "session-stale",
      isSessionTracked: () => false,
      forgetSession,
      onStaleSession,
    });

    expect(resolved).toBeUndefined();
    expect(forgetSession).toHaveBeenCalledWith("session-stale");
    expect(onStaleSession).toHaveBeenCalledWith("session-stale");
  });
});
