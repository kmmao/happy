export type AutoOptionSendStatus = "off" | "armed" | "ready" | "fired";

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
  | { type: "context-invalidated"; reason: string };

export function buildOptionsHash(items: string[]): string {
  return JSON.stringify(items);
}

export function createInitialAutoOptionSendState(): AutoOptionSendState {
  return {
    enabled: false,
    status: "off",
    candidate: null,
    remainingMs: null,
    lastAutoSentText: null,
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

export function buildAutoOptionCandidate(
  context: AutoOptionSendContext,
): AutoOptionCandidate | null {
  const snapshot = context.snapshot;
  if (!snapshot) return null;
  if (snapshot.recommendedIndex !== 0) return null;
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
  if (context.snapshot.items.length < 2) return false;
  return context.snapshot.recommendedIndex === 0;
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
  if (context.snapshot.recommendedIndex !== 0) return false;

  const currentText = context.snapshot.items[0]?.trim() ?? "";
  if (!currentText) return false;
  if (currentText !== state.candidate.recommendedText) return false;
  if (context.snapshot.optionsHash !== state.candidate.optionsHash) return false;
  if (context.snapshot.sourceMessageId !== state.candidate.sourceMessageId) return false;
  if (state.lastAutoSentText === currentText) return false;

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
      return clearToOff(state, null);
    }

    const candidate = buildAutoOptionCandidate(context);
    if (!candidate) {
      return clearToOff(state, null);
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
    return clearToOff(state, event.reason);
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
      return clearToOff(state, "fire-check-failed");
    }

    return {
      ...state,
      enabled: false,
      status: "fired",
      candidate: null,
      remainingMs: null,
      lastCancelReason: null,
      shouldSendText: state.candidate?.recommendedText ?? null,
      lastAutoSentText: state.candidate?.recommendedText ?? state.lastAutoSentText,
    };
  }

  return state;
}
