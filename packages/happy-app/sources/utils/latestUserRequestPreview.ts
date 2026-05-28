import { Message } from "@/sync/typesMessage";

export type LatestUserRequestPreview = {
  text: string;
  isAutoOptionSend: boolean;
};

/**
 * Returns a preview of the most recent user request from a newest-first message
 * list, or null when there is no user-text message with visible content.
 *
 * Pure and dependency-free (only reads message fields) so it can be reused from
 * the store's message-fold path without dragging in app-level modules.
 */
export function getLatestUserRequestPreview(
  messages: readonly Message[] | null | undefined,
): LatestUserRequestPreview | null {
  if (!messages || messages.length === 0) {
    return null;
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.kind !== "user-text") {
      continue;
    }

    const text = message.displayText ?? message.text;
    const normalizedText = text.replace(/\s+/g, " ").trim();
    if (normalizedText.length > 0) {
      return {
        text: normalizedText,
        isAutoOptionSend: message.meta?.source === "auto-option-send",
      };
    }
  }

  return null;
}
