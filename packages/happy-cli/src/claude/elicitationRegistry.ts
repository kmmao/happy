/**
 * elicitationRegistry — the lifecycle seam for MCP elicitations in the remote
 * launcher. An elicitation is a server-initiated question ("this MCP tool
 * needs input") forwarded to the App and answered asynchronously over RPC;
 * between those two moments it is a pending Promise that must survive across
 * turns, resolve exactly once, and never leak a listener.
 *
 * The registry owns those invariants:
 *   - id allocation and the pending map (open → settle | abort | drain),
 *   - response validation (unknown id / invalid action are ignored, the
 *     pending entry stays),
 *   - abort wiring (signal abort rejects AND removes the listener so a
 *     settled elicitation can never fire its abort path later),
 *   - drainAll for launcher teardown (reject everything; deliberately does
 *     NOT fire onClose — the session is ending, there is no banner left to
 *     clear).
 *
 * What stays in the launcher: the App-facing surfaces — the agent-state
 * banner shape and the push notification — injected as onOpen/onClose so the
 * lifecycle is testable without a Session.
 */

import type { ElicitationRequest, ElicitationResult } from "./jsonl/types";

const VALID_ACTIONS = ["accept", "decline", "cancel"] as const;
type ElicitationAction = (typeof VALID_ACTIONS)[number];

export interface ElicitationResponse {
  id: string;
  action: string;
  content?: Record<string, unknown>;
}

export interface ElicitationRegistryDeps {
  /** Surface the elicitation to the App (agent-state banner + push). */
  onOpen: (id: string, request: ElicitationRequest) => void;
  /** Clear the App-facing banner (settle and abort paths). */
  onClose: () => void;
  log: (message: string) => void;
}

export interface ElicitationRegistry {
  /** Pending count — read by the strand watchdog's silence gate. */
  size(): number;
  /**
   * Open an elicitation: allocate an id, surface it via onOpen, and return a
   * Promise that settles on the App's RPC response or rejects on abort.
   */
  open(
    request: ElicitationRequest,
    options: { signal: AbortSignal },
  ): Promise<ElicitationResult>;
  /**
   * Apply an App RPC response. Returns false (and keeps the pending entry)
   * for an unknown id or invalid action; true when the elicitation settled.
   */
  settle(response: ElicitationResponse): boolean;
  /** Reject every pending elicitation (launcher teardown; no onClose). */
  drainAll(error: Error): void;
}

export function createElicitationRegistry(
  deps: ElicitationRegistryDeps,
): ElicitationRegistry {
  const pending = new Map<
    string,
    { resolve: (result: ElicitationResult) => void; reject: (err: Error) => void }
  >();
  let counter = 0;

  return {
    size() {
      return pending.size;
    },

    open(request, options) {
      const id = `elicit-${++counter}`;
      deps.log(
        `[remote]: MCP elicitation request from ${request.mcpServerName}: ${id}`,
      );

      return new Promise<ElicitationResult>((resolve, reject) => {
        const abortHandler = () => {
          pending.delete(id);
          deps.onClose();
          reject(new Error("Elicitation aborted"));
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });

        pending.set(id, {
          resolve: (result) => {
            options.signal.removeEventListener("abort", abortHandler);
            resolve(result);
          },
          reject: (err) => {
            options.signal.removeEventListener("abort", abortHandler);
            reject(err);
          },
        });

        deps.onOpen(id, request);
      });
    },

    settle(response) {
      const pendingItem = pending.get(response.id);
      if (!pendingItem) {
        deps.log(`[remote]: elicitationResponse for unknown id ${response.id}`);
        return false;
      }
      if (!VALID_ACTIONS.includes(response.action as ElicitationAction)) {
        deps.log(`[remote]: invalid elicitation action: ${response.action}`);
        return false;
      }
      pending.delete(response.id);
      deps.onClose();
      pendingItem.resolve({
        action: response.action as ElicitationAction,
        content: response.content,
      } as ElicitationResult);
      return true;
    },

    drainAll(error) {
      for (const [, { reject }] of pending) {
        reject(error);
      }
      pending.clear();
    },
  };
}
