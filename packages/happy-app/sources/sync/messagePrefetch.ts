/**
 * Background prefetch of older messages.
 *
 * After the initial page of a session is loaded, this fire-and-forget loop
 * keeps pulling earlier pages (reusing the existing single-page "load earlier"
 * capability) until the whole history is in storage, so scrolling up never hits
 * the network. It is non-blocking, leaves a small gap between pages to stay easy
 * on bandwidth/CPU and the server, and is guarded against re-entrancy so a
 * session never runs more than one loop at a time.
 */

import { log } from "@/log";

const SLEEP_BETWEEN_PAGES_MS = 250;

export type OlderMessagePrefetchDeps = {
  /** Pulls exactly one older page; advances the oldest-seq cursor and updates hasServerOlderMessages. */
  fetchOlderMessages: (sessionId: string) => Promise<void>;
  /** Whether the server still has older messages for this session. */
  hasServerOlderMessages: (sessionId: string) => boolean;
  /** Whether per-session encryption is ready (loop pauses until it is). */
  hasSessionEncryption: (sessionId: string) => boolean;
  /** Current oldest seq cursor; loop stops once it reaches the start (<= 1). */
  getOldestSeq: (sessionId: string) => number | undefined;
  /** Set of sessions with an active loop; used to prevent concurrent loops. */
  activePrefetches: Set<string>;
  /** Override the inter-page delay (mainly for tests). */
  sleepMs?: number;
};

/**
 * Run the background older-message prefetch loop for a session.
 * No-op if a loop is already running for this session.
 */
export async function prefetchOlderMessagesInBackground(
  deps: OlderMessagePrefetchDeps,
  sessionId: string,
): Promise<void> {
  if (deps.activePrefetches.has(sessionId)) {
    return;
  }
  deps.activePrefetches.add(sessionId);

  const sleepMs = deps.sleepMs ?? SLEEP_BETWEEN_PAGES_MS;
  try {
    while (true) {
      if (!deps.hasServerOlderMessages(sessionId)) {
        return;
      }
      if (!deps.hasSessionEncryption(sessionId)) {
        return;
      }
      const oldestSeq = deps.getOldestSeq(sessionId);
      if (oldestSeq === undefined || oldestSeq <= 1) {
        return;
      }
      await deps.fetchOlderMessages(sessionId);
      if (sleepMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }
    }
  } catch (error) {
    log.log(`💬 prefetchOlderMessages stopped for ${sessionId}: ${error}`);
  } finally {
    deps.activePrefetches.delete(sessionId);
  }
}
