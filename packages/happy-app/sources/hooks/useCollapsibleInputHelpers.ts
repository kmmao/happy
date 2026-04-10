export interface PendingActionState {
  promptSuggestion: string | null | undefined;
  needsContinue: boolean | undefined;
  requiresAction?: boolean;
}

export function getHasPendingAction(options: PendingActionState): boolean {
  return !!(
    options.promptSuggestion ||
    options.needsContinue ||
    options.requiresAction
  );
}

export function didPendingActionAppear(
  previous: PendingActionState,
  current: PendingActionState,
): boolean {
  return !getHasPendingAction(previous) && getHasPendingAction(current);
}
