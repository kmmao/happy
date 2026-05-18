export type MessageHistoryFetchStrategy =
  | "incremental"
  | "fullHistory";

interface ResolveMessageHistoryFetchStrategyInput {
  initialAfterSeq: number;
}

export function resolveMessageHistoryFetchStrategy({
  initialAfterSeq,
}: ResolveMessageHistoryFetchStrategyInput): MessageHistoryFetchStrategy {
  if (initialAfterSeq > 0) {
    return "incremental";
  }
  return "fullHistory";
}

export function shouldFetchNewestPageFirst(
  _strategy: MessageHistoryFetchStrategy,
): boolean {
  return false;
}

export function shouldApplyMessagesImmediately(
  _strategy: MessageHistoryFetchStrategy,
): boolean {
  return true;
}
