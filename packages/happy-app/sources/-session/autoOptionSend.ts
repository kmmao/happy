export type AutoOptionSendStatus = "off" | "idle" | "armed" | "ready";

export interface SessionFollowUpOptionsSnapshot {
  sourceType: "markdown-options";
  sourceMessageId: string | null;
  items: string[];
  recommendedIndex: number | null;
  optionsHash: string;
}

export interface AutoOptionCandidate {
  sourceMessageId: string | null;
  optionsHash: string;
  recommendedText: string;
  startedAt: number;
  durationMs: number;
}

export interface AutoOptionSendState {
  enabled: boolean;
  status: AutoOptionSendStatus;
  candidate: AutoOptionCandidate | null;
  remainingMs: number | null;
  lastAutoSentText: string | null;
  lastAutoSentKey: string | null;
  lastCancelReason: string | null;
  shouldSendText: string | null;
}

export interface AutoOptionSendContext {
  sessionId: string;
  currentSessionId: string;
  inputText: string;
  hasPendingImages: boolean;
  isSttListening: boolean;
  hasAskUserQuestionVisible: boolean;
  isCurrentSessionActive: boolean;
  now: number;
  durationMs: number;
  snapshot: SessionFollowUpOptionsSnapshot | null;
}

export type AutoOptionSendEvent =
  | { type: "toggle"; enabled: boolean }
  | { type: "timer-finished" }
  | { type: "attempt-fire" }
  | { type: "options-updated" }
  | { type: "context-invalidated"; reason: string };

export function buildOptionsHash(items: string[]): string {
  return JSON.stringify(items);
}

function normalizeOptionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export const PURE_VIEW_ONLY_OPTION_PATTERNS = [
  "查看 diff",
  "看日志",
  "浏览输出",
] as const;

/**
 * View-only verb prefixes (Chinese + English).
 * An option starting with any of these is considered "view-only"
 * UNLESS it also contains a follow-up action connector.
 */
const VIEW_ONLY_VERB_PREFIXES = [
  // Chinese
  "查看", "看一下", "看下", "浏览",
  "列出", "列举", "给我列",
  "检查", "审查",
  "显示", "展示",
  "看日志", "看 diff", "查看 diff",
  // English
  "view ", "review ", "check ",
  "show ", "display ", "list ",
  "browse ", "inspect ",
] as const;

const FOLLOW_UP_ACTION_CONNECTORS = /(?:并|后|再|然后|并且|逐个| and | then | to fix)/i;

const PURE_VIEW_ONLY_OPTION_SET = new Set(
  PURE_VIEW_ONLY_OPTION_PATTERNS.map(normalizeOptionText),
);

function isPureViewOnlyOption(text: string): boolean {
  const normalized = normalizeOptionText(text);
  // Exact match (legacy)
  if (PURE_VIEW_ONLY_OPTION_SET.has(normalized)) return true;
  // Keyword prefix match: starts with a view-only verb AND has no follow-up action
  for (const prefix of VIEW_ONLY_VERB_PREFIXES) {
    if (normalized.startsWith(prefix.toLowerCase())) {
      return !FOLLOW_UP_ACTION_CONNECTORS.test(normalized);
    }
  }
  return false;
}

export function getRecommendedOptionIndex(items: string[]): number | null {
  if (items.length < 2) return null;
  const first = items[0]?.trim();
  if (!first) return null;
  return isPureViewOnlyOption(first) ? null : 0;
}

function buildAutoSentKey(candidate: AutoOptionCandidate): string {
  return `${candidate.sourceMessageId ?? "none"}:${candidate.optionsHash}:${candidate.recommendedText}`;
}

export function createInitialAutoOptionSendState(): AutoOptionSendState {
  return {
    enabled: false,
    status: "off",
    candidate: null,
    remainingMs: null,
    lastAutoSentText: null,
    lastAutoSentKey: null,
    lastCancelReason: null,
    shouldSendText: null,
  };
}

function clearToOff(
  state: AutoOptionSendState,
  reason: string | null,
): AutoOptionSendState {
  return {
    ...state,
    enabled: false,
    status: "off",
    candidate: null,
    remainingMs: null,
    lastCancelReason: reason,
    shouldSendText: null,
  };
}

function clearToIdle(
  state: AutoOptionSendState,
  reason: string | null,
): AutoOptionSendState {
  return {
    ...state,
    enabled: true,
    status: "idle",
    candidate: null,
    remainingMs: null,
    lastCancelReason: reason,
    shouldSendText: null,
  };
}

