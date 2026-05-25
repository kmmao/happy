/**
 * Map a file path's extension to the language identifier used by our
 * syntax-highlighting layer (`SimpleSyntaxHighlighter`, `UnifiedDiffView`,
 * `tokenizeLine` in `syntaxTokenizer`, tool views, etc.).
 *
 * Single source of truth — every consumer (CommitDiffView, SidePanelFilePreview,
 * the session file route, Edit/MultiEdit/Codex views, SessionCodeChangesView…)
 * should import from here so a new extension only needs to land in one table.
 *
 * Returns `null` for paths without an extension or whose extension isn't on
 * the known list — callers fall back to plain rendering in that case.
 */

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
    // JavaScript / TypeScript
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    // Python
    py: "python",
    pyw: "python",
    pyi: "python",
    // JVM
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    scala: "scala",
    // Systems
    go: "go",
    rs: "rust",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    // Ruby
    rb: "ruby",
    // PHP
    php: "php",
    // Shell
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    // Web
    html: "html",
    htm: "html",
    css: "css",
    scss: "css",
    less: "css",
    // Config / Data
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    // Swift / Objective-C
    swift: "swift",
    m: "objectivec",
    // Dart
    dart: "dart",
    // Lua
    lua: "lua",
    // SQL
    sql: "sql",
    // Markdown
    md: "markdown",
    mdx: "markdown",
};

export function getLanguageForPath(path: string): string | null {
    if (!path) return null;
    const ext = path.split(".").pop()?.toLowerCase();
    if (!ext) return null;
    return EXTENSION_TO_LANGUAGE[ext] ?? null;
}
