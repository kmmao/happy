export type MessageHistoryFetchStrategy =
  | "incremental"
  | "nativeFullHistory"
  | "webLatestOnly";

interface ResolveMessageHistoryFetchStrategyInput {
  initialAfterSeq: number;
}

export function resolveMessageHistoryFetchStrategy({
  initialAfterSeq,
}: ResolveMessageHistoryFetchStrategyInput): MessageHistoryFetchStrategy {
  if (initialAfterSeq > 0) {
    return "incremental";
  }
  return "nativeFullHistory";
}

export function shouldFetchNewestPageFirst(
  strategy: MessageHistoryFetchStrategy,
): boolean {
  return strategy === "webLatestOnly";
}

export function shouldApplyMessagesImmediately(
  strategy: MessageHistoryFetchStrategy,
): boolean {
  return strategy !== "nativeFullHistory";
}
