import { parseMarkdown } from "./parseMarkdown";
import type { MarkdownBlock } from "./parseMarkdown";

const MAX_MARKDOWN_PARSE_CACHE_SIZE = 150;

const markdownParseCache = new Map<string, MarkdownBlock[]>();

export function getCachedMarkdownBlocks(markdown: string): MarkdownBlock[] {
    const cached = markdownParseCache.get(markdown);
    if (cached) {
        markdownParseCache.delete(markdown);
        markdownParseCache.set(markdown, cached);
        return cached;
    }

    const blocks = parseMarkdown(markdown);
    markdownParseCache.set(markdown, blocks);

    if (markdownParseCache.size > MAX_MARKDOWN_PARSE_CACHE_SIZE) {
        const oldestKey = markdownParseCache.keys().next().value;
        if (oldestKey !== undefined) {
            markdownParseCache.delete(oldestKey);
        }
    }

    return blocks;
}
