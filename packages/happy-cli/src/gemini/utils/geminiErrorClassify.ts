/**
 * Gemini error classification — the pure "what kind of failure is this?" seam
 * lifted out of `runGemini`'s two error sites.
 *
 * A Gemini prompt can fail in half a dozen distinguishable ways (model-not-
 * found, empty/internal response, rate limit, quota exhaustion, workspace-auth,
 * CLI-not-installed) and each maps to a specific user-facing status string and a
 * retry decision. That cascade of `errorCode`/`details`/`message`/`String(err)`
 * sniffing lived inline TWICE — once in the retry loop (to decide quota-throw vs
 * retryable) and once in the terminal catch (to render the message) — so the
 * "is this retryable?" and "is this quota?" rules were computed in two places and
 * could drift. Concentrating the whole taxonomy here makes it the interface-as-
 * test-surface: an opaque error in, a typed `{category, isRetryable, userMessage}`
 * out, exhaustively pinned by `geminiErrorClassify.test.ts`. The render / throw /
 * retry ACTIONS stay at the call sites; only the classification moved.
 *
 * Categories are mutually exclusive in practice (a quota error never also says
 * "empty response"), so the fixed precedence below never has to arbitrate real
 * overlaps.
 */

export type GeminiErrorCategory =
  | "model-not-found"
  | "empty-response"
  | "rate-limit"
  | "quota"
  | "auth-required"
  | "cli-not-installed"
  | "unknown";

export interface GeminiErrorClassification {
  category: GeminiErrorCategory;
  /** Retryable inside the prompt loop — an empty/internal (-32603) response. */
  isRetryable: boolean;
  /** User-facing status string for this failure. */
  userMessage: string;
}

export interface ClassifyGeminiErrorOptions {
  /** Current model name, used only to render the model-not-found message. */
  currentModel?: string;
}

/** Pull a `reset after 3h20m35s` hint out of any of the error's text fields. */
function extractQuotaResetHint(haystack: string): string {
  const match = haystack.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
  if (!match) {
    return "";
  }
  const parts = match.slice(1).filter(Boolean).join("");
  return parts ? ` Quota resets in ${parts}.` : "";
}

export function classifyGeminiError(
  error: unknown,
  opts: ClassifyGeminiErrorOptions = {},
): GeminiErrorClassification {
  if (typeof error !== "object" || error === null) {
    return {
      category: "unknown",
      isRetryable: false,
      userMessage:
        error instanceof Error ? error.message : "Process error occurred",
    };
  }

  const errObj = error as any;
  const details: string = errObj.data?.details || errObj.details || "";
  const code = errObj.code || errObj.status || errObj.response?.status;
  const message: string = errObj.message || errObj.error?.message || "";
  const asString = String(error);
  const all = details + message + asString;

  // Empty error object → the Gemini CLI is not installed.
  if (Object.keys(errObj).length === 0) {
    return {
      category: "cli-not-installed",
      isRetryable: false,
      userMessage:
        'Failed to start Gemini. Is "gemini" CLI installed? Run: npm install -g @google/gemini-cli',
    };
  }

  // 404 — model not found.
  if (
    code === 404 ||
    details.includes("notFound") ||
    details.includes("404") ||
    message.includes("not found") ||
    message.includes("404")
  ) {
    const model = opts.currentModel || "gemini-2.5-pro";
    return {
      category: "model-not-found",
      isRetryable: false,
      userMessage: `Model "${model}" not found. Available models: gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite`,
    };
  }

  // Empty / internal (-32603) response — retryable.
  if (
    code === -32603 ||
    details.includes("empty response") ||
    details.includes("Model stream ended")
  ) {
    return {
      category: "empty-response",
      isRetryable: true,
      userMessage:
        "Gemini API returned empty response after retries. This is a temporary issue - please try again.",
    };
  }

  // 429 — rate limit.
  if (
    code === 429 ||
    details.includes("429") ||
    message.includes("429") ||
    asString.includes("429") ||
    details.includes("rateLimitExceeded") ||
    details.includes("RESOURCE_EXHAUSTED") ||
    message.includes("Rate limit exceeded") ||
    message.includes("Resource exhausted") ||
    asString.includes("rateLimitExceeded") ||
    asString.includes("RESOURCE_EXHAUSTED")
  ) {
    return {
      category: "rate-limit",
      isRetryable: false,
      userMessage:
        "Gemini API rate limit exceeded. Please wait a moment and try again. The API will retry automatically.",
    };
  }

  // Quota / capacity exhausted.
  if (
    details.includes("quota") ||
    message.includes("quota") ||
    asString.includes("quota") ||
    details.includes("exhausted") ||
    details.includes("capacity")
  ) {
    return {
      category: "quota",
      isRetryable: false,
      userMessage: `Gemini quota exceeded.${extractQuotaResetHint(all)} Try using a different model (gemini-2.5-flash-lite) or wait for quota reset.`,
    };
  }

  // Workspace auth required.
  if (
    message.includes("Authentication required") ||
    details.includes("Authentication required") ||
    code === -32000
  ) {
    return {
      category: "auth-required",
      isRetryable: false,
      userMessage:
        `Authentication required. For Google Workspace accounts, you need to set a Google Cloud Project:\n` +
        `  happy gemini project set <your-project-id>\n` +
        `Or use a different Google account: happy connect gemini\n` +
        `Guide: https://goo.gle/gemini-cli-auth-docs#workspace-gca`,
    };
  }

  // Fall back to whatever text the error carried.
  return {
    category: "unknown",
    isRetryable: false,
    userMessage: details || message || "Process error occurred",
  };
}
