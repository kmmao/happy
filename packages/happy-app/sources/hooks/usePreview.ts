/**
 * Hook for frontend preview: port detection, screenshot capture, diff comparison.
 *
 * Uses sessionBash to run agent-browser for screenshots and lsof for port detection.
 * Screenshots are saved to /tmp and read back via sessionReadFile as base64.
 *
 * Layer 1: Port detection + single screenshot capture
 * Layer 2: Baseline management + before/after diff comparison
 */

import * as React from "react";
import { sessionBash, sessionReadFile } from "@/sync/ops";

// Common dev server ports to highlight in detection results
const COMMON_DEV_PORTS = [3000, 3001, 4173, 5173, 5174, 8000, 8080, 8888];

// Shell metacharacters that could enable command injection
const SHELL_UNSAFE_PATTERN = /[;|&`$\\'"()\n\r]/;

export interface DetectedPort {
  readonly port: number;
  readonly process: string;
  readonly isCommonDevPort: boolean;
}

export interface PreviewScreenshot {
  readonly uri: string;
  readonly timestamp: number;
  readonly url: string;
}

export interface DiffResult {
  readonly baseline: PreviewScreenshot;
  readonly current: PreviewScreenshot;
  readonly diffUri: string;
  readonly timestamp: number;
}

export type PreviewState =
  | { readonly status: "idle" }
  | { readonly status: "detecting-ports" }
  | { readonly status: "unavailable"; readonly reason: string }
  | {
      readonly status: "ports-detected";
      readonly ports: readonly DetectedPort[];
    }
  | { readonly status: "capturing"; readonly url: string }
  | {
      readonly status: "captured";
      readonly screenshot: PreviewScreenshot;
      readonly ports: readonly DetectedPort[];
    }
  | { readonly status: "comparing"; readonly url: string }
  | {
      readonly status: "compared";
      readonly diff: DiffResult;
      readonly ports: readonly DetectedPort[];
    }
  | {
      readonly status: "error";
      readonly message: string;
      readonly ports: readonly DetectedPort[];
    };

export interface UsePreviewResult {
  readonly state: PreviewState;
  readonly baseline: PreviewScreenshot | null;
  readonly detectPorts: () => void;
  readonly captureScreenshot: (url: string) => void;
  readonly setBaseline: () => void;
  readonly clearBaseline: () => void;
  readonly compareWithBaseline: (url: string) => void;
  readonly reset: () => void;
}

/**
 * Validate and sanitize a URL for safe shell interpolation.
 * Returns the validated URL or throws an error.
 */
function validateUrl(raw: string): string {
  const trimmed = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported");
  }

  if (SHELL_UNSAFE_PATTERN.test(trimmed)) {
    throw new Error("URL contains invalid characters");
  }

  return trimmed;
}

/**
 * Parse lsof output to extract listening ports and process names.
 * Only supports lsof format — ss output is not parsed as its format differs.
 */
function parseLsofOutput(stdout: string): readonly DetectedPort[] {
  const lines = stdout.trim().split("\n");
  const portSet = new Map<number, string>();

  for (const line of lines) {
    if (line.startsWith("COMMAND")) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    const command = parts[0];
    const name = parts[parts.length - 1];

    const portMatch = name.match(/:(\d+)$/);
    if (portMatch) {
      const port = parseInt(portMatch[1], 10);
      if (port > 0 && port < 65536 && !portSet.has(port)) {
        portSet.set(port, command);
      }
    }
  }

  return Array.from(portSet.entries())
    .map(([port, process]) => ({
      port,
      process,
      isCommonDevPort: COMMON_DEV_PORTS.includes(port),
    }))
    .sort((a, b) => {
      if (a.isCommonDevPort !== b.isCommonDevPort) {
        return a.isCommonDevPort ? -1 : 1;
      }
      return a.port - b.port;
    });
}

/**
 * Capture a screenshot via agent-browser and read it back as base64.
 * Returns the data URI or throws on failure.
 */
async function captureAndRead(
  sessionId: string,
  safeUrl: string,
  screenshotPath: string,
): Promise<string> {
  const captureResult = await sessionBash(sessionId, {
    command: `agent-browser open "${safeUrl}" && agent-browser wait --load networkidle && agent-browser screenshot "${screenshotPath}" && agent-browser close`,
    timeout: 30000,
  });

  if (!captureResult.success || captureResult.exitCode !== 0) {
    throw new Error(
      captureResult.stderr ||
        captureResult.error ||
        "Screenshot capture failed",
    );
  }

  const readResult = await sessionReadFile(sessionId, screenshotPath);

  if (!readResult.success || !readResult.content) {
    throw new Error(readResult.error || "Failed to read screenshot file");
  }

  return `data:image/png;base64,${readResult.content}`;
}

export function usePreview(sessionId: string | undefined): UsePreviewResult {
  const [state, setState] = React.useState<PreviewState>({ status: "idle" });
  const [baseline, setBaselineState] = React.useState<PreviewScreenshot | null>(
    null,
  );
  const stateRef = React.useRef(state);
  stateRef.current = state;

  // Track the remote baseline file path for diff operations
  const baselinePathRef = React.useRef<string | null>(null);

  const getPorts = (): readonly DetectedPort[] => {
    const s = stateRef.current;
    return "ports" in s ? s.ports : [];
  };

  const detectPorts = React.useCallback(async () => {
    if (!sessionId) return;
    setState({ status: "detecting-ports" });

    // Check if agent-browser is available
    const browserCheck = await sessionBash(sessionId, {
      command: "which agent-browser 2>/dev/null",
      timeout: 5000,
    });

    if (!browserCheck.success || browserCheck.exitCode !== 0) {
      setState({
        status: "unavailable",
        reason: "agent-browser",
      });
      return;
    }

    const result = await sessionBash(sessionId, {
      command: "lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null",
      timeout: 10000,
    });

    if (!result.success || result.exitCode !== 0) {
      setState({ status: "ports-detected", ports: [] });
      return;
    }

    const ports = parseLsofOutput(result.stdout);
    setState({ status: "ports-detected", ports });
  }, [sessionId]);

  const captureScreenshot = React.useCallback(
    async (url: string) => {
      if (!sessionId) return;

      let safeUrl: string;
      try {
        safeUrl = validateUrl(url);
      } catch (e) {
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Invalid URL",
          ports: getPorts(),
        });
        return;
      }

      const currentPorts = getPorts();
      setState({ status: "capturing", url: safeUrl });

      const timestamp = Date.now();
      const screenshotPath = `/tmp/happy-preview-${timestamp}.png`;

      try {
        const uri = await captureAndRead(sessionId, safeUrl, screenshotPath);

        setState({
          status: "captured",
          screenshot: { uri, timestamp, url: safeUrl },
          ports: currentPorts,
        });
      } catch (e) {
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Screenshot capture failed",
          ports: currentPorts,
        });
      }

      sessionBash(sessionId, { command: `rm -f "${screenshotPath}"` }).catch(
        () => {},
      );
    },
    [sessionId],
  );

  const setBaseline = React.useCallback(async () => {
    if (!sessionId) return;

    const s = stateRef.current;
    if (s.status !== "captured") return;

    // Capture reference before async operation
    const screenshot = s.screenshot;
    const baselinePath = `/tmp/happy-baseline-${screenshot.timestamp}.png`;

    const saveResult = await sessionBash(sessionId, {
      command: `agent-browser open "${screenshot.url}" && agent-browser wait --load networkidle && agent-browser screenshot "${baselinePath}" && agent-browser close`,
      timeout: 30000,
    });

    // Verify state hasn't changed during the async operation
    const afterState = stateRef.current;
    if (
      afterState.status !== "captured" ||
      afterState.screenshot !== screenshot
    ) {
      // State changed during baseline save — discard to avoid inconsistency
      sessionBash(sessionId, { command: `rm -f "${baselinePath}"` }).catch(
        () => {},
      );
      return;
    }

    if (!saveResult.success || saveResult.exitCode !== 0) {
      // Fallback: save baseline in memory only (diff won't work but visual compare still works)
      setBaselineState(screenshot);
      baselinePathRef.current = null;
      return;
    }

    setBaselineState(screenshot);
    baselinePathRef.current = baselinePath;
  }, [sessionId]);

  const clearBaseline = React.useCallback(() => {
    if (sessionId && baselinePathRef.current) {
      sessionBash(sessionId, {
        command: `rm -f "${baselinePathRef.current}"`,
      }).catch(() => {});
    }
    setBaselineState(null);
    baselinePathRef.current = null;
  }, [sessionId]);

  const compareWithBaseline = React.useCallback(
    async (url: string) => {
      if (!sessionId || !baseline) return;

      // Capture baseline reference at function entry to avoid stale closure
      const baselineSnapshot = baseline;

      let safeUrl: string;
      try {
        safeUrl = validateUrl(url);
      } catch (e) {
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Invalid URL",
          ports: getPorts(),
        });
        return;
      }

      const currentPorts = getPorts();
      setState({ status: "comparing", url: safeUrl });

      const timestamp = Date.now();
      const currentPath = `/tmp/happy-current-${timestamp}.png`;
      const diffPath = `/tmp/happy-diff-${timestamp}.png`;

      try {
        let currentUri: string;
        let diffUri: string;

        if (baselinePathRef.current) {
          // Single browser session: open → wait → screenshot → diff → close
          // This ensures diff is computed against the exact same page state
          const combinedResult = await sessionBash(sessionId, {
            command: `agent-browser open "${safeUrl}" && agent-browser wait --load networkidle && agent-browser screenshot "${currentPath}" && agent-browser diff screenshot --baseline "${baselinePathRef.current}" -o "${diffPath}" && agent-browser close`,
            timeout: 45000,
          });

          if (!combinedResult.success || combinedResult.exitCode !== 0) {
            throw new Error(
              combinedResult.stderr ||
                combinedResult.error ||
                "Comparison failed",
            );
          }

          // Read both current screenshot and diff image
          const [currentRead, diffRead] = await Promise.all([
            sessionReadFile(sessionId, currentPath),
            sessionReadFile(sessionId, diffPath),
          ]);

          if (!currentRead.success || !currentRead.content) {
            throw new Error("Failed to read current screenshot");
          }

          currentUri = `data:image/png;base64,${currentRead.content}`;
          diffUri =
            diffRead.success && diffRead.content
              ? `data:image/png;base64,${diffRead.content}`
              : currentUri;
        } else {
          // No remote baseline file — just capture current for side-by-side
          currentUri = await captureAndRead(sessionId, safeUrl, currentPath);
          diffUri = currentUri;
        }

        setState({
          status: "compared",
          diff: {
            baseline: baselineSnapshot,
            current: { uri: currentUri, timestamp, url: safeUrl },
            diffUri,
            timestamp,
          },
          ports: currentPorts,
        });
      } catch (e) {
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Comparison failed",
          ports: currentPorts,
        });
      }

      // Cleanup temp files
      sessionBash(sessionId, {
        command: `rm -f "${currentPath}" "${diffPath}"`,
      }).catch(() => {});
    },
    [sessionId, baseline],
  );

  const reset = React.useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return {
    state,
    baseline,
    detectPorts,
    captureScreenshot,
    setBaseline,
    clearBaseline,
    compareWithBaseline,
    reset,
  };
}
