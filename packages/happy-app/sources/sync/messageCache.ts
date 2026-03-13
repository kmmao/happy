import { MMKV } from "react-native-mmkv";
import { Platform } from "react-native";
import type { Message } from "./typesMessage";
import { log } from "@/log";

const CACHE_PREFIX = "msg-v1-";
const CACHE_INDEX_KEY = "msg-cache-index";
const MAX_CACHED_MESSAGES = 200;
const MAX_CACHED_SESSIONS = 20;
const CACHE_SCHEMA_VERSION = 1;

interface CachedSessionMessages {
  schemaVersion: number;
  messages: readonly Message[];
  lastSeq: number;
  savedAt: number;
  isTrimmed: boolean; // true if messages were truncated, lastSeq may not cover full history
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
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    log.log(`Failed to load message cache for ${sessionId}: ${error}`);
    return null;
  }
}

export function saveMessageCache(
  sessionId: string,
  messages: ReadonlyArray<Message>,
  lastSeq: number,
): void {
  const mmkv = getMMKV();
  if (!mmkv) {
    return;
  }

  try {
    // messages are sorted by createdAt DESC (newest first) from storage.ts
    // slice(0, N) keeps the newest N messages
    const wasTrimmed = messages.length > MAX_CACHED_MESSAGES;
    const trimmedMessages = wasTrimmed
      ? messages.slice(0, MAX_CACHED_MESSAGES)
      : messages;

    const cached: CachedSessionMessages = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      messages: trimmedMessages,
      lastSeq,
      savedAt: Date.now(),
      isTrimmed: wasTrimmed,
    };

    mmkv.set(`${CACHE_PREFIX}${sessionId}`, JSON.stringify(cached));

    // Update index and enforce LRU limit
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
    removeCacheIndexEntry(mmkv, sessionId);
  } catch (error) {
    log.log(`Failed to delete message cache for ${sessionId}: ${error}`);
  }
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

  // Evict oldest entries if over limit
  if (index.length > MAX_CACHED_SESSIONS) {
    const sorted = [...index].sort((a, b) => a.savedAt - b.savedAt);
    const toEvict = sorted.slice(0, sorted.length - MAX_CACHED_SESSIONS);
    for (const entry of toEvict) {
      mmkv.delete(`${CACHE_PREFIX}${entry.sessionId}`);
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
