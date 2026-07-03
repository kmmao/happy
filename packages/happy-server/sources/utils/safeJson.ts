/**
 * Parse a JSON string expected to hold a string array, degrading to `[]` on any
 * malformed input or non-array shape. Used wherever a `String`-typed DB column
 * stores a JSON array (skillIds, tags, authors, …) and callers want a total,
 * throw-free read. Kept here as a generic helper rather than duplicated per
 * route/module.
 */
export function safeParseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
