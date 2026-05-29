import { describe, it, expect } from "vitest";
import { recipientMatches, ConnectionScope } from "./recipientMatcher";
import type { RecipientFilter } from "./eventRouter";

const userConn: ConnectionScope = { connectionType: "user-scoped" };
const sessA: ConnectionScope = { connectionType: "session-scoped", sessionId: "A" };
const sessB: ConnectionScope = { connectionType: "session-scoped", sessionId: "B" };
const machX: ConnectionScope = { connectionType: "machine-scoped", machineId: "X" };
const machY: ConnectionScope = { connectionType: "machine-scoped", machineId: "Y" };

describe("recipientMatches — scope routing matrix", () => {
  it("all-interested-in-session: user-scoped + matching session, never other sessions or machines", () => {
    const f: RecipientFilter = { type: "all-interested-in-session", sessionId: "A" };
    expect(recipientMatches(userConn, f)).toBe(true);
    expect(recipientMatches(sessA, f)).toBe(true);
    expect(recipientMatches(sessB, f)).toBe(false); // wrong session
    expect(recipientMatches(machX, f)).toBe(false); // machines never
  });

  it("user-scoped-only: only user-scoped connections", () => {
    const f: RecipientFilter = { type: "user-scoped-only" };
    expect(recipientMatches(userConn, f)).toBe(true);
    expect(recipientMatches(sessA, f)).toBe(false);
    expect(recipientMatches(machX, f)).toBe(false);
  });

  it("machine-scoped-only: all user-scoped + the matching machine, never session-scoped or other machines", () => {
    const f: RecipientFilter = { type: "machine-scoped-only", machineId: "X" };
    expect(recipientMatches(userConn, f)).toBe(true); // mobile/web needs all machine updates
    expect(recipientMatches(machX, f)).toBe(true); // the named machine
    expect(recipientMatches(machY, f)).toBe(false); // a different machine
    expect(recipientMatches(sessA, f)).toBe(false); // sessions don't need machine updates
  });

  it("all-user-authenticated-connections: every connection type", () => {
    const f: RecipientFilter = { type: "all-user-authenticated-connections" };
    expect(recipientMatches(userConn, f)).toBe(true);
    expect(recipientMatches(sessA, f)).toBe(true);
    expect(recipientMatches(machX, f)).toBe(true);
  });
});
