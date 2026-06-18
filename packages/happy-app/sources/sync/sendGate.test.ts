import { describe, expect, it } from "vitest";

import { checkSendEligibility, type SendGateState } from "./sendGate";

// One snapshot constructor + five blockers + a happy path. Precedence is
// the load-bearing invariant — multiple existing dispatcher tests (e.g.
// "does not send while the session is running" + "respects paused queues
// until explicitly forced") would silently break if no-session lost
// priority to paused, or if running lost priority to in-flight, etc.
// The combinatorial precedence tests below pin each ordering.

const eligibleState = (): SendGateState => ({
  sessionExists: true,
  isSessionRunning: false,
  isInFlight: false,
  isPaused: false,
  hasOverride: false,
  queueLength: 1,
});

describe("checkSendEligibility — happy path", () => {
  it("returns eligible:true when every condition allows a send", () => {
    expect(checkSendEligibility(eligibleState())).toEqual({ eligible: true });
  });
});

describe("checkSendEligibility — single blockers", () => {
  it("blocks with 'no-session' when the session entry is missing", () => {
    expect(
      checkSendEligibility({ ...eligibleState(), sessionExists: false }),
    ).toEqual({ eligible: false, reason: "no-session" });
  });

  it("blocks with 'session-running' when the session is mid-turn", () => {
    expect(
      checkSendEligibility({ ...eligibleState(), isSessionRunning: true }),
    ).toEqual({ eligible: false, reason: "session-running" });
  });

  it("blocks with 'in-flight' when a prior send is still pending an ack", () => {
    expect(
      checkSendEligibility({ ...eligibleState(), isInFlight: true }),
    ).toEqual({ eligible: false, reason: "in-flight" });
  });

  it("blocks with 'paused' when the queue is paused and no override is set", () => {
    expect(
      checkSendEligibility({ ...eligibleState(), isPaused: true }),
    ).toEqual({ eligible: false, reason: "paused" });
  });

  it("allows the send when the queue is paused but the dispatcher armed an override", () => {
    // This is the `schedule({ ignorePaused: true })` path — the existing
    // SessionView call sites depend on it for compose-while-paused.
    expect(
      checkSendEligibility({
        ...eligibleState(),
        isPaused: true,
        hasOverride: true,
      }),
    ).toEqual({ eligible: true });
  });

  it("blocks with 'empty-queue' when there is nothing to send", () => {
    expect(
      checkSendEligibility({ ...eligibleState(), queueLength: 0 }),
    ).toEqual({ eligible: false, reason: "empty-queue" });
  });
});

describe("checkSendEligibility — precedence (matches dispatchIfReady cascade)", () => {
  it("no-session beats every other blocker", () => {
    expect(
      checkSendEligibility({
        sessionExists: false,
        isSessionRunning: true,
        isInFlight: true,
        isPaused: true,
        hasOverride: false,
        queueLength: 0,
      }),
    ).toEqual({ eligible: false, reason: "no-session" });
  });

  it("session-running beats in-flight, paused, and empty-queue", () => {
    expect(
      checkSendEligibility({
        sessionExists: true,
        isSessionRunning: true,
        isInFlight: true,
        isPaused: true,
        hasOverride: false,
        queueLength: 0,
      }),
    ).toEqual({ eligible: false, reason: "session-running" });
  });

  it("in-flight beats paused and empty-queue", () => {
    expect(
      checkSendEligibility({
        sessionExists: true,
        isSessionRunning: false,
        isInFlight: true,
        isPaused: true,
        hasOverride: false,
        queueLength: 0,
      }),
    ).toEqual({ eligible: false, reason: "in-flight" });
  });

  it("paused beats empty-queue when no override is set", () => {
    expect(
      checkSendEligibility({
        sessionExists: true,
        isSessionRunning: false,
        isInFlight: false,
        isPaused: true,
        hasOverride: false,
        queueLength: 0,
      }),
    ).toEqual({ eligible: false, reason: "paused" });
  });

  it("empty-queue surfaces when nothing else is blocking", () => {
    expect(
      checkSendEligibility({
        sessionExists: true,
        isSessionRunning: false,
        isInFlight: false,
        isPaused: false,
        hasOverride: false,
        queueLength: 0,
      }),
    ).toEqual({ eligible: false, reason: "empty-queue" });
  });

  it("override lifts the paused blocker but does not bypass an empty queue", () => {
    expect(
      checkSendEligibility({
        sessionExists: true,
        isSessionRunning: false,
        isInFlight: false,
        isPaused: true,
        hasOverride: true,
        queueLength: 0,
      }),
    ).toEqual({ eligible: false, reason: "empty-queue" });
  });
});
