export type AutoOptionSendStatus = "off" | "idle" | "armed" | "ready";

export interface SessionFollowUpOptionsSnapshot {
  sourceType: "markdown-options";
  sourceMessageId: string | null;
  items: string[];
  recommendedIndex: number | null;
  optionsHash: string;
}

export interface AutoOptionFeedbackStats {
  send: number;
  editSend: number;
  timeoutIgnore: number;
  dismiss: number;
  total: number;
}

export type AutoOptionStatsResolver = (
  optionText: string,
) => AutoOptionFeedbackStats | undefined;

export interface AutoOptionQualityScore {
  score: number;
  passed: boolean;
  reasons: string[];
}

export interface RankedOption {
  text: string;
  index: number;
  score: number;
  passed: boolean;
  reasons: string[];
}

export interface RankedOptionsResult {
  ranked: RankedOption[];
  recommendedIndex: number | null;
  allScores: ReadonlyMap<number, number>;
}

export interface AutoOptionCandidate {
  sourceMessageId: string | null;
  optionsHash: string;
  recommendedText: string;
  startedAt: number;
  durationMs: number;
  qualityScore: number;
  qualityReasons: string[];
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
  statsResolver?: AutoOptionStatsResolver;
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

export function normalizeOptionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const MAX_OPTION_TEXT_LENGTH = 120;
const PASS_SCORE_THRESHOLD = 70;
const TOP_OPTIONS_LIMIT = 3;

export const PURE_VIEW_ONLY_OPTION_PATTERNS = [
  "查看 diff",
  "看日志",
  "浏览输出",
] as const;

const VIEW_ONLY_VERB_PREFIXES = [
  "查看", "看一下", "看下", "浏览",
  "列出", "列举", "给我列",
  "检查", "审查",
  "显示", "展示",
  "看日志", "看 diff", "查看 diff",
  "view ", "review ", "check ",
  "show ", "display ", "list ",
  "browse ", "inspect ",
] as const;

const ACTION_VERB_PREFIXES = [
  "继续", "修复", "处理", "执行", "运行", "提交", "重试", "部署", "实现", "更新", "排查", "定位", "优化", "重构", "补充", "验证", "回滚", "合并",
  "continue", "fix", "run", "execute", "implement", "update", "retry", "deploy", "commit", "refactor", "optimize", "verify", "test", "ship",
] as const;

const FOLLOW_UP_ACTION_CONNECTORS = /(?:并|后|再|然后|并且|逐个| and | then | to fix)/i;

const VAGUE_OPTION_BLACKLIST = new Set([
  "继续", "好的", "确认", "开始", "执行", "提交", "ok", "是的", "可以", "没问题", "好",
  "continue", "yes", "go ahead", "proceed", "do it", "sounds good", "go", "sure",
  "run tests", "run it", "fix it", "ship it",
].map(normalizeOptionText));

const TECHNICAL_SPECIFICITY_PATTERN =
  /(?:[a-zA-Z_]\w*\.[a-zA-Z]{1,4}|[a-z]+[A-Z]\w+|\w+_\w+|`[^`]+`|[a-zA-Z_]\w*\(\)|\/[\w/.]+|@[\w/]+)/;

const CHINESE_SPECIFICITY_PATTERN =
  /(?:模块|文件|函数|接口|组件|页面|路由|配置|测试用例|逻辑|方法|类|表|字段|参数|变量|常量)/;

const MIXED_LANG_TECHNICAL = /[\u4e00-\u9fff]\s*[a-zA-Z]\w{2,}/;

const PURE_VIEW_ONLY_OPTION_SET = new Set(
  PURE_VIEW_ONLY_OPTION_PATTERNS.map(normalizeOptionText),
);

function isPureViewOnlyOption(text: string): boolean {
  const normalized = normalizeOptionText(text);
  if (PURE_VIEW_ONLY_OPTION_SET.has(normalized)) return true;
  for (const prefix of VIEW_ONLY_VERB_PREFIXES) {
    if (normalized.startsWith(prefix.toLowerCase())) {
      return !FOLLOW_UP_ACTION_CONNECTORS.test(normalized);
    }
  }
  return false;
}

function matchedActionVerbPrefix(normalized: string): string | null {
  for (const prefix of ACTION_VERB_PREFIXES) {
    if (normalized.startsWith(prefix.toLowerCase())) return prefix.toLowerCase();
  }
  return null;
}

function scoreOption(
  text: string,
  index: number,
  stats: AutoOptionFeedbackStats | undefined,
): AutoOptionQualityScore {
  const normalized = normalizeOptionText(text);

  if (!normalized) {
    return { score: 0, passed: false, reasons: ["empty"] };
  }
  if (normalized.length > MAX_OPTION_TEXT_LENGTH) {
    return { score: 0, passed: false, reasons: ["too-long"] };
  }
  if (isPureViewOnlyOption(normalized)) {
    return { score: 0, passed: false, reasons: ["view-only"] };
  }
  if (VAGUE_OPTION_BLACKLIST.has(normalized)) {
    return { score: 0, passed: false, reasons: ["vague-blacklist"] };
  }

  const reasons: string[] = [];
  let score = 0;

  if (index === 0) {
    score += 25;
    reasons.push("source-priority-1");
  } else if (index === 1) {
    score += 16;
    reasons.push("source-priority-2");
  } else if (index === 2) {
    score += 10;
    reasons.push("source-priority-3");
  } else {
    score += 4;
    reasons.push("source-priority-tail");
  }

  const verbPrefix = matchedActionVerbPrefix(normalized);
  if (verbPrefix) {
    score += 22;
    reasons.push("action-verb");

    const remainder = normalized.slice(verbPrefix.length).trim();
    const isChinese = /[\u4e00-\u9fff]/.test(text);
    const minRemainderLen = isChinese ? 4 : 6;
    if (remainder.length < minRemainderLen) {
      score -= 15;
      reasons.push("vague-no-target");
    }
  } else {
    const connectorMatch = FOLLOW_UP_ACTION_CONNECTORS.exec(normalized);
    const tail = connectorMatch
      ? normalized.slice(connectorMatch.index + connectorMatch[0].length).trim()
      : "";
    const tailHasAction = tail
      ? ACTION_VERB_PREFIXES.some((p) => tail.includes(p.toLowerCase()))
      : false;
    if (tailHasAction) {
      score += 22;
      reasons.push("compound-action");
    } else {
      score += 8;
      reasons.push("weak-action");
    }
  }

  if (FOLLOW_UP_ACTION_CONNECTORS.test(normalized)) {
    score += 16;
    reasons.push("follow-up-connector");
  }

  if (normalized.length >= 20) {
    score += 12;
    reasons.push("detailed");
  } else if (normalized.length >= 10) {
    score += 8;
    reasons.push("medium-length");
  } else if (normalized.length >= 6) {
    score += 4;
    reasons.push("short");
  } else {
    reasons.push("too-short");
  }

  if (TECHNICAL_SPECIFICITY_PATTERN.test(text)) {
    score += 8;
    reasons.push("technical-specificity");
  }
  if (CHINESE_SPECIFICITY_PATTERN.test(text) && normalized.length >= 8) {
    score += 6;
    reasons.push("domain-specificity");
  }
  if (MIXED_LANG_TECHNICAL.test(text)) {
    score += 6;
    reasons.push("mixed-lang-technical");
  }

  if (stats && stats.total > 0) {
    const successRate = (stats.send + stats.editSend) / stats.total;
    const negativeRate = (stats.timeoutIgnore + stats.dismiss) / stats.total;
    score += Math.round(successRate * 20 - negativeRate * 10);
    reasons.push("history");
  } else {
    score += 14;
    reasons.push("no-history-default");
  }

  const clamped = clamp(score, 0, 100);
  return {
    score: clamped,
    passed: clamped >= PASS_SCORE_THRESHOLD,
    reasons,
  };
}

export function rankAndSelectOptions(
  items: string[],
  statsResolver?: AutoOptionStatsResolver,
): RankedOptionsResult {
  const seen = new Set<string>();
  const rankedAll: RankedOption[] = [];

  items.forEach((item, index) => {
    const normalized = normalizeOptionText(item);
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);

    const stats = statsResolver?.(item);
    const quality = scoreOption(item, index, stats);
    rankedAll.push({
      text: item.trim(),
      index,
      score: quality.score,
      passed: quality.passed,
      reasons: quality.reasons,
    });
  });

  rankedAll.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  const firstItem = rankedAll.find((item) => item.index === 0) ?? null;
  const firstItemPassed = firstItem?.passed === true;

  const limited = rankedAll.slice(0, TOP_OPTIONS_LIMIT);
  if (
    firstItem &&
    !limited.some((item) => item.index === firstItem.index)
  ) {
    if (limited.length < TOP_OPTIONS_LIMIT) {
      limited.push(firstItem);
    } else {
      limited[limited.length - 1] = firstItem;
    }
  }

  const recommendedIndex = firstItemPassed
    ? limited.findIndex((item) => item.index === 0)
    : -1;

  const allScores = new Map<number, number>();
  for (const item of rankedAll) {
    allScores.set(item.index, item.score);
  }

  return {
    ranked: limited,
    recommendedIndex: recommendedIndex >= 0 ? recommendedIndex : null,
    allScores,
  };
}


export function getRecommendedOptionIndex(
  items: string[],
  statsResolver?: AutoOptionStatsResolver,
): number | null {
  if (items.length < 2) return null;
  const result = rankAndSelectOptions(items, statsResolver);
  if (result.recommendedIndex === null) return null;
  return result.ranked[result.recommendedIndex]?.index ?? null;
}

export function buildAutoSentKey(candidate: AutoOptionCandidate): string {
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

  const ranked = rankAndSelectOptions(snapshot.items, context.statsResolver);
  if (ranked.recommendedIndex === null) return null;

  const selected = ranked.ranked[ranked.recommendedIndex];
  if (!selected?.text) return null;

  return {
    sourceMessageId: snapshot.sourceMessageId,
    optionsHash: snapshot.optionsHash,
    recommendedText: selected.text,
    startedAt: context.now,
    durationMs: context.durationMs,
    qualityScore: selected.score,
    qualityReasons: selected.reasons,
  };
}

function isContextReady(context: AutoOptionSendContext): boolean {
  if (!context.snapshot) return false;
  if (context.hasAskUserQuestionVisible) return false;
  if (!context.isCurrentSessionActive) return false;
  if (context.sessionId !== context.currentSessionId) return false;
  if (context.inputText.trim().length > 0) return false;
  if (context.hasPendingImages) return false;
  if (context.isSttListening) return false;
  return true;
}

function canFire(
  state: AutoOptionSendState,
  context: AutoOptionSendContext,
): boolean {
  if (!state.candidate) return false;
  if (!isContextReady(context)) return false;

  const candidate = buildAutoOptionCandidate(context);
  if (!candidate) return false;

  if (candidate.recommendedText !== state.candidate.recommendedText) return false;
  if (candidate.optionsHash !== state.candidate.optionsHash) return false;
  if (context.snapshot!.sourceMessageId !== state.candidate.sourceMessageId) return false;
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

    if (!isContextReady(context)) {
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
    if (!isContextReady(context)) {
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
