import { MessageQueue2 } from "@/utils/MessageQueue2";
import { logger } from "@/ui/logger";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { executeShellCommand } from "@/utils/shellCommand";

export interface MidTurnDrainCallbacks<T> {
  /** Called to interrupt the current turn (e.g. for isolate commands) */
  onInterrupt: () => Promise<void>;
  /** Called to push a user message into the SDK stdin */
  onPush: (message: string, mode: T) => void;
  /** Called when a shell command result is ready */
  onShellResult: (output: string) => void;
  /** Called to hot-swap model mid-turn */
  onModelSwap?: (oldModel: string | undefined, newModel: string | undefined) => Promise<void>;
  /** Called to hot-swap permission mode mid-turn */
  onPermissionModeSwap?: (oldMode: string, newMode: string) => Promise<void>;
  /** Get the current tracked mode */
  getCurrentMode: () => T | null;
  /** Update the tracked mode state */
  setCurrentMode: (mode: T, modeHash: string) => void;
  /** Working directory for shell commands */
  cwd: string;
}

/**
 * Drain mid-turn messages from the queue and process them.
 * This runs concurrently during a turn, allowing user messages sent from
 * the App to be injected into the CLI subprocess stdin immediately rather
 * than waiting for the turn to complete.
 */
export async function drainMidTurnMessages<T extends { model?: string; permissionMode?: string }>(
  queue: MessageQueue2<T>,
  signal: AbortSignal,
  currentColdHash: string,
  coldHasher: (mode: T) => string,
  callbacks: MidTurnDrainCallbacks<T>,
): Promise<void> {
  logger.debug("[midTurnDrain] drain started");
  while (!signal.aborted) {
    const hasNew = await queue.waitForNewMessage(signal);
    if (!hasNew || signal.aborted) break;

    const item = queue.tryTakeForMidTurn(currentColdHash, coldHasher);

    if (!item) {
      // Message exists but can't be mid-turn pushed.
      // If it's an isolate (/compact, /clear), interrupt the current turn
      if (queue.peekIsolate()) {
        logger.debug("[midTurnDrain] isolate detected, interrupting");
        await callbacks.onInterrupt();
      }
      // For other non-mid-turn cases (cold hash change), stop draining
      break;
    }

    // Handle shell commands directly without sending to Claude
    const specialCmd = parseSpecialCommand(item.message);
    if (specialCmd.type === "shell" && specialCmd.shellCommand) {
      logger.debug("[midTurnDrain] executing shell command");
      const output = await executeShellCommand(specialCmd.shellCommand, callbacks.cwd);
      callbacks.onShellResult(output);
      continue;
    }

    const currentMode = callbacks.getCurrentMode();

    // Hot-swap model if changed
    if (currentMode && item.mode.model !== currentMode.model && callbacks.onModelSwap) {
      await callbacks.onModelSwap(currentMode.model, item.mode.model);
    }

    // Hot-swap permissionMode if changed
    if (
      currentMode &&
      item.mode.permissionMode !== currentMode.permissionMode &&
      callbacks.onPermissionModeSwap
    ) {
      await callbacks.onPermissionModeSwap(
        currentMode.permissionMode ?? "",
        item.mode.permissionMode ?? "",
      );
    }

    // Update tracked mode state
    callbacks.setCurrentMode(item.mode, item.modeHash);

    // Push the message for mid-turn injection
    logger.debug(`[midTurnDrain] pushing ${item.message.length} chars`);
    callbacks.onPush(item.message, item.mode);
  }
  logger.debug("[midTurnDrain] drain stopped");
}
