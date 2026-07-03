import type { ToolCall } from "@/sync/typesMessage";
import type { Metadata } from "@/sync/storageTypes";

/**
 * Tool title / subtitle resolution — the pure seam sitting OVER the knownTools
 * registry (ADR-0055 keeps knownTools itself a registry; this does not replace
 * it, it consolidates how callers READ from it).
 *
 * Four render sites — ToolView's header title, ToolView's Task-child subtitle,
 * ToolHeader, and TaskView — each re-derived a tool's display title/subtitle
 * from a knownTools entry inline, with the same `title` string-or-function
 * dance copy-pasted and two subtly different fallback orders. A change to how a
 * title is computed (e.g. a new `extractDescription`-first rule) had to be made
 * in every copy or the surfaces drifted. These resolvers make the two title
 * shapes and the subtitle shape single, testable functions; each is in-process
 * pure (a knownTools entry + tool + metadata in, a string out).
 */

/**
 * The slice of a knownTools entry these resolvers read. Structural so tests can
 * pass synthetic entries and callers can pass their looked-up (loosely-typed)
 * registry entry without a cast contortion.
 */
export type ToolTitleSource = {
    title?:
        | string
        | ((opts: { tool: ToolCall; metadata: Metadata | null }) => string);
    extractDescription?: (opts: {
        tool: ToolCall;
        metadata: Metadata | null;
    }) => string;
    extractSubtitle?: (opts: {
        tool: ToolCall;
        metadata: Metadata | null;
    }) => string | null | undefined;
} | null | undefined;

/**
 * Header-style title: the knownTool's `title` (called if a function), falling
 * back to the raw tool name when the entry has no title. This is the shape the
 * ToolView header and ToolHeader want.
 */
export function resolveToolTitle(
    knownTool: ToolTitleSource,
    tool: ToolCall,
    metadata: Metadata | null,
): string {
    if (knownTool?.title) {
        return typeof knownTool.title === "function"
            ? knownTool.title({ tool, metadata })
            : knownTool.title;
    }
    return tool.name;
}

/**
 * Child/description-style title: prefer `extractDescription` (the richer, input-
 * derived label a running sub-tool shows), then fall back to the header title.
 * This is the shape TaskView and ToolView's Task-child subtitle want.
 */
export function resolveToolChildTitle(
    knownTool: ToolTitleSource,
    tool: ToolCall,
    metadata: Metadata | null,
): string {
    if (typeof knownTool?.extractDescription === "function") {
        return knownTool.extractDescription({ tool, metadata });
    }
    return resolveToolTitle(knownTool, tool, metadata);
}

/**
 * Subtitle: the knownTool's `extractSubtitle` result when it yields a non-empty
 * string, else null. Callers layer their own gating (e.g. session-compact tools
 * suppress the subtitle) around this.
 */
export function resolveToolSubtitle(
    knownTool: ToolTitleSource,
    tool: ToolCall,
    metadata: Metadata | null,
): string | null {
    if (typeof knownTool?.extractSubtitle === "function") {
        const subtitle = knownTool.extractSubtitle({ tool, metadata });
        if (typeof subtitle === "string" && subtitle) {
            return subtitle;
        }
    }
    return null;
}
