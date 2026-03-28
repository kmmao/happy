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

export type Sensitivity = "conservative" | "balanced" | "aggressive";

export interface TurnCollectorConfig {
  sensitivity: Sensitivity;
  trackFileEdits: boolean;
  trackToolCalls: boolean;
  trackTokens: boolean;
}

interface SensitivityPreset {
  turnThreshold: number;
  timeThresholdMs: number;
  toolCallThreshold: number;
  tokenThreshold: number;
}

const SENSITIVITY_PRESETS: Record<Sensitivity, SensitivityPreset> = {
  conservative: { turnThreshold: 5, timeThresholdMs: 60 * 60 * 1000, toolCallThreshold: 8, tokenThreshold: 800 },
  balanced:     { turnThreshold: 3, timeThresholdMs: 30 * 60 * 1000, toolCallThreshold: 5, tokenThreshold: 500 },
  aggressive:   { turnThreshold: 1, timeThresholdMs: 10 * 60 * 1000, toolCallThreshold: 3, tokenThreshold: 200 },
};

const DEFAULT_CONFIG: TurnCollectorConfig = {
  sensitivity: "balanced",
  trackFileEdits: true,
  trackToolCalls: true,
  trackTokens: true,
};

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

  private readonly config: TurnCollectorConfig;
  private readonly preset: SensitivityPreset;

  constructor(config?: Partial<TurnCollectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.preset = SENSITIVITY_PRESETS[this.config.sensitivity];
    logger.debug(`[knowledge] TurnCollector initialized: sensitivity=${this.config.sensitivity}, trackFileEdits=${this.config.trackFileEdits}, trackToolCalls=${this.config.trackToolCalls}, trackTokens=${this.config.trackTokens}`);
  }

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

    const isValuable =
      (this.config.trackFileEdits && this.fileEdits.length > 0)
      || (this.config.trackToolCalls && this.toolCallCount > this.preset.toolCallThreshold)
      || (this.config.trackTokens && this.outputTokens > this.preset.tokenThreshold);

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
      this.pendingTurns.length >= this.preset.turnThreshold
      || (this.pendingTurns.length > 0 && timeSinceLastExtraction > this.preset.timeThresholdMs);

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
