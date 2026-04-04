import { logger } from "@/ui/logger";

interface TurnData {
  turnId: string;
  model: string;
  userMessage: string;
  assistantText: string;
  fileEdits: { path: string; type: "create" | "edit" }[];
  toolCallCount: number;
  outputTokens: number;
}

interface KnowledgeInjectionResult {
  profile: {
    techStack: string[];
    architectureType?: string;
    knownPitfalls: string[];
    coreConventions: string[];
    lastUpdatedAt: number;
  } | null;
  entries: {
    id: string;
    entryType: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    createdAt: string;
  }[];
}

/**
 * Client for the Happy server knowledge base API.
 * Handles sending turn data for extraction and fetching knowledge for injection.
 */
export class KnowledgeClient {
  constructor(
    private readonly serverUrl: string,
    private readonly authToken: string,
    private readonly projectId: string,
    private readonly sessionId: string,
  ) {}

  /**
   * Send accumulated turn data to server for knowledge extraction.
   * The server handles AI extraction and deduplication.
   * Non-blocking: errors are logged but don't propagate.
   */
  async submitTurns(turns: TurnData[]): Promise<void> {
    for (const turn of turns) {
      try {
        const body = {
          entryType: this.inferEntryType(turn),
          category: this.inferCategory(turn),
          contributorType: "session",
          action: "create",
          title: this.generateTitle(turn),
          content: turn.assistantText.slice(0, 2000),
          request: turn.userMessage.slice(0, 500),
          findings: undefined,
          analysis: undefined,
          outcome: turn.fileEdits.length > 0
            ? `Modified ${turn.fileEdits.length} file(s): ${turn.fileEdits.map((f) => f.path).join(", ").slice(0, 500)}`
            : undefined,
          tags: this.extractTags(turn),
          confidence: turn.outputTokens > 1000 ? "high" : "medium",
          sessionId: this.sessionId,
          model: turn.model,
          affectedFiles: turn.fileEdits.map((f) => f.path),
        };

        const resp = await fetch(`${this.serverUrl}/v1/projects/${this.projectId}/knowledge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.authToken}`,
          },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          logger.debug(`[knowledge] Failed to submit turn ${turn.turnId}: ${resp.status}`);
        } else {
          const result = await resp.json() as { action: string };
          logger.debug(`[knowledge] Turn ${turn.turnId} submitted: action=${result.action}`);
        }
      } catch (err) {
        logger.debug(`[knowledge] Error submitting turn: ${err}`);
      }
    }
  }

  /**
   * Fetch knowledge context for injection into a new session.
   */
  async fetchInjectionContext(
    mode: "auto" | "full" | "minimal",
    contextHints?: string[],
  ): Promise<KnowledgeInjectionResult | null> {
    try {
      const resp = await fetch(`${this.serverUrl}/v1/projects/${this.projectId}/knowledge/inject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ mode, contextHints }),
      });

      if (!resp.ok) {
        logger.debug(`[knowledge] Failed to fetch injection context: ${resp.status}`);
        return null;
      }

      return await resp.json() as KnowledgeInjectionResult;
    } catch (err) {
      logger.debug(`[knowledge] Error fetching injection context: ${err}`);
      return null;
    }
  }

  /**
   * Format injection result as a system prompt snippet.
   */
  static formatForInjection(result: KnowledgeInjectionResult): string {
    const parts: string[] = [];

    if (result.profile) {
      parts.push("## Project Knowledge Base");
      if (result.profile.techStack.length > 0) {
        parts.push(`Tech Stack: ${result.profile.techStack.join(", ")}`);
      }
      if (result.profile.architectureType) {
        parts.push(`Architecture: ${result.profile.architectureType}`);
      }
      if (result.profile.knownPitfalls.length > 0) {
        parts.push("Known Pitfalls:");
        result.profile.knownPitfalls.forEach((p) => parts.push(`- \u26a0\ufe0f ${p}`));
      }
      if (result.profile.coreConventions.length > 0) {
        parts.push("Core Conventions:");
        result.profile.coreConventions.forEach((c) => parts.push(`- ${c}`));
      }
    }

    if (result.entries.length > 0) {
      parts.push("\n## Recent Knowledge");
      for (const entry of result.entries) {
        const typeIcon: Record<string, string> = { discovery: "\ud83d\udca1", decision: "\ud83d\udccb", fix: "\ud83d\udd27", convention: "\ud83d\udccf", warning: "\u26a0\ufe0f" };
        const icon = typeIcon[entry.entryType] || "\ud83d\udcdd";
        parts.push(`${icon} **${entry.title}** (${entry.confidence} confidence, ${entry.createdAt})`);
        parts.push(`   ${entry.content.slice(0, 300)}`);
        if (entry.tags.length > 0) {
          parts.push(`   Tags: ${entry.tags.map((t) => `#${t}`).join(" ")}`);
        }
      }
    }

    return parts.join("\n");
  }

  /**
   * Infer knowledge category from turn content.
   * Categories: user (preferences/role), feedback (corrections/guidance),
   * project (goals/decisions/architecture), reference (external pointers).
   */
  private inferCategory(turn: TurnData): string {
    const text = `${turn.userMessage} ${turn.assistantText}`.toLowerCase();

    // Feedback: corrections, style guidance, approach preferences
    const feedbackSignals = ["don't", "stop", "不要", "别", "改成", "换成", "prefer", "instead", "should be", "wrong", "纠正", "错了"];
    if (feedbackSignals.some((s) => text.includes(s)) && turn.fileEdits.length === 0) return "feedback";

    // Reference: URLs, docs, external resources
    const refSignals = ["http://", "https://", "docs.", "文档", "参考", "reference", "documentation", "readme", "wiki"];
    if (refSignals.some((s) => text.includes(s)) && turn.fileEdits.length === 0) return "reference";

    // User: role, preferences, environment info
    const userSignals = ["i am", "i'm", "我是", "my setup", "my environment", "我的", "偏好", "preference", "workflow"];
    if (userSignals.some((s) => text.includes(s)) && turn.fileEdits.length === 0) return "user";

    // Default: project knowledge (code changes, discoveries, decisions)
    return "project";
  }

  private inferEntryType(turn: TurnData): string {
    const text = `${turn.userMessage} ${turn.assistantText}`.toLowerCase();
    if (text.includes("fix") || text.includes("bug") || text.includes("error") || text.includes("修复")) return "fix";
    if (text.includes("决策") || text.includes("选型") || text.includes("decision") || text.includes("choose")) return "decision";
    if (text.includes("规范") || text.includes("convention") || text.includes("规则")) return "convention";
    if (text.includes("注意") || text.includes("warning") || text.includes("危险") || text.includes("雷区")) return "warning";
    return "discovery";
  }

  private generateTitle(turn: TurnData): string {
    // Use first line of user message, truncated
    const firstLine = turn.userMessage.split("\n")[0].trim();
    if (firstLine.length > 0 && firstLine.length <= 200) return firstLine;
    if (firstLine.length > 200) return firstLine.slice(0, 197) + "...";
    // Fallback: use file edits
    if (turn.fileEdits.length > 0) {
      return `Modified ${turn.fileEdits.map((f) => f.path.split("/").pop()).join(", ")}`.slice(0, 200);
    }
    return "Session activity";
  }

  private extractTags(turn: TurnData): string[] {
    const tags = new Set<string>();
    for (const edit of turn.fileEdits) {
      const ext = edit.path.split(".").pop();
      if (ext) tags.add(ext);
      // Extract directory-based tags
      const parts = edit.path.split("/");
      if (parts.length > 1) {
        const dir = parts[parts.length - 2];
        if (dir && dir.length < 20) tags.add(dir);
      }
    }
    return [...tags].slice(0, 10);
  }
}
