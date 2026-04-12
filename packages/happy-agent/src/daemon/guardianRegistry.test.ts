import { describe, it, expect } from "vitest";
import { GuardianSessionRegistry } from "./guardianRegistry";

describe("GuardianSessionRegistry", () => {
  it("resolve — returns null when empty", () => {
    const reg = new GuardianSessionRegistry();
    expect(reg.resolve({ loopId: "loop-1" })).toBeNull();
    expect(reg.resolve({ projectId: "proj-1" })).toBeNull();
  });

  it("remember + resolve — loop key takes priority", () => {
    const reg = new GuardianSessionRegistry();
    reg.remember("session-A", { loopId: "loop-1", projectId: "proj-1" });

    expect(reg.resolve({ loopId: "loop-1" })).toBe("session-A");
    expect(reg.resolve({ projectId: "proj-1" })).toBe("session-A");
  });

  it("resolve — loop key before project key", () => {
    const reg = new GuardianSessionRegistry();
    reg.remember("session-loop", { loopId: "loop-1" });
    reg.remember("session-project", { projectId: "proj-1" });

    // When both loopId and projectId provided, loop wins
    expect(reg.resolve({ loopId: "loop-1", projectId: "proj-1" })).toBe("session-loop");
  });

  it("remember — does not overwrite project key if already set", () => {
    const reg = new GuardianSessionRegistry();
    reg.remember("session-1", { projectId: "proj-1" });
    reg.remember("session-2", { loopId: "loop-1", projectId: "proj-1" });

    // Project key keeps original session-1
    expect(reg.resolve({ projectId: "proj-1" })).toBe("session-1");
    // Loop key has session-2
    expect(reg.resolve({ loopId: "loop-1" })).toBe("session-2");
  });

  it("forgetSession — removes all entries for that session", () => {
    const reg = new GuardianSessionRegistry();
    reg.remember("session-X", { loopId: "loop-1", projectId: "proj-1" });

    expect(reg.size).toBe(2); // loop + project keys

    const removed = reg.forgetSession("session-X");
    expect(removed).toBe(2);
    expect(reg.size).toBe(0);
    expect(reg.resolve({ loopId: "loop-1" })).toBeNull();
  });

  it("forgetLoop — removes only loop entry", () => {
    const reg = new GuardianSessionRegistry();
    reg.remember("session-A", { loopId: "loop-1", projectId: "proj-1" });

    expect(reg.forgetLoop("loop-1")).toBe(true);
    expect(reg.resolve({ loopId: "loop-1" })).toBeNull();
    // Project entry still exists
    expect(reg.resolve({ projectId: "proj-1" })).toBe("session-A");
  });

  it("getSnapshot — returns all entries", () => {
    const reg = new GuardianSessionRegistry();
    reg.remember("s1", { loopId: "loop-1" });
    reg.remember("s2", { loopId: "loop-2" });

    const snapshot = reg.getSnapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((e) => e.sessionId).sort()).toEqual(["s1", "s2"]);
  });

  it("forgetSession — noop for unknown session", () => {
    const reg = new GuardianSessionRegistry();
    expect(reg.forgetSession("nonexistent")).toBe(0);
  });
});
