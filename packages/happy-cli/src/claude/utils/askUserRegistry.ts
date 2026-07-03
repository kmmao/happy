/**
 * ask_user pending-request registry — the state machine behind the
 * `mcp__happy__ask_user` tool, lifted out of `startHappyServer`.
 *
 * One ask_user invocation lives across three touch points: the MCP tool handler
 * registers a pending entry and awaits its resolver; the `ask_user_response` RPC
 * resolves (answers) or rejects (user declined) it; the SDK abort signal and a
 * 30-minute timeout each reject it; and session teardown rejects them all. Those
 * five transitions used to be hand-wired against a shared `Map` scattered across
 * the two handlers, with the timer clear/reject dance repeated at each site — a
 * class of "forgot to clearTimeout" / "rejected an already-settled entry" bugs.
 *
 * This registry owns the Map + timer lifecycle behind one small interface:
 * `register` returns the awaited promise (and arms the timeout), and
 * `resolve` / `reject` / `rejectAll` settle entries exactly once (clearing the
 * timer, deleting the entry). Pure and timer-testable — the interface is the
 * test surface. The handlers keep only their transport concerns (agentState
 * bookkeeping, MCP result shaping).
 */

export type AskUserAnswers = Record<string, string>;

type PendingAsk = {
  resolve: (answers: AskUserAnswers) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface AskUserRegistry {
  /**
   * Register a pending ask and return the promise the MCP handler awaits. The
   * promise rejects automatically after `timeoutMs` if no one settled it.
   */
  register(askId: string, timeoutMs: number): Promise<AskUserAnswers>;
  /** Settle with the user's answers. Returns false if no pending entry existed. */
  resolve(askId: string, answers: AskUserAnswers): boolean;
  /** Settle by rejecting with `reason` (user declined / client abort). Returns false if none. */
  reject(askId: string, reason: string): boolean;
  /** Reject every surviving entry (session/server teardown). */
  rejectAll(reason: string): void;
  /** Number of currently-pending asks. */
  readonly size: number;
}

export function createAskUserRegistry(): AskUserRegistry {
  const pending = new Map<string, PendingAsk>();

  // Pull an entry out of the map and stop its timer, so a settle happens once.
  function take(askId: string): PendingAsk | undefined {
    const entry = pending.get(askId);
    if (!entry) return undefined;
    pending.delete(askId);
    clearTimeout(entry.timer);
    return entry;
  }

  return {
    register(askId, timeoutMs) {
      return new Promise<AskUserAnswers>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.delete(askId)) return;
          reject(
            new Error(
              `ask_user timed out after ${Math.round(timeoutMs / 60000)} minutes with no response from user`,
            ),
          );
        }, timeoutMs);
        pending.set(askId, { resolve, reject, timer });
      });
    },

    resolve(askId, answers) {
      const entry = take(askId);
      if (!entry) return false;
      entry.resolve(answers);
      return true;
    },

    reject(askId, reason) {
      const entry = take(askId);
      if (!entry) return false;
      entry.reject(new Error(reason));
      return true;
    },

    rejectAll(reason) {
      if (pending.size === 0) return;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      }
      pending.clear();
    },

    get size() {
      return pending.size;
    },
  };
}
