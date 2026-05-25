/**
 * Session — session-id discovery channel tests.
 *
 * Focus: the `addSessionFoundCallback` / `onSessionFound` contract that feeds
 * the JSONL scanner. The interesting case is the *late subscriber* — a callback
 * that registers after the SessionStart hook has already reported the id. In
 * PTY/Remote mode the claude process is live (and can fire SessionStart) from
 * the moment `startClaudePty` runs, while claudeRemote only subscribes its
 * scanner a couple of awaits later; without a replay that race leaves the
 * scanner watching nothing. These tests pin the replay and the forward path.
 *
 * No module mocking: `Session` only touches `client.keepAlive` (constructor +
 * keep-alive interval) and `client.updateMetadata` (in `onSessionFound`), so we
 * inject a tiny recording double via the constructor and leave the rest as
 * unused casts.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Session } from "./session";
import type { ApiClient, ApiSessionClient } from "@/lib";
import type { MessageQueue2 } from "@/utils/MessageQueue2";
import type { EnhancedMode } from "./loop";

function makeSession(sessionId: string | null): Session {
  let metadata: Record<string, unknown> = {};
  const client = {
    keepAlive: () => undefined,
    updateMetadata: (handler: (m: Record<string, unknown>) => Record<string, unknown>) => {
      metadata = handler(metadata);
    },
  } as unknown as ApiSessionClient;

  return new Session({
    api: {} as unknown as ApiClient,
    client,
    path: "/tmp/session-test",
    logPath: "/tmp/session-test/log",
    sessionId,
    mcpServers: {},
    messageQueue: {} as unknown as MessageQueue2<EnhancedMode>,
    onModeChange: () => undefined,
    hookSettingsPath: "/tmp/session-test/hook.json",
  });
}

describe("Session session-id discovery channel", () => {
  const sessions: Session[] = [];

  function build(sessionId: string | null): Session {
    const s = makeSession(sessionId);
    sessions.push(s);
    return s;
  }

  afterEach(() => {
    // Stop the 2s keep-alive interval started in the constructor.
    sessions.splice(0).forEach((s) => s.cleanup());
  });

  it("replays the last-known id to a late subscriber (the spawn→subscribe race)", () => {
    const s = build(null);
    // SessionStart hook arrives BEFORE the scanner subscribes.
    s.onSessionFound("sid-1");

    const seen: string[] = [];
    s.addSessionFoundCallback((id) => seen.push(id));

    // Replayed immediately on registration — the scanner learns the id it
    // would otherwise have missed entirely.
    expect(seen).toEqual(["sid-1"]);
  });

  it("replays an id already known at construction", () => {
    const s = build("sid-0");
    const seen: string[] = [];
    s.addSessionFoundCallback((id) => seen.push(id));
    expect(seen).toEqual(["sid-0"]);
  });

  it("does not fire when no id is known yet, then forwards the first discovery", () => {
    const s = build(null);
    const seen: string[] = [];
    s.addSessionFoundCallback((id) => seen.push(id));
    // No id yet → no replay.
    expect(seen).toEqual([]);

    s.onSessionFound("sid-1");
    expect(seen).toEqual(["sid-1"]);
  });

  it("notifies an early subscriber exactly once (no replay double-fire)", () => {
    const s = build(null);
    const early: string[] = [];
    const late: string[] = [];

    // Subscribed before any id is known → no replay at registration.
    s.addSessionFoundCallback((id) => early.push(id));
    expect(early).toEqual([]);

    // Discovery fans out to every current subscriber once.
    s.onSessionFound("sid-1");
    expect(early).toEqual(["sid-1"]);

    // A subscriber added afterwards gets the id via replay, while the early
    // subscriber is NOT notified a second time.
    s.addSessionFoundCallback((id) => late.push(id));
    expect(late).toEqual(["sid-1"]);
    expect(early).toEqual(["sid-1"]);
  });

  it("stops notifying after removeSessionFoundCallback (the exit unsubscribe path)", () => {
    const s = build(null);
    const seen: string[] = [];
    const cb = (id: string) => seen.push(id);

    s.addSessionFoundCallback(cb);
    s.removeSessionFoundCallback(cb);

    s.onSessionFound("sid-1");
    expect(seen).toEqual([]);
  });
});
