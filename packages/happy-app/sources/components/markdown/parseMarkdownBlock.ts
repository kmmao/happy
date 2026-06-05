import type { MarkdownBlock } from "./parseMarkdown";
import { parseMarkdownSpans } from "./parseMarkdownSpans";

function parseTable(lines: string[], startIndex: number): { table: MarkdownBlock | null; nextIndex: number } {
    let index = startIndex;
    const tableLines: string[] = [];

    // Collect consecutive pipe-bearing lines that look like table rows.
    // LLMs sometimes insert blank lines between rows (PR #730); skip those
    // rather than terminating the table parse, but stop on any other non-pipe
    // line so a trailing paragraph doesn't get swallowed.
    while (index < lines.length) {
        if (lines[index].includes('|')) {
            tableLines.push(lines[index]);
            index++;
        } else if (lines[index].trim() === '') {
            index++;
        } else {
            break;
        }
    }

    if (tableLines.length < 2) {
        return { table: null, nextIndex: startIndex };
    }

    // Validate that the second line is a separator containing dashes, which distinguishes tables from plain text.
    // Accepts both leading-pipe format (| --- | --- |) and bare format (--- | --- | ---).
    // Requires at least one character (+) so empty lines don't accidentally match.
    const separatorLine = tableLines[1].trim();
    const isSeparator = /^[|\s\-:=]+$/.test(separatorLine) && separatorLine.includes('-');

    if (!isSeparator) {
        return { table: null, nextIndex: startIndex };
    }

    // Extract header cells from the first line, removing only leading/trailing empty segments from pipe splitting
    const headerLine = tableLines[0].trim();
    const rawHeaders = headerLine.split('|').map(cell => cell.trim());
    // Remove first/last empty strings caused by leading/trailing pipes (e.g. "| A | B |" → ['', 'A', 'B', ''])
    if (rawHeaders.length > 0 && rawHeaders[0] === '') rawHeaders.shift();
    if (rawHeaders.length > 0 && rawHeaders[rawHeaders.length - 1] === '') rawHeaders.pop();
    const headers = rawHeaders;

    if (headers.length === 0) {
        return { table: null, nextIndex: startIndex };
    }

    // Extract data rows from remaining lines (skipping the separator line), preserving valid cell content
    const rows: string[][] = [];
    for (let i = 2; i < tableLines.length; i++) {
        const rowLine = tableLines[i].trim();
        if (rowLine.startsWith('|')) {
            const rawCells = rowLine.split('|').map(cell => cell.trim());
            // Remove first/last empty strings caused by leading/trailing pipes
            if (rawCells.length > 0 && rawCells[0] === '') rawCells.shift();
            if (rawCells.length > 0 && rawCells[rawCells.length - 1] === '') rawCells.pop();
            const rowCells = rawCells;

            // Include rows that contain actual content, filtering out empty rows
            if (rowCells.length > 0) {
                rows.push(rowCells);
            }
        }
    }

    const table: MarkdownBlock = {
        type: 'table',
        headers,
        rows
    };

    return { table, nextIndex: index };
}

