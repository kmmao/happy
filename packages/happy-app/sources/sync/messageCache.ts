import { MMKV } from "react-native-mmkv";
import { Platform } from "react-native";
import type { Message } from "./typesMessage";
import { log } from "@/log";

const CACHE_PREFIX = "msg-v1-";
const CACHE_INDEX_KEY = "msg-cache-index";
const HISTORY_COMPLETE_PREFIX = "msg-history-complete-v1-";
const MAX_CACHED_MESSAGES = 5000;
const MAX_CACHED_SESSIONS = 20;
const CACHE_SCHEMA_VERSION = 2;

// Any single tool.result content block whose serialized size (chars) exceeds
// this cap gets replaced with a placeholder marker before the cache write.
// Common trigger: `Read` on a binary file returns
//   [{type: "image", source: {media_type: ..., data: "<hundreds of KB base64>"}}]
// which was previously round-tripped through JSON.stringify + MMKV.set +
// JSON.parse on every save/load — a single 144KB base64 → ~150KB string blob
// stalls the main thread hundreds of ms on synchronous storage backends. The
// real image bytes stay in memory / server; only the LOCAL persisted cache is
// elided, and any cached slot re-populates from the next server sync.
const CACHE_INLINE_BLOB_CAP = 32 * 1024;

interface CachedSessionMessages {
  schemaVersion: number;
  messages: readonly Message[];
  lastSeq: number;
  savedAt: number;
  isTrimmed: boolean;
  latestUserRequestPreview?: {
    text: string;
    isAutoOptionSend: boolean;
  } | null;
}

interface CacheIndexEntry {
  sessionId: string;
  savedAt: number;
}

let messageCacheMMKV: MMKV | null = null;

export function initMessageCache(encryptionKey: string): void {
  if (Platform.OS === "web") {
    messageCacheMMKV = null;
    return;
  }
  try {
    messageCacheMMKV = new MMKV({
      id: "message-cache",
      encryptionKey,
    });
  } catch (error) {
    log.log(`Failed to initialize message cache MMKV: ${error}`);
    messageCacheMMKV = null;
  }
}

function getMMKV(): MMKV | null {
  return messageCacheMMKV;
}

