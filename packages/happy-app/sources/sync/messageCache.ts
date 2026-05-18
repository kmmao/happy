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

    const cached: CachedSessionMessages = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      messages: trimmedMessages,
      lastSeq,
      savedAt: Date.now(),
      isTrimmed: wasTrimmed,
      latestUserRequestPreview,
    };

    mmkv.set(`${CACHE_PREFIX}${sessionId}`, JSON.stringify(cached));

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

