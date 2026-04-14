import { parseMarkdownBlock } from "./parseMarkdownBlock"

export type MarkdownBlock = {
    type: 'text'
    content: MarkdownSpan[]
} | {
    type: 'header'
    level: 1 | 2 | 3 | 4 | 5 | 6
    content: MarkdownSpan[]
} | {
    type: 'list',
    items: { spans: MarkdownSpan[], checked?: boolean }[]
} | {
    type: 'numbered-list',
    items: { number: number, spans: MarkdownSpan[] }[]
} | {
    type: 'code-block',
    language: string | null,
    content: string
} | {
    type: 'mermaid',
    content: string
} | {
    type: 'horizontal-rule'
} | {
    type: 'options',
    items: string[]
} | {
    type: 'table',
    headers: string[],
    rows: string[][]
} | {
    type: 'blockquote',
    content: MarkdownSpan[]
} | {
    type: 'math-block',
    content: string
} | {
    type: 'plan-card'
    title: string
    summary: string | null
    phases: { id: string; name: string; depends: string; description: string }[]
    risks: string | null
}

export type MarkdownSpan = {
    styles: ('italic' | 'bold' | 'semibold' | 'code')[],
    text: string,
    url: string | null,
    isMath?: boolean
}

export function parseMarkdown(markdown: string) {
    return parseMarkdownBlock(markdown);
}