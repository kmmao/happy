/**
 * Preprocess text for TTS playback by removing code blocks, Markdown syntax,
 * URLs, and other non-speakable content that Claude Code responses may contain.
 *
 * Processing order matters:
 * 1. Code blocks first (before inline code)
 * 2. Markdown links/images before URL removal (URLs inside parens must be matched first)
 * 3. Bare URLs and file paths last
 */
export function preprocessTtsText(rawText: string): string {
  let text = rawText;

  // 1. Remove fenced code blocks (```...```)
  text = text.replace(/```[\s\S]*?```/g, "");

  // 2. Remove inline code backticks but keep the content (short terms may be meaningful)
  text = text.replace(/`([^`]+)`/g, "$1");

  // 3. Remove Markdown images ![alt](url) — before links to avoid partial match
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");

  // 4. Remove Markdown links [text](url) — keep the link text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 5. Remove bare URLs (http/https/file) — after Markdown links are already handled
  text = text.replace(/https?:\/\/\S+/g, "");
  text = text.replace(/file:\/\/\S+/g, "");

  // 6. Remove Unix-style file paths (at least 2 segments, e.g. /src/index.ts)
  // Uses structured segments (word-chars + optional .ext) to avoid eating trailing punctuation
  text = text.replace(/(?:\/[\w\-]+(?:\.[\w\-]+)*){2,}/g, "");

  // 7. Remove Windows-style file paths (e.g. C:\Users\foo\bar.ts)
  text = text.replace(/[A-Z]:\\(?:[\w.\-]+\\)+[\w.\-]+/g, "");

  // 8. Remove Markdown headers (# ## ### etc.)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // 9. Remove Markdown emphasis (*italic*, **bold**, ***bold italic***, ~~strikethrough~~)
  text = text.replace(/\*{1,3}(.*?)\*{1,3}/g, "$1");
  text = text.replace(/~~(.*?)~~/g, "$1");

  // 10. Remove Markdown list markers (- , * , 1. )
  text = text.replace(/^\s*[-*]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");

  // 11. Remove Markdown blockquotes (> )
  text = text.replace(/^\s*>\s+/gm, "");

  // 12. Remove Markdown horizontal rules (---, ***, ___)
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // 13. Remove Markdown table formatting (|---|---|)
  text = text.replace(/^\|[-:|\s]+\|$/gm, "");
  text = text.replace(/\|/g, " ");

  // 14. Collapse consecutive whitespace/newlines into single space
  text = text.replace(/\s+/g, " ").trim();

  return text;
}
