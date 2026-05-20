/**
 * Message fetch, decrypt, apply and cache management logic, extracted from sync.ts.
 * Handles forward/reverse pagination, per-session encryption, and debounced cache writes.
 */

import { Encryption } from "./encryption/encryption";
import { SessionEncryption } from "./encryption/sessionEncryption";
import { AuthCredentials } from "@/auth/tokenStorage";
import { apiSocket } from "./apiSocket";
import { storage } from "./storage";
import { log } from "@/log";
import { AsyncLock } from "@/utils/lock";
import { NonRetryableError } from "@/utils/time";
import {
  NormalizedMessage,
  normalizeRawMessage,
  collectSequencedHistorySignals,
  RawRecord,
} from "./typesRaw";
import { ApiMessage } from "./apiTypes";
import { Message } from "./typesMessage";
import { voiceHooks } from "@/realtime/hooks/voiceHooks";
import { autoOptionSendService } from "@/sync/autoOptionSendService";
import {
  saveMessageCache,
  deleteMessageCache,
  deleteHistoryComplete,
} from "./messageCache";
import {
  saveLastSeq,
  deleteLastSeq,
  deleteBackfillBoundary,
} from "./persistence";
import { getSessionUsageSummary } from "./apiUsage";
import { getLatestUserRequestPreview } from "@/utils/sessionUtils";
import { resolveMessageCursorAdvance } from "./messageCursor";
import {
  resolveMessageHistoryFetchStrategy,
  shouldApplyMessagesImmediately,
  shouldFetchNewestPageFirst,
} from "./messageFetchStrategy";
import { gitStatusSync } from "./gitStatusSync";
import { projectManager } from "./projectManager";
import { InvalidateSync } from "@/utils/sync";

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export type MessageFetchContext = {
  encryption: Encryption;
  sessionLastSeq: Map<string, number>;
  sessionMessageLocks: Map<string, AsyncLock>;
  processedWebSocketMessageIds: Map<string, Set<string>>;
  sessionOldestSeq: Map<string, number>;
  backfilledSessions: Set<string>;
  cacheWriteTimers: Map<string, ReturnType<typeof setTimeout>>;
  credentials: AuthCredentials | null;
  deleted404Sessions: Set<string>;
  messagesSync: Map<string, InvalidateSync>;
  sendSync: Map<string, InvalidateSync>;
  pendingOutbox: Map<string, unknown[]>;
  sessionMessageQueue: Map<string, NormalizedMessage[]>;
  sessionQueueProcessing: Set<string>;
  /** Callback to fully clean up a 404'd session (all state, including lastVisibleSessionId). */
  cleanupSession: (sessionId: string) => void;
  applySessions: (
    sessions: Array<{ id: string; sdkSessionState?: unknown; [key: string]: unknown }>,
  ) => void;
};

// ---------------------------------------------------------------------------
// Session local cleanup (helper – used by Sync.cleanupSessionLocally)
// ---------------------------------------------------------------------------

/**
 * Cleans per-session data structures that are safe to remove even while inside
 * lock.inLock() (does NOT touch sessionMessageLocks).
 * The Sync class wrapper additionally handles lastVisibleSessionId.
 */
