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
  trackTokens: boolean;
}

interface SensitivityPreset {
  turnThreshold: number;
  timeThresholdMs: number;
}

const SENSITIVITY_PRESETS: Record<Sensitivity, SensitivityPreset> = {
  conservative: { turnThreshold: 5, timeThresholdMs: 60 * 60 * 1000 },
  balanced:     { turnThreshold: 3, timeThresholdMs: 30 * 60 * 1000 },
  aggressive:   { turnThreshold: 1, timeThresholdMs: 10 * 60 * 1000 },
};

const DEFAULT_CONFIG: TurnCollectorConfig = {
  sensitivity: "balanced",
  trackFileEdits: true,
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

  // Session-level statistics for end-of-session summary
  private totalTurnCount: number = 0;
  private valuableTurnCount: number = 0;
  private totalOutputTokens: number = 0;
  private allEditedPaths: Set<string> = new Set();
  private firstUserMessage: string = "";
  private lastUserMessage: string = "";
  private lastModel: string = "";

  private config: TurnCollectorConfig;
  private preset: SensitivityPreset;

  constructor(config?: Partial<TurnCollectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.preset = SENSITIVITY_PRESETS[this.config.sensitivity];
    logger.debug(`[knowledge] TurnCollector initialized: sensitivity=${this.config.sensitivity}, trackFileEdits=${this.config.trackFileEdits}`);
  }

  /** Update config at runtime (e.g. from server knowledgeConfig). Only applies changed fields. */
  updateConfig(patch: Partial<TurnCollectorConfig>): void {
    const prev = { ...this.config };
    this.config = { ...this.config, ...patch };
    if (patch.sensitivity && patch.sensitivity !== prev.sensitivity) {
      this.preset = SENSITIVITY_PRESETS[this.config.sensitivity];
    }
    logger.debug(`[knowledge] TurnCollector config updated: sensitivity=${this.config.sensitivity}, trackFileEdits=${this.config.trackFileEdits}`);
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

    // Accumulate session-level stats (regardless of isValuable)
    this.totalTurnCount++;
    this.totalOutputTokens += outputTokens;
    if (this.userMessage) {
      if (!this.firstUserMessage) this.firstUserMessage = this.userMessage;
      this.lastUserMessage = this.userMessage;
    }
    this.lastModel = this.currentModel;
    for (const edit of this.fileEdits) this.allEditedPaths.add(edit.path);

    const isValuable =
      (this.config.trackFileEdits && this.fileEdits.length > 0)
      || (this.config.trackTokens && this.fileEdits.length === 0 && this.outputTokens > 1500);

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

      this.valuableTurnCount++;
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

  /**
   * Build a session-end summary entry from accumulated stats.
   * Returns null if the session was too short (< 2 valuable turns).
   */
  buildSessionSummary(): TurnData | null {
    if (this.valuableTurnCount < 2) return null;

    const editPaths = [...this.allEditedPaths];
    const pathList = editPaths.length > 0
      ? editPaths.map((p) => p.split("/").pop()).join(", ").slice(0, 500)
      : "none";

    const title = this.firstUserMessage.split("\n")[0].slice(0, 200) || "Session summary";

    const parts = [
      `Session: ${this.totalTurnCount} turns, ${this.valuableTurnCount} valuable, ${this.totalOutputTokens} output tokens.`,
      `Files modified: ${editPaths.length} (${pathList}).`,
    ];
    if (this.firstUserMessage) parts.push(`First task: ${this.firstUserMessage.slice(0, 300)}`);
    if (this.lastUserMessage && this.lastUserMessage !== this.firstUserMessage) {
      parts.push(`Last task: ${this.lastUserMessage.slice(0, 300)}`);
    }

    const fileEdits: FileEdit[] = editPaths.map((p) => ({ path: p, type: "edit" as const }));

    return {
      turnId: `summary-${Date.now()}`,
      model: this.lastModel,
      userMessage: title,
      assistantText: parts.join("\n"),
      fileEdits,
      toolCallCount: 0,
      outputTokens: this.totalOutputTokens,
    };
  }

  /**
   * Return the assistant text accumulated during the current/last turn.
   * Used by per-turn hit detection against injected knowledge entries.
   */
  getAssistantTextSnapshot(): string {
    return this.assistantText;
  }
}
