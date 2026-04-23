import { MMKV } from "react-native-mmkv";
import { AutoOptionFeedbackStats, normalizeOptionText } from "@/-session/autoOptionSend";

export type AutoOptionFeedbackAction =
  | "send"
  | "edit_send"
  | "timeout_ignore"
  | "dismiss";

export interface AutoOptionFeedbackEvent {
  projectId: string;
  sessionId: string;
  optionText: string;
  optionHash: string;
  action: AutoOptionFeedbackAction;
  source: "auto" | "manual";
  scoreBefore: number | null;
  latencyMs: number | null;
  edited: boolean;
  reason: string | null;
  ts: number;
}

interface AutoOptionFeedbackStore {
  events: AutoOptionFeedbackEvent[];
}

type AutoOptionFeedbackListener = () => void;

const mmkv = new MMKV();

const KEY_PREFIX = "auto-option-feedback:";
const MAX_EVENTS = 200;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const feedbackListeners = new Map<string, Set<AutoOptionFeedbackListener>>();

function getKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

function loadStore(projectId: string): AutoOptionFeedbackStore {
  const raw = mmkv.getString(getKey(projectId));
  if (!raw) {
    return { events: [] };
  }

  try {
    const parsed = JSON.parse(raw) as AutoOptionFeedbackStore;
    if (!parsed || !Array.isArray(parsed.events)) {
      return { events: [] };
    }
    return { events: parsed.events.filter((event) => Boolean(event?.optionText)) };
  } catch {
    return { events: [] };
  }
}

function saveStore(projectId: string, store: AutoOptionFeedbackStore): void {
  mmkv.set(getKey(projectId), JSON.stringify(store));
}

function cleanupEvents(events: AutoOptionFeedbackEvent[], now: number): AutoOptionFeedbackEvent[] {
  const minTs = now - TTL_MS;
  const filtered = events.filter((event) => event.ts >= minTs);
  if (filtered.length <= MAX_EVENTS) return filtered;
  return filtered.slice(filtered.length - MAX_EVENTS);
}

function notifyAutoOptionFeedback(projectId: string): void {
  const listeners = feedbackListeners.get(projectId);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeAutoOptionFeedback(
  projectId: string,
  listener: AutoOptionFeedbackListener,
): () => void {
  const listeners = feedbackListeners.get(projectId) ?? new Set<AutoOptionFeedbackListener>();
  listeners.add(listener);
  feedbackListeners.set(projectId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      feedbackListeners.delete(projectId);
    }
  };
}

export function recordAutoOptionFeedback(event: AutoOptionFeedbackEvent): void {
  const now = Date.now();
  const store = loadStore(event.projectId);

  const dedupKey = `${event.sessionId}:${event.optionHash}:${event.action}:${new Date(event.ts).toISOString().slice(0, 10)}`;
  const hasSameDayDuplicate = store.events.some((existing) => {
    const existingKey = `${existing.sessionId}:${existing.optionHash}:${existing.action}:${new Date(existing.ts).toISOString().slice(0, 10)}`;
    return existingKey === dedupKey;
  });
  if (hasSameDayDuplicate) {
    return;
  }

  const nextEvents = cleanupEvents([...store.events, event], now);
  saveStore(event.projectId, { events: nextEvents });
  notifyAutoOptionFeedback(event.projectId);
}

export function getAutoOptionFeedbackStats(
  projectId: string,
  optionText: string,
): AutoOptionFeedbackStats {
  const store = loadStore(projectId);
  const normalized = normalizeOptionText(optionText);
  const now = Date.now();
  const events = cleanupEvents(store.events, now).filter(
    (event) => normalizeOptionText(event.optionText) === normalized,
  );

  const stats: AutoOptionFeedbackStats = {
    send: 0,
    editSend: 0,
    timeoutIgnore: 0,
    dismiss: 0,
    total: 0,
  };

  for (const event of events) {
    if (event.action === "send") stats.send += 1;
    if (event.action === "edit_send") stats.editSend += 1;
    if (event.action === "timeout_ignore") stats.timeoutIgnore += 1;
    if (event.action === "dismiss") stats.dismiss += 1;
  }
  stats.total = stats.send + stats.editSend + stats.timeoutIgnore + stats.dismiss;

  return stats;
}