export function parseMarkdownBlock(markdown: string) {
    const blocks: MarkdownBlock[] = [];
    const lines = markdown.split('\n');
    let index = 0;
    outer: while (index < lines.length) {
        const line = lines[index];
        index++;

        // Headers
        for (let i = 1; i <= 6; i++) {
            if (line.startsWith(`${'#'.repeat(i)} `)) {
                blocks.push({ type: 'header', level: i as 1 | 2 | 3 | 4 | 5 | 6, content: parseMarkdownSpans(line.slice(i + 1).trim(), true) });
                continue outer;
            }
        }

        // Trim
        let trimmed = line.trim();

        // Code block
        if (trimmed.startsWith('```')) {
            const language = trimmed.slice(3).trim() || null;
            let content = [];
            while (index < lines.length) {
                const nextLine = lines[index];
                if (nextLine.trim() === '```') {
                    index++;
                    break;
                }
                content.push(nextLine);
                index++;
            }
            const contentString = content.join('\n');

            // Detect mermaid diagram language and route to appropriate block type
            if (language === 'mermaid') {
                blocks.push({ type: 'mermaid', content: contentString });
            } else {
                blocks.push({ type: 'code-block', language, content: contentString });
            }
            continue;
        }

        // Math block ($$...$$)
        if (trimmed.startsWith('$$')) {
            // Single-line math block: $$ content $$
            if (trimmed.endsWith('$$') && trimmed.length > 4) {
                const mathContent = trimmed.slice(2, -2).trim();
                if (mathContent.length > 0) {
                    blocks.push({ type: 'math-block', content: mathContent });
                    continue;
                }
            }
            // Multi-line math block
            let content = [];
            // If there's content after the opening $$
            const firstLineContent = trimmed.slice(2).trim();
            if (firstLineContent) {
                content.push(firstLineContent);
            }
            while (index < lines.length) {
                const nextLine = lines[index];
                if (nextLine.trim() === '$$') {
                    index++;
                    break;
                }
                content.push(nextLine);
                index++;
            }
            const mathContent = content.join('\n').trim();
            if (mathContent.length > 0) {
                blocks.push({ type: 'math-block', content: mathContent });
            }
            continue;
        }

        // Horizontal rule
        if (trimmed === '---') {
            blocks.push({ type: 'horizontal-rule' });
            continue;
        }

        // Plan card block  <plan title="..."> ... </plan>
        if (trimmed.startsWith('<plan ')) {
            const titleMatch = trimmed.match(/title="([^"]*)"/);
            const title = titleMatch ? titleMatch[1] : '';
            let summary: string | null = null;
            const phases: { id: string; name: string; depends: string; description: string }[] = [];
            let risks: string | null = null;

            while (index < lines.length) {
                const planLine = lines[index].trim();
                index++;

                if (planLine === '</plan>' || planLine.startsWith('</plan>')) break;

                const summaryMatch = planLine.match(/<summary>(.*?)<\/summary>/);
                if (summaryMatch) { summary = summaryMatch[1].trim(); continue; }

                const phaseMatch = planLine.match(/<phase\s+id="([^"]*)"\s+name="([^"]*)"\s+depends="([^"]*)">(.*?)<\/phase>/);
                if (phaseMatch) {
                    phases.push({
                        id: phaseMatch[1],
                        name: phaseMatch[2],
                        depends: phaseMatch[3],
                        description: phaseMatch[4].trim(),
                    });
                    continue;
                }

                const risksMatch = planLine.match(/<risks>(.*?)<\/risks>/);
                if (risksMatch) { risks = risksMatch[1].trim(); continue; }
            }

            blocks.push({ type: 'plan-card', title, summary, phases, risks });
            continue;
        }

        // Options block
        if (trimmed.startsWith('<options>')) {
            let items: string[] = [];
            while (index < lines.length) {
                const nextLine = lines[index];
                if (nextLine.trim() === '</options>') {
                    index++;
                    break;
                }
                // Extract content from <option> tags
                const optionMatch = nextLine.match(/<option>(.*?)<\/option>/);
                if (optionMatch) {
                    items.push(optionMatch[1]);
                }
                index++;
            }
            if (items.length > 0) {
                blocks.push({ type: 'options', items });
            }
            continue;
        }

        // Blockquote
        if (trimmed.startsWith('> ') || trimmed === '>') {
            const quoteLines: string[] = [];
            quoteLines.push(trimmed === '>' ? '' : trimmed.slice(2));
            while (index < lines.length) {
                const nextTrimmed = lines[index].trim();
                if (nextTrimmed.startsWith('> ') || nextTrimmed === '>') {
                    quoteLines.push(nextTrimmed === '>' ? '' : nextTrimmed.slice(2));
                    index++;
                } else {
                    break;
                }
            }
            const quoteText = quoteLines.join(' ').trim();
            if (quoteText.length > 0) {
                blocks.push({ type: 'blockquote', content: parseMarkdownSpans(quoteText, false) });
            }
            continue;
        }

        // If it is a numbered list
        const numberedListMatch = trimmed.match(/^(\d+)\.\s/);
        if (numberedListMatch) {
            let allLines = [{ number: parseInt(numberedListMatch[1]), content: trimmed.slice(numberedListMatch[0].length) }];
            while (index < lines.length) {
                const nextLine = lines[index].trim();
                const nextMatch = nextLine.match(/^(\d+)\.\s/);
                if (!nextMatch) break;
                allLines.push({ number: parseInt(nextMatch[1]), content: nextLine.slice(nextMatch[0].length) });
                index++;
            }
            blocks.push({ type: 'numbered-list', items: allLines.map((l) => ({ number: l.number, spans: parseMarkdownSpans(l.content, false) })) });
            continue;
        }

        // If it is a list
        if (trimmed.startsWith('- ')) {
            let allLines = [trimmed.slice(2)];
            while (index < lines.length && lines[index].trim().startsWith('- ')) {
                allLines.push(lines[index].trim().slice(2));
                index++;
            }
            blocks.push({
                type: 'list',
                items: allLines.map((l) => {
                    // Detect task list checkbox prefix
                    if (l.startsWith('[ ] ') || l.startsWith('[  ] ')) {
                        return { spans: parseMarkdownSpans(l.replace(/^\[\s*\]\s*/, ''), false), checked: false };
                    }
                    if (l.startsWith('[x] ') || l.startsWith('[X] ') || l.startsWith('[x ] ') || l.startsWith('[X ] ')) {
                        return { spans: parseMarkdownSpans(l.replace(/^\[[xX]\s*\]\s*/, ''), false), checked: true };
                    }
                    return { spans: parseMarkdownSpans(l, false) };
                }),
            });
            continue;
        }

        // Check for table
        if (trimmed.includes('|') && !trimmed.startsWith('```')) {
            const { table, nextIndex } = parseTable(lines, index - 1);
            if (table) {
                blocks.push(table);
                index = nextIndex;
                continue outer;
            }
        }

        // Fallback
        if (trimmed.length > 0) {
            blocks.push({ type: 'text', content: parseMarkdownSpans(trimmed, false) });
        }
    }
    return blocks;
}