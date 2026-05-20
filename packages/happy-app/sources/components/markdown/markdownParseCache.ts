import { parseMarkdown } from "./parseMarkdown";
import type { MarkdownBlock } from "./parseMarkdown";

const MAX_MARKDOWN_PARSE_CACHE_SIZE = 150;

const markdownParseCache = new Map<string, MarkdownBlock[]>();

// [stream-perf] tracking
let _perfTotalMiss = 0;
let _perfTotalHit = 0;
let _perfConsecutiveMiss = 0;

export function getCachedMarkdownBlocks(markdown: string): MarkdownBlock[] {
    const cached = markdownParseCache.get(markdown);
    if (cached) {
        markdownParseCache.delete(markdown);
        markdownParseCache.set(markdown, cached);
        // [stream-perf] hit
        if (__DEV__) {
            _perfTotalHit++;
            _perfConsecutiveMiss = 0;
        }
        return cached;
    }

    // [stream-perf] miss — measure parse time
    const _perfT0 = __DEV__ && typeof performance !== "undefined" ? performance.now() : 0;
    const blocks = parseMarkdown(markdown);
    if (__DEV__ && _perfT0 > 0) {
        _perfTotalMiss++;
        _perfConsecutiveMiss++;
        const _perfMs = performance.now() - _perfT0;
        if (_perfMs > 2 || _perfConsecutiveMiss % 20 === 1) {
            const missRate = _perfTotalMiss / (_perfTotalMiss + _perfTotalHit);
            console.log(
                `[stream-perf] markdown-parse: ${_perfMs.toFixed(1)}ms, len=${markdown.length}, ` +
                `consecutiveMiss=${_perfConsecutiveMiss}, missRate=${(missRate * 100).toFixed(0)}%`
            );
        }
    }

    markdownParseCache.set(markdown, blocks);

    if (markdownParseCache.size > MAX_MARKDOWN_PARSE_CACHE_SIZE) {
        const oldestKey = markdownParseCache.keys().next().value;
        if (oldestKey !== undefined) {
            markdownParseCache.delete(oldestKey);
        }
    }

    return blocks;
}
