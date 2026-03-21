/**
 * Hook for frontend preview: port detection, screenshot capture, diff comparison.
 *
 * Uses sessionBash to run agent-browser for screenshots.
 * Port detection uses multi-strategy fallback (lsof → ss → netstat + docker + curl probe).
 * Screenshots are saved to happy-preview/ under the working directory and read back via sessionReadFile as base64.
 *
 * Layer 1: Port detection + single screenshot capture
 * Layer 2: Baseline management + before/after diff comparison
 */

import * as React from "react";
import { sessionBash, sessionReadFile } from "@/sync/ops";
import { detectAllPorts, type DetectedPort } from "@/hooks/portDetection";

export type { DetectedPort } from "@/hooks/portDetection";

// Shell metacharacters that could enable command injection
const SHELL_UNSAFE_PATTERN = /[;|&`$\\'"()\n\r]/;

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
 * Build a temp file path under the working directory's .happy-preview/ folder.
 * The working directory is always in the CLI's readFile allowed list.
 * Files are cleaned up immediately after reading.
 */
function previewTempPath(filename: string): string {
  return `happy-preview/${filename}`;
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
  const absPath = `$PWD/${screenshotPath}`;
  const captureResult = await sessionBash(sessionId, {
    command: `mkdir -p "$(dirname "${absPath}")" && agent-browser open "${safeUrl}" && agent-browser wait --load networkidle && agent-browser screenshot "${absPath}" && agent-browser close`,
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

    const ports = await detectAllPorts(sessionId);
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
      const screenshotPath = previewTempPath(`happy-preview-${timestamp}.png`);

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

      sessionBash(sessionId, { command: `rm -f "$PWD/${screenshotPath}"` }).catch(
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
    const baselinePath = previewTempPath(`happy-baseline-${screenshot.timestamp}.png`);

    const absBaselinePath = `$PWD/${baselinePath}`;
    const saveResult = await sessionBash(sessionId, {
      command: `mkdir -p "$(dirname "${absBaselinePath}")" && agent-browser open "${screenshot.url}" && agent-browser wait --load networkidle && agent-browser screenshot "${absBaselinePath}" && agent-browser close`,
      timeout: 30000,
    });

    // Verify state hasn't changed during the async operation
    const afterState = stateRef.current;
    if (
      afterState.status !== "captured" ||
      afterState.screenshot !== screenshot
    ) {
      // State changed during baseline save — discard to avoid inconsistency
      sessionBash(sessionId, { command: `rm -f "$PWD/${baselinePath}"` }).catch(
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
        command: `rm -f "$PWD/${baselinePathRef.current}"`,
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
      const currentPath = previewTempPath(`happy-current-${timestamp}.png`);
      const diffPath = previewTempPath(`happy-diff-${timestamp}.png`);

      try {
        let currentUri: string;
        let diffUri: string;

        if (baselinePathRef.current) {
          // Single browser session: open → wait → screenshot → diff → close
          // This ensures diff is computed against the exact same page state
          const absCurrentPath = `$PWD/${currentPath}`;
          const absDiffPath = `$PWD/${diffPath}`;
          const absBaselineRef = `$PWD/${baselinePathRef.current}`;
          const combinedResult = await sessionBash(sessionId, {
            command: `mkdir -p "$(dirname "${absCurrentPath}")" && agent-browser open "${safeUrl}" && agent-browser wait --load networkidle && agent-browser screenshot "${absCurrentPath}" && agent-browser diff screenshot --baseline "${absBaselineRef}" -o "${absDiffPath}" && agent-browser close`,
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
        command: `rm -f "$PWD/${currentPath}" "$PWD/${diffPath}"`,
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
