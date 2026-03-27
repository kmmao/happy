import { logger } from "@/ui/logger";

interface FileEdit {
  path: string;
  type: "create" | "edit";
}

interface TurnData {
  turnId: string;
  model: string;
  userMessage: string;
  assistantText: string;
  fileEdits: FileEdit[];
  toolCallCount: number;
  outputTokens: number;
}

/**
 * Collects data from SDK messages during a turn for knowledge extraction.
 * Resets on each new turn. Only tracks data when knowledge base is enabled.
 */
export class TurnCollector {
  private currentTurnId: string | null = null;
  private currentModel: string = "";
  private userMessage: string = "";
  private assistantText: string = "";
  private fileEdits: FileEdit[] = [];
  private toolCallCount: number = 0;
  private outputTokens: number = 0;
  private pendingTurns: TurnData[] = [];
  private lastExtractionTime: number = Date.now();

  // Accumulation thresholds
  private readonly TURN_THRESHOLD = 3;
  private readonly TIME_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  startTurn(turnId: string, model: string): void {
    this.currentTurnId = turnId;
    this.currentModel = model;
    this.userMessage = "";
    this.assistantText = "";
    this.fileEdits = [];
    this.toolCallCount = 0;
    this.outputTokens = 0;
  }

  collectUserMessage(text: string): void {
    this.userMessage = text.slice(0, 2000);
  }

  collectAssistantText(text: string): void {
    this.assistantText += text;
    if (this.assistantText.length > 5000) {
      this.assistantText = this.assistantText.slice(0, 5000);
    }
  }

  collectFileEdit(path: string, type: "create" | "edit"): void {
    this.fileEdits.push({ path, type });
  }

  collectToolCall(): void {
    this.toolCallCount++;
  }

  /**
   * Called when a turn completes. Evaluates if the turn has enough
   * substance to be worth extracting knowledge from.
   */
  onTurnEnd(outputTokens: number): TurnData[] | null {
    this.outputTokens = outputTokens;

    if (!this.currentTurnId) return null;

    const isValuable = this.fileEdits.length > 0
      || this.toolCallCount > 5
      || this.outputTokens > 500;

    if (isValuable) {
      this.pendingTurns.push({
        turnId: this.currentTurnId,
        model: this.currentModel,
        userMessage: this.userMessage,
        assistantText: this.assistantText.slice(0, 5000),
        fileEdits: [...this.fileEdits].slice(0, 50),
        toolCallCount: this.toolCallCount,
        outputTokens: this.outputTokens,
      });

      logger.debug(`[knowledge] Turn ${this.currentTurnId} marked as valuable (edits=${this.fileEdits.length}, tools=${this.toolCallCount}, tokens=${this.outputTokens})`);
    }

    this.currentTurnId = null;

    // Check if we should trigger extraction
    const timeSinceLastExtraction = Date.now() - this.lastExtractionTime;
    const shouldExtract =
      this.pendingTurns.length >= this.TURN_THRESHOLD
      || (this.pendingTurns.length > 0 && timeSinceLastExtraction > this.TIME_THRESHOLD_MS);

    if (shouldExtract) {
      const turns = [...this.pendingTurns];
      this.pendingTurns = [];
      this.lastExtractionTime = Date.now();
      logger.debug(`[knowledge] Triggering extraction for ${turns.length} turns`);
      return turns;
    }

    return null;
  }

  /** Force flush any pending turns (e.g., on session end) */
  flush(): TurnData[] | null {
    if (this.pendingTurns.length === 0) return null;
    const turns = [...this.pendingTurns];
    this.pendingTurns = [];
    this.lastExtractionTime = Date.now();
    logger.debug(`[knowledge] Flushing ${turns.length} pending turns`);
    return turns;
  }

  getPendingCount(): number {
    return this.pendingTurns.length;
  }
}
