/**
 * Turn `tool.result` (arbitrary shape) into a human-readable string suitable
 * for a monospace `<CodeView>` — without dragging hundreds of KB of image
 * base64 into a single Text node.
 *
 * Why this exists
 * ---------------
 * Before this helper, three sites did the same thing:
 *
 *   typeof tool.result === "string"
 *     ? tool.result
 *     : JSON.stringify(tool.result, null, 2)
 *
 * That's fine for the 99 % case, but tools that return image blocks — most
 * commonly `Read` on a binary file — deliver
 *
 *   [{ type: "image", source: { media_type: "image/jpeg", data: "<base64>" }}]
 *
 * where `data` is anywhere from 50 KB to several MB. Stringifying that
 * produces a same-sized JSON blob, pouring it into a single monospace `<Text>`
 * node stalls RN Web's layout / paint pipeline for hundreds of ms, and every
 * component re-render redoes the whole trip.
 *
 * The helper elides image / oversized-text blocks into a short marker (with
 * the original media type + byte count so a user can still tell what's
 * there), leaves anything under the cap alone, and truncates oversize plain
 * strings / raw objects at the same threshold. Callers see a bounded string
 * even in the worst case.
 *
 * Correctness / display parity
 * ----------------------------
 * The original design showed users the full stringified JSON — so trimming
 * it changes what they see. That's a deliberate trade-off: the alternative
 * ("show every byte") is unusable when a single value is a MB of base64.
 * Users who genuinely want the raw bytes can right-click / long-press the
 * tool card to Copy Output, which invokes {@link summarizeToolResult} with
 * a larger cap; if the underlying representation is not human-readable
 * (image bytes), the marker is what they get in the clipboard too — that's
 * the honest signal, better than dumping raw base64 without context.
 */

const DEFAULT_MAX_LEN = 32 * 1024; // 32 KB — visible in <CodeView> without stalling layout
const IMAGE_ELISION_MARKER = "[image elided — ";
const TEXT_ELISION_MARKER = "[text elided — ";
const OBJECT_ELISION_MARKER = "\n... [truncated";

export interface SummarizeToolResultOptions {
  /**
   * Per-block character cap. Anything longer than this in a single string /
   * base64 blob / raw JSON dump is replaced with a marker. Defaults to
   * {@link DEFAULT_MAX_LEN} (32 KB).
   */
  maxLen?: number;
}

export function summarizeToolResult(
  result: unknown,
  options: SummarizeToolResultOptions = {},
): string {
  const maxLen = options.maxLen ?? DEFAULT_MAX_LEN;
  if (result == null) return "";

  if (typeof result === "string") {
    return capString(result, maxLen);
  }

  if (Array.isArray(result)) {
    return result.map((b) => summarizeBlock(b, maxLen)).join("\n");
  }

  // Non-array object: fall back to formatted JSON with a size cap so a rogue
  // tool that returns a 5 MB nested structure still doesn't sink the UI.
  return capString(safeStringify(result), maxLen);
}

function summarizeBlock(block: unknown, maxLen: number): string {
  if (block == null) return String(block);
  if (typeof block === "string") return capString(block, maxLen);
  if (typeof block !== "object") return String(block);

  const b = block as Record<string, unknown>;

  // Anthropic image block: { type: "image", source: { type: "base64", media_type, data } }
  if (b.type === "image" && b.source && typeof b.source === "object") {
    const src = b.source as Record<string, unknown>;
    const media = typeof src.media_type === "string" ? src.media_type : "image";
    const data = typeof src.data === "string" ? src.data : "";
    const bytes = data.length;
    return `${IMAGE_ELISION_MARKER}${media}, ${formatBytes(bytes)} base64]`;
  }

  // Anthropic text block: { type: "text", text: "..." }
  if (b.type === "text" && typeof b.text === "string") {
    if (b.text.length > maxLen) {
      return `${TEXT_ELISION_MARKER}${formatBytes(b.text.length)} chars, showing first ${formatBytes(maxLen)}]\n${b.text.slice(0, maxLen)}`;
    }
    return b.text;
  }

  // Anything else — format as JSON, then cap.
  return capString(safeStringify(block), maxLen);
}

function capString(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}${OBJECT_ELISION_MARKER}, ${formatBytes(s.length)} chars total]`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    // Circular refs / non-serializable values — surface something honest.
    return String(v);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
