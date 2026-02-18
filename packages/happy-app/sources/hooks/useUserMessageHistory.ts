import { useState, useCallback, useRef } from "react";
import { storage } from "@/sync/storage";

/**
 * Hook for navigating through user message history within the current session.
 * Provides arrow key navigation similar to shell history or Claude Code.
 *
 * Usage:
 * - navigateUp(currentDraft): Get previous message in history, preserving current draft
 * - navigateDown(): Get next message in history (or saved draft when returning to end)
 * - reset(): Reset to end of history (no selection)
 *
 * The hook preserves the current input text as a "draft" when first navigating up,
 * and restores it when navigating back down past all history.
 *
 * @param sessionId - The current session ID to scope history to
 */
export function useUserMessageHistory(sessionId: string | undefined) {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const savedDraft = useRef<string>("");

  // Build history from the current session only, sorted by timestamp (most recent first)
  // This is called on-demand rather than memoized to avoid stale data
  const getHistory = useCallback(() => {
    if (!sessionId) return [];

    const allSessionMessages = storage.getState().sessionMessages;
    const sessionMessages = allSessionMessages[sessionId];
    if (!sessionMessages?.messages) return [];

    const userMessages: Array<{ text: string; time: number }> = [];

    for (const msg of sessionMessages.messages) {
      if (msg.kind === "user-text") {
        userMessages.push({
          text: msg.text,
          time: msg.createdAt,
        });
      }
    }

    // Sort by timestamp descending (most recent first)
    userMessages.sort((a, b) => b.time - a.time);

    return userMessages.map((m) => m.text);
  }, [sessionId]);

  /**
   * Navigate to previous message in history (older)
   * Returns the message text or null if at end of history
   *
   * @param currentDraft - The current input text to preserve as draft
   */
  const navigateUp = useCallback(
    (currentDraft?: string) => {
      const history = getHistory();

      // Save draft when first navigating into history
      if (historyIndex === -1 && currentDraft !== undefined) {
        savedDraft.current = currentDraft;
      }

      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        return history[newIndex];
      }
      return null;
    },
    [historyIndex, getHistory],
  );

  /**
   * Navigate to next message in history (newer)
   * Returns the message text, saved draft when returning to end, or null if already at end
   */
  const navigateDown = useCallback(() => {
    const history = getHistory();

    if (historyIndex > -1) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);

      // Return saved draft when navigating back past all history
      if (newIndex === -1) {
        const draft = savedDraft.current;
        savedDraft.current = ""; // Clear saved draft
        return draft;
      }

      return history[newIndex];
    }
    return null;
  }, [historyIndex, getHistory]);

  /**
   * Reset history navigation to end (no selection)
   * Returns the saved draft text and clears it
   */
  const reset = useCallback(() => {
    const draft = savedDraft.current;
    setHistoryIndex(-1);
    savedDraft.current = "";
    return draft;
  }, []);

  return {
    navigateUp,
    navigateDown,
    reset,
    isNavigating: historyIndex !== -1,
  };
}
