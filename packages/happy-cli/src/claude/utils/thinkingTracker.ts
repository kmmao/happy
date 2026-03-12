/**
 * ThinkingTracker — Unified thinking state machine for claudeLocal mode.
 *
 * Fuses two signal sources:
 *  1. fd3 fetch events (fast, but only covers HTTP requests)
 *  2. JSONL assistant messages (slightly delayed, but covers tool execution gaps)
 *
 * Rules:
 *  - fetch-start        → thinking=true immediately, cancel idle timer
 *  - fetch-end          → if no active fetches, start idle timer
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
  /** Claude Code process exited */
  onProcessExit(): void;
  /** Cleanup all timers */
  cleanup(): void;
}

export function createThinkingTracker(opts: {
  onChange: (thinking: boolean) => void;
  idleTimeoutMs?: number;
}): ThinkingTracker {
  const idleTimeoutMs = opts.idleTimeoutMs ?? 2000;

  let thinking = false;
  let activeFetches = new Set<number>();
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

  function startIdleTimer(): void {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (activeFetches.size === 0) {
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
      if (activeFetches.size === 0 && thinking) {
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
      setThinking(false);
    },

    cleanup(): void {
      clearIdleTimer();
      activeFetches.clear();
    },
  };
}
