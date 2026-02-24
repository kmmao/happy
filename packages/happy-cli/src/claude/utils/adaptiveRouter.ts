/**
 * Adaptive Model Router
 *
 * Pure-function module that decides which Claude model to use for each turn
 * based on message content, session history, and cumulative token usage.
 *
 * Routing strategy (aggressive switching, base model as default):
 * - Cumulative input > 150K tokens → 1M variant (highest priority, bypasses cooldown)
 * - Complex keywords + message > 200 chars → opus
 * - Recent 3 turns average output > 3000 tokens → opus
 * - Message < 30 chars + simple pattern → haiku
 * - No special signal → base model (user configured)
 *
 * Cooldown: minimum 2 turns between switches (except 1M upgrade).
 */

export interface TurnRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface AdaptiveRouterState {
  baseModel: string;
  turnHistory: readonly TurnRecord[];
  cumulativeInputTokens: number;
  currentModelId: string;
  lastSwitchTurn: number;
  turnCount: number;
}

interface ParseResult {
  isAdaptive: boolean;
  baseModelId: string;
}

interface RouteResult {
  modelId: string;
  reason: string;
  changed: boolean;
}

const MODEL_IDS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  "sonnet-1m": "claude-sonnet-4-6[1m]",
  opus: "claude-opus-4-6",
  "opus-1m": "claude-opus-4-6[1m]",
} as const;

const COMPLEX_KEYWORDS = new Set([
  // English
  "architect",
  "design",
  "refactor",
  "debug",
  "analyze",
  "review",
  "plan",
  "migrate",
  "security",
  "performance",
  // Chinese
  "\u67B6\u6784",
  "\u8BBE\u8BA1",
  "\u91CD\u6784",
  "\u5206\u6790",
  "\u5BA1\u67E5",
  "\u89C4\u5212",
  "\u8FC1\u79FB",
  "\u4F18\u5316",
  "\u5B89\u5168",
]);

const SIMPLE_PATTERNS = new Set([
  "yes",
  "no",
  "ok",
  "y",
  "n",
  "\u597D",
  "\u7EE7\u7EED",
  "\u786E\u8BA4",
  "lgtm",
  "ship it",
  "sure",
  "done",
  "thanks",
  "thank you",
  "\u8C22\u8C22",
  "\u5BF9",
  "\u662F",
  "\u4E0D",
  "\u884C",
]);

const MAX_HISTORY = 20;
const COOLDOWN_TURNS = 2;
const LONG_CONTEXT_THRESHOLD = 150_000;
const COMPLEX_MESSAGE_MIN_LENGTH = 200;
const HIGH_OUTPUT_THRESHOLD = 3000;
const SIMPLE_MESSAGE_MAX_LENGTH = 30;
const SHORT_MESSAGE_MAX_LENGTH = 80;

/**
 * Parse an adaptive usage key to extract the base model ID.
 * e.g. "adaptiveUsage:sonnet" → { isAdaptive: true, baseModelId: "claude-sonnet-4-6" }
 * e.g. "adaptiveUsage" → { isAdaptive: true, baseModelId: "claude-sonnet-4-6" } (backward compat)
 */
export function parseAdaptiveKey(key: string): ParseResult {
  if (key === "adaptiveUsage") {
    return { isAdaptive: true, baseModelId: MODEL_IDS.sonnet };
  }

  if (key.startsWith("adaptiveUsage:")) {
    const base = key.slice("adaptiveUsage:".length);
    switch (base) {
      case "opus":
        return { isAdaptive: true, baseModelId: MODEL_IDS.opus };
      case "haiku":
        return { isAdaptive: true, baseModelId: MODEL_IDS.haiku };
      case "sonnet":
      default:
        return { isAdaptive: true, baseModelId: MODEL_IDS.sonnet };
    }
  }

  return { isAdaptive: false, baseModelId: MODEL_IDS.sonnet };
}

export function createInitialState(baseModelId: string): AdaptiveRouterState {
  return {
    baseModel: baseModelId,
    turnHistory: [],
    cumulativeInputTokens: 0,
    currentModelId: baseModelId,
    lastSwitchTurn: -COOLDOWN_TURNS, // allow immediate first switch
    turnCount: 0,
  };
}

export function recordTurn(
  state: AdaptiveRouterState,
  turn: TurnRecord,
): AdaptiveRouterState {
  const newHistory = [...state.turnHistory, turn].slice(-MAX_HISTORY);
  return {
    ...state,
    turnHistory: newHistory,
    cumulativeInputTokens: state.cumulativeInputTokens + turn.inputTokens,
    turnCount: state.turnCount + 1,
  };
}

