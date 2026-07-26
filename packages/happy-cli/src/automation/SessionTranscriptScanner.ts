import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "@/ui/logger";

export interface TranscriptTurn {
  sessionId: string;
  turnId: string;
  userMessage: string;
  assistantText: string;
  fileEdits: Array<{ path: string; type: "create" | "edit" }>;
  toolCallCount: number;
  outputTokens: number;
  model: string;
  timestamp: number;
}

interface SessionLogEntry {
  type?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  model?: string;
  timestamp?: number;
  uuid?: string;
  toolName?: string;
  toolInput?: { file_path?: string; command?: string };
  usage?: { output_tokens?: number };
}

/**
 * Scans Claude Code session JSONL files and extracts valuable turns
 * for downstream consumers. Filters for turns with substantive
 * file edits or significant assistant output.
 */
export async function scanSessionTranscripts(options: {
  sinceMs: number;
  maxSessions?: number;
  maxTurnsPerSession?: number;
}): Promise<TranscriptTurn[]> {
  const { sinceMs, maxSessions = 20, maxTurnsPerSession = 10 } = options;
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const projectsDir = join(claudeConfigDir, "projects");
  const results: TranscriptTurn[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return results;
  }

  for (const projectDir of projectDirs) {
    const fullProjectDir = join(projectsDir, projectDir);
    let dirStat;
    try {
      dirStat = await stat(fullProjectDir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;

    // Scan for .jsonl session files
    let sessionFiles: string[];
    try {
      const entries = await readdir(fullProjectDir);
      sessionFiles = entries.filter((e) => e.endsWith(".jsonl")).slice(0, maxSessions);
    } catch {
      continue;
    }

    for (const sessionFile of sessionFiles) {
      const sessionPath = join(fullProjectDir, sessionFile);
      try {
        const fileStat = await stat(sessionPath);
        if (fileStat.mtimeMs < sinceMs) continue; // Skip old sessions

        const content = await readFile(sessionPath, "utf-8");
        const turns = extractTurnsFromJsonl(
          content,
          sessionFile.replace(".jsonl", ""),
          maxTurnsPerSession,
        );
        results.push(...turns);
      } catch {
        continue;
      }
    }
  }

  logger.debug(`[SESSION-TRANSCRIPT] Scanned ${results.length} valuable turns from session logs`);
  return results;
}

function extractTurnsFromJsonl(
  content: string,
  sessionId: string,
  maxTurns: number,
): TranscriptTurn[] {
  const lines = content.split("\n").filter(Boolean);
  const turns: TranscriptTurn[] = [];

  let currentUser = "";
  let currentAssistant = "";
  let currentModel = "";
  let currentTimestamp = 0;
  let fileEdits: Array<{ path: string; type: "create" | "edit" }> = [];
  let toolCallCount = 0;
  let outputTokens = 0;
  let turnIndex = 0;

  const flushTurn = () => {
    if (!currentUser && !currentAssistant) return;
    const isValuable = fileEdits.length > 0 || outputTokens > 500 || toolCallCount > 3;
    if (isValuable && turns.length < maxTurns) {
      turns.push({
        sessionId,
        turnId: `${sessionId}-${turnIndex}`,
        userMessage: currentUser.slice(0, 2000),
        assistantText: currentAssistant.slice(0, 5000),
        fileEdits: [...fileEdits].slice(0, 50),
        toolCallCount,
        outputTokens,
        model: currentModel,
        timestamp: currentTimestamp,
      });
    }
    currentUser = "";
    currentAssistant = "";
    fileEdits = [];
    toolCallCount = 0;
    outputTokens = 0;
    turnIndex++;
  };

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as SessionLogEntry;

      // Skip internal events
      if (entry.type === "file-history-snapshot" || entry.type === "change" || entry.type === "queue-operation") {
        continue;
      }

      const role = entry.message?.role;
      if (role === "user") {
        flushTurn(); // New turn starts
        const content = entry.message?.content;
        if (typeof content === "string") {
          currentUser = content;
        } else if (Array.isArray(content)) {
          currentUser = content.filter((c) => c.type === "text" && c.text).map((c) => c.text!).join("\n");
        }
        currentTimestamp = entry.timestamp ?? Date.now();
        currentModel = entry.model ?? currentModel;
      } else if (role === "assistant") {
        const content = entry.message?.content;
        if (typeof content === "string") {
          currentAssistant += content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              currentAssistant += block.text;
            } else if (block.type === "tool_use") {
              toolCallCount++;
            }
          }
        }
        if (entry.usage?.output_tokens) {
          outputTokens += entry.usage.output_tokens;
        }
      }

      // Track file edits from tool results
      if (entry.toolName === "Write" || entry.toolName === "Edit") {
        const filePath = entry.toolInput?.file_path;
        if (filePath) {
          fileEdits.push({
            path: filePath,
            type: entry.toolName === "Write" ? "create" : "edit",
          });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  flushTurn(); // Flush last turn
  return turns;
}
