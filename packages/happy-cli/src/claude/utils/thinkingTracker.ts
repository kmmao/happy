/**
 * ThinkingTracker — Unified thinking state machine for claudeLocal mode.
 *
 * Fuses three signal sources:
 *  1. fd3 fetch events (fast, but only covers HTTP requests)
 *  2. JSONL assistant messages (slightly delayed, but covers tool execution gaps)
 *  3. JSONL tool lifecycle (tool_use in assistant → tool_result in user)
 *
 * Rules:
 *  - fetch-start        → thinking=true immediately, cancel idle timer
 *  - fetch-end          → if no active fetches AND no active tools, start idle timer
 *  - tool-use-start     → mark tool active, cancel idle timer, keep thinking=true
 *  - tool-use-end       → mark tool done; if no active fetches/tools, start idle timer
 *  - assistant message   → if thinking, reset (extend) idle timer
 *  - idle timer expires  → thinking=false
 *  - process exit        → thinking=false immediately
 */

export interface ThinkingTracker {
  /** fd3: HTTP request started */
  onFetchStart(id: number): void;
  /** fd3: HTTP request ended */
  onFetchEnd(id: number): void;
  /** JSONL: new assistant message arrived */
  onAssistantMessage(): void;
  /** JSONL: tool_use block detected in assistant message */
  onToolUseStart(callId: string): void;
  /** JSONL: tool_result block detected in user message */
  onToolUseEnd(callId: string): void;
  /** Claude Code process exited */
  onProcessExit(): void;
  /** Cleanup all timers */
  cleanup(): void;
}

export function createThinkingTracker(opts: {
  onChange: (thinking: boolean) => void;
  idleTimeoutMs?: number;
}): ThinkingTracker {
  const idleTimeoutMs = opts.idleTimeoutMs ?? 5000;

  let thinking = false;
  let activeFetches = new Set<number>();
  let activeToolCalls = new Set<string>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function setThinking(value: boolean): void {
    if (thinking !== value) {
      thinking = value;
      opts.onChange(value);
    }
  }

  function clearIdleTimer(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function hasActiveWork(): boolean {
    return activeFetches.size > 0 || activeToolCalls.size > 0;
  }

  function startIdleTimer(): void {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!hasActiveWork()) {
        setThinking(false);
      }
    }, idleTimeoutMs);
  }

  return {
    onFetchStart(id: number): void {
      activeFetches.add(id);
      clearIdleTimer();
      setThinking(true);
    },

    onFetchEnd(id: number): void {
      activeFetches.delete(id);
      if (!hasActiveWork() && thinking) {
        startIdleTimer();
      }
    },

    onToolUseStart(callId: string): void {
      activeToolCalls.add(callId);
      clearIdleTimer();
      // Keep thinking=true (should already be true from fetch)
      setThinking(true);
    },

    onToolUseEnd(callId: string): void {
      activeToolCalls.delete(callId);
      if (!hasActiveWork() && thinking) {
        startIdleTimer();
      }
    },

    onAssistantMessage(): void {
      // Only extend if already thinking — don't start thinking from JSONL alone.
      // An assistant message means Claude just responded and may be about to
      // execute tools, so extend the idle window.
      if (thinking && idleTimer !== null) {
        startIdleTimer();
      }
    },

    onProcessExit(): void {
      clearIdleTimer();
      activeFetches.clear();
      activeToolCalls.clear();
      setThinking(false);
    },

    cleanup(): void {
      clearIdleTimer();
      activeFetches.clear();
      activeToolCalls.clear();
    },
  };
}