function get1mVariant(modelId: string): string | null {
  if (modelId === MODEL_IDS.sonnet || modelId === MODEL_IDS["sonnet-1m"]) {
    return MODEL_IDS["sonnet-1m"];
  }
  if (modelId === MODEL_IDS.opus || modelId === MODEL_IDS["opus-1m"]) {
    return MODEL_IDS["opus-1m"];
  }
  // Haiku doesn't have a 1M variant, upgrade to sonnet-1m
  if (modelId === MODEL_IDS.haiku) {
    return MODEL_IDS["sonnet-1m"];
  }
  return null;
}

function containsComplexKeyword(message: string): boolean {
  const lower = message.toLowerCase();
  for (const keyword of COMPLEX_KEYWORDS) {
    if (lower.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function isSimpleMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return SIMPLE_PATTERNS.has(trimmed);
}

function recentAverageOutput(
  history: readonly TurnRecord[],
  count: number,
): number {
  if (history.length === 0) return 0;
  const recent = history.slice(-count);
  const total = recent.reduce((sum, t) => sum + t.outputTokens, 0);
  return total / recent.length;
}

export function resolveModel(
  state: AdaptiveRouterState,
  userMessage: string,
): RouteResult {
  const turnsSinceSwitch = state.turnCount - state.lastSwitchTurn;
  const inCooldown = turnsSinceSwitch < COOLDOWN_TURNS;

  // Priority 1: Long context upgrade (bypasses cooldown)
  if (state.cumulativeInputTokens > LONG_CONTEXT_THRESHOLD) {
    const variant = get1mVariant(state.currentModelId);
    if (variant && variant !== state.currentModelId) {
      return {
        modelId: variant,
        reason: `Cumulative input ${state.cumulativeInputTokens} tokens > ${LONG_CONTEXT_THRESHOLD}, upgrading to 1M context`,
        changed: true,
      };
    }
  }

  // Stay on 1M variant while context is long — never downgrade from 1M
  const isOn1mVariant = state.currentModelId.includes("[1m]");
  const isLongContext = state.cumulativeInputTokens > LONG_CONTEXT_THRESHOLD;
  if (isOn1mVariant && isLongContext) {
    return {
      modelId: state.currentModelId,
      reason: "Staying on 1M variant (long context)",
      changed: false,
    };
  }

  // Respect cooldown for non-1M switches
  if (inCooldown) {
    return {
      modelId: state.currentModelId,
      reason: "In cooldown period",
      changed: false,
    };
  }

  // Priority 2: Complex task → opus
  if (
    containsComplexKeyword(userMessage) &&
    userMessage.length > COMPLEX_MESSAGE_MIN_LENGTH
  ) {
    if (state.currentModelId !== MODEL_IDS.opus) {
      return {
        modelId: MODEL_IDS.opus,
        reason: "Complex keywords detected with long message",
        changed: true,
      };
    }
  }

  // Priority 3: High output trend → opus
  if (state.turnHistory.length >= 3) {
    const avgOutput = recentAverageOutput(state.turnHistory, 3);
    if (
      avgOutput > HIGH_OUTPUT_THRESHOLD &&
      state.currentModelId !== MODEL_IDS.opus
    ) {
      return {
        modelId: MODEL_IDS.opus,
        reason: `Recent 3-turn average output ${Math.round(avgOutput)} > ${HIGH_OUTPUT_THRESHOLD} tokens`,
        changed: true,
      };
    }
  }

  // Priority 4: Simple/short message → haiku
  // 4a: Exact simple patterns (ok, yes, 好, etc.)
  if (
    userMessage.length < SIMPLE_MESSAGE_MAX_LENGTH &&
    isSimpleMessage(userMessage)
  ) {
    if (state.currentModelId !== MODEL_IDS.haiku) {
      return {
        modelId: MODEL_IDS.haiku,
        reason: "Simple confirmation message",
        changed: true,
      };
    }
  }
  // 4b: Short messages without complex keywords (greetings, simple questions)
  if (
    userMessage.length < SHORT_MESSAGE_MAX_LENGTH &&
    !containsComplexKeyword(userMessage)
  ) {
    if (state.currentModelId !== MODEL_IDS.haiku) {
      return {
        modelId: MODEL_IDS.haiku,
        reason: `Short message (${userMessage.length} chars) without complex keywords`,
        changed: true,
      };
    }
  }

  // Default: return to base model if not already there
  if (state.currentModelId !== state.baseModel) {
    return {
      modelId: state.baseModel,
      reason: "No special signal, returning to base model",
      changed: true,
    };
  }

  return {
    modelId: state.currentModelId,
    reason: "No change needed",
    changed: false,
  };
}

export function isAdaptiveMode(modelKey: string | undefined): boolean {
  return (
    modelKey === "adaptiveUsage" ||
    (modelKey?.startsWith("adaptiveUsage:") ?? false)
  );
}