export function cleanupSessionLocallyCore(
  ctx: Pick<
    MessageFetchContext,
    | "deleted404Sessions"
    | "encryption"
    | "messagesSync"
    | "sendSync"
    | "pendingOutbox"
    | "sessionLastSeq"
    | "sessionMessageQueue"
    | "sessionQueueProcessing"
  >,
  sessionId: string,
): void {
  ctx.deleted404Sessions.add(sessionId);
  storage.getState().deleteSession(sessionId);
  ctx.encryption.removeSessionEncryption(sessionId);
  projectManager.removeSession(sessionId);
  gitStatusSync.clearForSession(sessionId);
  // Remove from map so future invalidate() calls are no-ops,
  // but don't call stop() on messagesSync — we are inside this sync's callback.
  ctx.messagesSync.delete(sessionId);
  // sendSync is a separate object — safe to stop() from here.
  const sndSync = ctx.sendSync.get(sessionId);
  if (sndSync) {
    sndSync.stop();
    ctx.sendSync.delete(sessionId);
  }
  ctx.pendingOutbox.delete(sessionId);
  ctx.sessionLastSeq.delete(sessionId);
  deleteLastSeq(sessionId);
  deleteBackfillBoundary(sessionId);
  deleteMessageCache(sessionId);
  deleteHistoryComplete(sessionId);
  // Do NOT delete sessionMessageLocks — caller may still be inside lock.inLock().
  ctx.sessionMessageQueue.delete(sessionId);
  ctx.sessionQueueProcessing.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Decrypt + normalize a batch of raw messages
// ---------------------------------------------------------------------------

export async function decryptAndNormalizeBatchAction(
  encryption: SessionEncryption,
  rawMessages: ApiMessage[],
  sessionId?: string,
): Promise<{
  normalized: NormalizedMessage[];
  sequencedContents: Array<{ seq: number; content: RawRecord | null | undefined }>;
  processedSeqs: number[];
}> {
  const decryptedMessages = await encryption.decryptMessages(rawMessages);
  const normalized: NormalizedMessage[] = [];
  const sequencedContents: Array<{
    seq: number;
    content: RawRecord | null | undefined;
  }> = [];
  let decryptFailCount = 0;
  const processedSeqs: number[] = [];
  const failedSeqs: number[] = [];

  for (let i = 0; i < decryptedMessages.length; i++) {
    const decrypted = decryptedMessages[i];
    const rawMessage = rawMessages[i];
    if (!decrypted || decrypted.content === null) {
      decryptFailCount++;
      failedSeqs.push(rawMessage.seq);
      continue;
    }
    processedSeqs.push(rawMessage.seq);
    sequencedContents.push({ seq: rawMessage.seq, content: decrypted.content });
    const msg = normalizeRawMessage(
      decrypted.id,
      decrypted.localId,
      decrypted.createdAt,
      decrypted.content,
    );
    if (msg) normalized.push(msg);
  }

  if (decryptFailCount > 0) {
    log.warn(
      `⚠️ ${decryptFailCount}/${rawMessages.length} messages failed to decrypt for session ${sessionId ?? "unknown"} seqs=[${failedSeqs.join(",")}] (possible encryption key mismatch after session reconnect)`,
    );
  }

  return { normalized, sequencedContents, processedSeqs };
}

// ---------------------------------------------------------------------------
// Apply messages to storage
// ---------------------------------------------------------------------------

export function applyMessagesAction(
  ctx: Pick<MessageFetchContext, "cacheWriteTimers" | "sessionLastSeq">,
  sessionId: string,
  messages: NormalizedMessage[],
): void {
  const result = storage.getState().applyMessages(sessionId, messages);
  const m: Message[] = [];
  for (const messageId of result.changed) {
    const message =
      storage.getState().sessionMessages[sessionId]?.messagesMap[messageId];
    if (message) {
      m.push(message);
    }
  }
  if (m.length > 0) {
    voiceHooks.onMessages(sessionId, m);
    autoOptionSendService.onMessages(sessionId);
  }
  if (result.hasReadyEvent) {
    voiceHooks.onReady(sessionId);
    autoOptionSendService.onReady(sessionId);
  }

  // Schedule debounced cache write
  scheduleCacheWriteAction(ctx, sessionId);
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

export function scheduleCacheWriteAction(
  ctx: Pick<MessageFetchContext, "cacheWriteTimers" | "sessionLastSeq">,
  sessionId: string,
): void {
  const existing = ctx.cacheWriteTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
  }

  ctx.cacheWriteTimers.set(
    sessionId,
    setTimeout(() => {
      ctx.cacheWriteTimers.delete(sessionId);
      const session = storage.getState().sessionMessages[sessionId];
      const lastSeq = ctx.sessionLastSeq.get(sessionId) ?? 0;
      if (session?.isLoaded && session.messages.length > 0) {
        const latestRequestPreview =
          storage.getState().sessions[sessionId]?.latestUserRequestPreview ??
          getLatestUserRequestPreview(session.messages);
        saveMessageCache(sessionId, session.messages, lastSeq, latestRequestPreview);
      }
    }, 2000),
  );
}

export function flushPendingCacheWritesAction(
  ctx: Pick<MessageFetchContext, "cacheWriteTimers" | "sessionLastSeq">,
): void {
  for (const [sessionId, timer] of ctx.cacheWriteTimers) {
    clearTimeout(timer);
    const session = storage.getState().sessionMessages[sessionId];
    const lastSeq = ctx.sessionLastSeq.get(sessionId) ?? 0;
    const latestRequestPreview =
      storage.getState().sessions[sessionId]?.latestUserRequestPreview ??
      (session?.messages.length > 0
        ? getLatestUserRequestPreview(session.messages)
        : null);
    if (session?.isLoaded && session.messages.length > 0) {
      saveMessageCache(sessionId, session.messages, lastSeq, latestRequestPreview);
    }
  }
  ctx.cacheWriteTimers.clear();
}

export function cancelPendingCacheWritesAction(
  ctx: Pick<MessageFetchContext, "cacheWriteTimers">,
): void {
  for (const timer of ctx.cacheWriteTimers.values()) {
    clearTimeout(timer);
  }
  ctx.cacheWriteTimers.clear();
}

// ---------------------------------------------------------------------------
// Fetch messages (forward + reverse pagination)
// ---------------------------------------------------------------------------

type V3GetSessionMessagesResponse = {
  messages: ApiMessage[];
  hasMore: boolean;
  totalCount?: number;
};

export async function fetchMessagesAction(
  ctx: MessageFetchContext,
  sessionId: string,
): Promise<void> {
  log.log(`💬 fetchMessages starting for session ${sessionId} - acquiring lock`);

  let lock = ctx.sessionMessageLocks.get(sessionId);
  if (!lock) {
    lock = new AsyncLock();
    ctx.sessionMessageLocks.set(sessionId, lock);
  }

  await lock.inLock(async () => {
    const encryption = ctx.encryption.getSessionEncryption(sessionId);
    if (!encryption) {
      log.log(
        `💬 fetchMessages: Session encryption not ready for ${sessionId}, will retry`,
      );
      throw new Error(`Session encryption not ready for ${sessionId}`);
    }

    const initialAfterSeq = ctx.sessionLastSeq.get(sessionId) ?? 0;
    const fetchStrategy = resolveMessageHistoryFetchStrategy({ initialAfterSeq });
    const shouldApplyImmediately = shouldApplyMessagesImmediately(fetchStrategy);
    let afterSeq = initialAfterSeq;
    let hasMore = true;
    let totalNormalized = 0;
    let totalProcessedMessages = 0;
    let isFirstBatch = true;
    let serverTotalCount: number | undefined;
    let blockedByUnprocessedMessage = false;
    let pendingCursorSeq: number | null = null;

    const historySignalEntries: Array<{
      seq: number;
      content: RawRecord | null | undefined;
    }> = [];
    const pendingNormalizedMessages: NormalizedMessage[] = [];

    const applyBatch = (messages: NormalizedMessage[]) => {
      if (messages.length === 0) return;
      if (shouldApplyImmediately) {
        applyMessagesAction(ctx, sessionId, messages);
      } else {
        pendingNormalizedMessages.push(...messages);
      }
    };

    if (shouldFetchNewestPageFirst(fetchStrategy)) {
      const newestResponse = await apiSocket.request(
        `/v3/sessions/${sessionId}/messages?before_seq=2147483647&limit=2000`,
      );
      if (!newestResponse.ok && newestResponse.status === 404) {
        log.log(
          `💬 fetchMessages: session ${sessionId} not found (404), cleaning up`,
        );
        ctx.cleanupSession(sessionId);
        throw new NonRetryableError(`Session ${sessionId} not found`);
      }
      if (!newestResponse.ok) {
        throw new Error(
          `Failed to fetch messages for ${sessionId}: ${newestResponse.status}`,
        );
      }
      const newestData = (await newestResponse.json()) as V3GetSessionMessagesResponse;
      const newestMessages = Array.isArray(newestData.messages)
        ? newestData.messages
        : [];
      if (newestMessages.length > 0) {
        const decryptResult = await decryptAndNormalizeBatchAction(
          encryption,
          newestMessages,
          sessionId,
        );
        historySignalEntries.push(...decryptResult.sequencedContents);
        totalNormalized += decryptResult.normalized.length;
        totalProcessedMessages += decryptResult.processedSeqs.length;
        applyBatch(decryptResult.normalized);

        const cursorAdvance = resolveMessageCursorAdvance({
          afterSeq,
          rawSeqs: newestMessages.map((message) => message.seq),
          processedSeqs: decryptResult.processedSeqs,
        });
        if (cursorAdvance.cursorSeq !== null) {
          if (shouldApplyImmediately) {
            ctx.sessionLastSeq.set(sessionId, cursorAdvance.cursorSeq);
            saveLastSeq(sessionId, cursorAdvance.cursorSeq);
          } else {
            pendingCursorSeq = cursorAdvance.cursorSeq;
          }
        }
        if (cursorAdvance.blockedByUnprocessedSeq) {
          blockedByUnprocessedMessage = true;
        }

        const minSeq = Math.min(...newestMessages.map((m) => m.seq));
        ctx.sessionOldestSeq.set(sessionId, minSeq);
        storage.getState().setHasServerOlderMessages(sessionId, newestData.hasMore);
      } else {
        storage.getState().setHasServerOlderMessages(sessionId, false);
      }
      hasMore = false;
      isFirstBatch = false;
    }

    while (hasMore) {
      const response = await apiSocket.request(
        `/v3/sessions/${sessionId}/messages?after_seq=${afterSeq}&limit=2000`,
      );
      if (!response.ok) {
        if (response.status === 404) {
          log.log(
            `💬 fetchMessages: session ${sessionId} not found (404), cleaning up`,
          );
          ctx.cleanupSession(sessionId);
          throw new NonRetryableError(`Session ${sessionId} not found`);
        }
        throw new Error(
          `Failed to fetch messages for ${sessionId}: ${response.status}`,
        );
      }
      const data = (await response.json()) as V3GetSessionMessagesResponse;
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const decryptResult = await decryptAndNormalizeBatchAction(
        encryption,
        messages,
        sessionId,
      );
      historySignalEntries.push(...decryptResult.sequencedContents);
      totalNormalized += decryptResult.normalized.length;
      totalProcessedMessages += decryptResult.processedSeqs.length;
      applyBatch(decryptResult.normalized);
      if (isFirstBatch && shouldApplyImmediately) {
        storage.getState().applyMessagesLoaded(sessionId);
        isFirstBatch = false;
      }

      const cursorAdvance = resolveMessageCursorAdvance({
        afterSeq,
        rawSeqs: messages.map((message) => message.seq),
        processedSeqs: decryptResult.processedSeqs,
      });
      if (cursorAdvance.cursorSeq !== null) {
        ctx.sessionLastSeq.set(sessionId, cursorAdvance.cursorSeq);
        saveLastSeq(sessionId, cursorAdvance.cursorSeq);
      }

      hasMore = !!data.hasMore;
      if (data.totalCount !== undefined) {
        serverTotalCount = data.totalCount;
      }
      if (serverTotalCount !== undefined && serverTotalCount > 0) {
        storage.getState().setSessionLoadingProgress(sessionId, {
          loaded: totalProcessedMessages,
          total: serverTotalCount,
        });
      }
      if (cursorAdvance.blockedByUnprocessedSeq) {
        blockedByUnprocessedMessage = true;
        log.warn(
          `⚠️ fetchMessages: stopped at seq ${cursorAdvance.nextAfterSeq} for ${sessionId} because a message could not be processed`,
        );
        hasMore = false;
      } else if (hasMore && cursorAdvance.stalled) {
        log.log(
          `💬 fetchMessages: pagination stalled at seq ${afterSeq} for ${sessionId}, advancing by 1`,
        );
      }
      afterSeq = cursorAdvance.nextAfterSeq;
    }

    if (!shouldApplyImmediately && pendingNormalizedMessages.length > 0) {
      applyMessagesAction(ctx, sessionId, pendingNormalizedMessages);
    }
    if (!shouldApplyImmediately && pendingCursorSeq !== null) {
      ctx.sessionLastSeq.set(sessionId, pendingCursorSeq);
      saveLastSeq(sessionId, pendingCursorSeq);
    }

    // Surface side-channel session signals after all messages are merged in seq order.
    const finalHistorySignals = collectSequencedHistorySignals(historySignalEntries);
    storage.getState().setPromptSuggestion(sessionId, finalHistorySignals.promptSuggestion);
    storage.getState().setNeedsContinue(sessionId, finalHistorySignals.needsContinue);
    if (finalHistorySignals.sdkSessionState !== null) {
      const currentSession = storage.getState().sessions[sessionId];
      if (currentSession) {
        ctx.applySessions([
          {
            ...currentSession,
            sdkSessionState: finalHistorySignals.sdkSessionState,
          },
        ]);
      }
    }

    storage.getState().applyMessagesLoaded(sessionId);
    if (initialAfterSeq === 0 && !blockedByUnprocessedMessage) {
      ctx.backfilledSessions.add(sessionId);
    }
    log.log(
      `💬 fetchMessages completed for session ${sessionId} - processed ${totalNormalized} messages`,
    );

    if (
      initialAfterSeq === 0 &&
      serverTotalCount !== undefined &&
      totalProcessedMessages < serverTotalCount
    ) {
      log.warn(
        `⚠️ fetchMessages: incomplete history for ${sessionId} — processed ${totalProcessedMessages}/${serverTotalCount} messages (${serverTotalCount - totalProcessedMessages} missing, likely decrypt failures)`,
      );
    }

    // Fetch cumulative usage baseline from server (non-blocking)
    if (ctx.credentials) {
      getSessionUsageSummary(ctx.credentials, sessionId)
        .then((summary) => {
          if (summary.reportCount > 0) {
            storage.getState().applySessionUsageBaseline(sessionId, {
              totalInputTokens: summary.totalInputTokens,
              totalOutputTokens: summary.totalOutputTokens,
              lastInputTokens: summary.lastInputTokens,
              lastOutputTokens: summary.lastOutputTokens,
              lastCacheCreation: summary.lastCacheCreation,
              lastCacheRead: summary.lastCacheRead,
            });
            log.log(
              `💬 Applied usage baseline for ${sessionId}: ${summary.totalInputTokens} in / ${summary.totalOutputTokens} out`,
            );
          }
        })
        .catch((error) => {
          log.log(
            `💬 Failed to fetch usage baseline for ${sessionId}: ${error}`,
          );
        });
    }
  });
}
