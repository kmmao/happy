/**
 * Syntax tokenization utilities for code highlighting in DiffView and SimpleSyntaxHighlighter.
 * Extracted from SimpleSyntaxHighlighter.tsx to be reusable across components.
 */

export interface SyntaxToken {
    text: string;
    type: string;
    nestLevel?: number;
}

// Bracket pairs for nesting detection
const bracketPairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '<': '>',
};

const openBrackets = Object.keys(bracketPairs);
const closeBrackets = Object.values(bracketPairs);

/**
 * Tokenize application log text with line-level severity, timestamp, and marker highlighting.
 */
function tokenizeLogFile(text: string): SyntaxToken[] {
    type MatchEntry = { start: number; end: number; type: string };
    const entries: MatchEntry[] = [];

    const patterns: Array<{ re: RegExp; type: string }> = [
        { re: /\bERROR\b/g,                                               type: 'keyword' },
        { re: /\b(?:WARN(?:ING)?)\b/g,                                   type: 'number' },
        { re: /\b(?:INFO|DEBUG|TRACE)\b/g,                               type: 'comment' },
        { re: /\d{2,4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/g, type: 'string' },
        { re: /@[0-9a-f]{4,}/gi,                                         type: 'number' },
        { re: /(?:==>|<==)\s*/g,                                         type: 'keyword' },
        { re: /\bCaused by:/g,                                           type: 'keyword' },
    ];

    for (const p of patterns) {
        let m: RegExpExecArray | null;
        while ((m = p.re.exec(text)) !== null) {
            entries.push({ start: m.index, end: m.index + m[0].length, type: p.type });
        }
    }

    entries.sort((a, b) => a.start - b.start);

    const tokens: SyntaxToken[] = [];
    let cur = 0;
    for (const e of entries) {
        if (e.start < cur) continue;
        if (e.start > cur) tokens.push({ text: text.slice(cur, e.start), type: 'default' });
        tokens.push({ text: text.slice(e.start, e.end), type: e.type });
        cur = e.end;
    }
    if (cur < text.length) tokens.push({ text: text.slice(cur), type: 'default' });
    return tokens;
}

/**
 * Tokenize code into syntax tokens with type information.
 * Returns an array of tokens, each with text content and a syntax type.
 */
export function tokenizeCode(code: string, language: string | null): SyntaxToken[] {
    const tokens: SyntaxToken[] = [];

    if (!language) {
        return [{ text: code, type: 'default' }];
    }

    const lang = language.toLowerCase();

    if (lang === 'log') {
        return tokenizeLogFile(code);
    }

    // Language-specific keyword sets
    const keywordSets = {
        controlFlow: ['if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'yield', 'try', 'catch', 'finally', 'throw', 'with'],
        keywords: ['function', 'const', 'let', 'var', 'def', 'class', 'interface', 'enum', 'struct', 'union', 'namespace', 'module'],
        types: ['int', 'string', 'bool', 'float', 'double', 'char', 'void', 'any', 'unknown', 'never', 'object', 'array', 'number', 'boolean'],
        modifiers: ['public', 'private', 'protected', 'static', 'final', 'abstract', 'virtual', 'override', 'async', 'await', 'export', 'default'],
        boolean: ['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil'],
        imports: ['import', 'from', 'export', 'require', 'include', 'using', 'package'],
    };

    // Language-specific additions
    if (lang === 'python' || lang === 'py') {
        keywordSets.keywords.push('def', 'lambda', 'pass', 'global', 'nonlocal', 'as', 'in', 'is', 'not', 'and', 'or');
        keywordSets.types.push('str', 'list', 'dict', 'tuple', 'set');
    } else if (lang === 'typescript' || lang === 'ts' || lang === 'tsx') {
        keywordSets.types.push('Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit');
        keywordSets.keywords.push('type', 'interface', 'extends', 'implements', 'keyof', 'typeof');
    } else if (lang === 'javascript' || lang === 'js' || lang === 'jsx') {
        keywordSets.keywords.push('extends', 'implements');
    } else if (lang === 'java') {
        keywordSets.keywords.push('package', 'extends', 'implements', 'super', 'this');
        keywordSets.modifiers.push('synchronized', 'transient', 'volatile', 'native', 'strictfp');
    } else if (lang === 'go') {
        keywordSets.keywords.push('func', 'package', 'type', 'struct', 'interface', 'chan', 'map', 'range', 'select', 'go', 'defer');
        keywordSets.types.push('int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'byte', 'rune', 'float32', 'float64', 'complex64', 'complex128', 'error');
    } else if (lang === 'rust' || lang === 'rs') {
        keywordSets.keywords.push('fn', 'let', 'mut', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'where', 'move');
        keywordSets.types.push('i8', 'i16', 'i32', 'i64', 'i128', 'u8', 'u16', 'u32', 'u64', 'u128', 'f32', 'f64', 'usize', 'isize', 'str', 'String', 'Vec', 'Option', 'Result', 'Box');
    } else if (lang === 'ruby' || lang === 'rb') {
        keywordSets.keywords.push('def', 'end', 'do', 'begin', 'rescue', 'ensure', 'module', 'attr_reader', 'attr_writer', 'attr_accessor');
        keywordSets.modifiers.push('require', 'include', 'extend');
    }

    // Regex patterns for comprehensive tokenization
    const patterns: Array<{ regex: RegExp; type: string; captureGroup?: number }> = [
        // Comments (highest priority)
        { regex: /(\/\*[\s\S]*?\*\/)/g, type: 'comment' },
        { regex: /(\/\/.*$)/gm, type: 'comment' },
        { regex: /(#.*$)/gm, type: 'comment' },
        { regex: /("""[\s\S]*?"""|'''[\s\S]*?''')/g, type: 'docstring' },

        // Strings and regex
        { regex: /(r?["'`])((?:(?!\1)[^\\]|\\.)*)(\1)/g, type: 'string' },
        { regex: /(\/(?:[^\/\\\n]|\\.)+\/[gimuy]*)/g, type: 'regex' },

        // Numbers (including hex, binary, floats)
        { regex: /\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, type: 'number' },

        // Decorators
        { regex: /@\w+/g, type: 'decorator' },

        // Function definitions and calls
        { regex: /\b(function|def|async function)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g, type: 'function', captureGroup: 2 },
        { regex: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, type: 'function' },

        // Method calls (object.method)
        { regex: /\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, type: 'method', captureGroup: 1 },
        { regex: /\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, type: 'property', captureGroup: 1 },

        // Keywords by category
        { regex: new RegExp(`\\b(${keywordSets.imports.join('|')})\\b`, 'g'), type: 'import' },
        { regex: new RegExp(`\\b(${keywordSets.controlFlow.join('|')})\\b`, 'g'), type: 'controlFlow' },
        { regex: new RegExp(`\\b(${keywordSets.keywords.join('|')})\\b`, 'g'), type: 'keyword' },
        { regex: new RegExp(`\\b(${keywordSets.types.join('|')})\\b`, 'g'), type: 'type' },
        { regex: new RegExp(`\\b(${keywordSets.modifiers.join('|')})\\b`, 'g'), type: 'modifier' },
        { regex: new RegExp(`\\b(${keywordSets.boolean.join('|')})\\b`, 'g'), type: 'boolean' },

        // Operators by category
        { regex: /(===|!==|==|!=|<=|>=|<|>)/g, type: 'comparison' },
        { regex: /(&&|\|\||!)/g, type: 'logical' },
        { regex: /(=|\+=|-=|\*=|\/=|%=|\|=|&=|\^=)/g, type: 'assignment' },
        { regex: /(\+|-|\*|\/|%|\*\*)/g, type: 'operator' },
        { regex: /(\?|:)/g, type: 'operator' },

        // Brackets and punctuation
        { regex: /([()[\]{}])/g, type: 'bracket' },
        { regex: /([.,;])/g, type: 'punctuation' },
    ];

    // Calculate bracket nesting levels
    const nestingMap = new Map<number, number>();
    const stack: Array<{ char: string; pos: number }> = [];

    for (let i = 0; i < code.length; i++) {
        const char = code[i];
        if (openBrackets.includes(char)) {
            stack.push({ char, pos: i });
            nestingMap.set(i, stack.length);
        } else if (closeBrackets.includes(char)) {
            if (stack.length > 0) {
                const lastOpen = stack.pop();
                if (lastOpen && bracketPairs[lastOpen.char] === char) {
                    nestingMap.set(i, stack.length + 1);
                }
            }
        }
    }

    // Split code into lines to preserve line breaks
    const lines = code.split('\n');
    let globalOffset = 0;

    lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) {
            tokens.push({ text: '\n', type: 'default' });
            globalOffset += 1;
        }

        const lineTokens: Array<{ start: number; end: number; type: string; text: string; captureGroup?: number }> = [];

        // Find all matches for all patterns
        for (const pattern of patterns) {
            let match;
            pattern.regex.lastIndex = 0;
            while ((match = pattern.regex.exec(line)) !== null) {
                const tokenText = pattern.captureGroup ? match[pattern.captureGroup] : match[0];
                const tokenStart = pattern.captureGroup ? match.index + match[0].indexOf(tokenText) : match.index;

                lineTokens.push({
                    start: tokenStart,
                    end: tokenStart + tokenText.length,
                    type: pattern.type,
                    text: tokenText,
                });
            }
        }

        // Sort tokens by position and remove overlaps
        lineTokens.sort((a, b) => a.start - b.start);

        const filteredTokens: typeof lineTokens = [];
        let lastEnd = 0;
        for (const token of lineTokens) {
            if (token.start >= lastEnd) {
                filteredTokens.push(token);
                lastEnd = token.end;
            }
        }

        // Build output tokens with proper nesting levels for brackets
        let currentIndex = 0;
        for (const token of filteredTokens) {
            if (token.start > currentIndex) {
                const beforeText = line.slice(currentIndex, token.start);
                if (beforeText) {
                    tokens.push({ text: beforeText, type: 'default' });
                }
            }

            if (token.type === 'bracket') {
                const globalPos = globalOffset + token.start;
                const nestLevel = nestingMap.get(globalPos) || 1;
                tokens.push({ text: token.text, type: token.type, nestLevel });
            } else {
                tokens.push({ text: token.text, type: token.type });
            }

            currentIndex = token.end;
        }

        if (currentIndex < line.length) {
            const remainingText = line.slice(currentIndex);
            if (remainingText) {
                tokens.push({ text: remainingText, type: 'default' });
            }
        }

        globalOffset += line.length;
    });

    return tokens;
}

/**
 * Tokenize a single line of code (no newline splitting).
 * Optimized for DiffView where lines are already split.
 */
export function tokenizeLine(lineText: string, language: string): SyntaxToken[] {
    if (!lineText) return [];
    // tokenizeCode handles single-line input correctly (no \n to split on)
    return tokenizeCode(lineText, language);
}

/**
 * Get the syntax highlight color for a token type using theme colors.
 */
export function getSyntaxColor(type: string, nestLevel: number | undefined, theme: any): string {
    const colors = {
        keyword: theme.colors.syntaxKeyword,
        controlFlow: theme.colors.syntaxKeyword,
        type: theme.colors.syntaxKeyword,
        modifier: theme.colors.syntaxKeyword,
        string: theme.colors.syntaxString,
        number: theme.colors.syntaxNumber,
        boolean: theme.colors.syntaxNumber,
        regex: theme.colors.syntaxString,
        function: theme.colors.syntaxFunction,
        method: theme.colors.syntaxFunction,
        property: theme.colors.syntaxDefault,
        comment: theme.colors.syntaxComment,
        docstring: theme.colors.syntaxComment,
        operator: theme.colors.syntaxDefault,
        assignment: theme.colors.syntaxKeyword,
        comparison: theme.colors.syntaxKeyword,
        logical: theme.colors.syntaxKeyword,
        decorator: theme.colors.syntaxKeyword,
        import: theme.colors.syntaxKeyword,
        variable: theme.colors.syntaxDefault,
        parameter: theme.colors.syntaxDefault,
        punctuation: theme.colors.syntaxDefault,
        default: theme.colors.syntaxDefault,
    };

    if (type === 'bracket') {
        const bracketColors = [
            theme.colors.syntaxBracket1,
            theme.colors.syntaxBracket2,
            theme.colors.syntaxBracket3,
            theme.colors.syntaxBracket4,
            theme.colors.syntaxBracket5,
        ];
        const level = (nestLevel || 1) % 5;
        return bracketColors[level === 0 ? 4 : level - 1];
    }

    return colors[type as keyof typeof colors] || colors.default;
}

/**
 * Map file extension to language identifier for syntax highlighting.
 */
export function getLanguageFromPath(filePath: string): string | null {
    if (!filePath) return null;

    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    const extensionMap: Record<string, string> = {
        // JavaScript / TypeScript
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        // Python
        py: 'python',
        pyw: 'python',
        pyi: 'python',
        // Java / JVM
        java: 'java',
        kt: 'kotlin',
        kts: 'kotlin',
        scala: 'scala',
        // Systems
        go: 'go',
        rs: 'rust',
        c: 'c',
        h: 'c',
        cpp: 'cpp',
        cc: 'cpp',
        cxx: 'cpp',
        hpp: 'cpp',
        // Ruby
        rb: 'ruby',
        // PHP
        php: 'php',
        // Shell
        sh: 'bash',
        bash: 'bash',
        zsh: 'bash',
        fish: 'bash',
        // Web
        html: 'html',
        htm: 'html',
        css: 'css',
        scss: 'css',
        less: 'css',
        // Config / Data
        json: 'json',
        yaml: 'yaml',
        yml: 'yaml',
        toml: 'toml',
        xml: 'xml',
        // Swift / Objective-C
        swift: 'swift',
        m: 'objectivec',
        // Dart
        dart: 'dart',
        // Lua
        lua: 'lua',
        // SQL
        sql: 'sql',
        // Markdown
        md: 'markdown',
        mdx: 'markdown',
    };

    return extensionMap[ext] || null;
}
