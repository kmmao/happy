import * as React from "react";
import { storage } from "@/sync/storage";
import {
  didPendingActionAppear,
  getHasPendingAction,
} from "./useCollapsibleInputHelpers";

interface UseCollapsibleInputOptions {
  /** Session ID for persisting collapsed state */
  sessionId: string;
  /** Whether the session has messages (collapsed by default if true) */
  hasMessages: boolean;
  /** Current prompt suggestion */
  promptSuggestion: string | null | undefined;
  /** Whether the session needs a continue */
  needsContinue: boolean | undefined;
  /** Whether the SDK session is waiting for user action */
  requiresAction?: boolean;
  /** Whether STT is currently listening */
  isSttListening?: boolean;
  /** Whether there are pending images to send */
  hasPendingImages?: boolean;
}

interface UseCollapsibleInputReturn {
  collapsed: boolean;
  expand: () => void;
  collapse: () => void;
  hasPendingAction: boolean;
}

export function useCollapsibleInput(
  options: UseCollapsibleInputOptions,
): UseCollapsibleInputReturn {
  const {
    sessionId,
    hasMessages,
    promptSuggestion,
    needsContinue,
    requiresAction,
    isSttListening,
    hasPendingImages,
  } = options;

  // Check if collapsible input is enabled in settings (default: false = always expanded)
  const collapsibleEnabled = storage.getState().settings.collapsibleInput;

  // Read persisted state: if user manually expanded, respect that
  const isPersistedExpanded = React.useMemo(
    () =>
      (storage.getState().localSettings.inputExpandedSessions ?? {})[
        sessionId
      ] === true,
    [sessionId],
  );

  // If collapsible is disabled, never collapse
  // Otherwise: collapsed when session has messages, expanded when empty
  // If user previously expanded this session, start expanded
  const [collapsed, setCollapsed] = React.useState(
    collapsibleEnabled && !isPersistedExpanded ? hasMessages : false,
  );

  // Sync collapsed state when messages load (hasMessages goes false → true)
  // Only if user hasn't manually expanded and collapsible is enabled
  const prevHasMessages = React.useRef(hasMessages);
  React.useEffect(() => {
    if (
      collapsibleEnabled &&
      !prevHasMessages.current &&
      hasMessages &&
      !isPersistedExpanded
    ) {
      setCollapsed(true);
    }
    prevHasMessages.current = hasMessages;
  }, [hasMessages, isPersistedExpanded, collapsibleEnabled]);

  const hasPendingAction = getHasPendingAction({
    promptSuggestion,
    needsContinue,
    requiresAction,
  });

  // Auto-expand when a pending action appears
  const prevPromptSuggestion = React.useRef(promptSuggestion);
  const prevNeedsContinue = React.useRef(needsContinue);
  const prevRequiresAction = React.useRef(requiresAction);

  React.useEffect(() => {
    const pendingActionAppeared = didPendingActionAppear(
      {
        promptSuggestion: prevPromptSuggestion.current,
        needsContinue: prevNeedsContinue.current,
        requiresAction: prevRequiresAction.current,
      },
      {
        promptSuggestion,
        needsContinue,
        requiresAction,
      },
    );

    if (pendingActionAppeared) {
      setCollapsed(false);
    }

    prevPromptSuggestion.current = promptSuggestion;
    prevNeedsContinue.current = needsContinue;
    prevRequiresAction.current = requiresAction;
  }, [promptSuggestion, needsContinue, requiresAction]);

  // Persist expanded state to local settings
  const persistExpanded = React.useCallback(
    (expanded: boolean) => {
      const current =
        storage.getState().localSettings.inputExpandedSessions ?? {};
      if (expanded) {
        storage.getState().applyLocalSettings({
          inputExpandedSessions: {
            ...current,
            [sessionId]: true,
          },
        });
      } else {
        const { [sessionId]: _, ...rest } = current;
        storage.getState().applyLocalSettings({
          inputExpandedSessions: rest,
        });
      }
    },
    [sessionId],
  );

  const expand = React.useCallback(() => {
    setCollapsed(false);
    persistExpanded(true);
  }, [persistExpanded]);

  const collapse = React.useCallback(() => {
    // Don't collapse if feature is disabled, STT is active, or images are pending
    if (!collapsibleEnabled || isSttListening || hasPendingImages) return;
    setCollapsed(true);
    persistExpanded(false);
  }, [collapsibleEnabled, isSttListening, hasPendingImages, persistExpanded]);

  return {
    collapsed,
    expand,
    collapse,
    hasPendingAction,
  };
}

