import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createThinkingTracker } from "./thinkingTracker";

describe("ThinkingTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should set thinking=true on fetch-start", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange });

    tracker.onFetchStart(1);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("should set thinking=false after fetch-end + idle timeout", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    tracker.onFetchStart(1);
    tracker.onFetchEnd(1);

    // Not yet — idle timer still running
    expect(onChange).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("should not set thinking=false before idle timeout expires", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    tracker.onFetchStart(1);
    tracker.onFetchEnd(1);

    vi.advanceTimersByTime(1999);

    expect(onChange).toHaveBeenCalledTimes(1); // only the true call
  });

  it("should extend idle timer on assistant message", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    tracker.onFetchStart(1);
    tracker.onFetchEnd(1);

    // After 1.5s, assistant message arrives → reset timer
    vi.advanceTimersByTime(1500);
    tracker.onAssistantMessage();

    // At 3s (1.5s after reset), timer not yet expired
    vi.advanceTimersByTime(1500);
    expect(onChange).toHaveBeenCalledTimes(1); // still only the true call

    // At 3.5s (2s after reset), timer expires
    vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("should handle multiple concurrent fetches", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    tracker.onFetchStart(1);
    tracker.onFetchStart(2);
    tracker.onFetchEnd(1);

    // Still one active fetch — no idle timer should start
    vi.advanceTimersByTime(5000);
    expect(onChange).toHaveBeenCalledTimes(1); // only the first true

    tracker.onFetchEnd(2);
    vi.advanceTimersByTime(2000);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("should cancel idle timer on new fetch-start", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    tracker.onFetchStart(1);
    tracker.onFetchEnd(1);

    // Before idle expires, a new fetch starts
    vi.advanceTimersByTime(1000);
    tracker.onFetchStart(2);

    // Original idle timer should be cancelled
    vi.advanceTimersByTime(5000);
    // Still thinking=true (fetch 2 is active)
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);

    tracker.cleanup();
  });

  it("should set thinking=false immediately on process exit", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange });

    tracker.onFetchStart(1);
    tracker.onProcessExit();

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("should not call onChange with duplicate values", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange });

    tracker.onFetchStart(1);
    tracker.onFetchStart(2); // already true, should not call again

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("should not start thinking from assistant message alone", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange });

    // Assistant message when not thinking — should be no-op
    tracker.onAssistantMessage();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("should not extend idle timer if no idle timer is running", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    // Start thinking with active fetch (no idle timer)
    tracker.onFetchStart(1);

    // Assistant message when fetch is still active — no idle timer to extend
    tracker.onAssistantMessage();

    // End fetch, start idle timer
    tracker.onFetchEnd(1);

    // Should still timeout at 2s from fetch-end, not extended
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("should reset state on process exit and allow reuse", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    // First round
    tracker.onFetchStart(1);
    tracker.onProcessExit();
    expect(onChange).toHaveBeenLastCalledWith(false);

    onChange.mockClear();

    // Second round (reuse after process restart)
    tracker.onFetchStart(2);
    expect(onChange).toHaveBeenCalledWith(true);

    tracker.onFetchEnd(2);
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("should not fire callbacks after cleanup", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    tracker.onFetchStart(1);
    tracker.onFetchEnd(1);
    tracker.cleanup();

    // Idle timer should have been cleared
    vi.advanceTimersByTime(5000);
    expect(onChange).toHaveBeenCalledTimes(1); // only the initial true
  });

  it("should use default 2000ms idle timeout", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange });

    tracker.onFetchStart(1);
    tracker.onFetchEnd(1);

    vi.advanceTimersByTime(1999);
    expect(onChange).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("should simulate a full Claude work cycle correctly", () => {
    const onChange = vi.fn();
    const tracker = createThinkingTracker({ onChange, idleTimeoutMs: 2000 });

    // T=0: fetch-start (Claude calls API)
    tracker.onFetchStart(10);
    expect(onChange).toHaveBeenLastCalledWith(true);

    // T=1000: fetch-end (API returns, Claude decides to call a tool)
    vi.advanceTimersByTime(1000);
    tracker.onFetchEnd(10);

    // T=1200: assistant message from JSONL → extends idle timer
    vi.advanceTimersByTime(200);
    tracker.onAssistantMessage();

    // T=2000: tool is still executing, only 800ms since assistant msg
    vi.advanceTimersByTime(800);
    expect(onChange).toHaveBeenCalledTimes(1); // still just the true

    // T=2500: tool sends result, new fetch starts
    vi.advanceTimersByTime(500);
    tracker.onFetchStart(11);
    // idle timer cancelled

    // T=3500: second fetch ends (final response, no tool call)
    vi.advanceTimersByTime(1000);
    tracker.onFetchEnd(11);

    // T=5500: idle timer expires → thinking=false
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenLastCalledWith(false);

    tracker.cleanup();
  });
});
