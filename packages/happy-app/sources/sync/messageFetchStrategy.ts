export type MessageHistoryFetchStrategy =
  | "incremental"
  | "nativeFullHistory"
  | "webLatestOnly";

interface ResolveMessageHistoryFetchStrategyInput {
  platformOS: string;
  initialAfterSeq: number;
}

export function resolveMessageHistoryFetchStrategy({
  platformOS,
  initialAfterSeq,
}: ResolveMessageHistoryFetchStrategyInput): MessageHistoryFetchStrategy {
  if (initialAfterSeq > 0) {
    return "incremental";
  }
  return platformOS === "web" ? "webLatestOnly" : "nativeFullHistory";
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
