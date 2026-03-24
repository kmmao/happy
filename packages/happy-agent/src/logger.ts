/**
 * Simple file-based logger for happy-agent.
 *
 * All debugging goes to file only — never console output,
 * which would disturb the agent session.
 * Log files are written to $HAPPY_HOME_DIR/logs/agent-<timestamp>.log
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function filenameTimestamp(): string {
  return new Date()
    .toLocaleString("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    .replace(/[: ]/g, "-")
    .replace(/,/g, "");
}

function resolveLogPath(): string {
  const config = loadConfig();
  const logsDir = join(config.homeDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  return join(logsDir, `agent-${filenameTimestamp()}-pid-${process.pid}.log`);
}

class Logger {
  readonly logFilePath: string;

  constructor() {
    this.logFilePath = resolveLogPath();
  }

  debug(message: string, ...args: unknown[]): void {
    this.write("DEBUG", message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.write("WARN", message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.write("ERROR", message, ...args);
  }

  private write(level: string, message: string, ...args: unknown[]): void {
    const extra = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    const line = `[${timestamp()}] [${level}] ${message}${extra ? " " + extra : ""}\n`;
    try {
      appendFileSync(this.logFilePath, line);
    } catch {
      // Fail silently — never disturb the agent session
    }
  }
}

export const logger = new Logger();