export function buildAutoOptionCandidate(
  context: AutoOptionSendContext,
): AutoOptionCandidate | null {
  const snapshot = context.snapshot;
  if (!snapshot) return null;
  if (getRecommendedOptionIndex(snapshot.items) !== 0) return null;
  const recommendedText = snapshot.items[0]?.trim();
  if (!recommendedText) return null;

  return {
    sourceMessageId: snapshot.sourceMessageId,
    optionsHash: snapshot.optionsHash,
    recommendedText,
    startedAt: context.now,
    durationMs: context.durationMs,
  };
}

function canArm(context: AutoOptionSendContext): boolean {
  if (!context.snapshot) return false;
  if (context.hasAskUserQuestionVisible) return false;
  if (!context.isCurrentSessionActive) return false;
  if (context.sessionId !== context.currentSessionId) return false;
  if (context.inputText.trim().length > 0) return false;
  if (context.hasPendingImages) return false;
  if (context.isSttListening) return false;
  return getRecommendedOptionIndex(context.snapshot.items) === 0;
}

function canFire(
  state: AutoOptionSendState,
  context: AutoOptionSendContext,
): boolean {
  if (!state.candidate) return false;
  if (!context.snapshot) return false;
  if (context.hasAskUserQuestionVisible) return false;
  if (!context.isCurrentSessionActive) return false;
  if (context.sessionId !== context.currentSessionId) return false;
  if (context.inputText.trim().length > 0) return false;
  if (context.hasPendingImages) return false;
  if (context.isSttListening) return false;
  if (getRecommendedOptionIndex(context.snapshot.items) !== 0) return false;

  const currentText = context.snapshot.items[0]?.trim() ?? "";
  if (!currentText) return false;
  if (currentText !== state.candidate.recommendedText) return false;
  if (context.snapshot.optionsHash !== state.candidate.optionsHash) return false;
  if (context.snapshot.sourceMessageId !== state.candidate.sourceMessageId) return false;
  if (state.lastAutoSentKey === buildAutoSentKey(state.candidate)) return false;

  return true;
}

export function reduceAutoOptionSendEvent(
  state: AutoOptionSendState,
  event: AutoOptionSendEvent,
  context: AutoOptionSendContext,
): AutoOptionSendState {
  if (event.type === "toggle") {
    if (!event.enabled) {
      return clearToOff(state, "manual-toggle-off");
    }

    if (!canArm(context)) {
      return clearToIdle(state, null);
    }

    const candidate = buildAutoOptionCandidate(context);
    if (!candidate) {
      return clearToIdle(state, null);
    }

    return {
      ...state,
      enabled: true,
      status: "armed",
      candidate,
      remainingMs: candidate.durationMs,
      lastCancelReason: null,
      shouldSendText: null,
    };
  }

  if (event.type === "context-invalidated") {
    if (event.reason === "options-missing" && state.enabled) {
      return clearToIdle(state, state.lastCancelReason);
    }
    return clearToOff(state, event.reason);
  }

  if (event.type === "options-updated") {
    if (!state.enabled) return state;
    if (!canArm(context)) {
      return clearToIdle(state, "options-invalid");
    }

    const candidate = buildAutoOptionCandidate(context);
    if (!candidate) {
      return clearToIdle(state, "options-invalid");
    }

    if (
      (state.status === "armed" || state.status === "ready") &&
      state.candidate &&
      state.candidate.optionsHash === candidate.optionsHash &&
      state.candidate.sourceMessageId === candidate.sourceMessageId &&
      state.candidate.recommendedText === candidate.recommendedText
    ) {
      return state;
    }

    if (state.status === "idle" && state.lastAutoSentKey === buildAutoSentKey(candidate)) {
      return clearToIdle(state, state.lastCancelReason);
    }

    return {
      ...state,
      enabled: true,
      status: "armed",
      candidate,
      remainingMs: candidate.durationMs,
      lastCancelReason: null,
      shouldSendText: null,
    };
  }

  if (event.type === "timer-finished") {
    if (state.status !== "armed") return state;
    return {
      ...state,
      status: "ready",
      remainingMs: 0,
      shouldSendText: null,
    };
  }

  if (event.type === "attempt-fire") {
    if (state.status !== "ready") return state;
    if (!canFire(state, context)) {
      return clearToIdle(state, "fire-check-failed");
    }

    return {
      ...state,
      enabled: true,
      status: "idle",
      candidate: null,
      remainingMs: null,
      lastCancelReason: null,
      shouldSendText: state.candidate?.recommendedText ?? null,
      lastAutoSentText:
        state.candidate?.recommendedText ?? state.lastAutoSentText,
      lastAutoSentKey: state.candidate
        ? buildAutoSentKey(state.candidate)
        : state.lastAutoSentKey,
    };
  }

  return state;
}