export function loadMessageCache(
  sessionId: string,
): CachedSessionMessages | null {
  const mmkv = getMMKV();
  if (!mmkv) {
    return null;
  }

  try {
    const raw = mmkv.getString(`${CACHE_PREFIX}${sessionId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedSessionMessages;
    if (
      !parsed ||
      !Array.isArray(parsed.messages) ||
      typeof parsed.lastSeq !== "number" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }
    if (parsed.schemaVersion === CACHE_SCHEMA_VERSION) {
      return parsed;
    }
    if (parsed.schemaVersion === 1) {
      return {
        ...parsed,
        schemaVersion: CACHE_SCHEMA_VERSION,
        latestUserRequestPreview: undefined,
      };
    }
    return null;
  } catch (error) {
    log.log(`Failed to load message cache for ${sessionId}: ${error}`);
    return null;
  }
}

/**
 * Elide oversized tool.result payloads (typically image `Read` results with
 * hundreds of KB of base64) before they hit the sync persistence backend.
 * Returns a shallow-cloned view — the original `messages` array and its
 * message objects are NOT mutated, so live in-memory state (which needs the
 * real bytes for display) is untouched.
 *
 * `elided` is reported to the caller purely so a single log line can surface
 * that the cache write escaped a heavy payload; there's no correctness gate
 * on it.
 */
function sanitizeMessagesForCache(
  messages: ReadonlyArray<Message>,
): { messages: Message[]; elided: number; totalBytes: number } {
  let elided = 0;
  let totalBytes = 0;
  const out: Message[] = messages.map((m) => sanitizeMessage(m));
  return { messages: out, elided, totalBytes };

  function sanitizeMessage(msg: Message): Message {
    if (msg.kind !== "tool-call") return msg;
    const tool = msg.tool;
    const sanitizedResult = sanitizeResult(tool.result);
    const sanitizedChildren = msg.children.map(sanitizeMessage);
    if (sanitizedResult === tool.result && sanitizedChildren === msg.children) {
      return msg;
    }
    return {
      ...msg,
      tool: sanitizedResult === tool.result
        ? tool
        : { ...tool, result: sanitizedResult },
      children: sanitizedChildren,
    };
  }

  function sanitizeResult(result: unknown): unknown {
    if (result == null) return result;
    if (typeof result === "string") {
      totalBytes += result.length;
      if (result.length > CACHE_INLINE_BLOB_CAP) {
        elided += 1;
        return `[elided ${result.length}-char string from local cache]`;
      }
      return result;
    }
    if (Array.isArray(result)) {
      let changed = false;
      const mapped = result.map((block) => {
        const s = sanitizeResultBlock(block);
        if (s !== block) changed = true;
        return s;
      });
      return changed ? mapped : result;
    }
    return result;
  }

  function sanitizeResultBlock(block: unknown): unknown {
    if (!block || typeof block !== "object") return block;
    const b = block as Record<string, unknown>;

    // Anthropic image block shape:
    // { type: "image", source: { type: "base64", media_type, data: "<base64>" } }
    if (b.type === "image" && b.source && typeof b.source === "object") {
      const src = b.source as Record<string, unknown>;
      if (typeof src.data === "string") {
        totalBytes += src.data.length;
        if (src.data.length > CACHE_INLINE_BLOB_CAP) {
          elided += 1;
          return {
            type: "image",
            source: {
              ...src,
              data: `[elided ${src.data.length}-char base64 from local cache]`,
            },
          };
        }
      }
      return block;
    }

    // Some tools return a `{type: "text", text: "<huge string>"}` block —
    // elide the text field if it's massive.
    if (b.type === "text" && typeof b.text === "string") {
      totalBytes += (b.text as string).length;
      if ((b.text as string).length > CACHE_INLINE_BLOB_CAP) {
        elided += 1;
        return {
          ...b,
          text: `[elided ${(b.text as string).length}-char text from local cache]`,
        };
      }
      return block;
    }

    return block;
  }
}

export function saveMessageCache(
  sessionId: string,
  messages: ReadonlyArray<Message>,
  lastSeq: number,
  latestUserRequestPreview?: {
    text: string;
    isAutoOptionSend: boolean;
  } | null,
): void {
  const mmkv = getMMKV();
  if (!mmkv) {
    return;
  }

  try {
    const wasTrimmed = messages.length > MAX_CACHED_MESSAGES;
    const trimmedMessages = wasTrimmed
      ? messages.slice(0, MAX_CACHED_MESSAGES)
      : messages;

    // Strip large image / text blobs from tool.result before serialising —
    // otherwise a single Read on a binary drags every subsequent cache write
    // through hundreds of KB of base64, blocking the storage backend and (on
    // some platforms) the JS main thread with it.
    const sanitized = sanitizeMessagesForCache(trimmedMessages);

    const cached: CachedSessionMessages = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      messages: sanitized.messages,
      lastSeq,
      savedAt: Date.now(),
      isTrimmed: wasTrimmed,
      latestUserRequestPreview,
    };

    const serialized = JSON.stringify(cached);
    if (sanitized.elided > 0) {
      log.log(
        `[messageCache] sessionId=${sessionId} elided ${sanitized.elided} oversized tool.result block(s) ` +
        `(pre-elide scanned bytes~=${sanitized.totalBytes}, final blob=${serialized.length})`,
      );
    }

    mmkv.set(`${CACHE_PREFIX}${sessionId}`, serialized);

    updateCacheIndex(mmkv, sessionId);
  } catch (error) {
    log.log(`Failed to save message cache for ${sessionId}: ${error}`);
  }
}

export function deleteMessageCache(sessionId: string): void {
  const mmkv = getMMKV();
  if (!mmkv) {
    return;
  }

  try {
    mmkv.delete(`${CACHE_PREFIX}${sessionId}`);
    mmkv.delete(`${HISTORY_COMPLETE_PREFIX}${sessionId}`);
    removeCacheIndexEntry(mmkv, sessionId);
  } catch (error) {
    log.log(`Failed to delete message cache for ${sessionId}: ${error}`);
  }
}

export function loadHistoryComplete(sessionId: string): boolean {
  const mmkv = getMMKV();
  if (!mmkv) return false;
  return mmkv.getBoolean(`${HISTORY_COMPLETE_PREFIX}${sessionId}`) ?? false;
}

export function saveHistoryComplete(sessionId: string): void {
  const mmkv = getMMKV();
  if (!mmkv) return;
  mmkv.set(`${HISTORY_COMPLETE_PREFIX}${sessionId}`, true);
}

export function deleteHistoryComplete(sessionId: string): void {
  const mmkv = getMMKV();
  if (!mmkv) return;
  mmkv.delete(`${HISTORY_COMPLETE_PREFIX}${sessionId}`);
}

export function clearAllMessageCaches(): void {
  const mmkv = getMMKV();
  if (!mmkv) {
    return;
  }

  try {
    mmkv.clearAll();
  } catch (error) {
    log.log(`Failed to clear all message caches: ${error}`);
  }
  messageCacheMMKV = null;
}

function loadCacheIndex(mmkv: MMKV): CacheIndexEntry[] {
  try {
    const raw = mmkv.getString(CACHE_INDEX_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as CacheIndexEntry[];
  } catch {
    return [];
  }
}

function saveCacheIndex(mmkv: MMKV, index: CacheIndexEntry[]): void {
  mmkv.set(CACHE_INDEX_KEY, JSON.stringify(index));
}

function updateCacheIndex(mmkv: MMKV, sessionId: string): void {
  const index = loadCacheIndex(mmkv).filter((e) => e.sessionId !== sessionId);
  index.push({ sessionId, savedAt: Date.now() });

  if (index.length > MAX_CACHED_SESSIONS) {
    const sorted = [...index].sort((a, b) => a.savedAt - b.savedAt);
    const toEvict = sorted.slice(0, sorted.length - MAX_CACHED_SESSIONS);
    for (const entry of toEvict) {
      mmkv.delete(`${CACHE_PREFIX}${entry.sessionId}`);
      mmkv.delete(`${HISTORY_COMPLETE_PREFIX}${entry.sessionId}`);
    }
    saveCacheIndex(mmkv, sorted.slice(sorted.length - MAX_CACHED_SESSIONS));
  } else {
    saveCacheIndex(mmkv, index);
  }
}

function removeCacheIndexEntry(mmkv: MMKV, sessionId: string): void {
  const index = loadCacheIndex(mmkv).filter((e) => e.sessionId !== sessionId);
  saveCacheIndex(mmkv, index);
}

