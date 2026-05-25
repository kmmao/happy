/**
 * Extension-based binary-file detection. Single source of truth for the
 * "do we even try to read this as text?" check used by the file viewers
 * (`SidePanelFilePreview`, the session/machine file routes, `GitBrowseTab`,
 * `CommitDiffView` indirectly via git output).
 *
 * Intentionally conservative — we list extensions that are almost certainly
 * binary so we can skip the base64 → UTF-8 round-trip and the heuristic
 * non-printable scan. Anything not on the list still goes through the
 * normal text-loading path, where another null-byte / non-printable check
 * decides binary-ness from the actual bytes.
 */

const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
    // Images
    "png", "jpg", "jpeg", "gif", "bmp", "svg", "ico",
    // Video
    "mp4", "avi", "mov", "wmv", "flv", "webm",
    // Audio
    "mp3", "wav", "flac", "aac", "ogg",
    // Office / documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    // Archives
    "zip", "tar", "gz", "rar", "7z",
    // Installers / executables
    "exe", "dmg", "deb", "rpm",
    // Fonts
    "woff", "woff2", "ttf", "otf",
    // Databases
    "db", "sqlite", "sqlite3",
]);

/**
 * Returns true when the path's extension is on the known-binary list.
 * Accepts a full path or just a file name. Empty / extension-less inputs
 * return false (caller's content-sniffing pass will decide).
 */
export function isBinaryFilePath(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase();
    return ext ? BINARY_EXTENSIONS.has(ext) : false;
}
