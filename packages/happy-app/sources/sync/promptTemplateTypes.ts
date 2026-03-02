/**
 * Prompt Template type definitions and constants
 *
 * Templates are stored in UserKVStore with E2E encryption.
 * Each template is an independent KV entry: kanban/template/{templateId}
 *
 * Inspired by AutoClaude's phase-specific prompts (coder.md, QA_REVIEW_SYSTEM_PROMPT.md).
 * Templates provide structured prompts that auto-fill task context via variables.
 */

//
// Template data model
//

export interface PromptTemplateData {
    readonly name: string;
    readonly content: string;
    /** Built-in templates cannot be deleted */
    readonly isBuiltIn: boolean;
    readonly sortOrder: number;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface PromptTemplate extends PromptTemplateData {
    readonly id: string;
    /** KV optimistic lock version (-1 = new, 0+ = existing) */
    readonly kvVersion: number;
}

//
// KV key helpers
//

const TEMPLATE_PREFIX = "kanban/template/";

export function templateKey(templateId: string): string {
    return `${TEMPLATE_PREFIX}${templateId}`;
}

export function parseTemplateKey(key: string): string | null {
    if (!key.startsWith(TEMPLATE_PREFIX)) {
        return null;
    }
    return key.slice(TEMPLATE_PREFIX.length);
}

export function isTemplateKey(key: string): boolean {
    return key.startsWith(TEMPLATE_PREFIX);
}

//
// Built-in template IDs (stable across devices)
//

export const BUILTIN_TEMPLATE_IDS = {
    coding: "builtin-coding",
    bugfix: "builtin-bugfix",
    review: "builtin-review",
} as const;

//
// Built-in template content
//

export const BUILTIN_TEMPLATES: ReadonlyArray<PromptTemplateData & { readonly id: string }> = [
    {
        id: BUILTIN_TEMPLATE_IDS.coding,
        name: "kanban.templates.builtIn.coding",
        content: [
            "# Task: {{title}}",
            "",
            "{{description}}",
            "",
            "## Working Directory",
            "{{directory}}",
            "",
            "## Instructions",
            "1. Read the existing codebase first to understand patterns and conventions",
            "2. Plan your approach before writing code",
            "3. Implement the feature with proper error handling",
            "4. Write tests for new functionality",
            "5. Verify the build passes before finishing",
            "",
            "## Commit Format",
            "Use conventional commits: feat|fix|refactor|docs|test|chore: description",
            "",
            "## Quality Checklist",
            "- [ ] Code follows existing patterns",
            "- [ ] Error cases handled",
            "- [ ] No hardcoded values",
            "- [ ] Tests pass",
        ].join("\n"),
        isBuiltIn: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: BUILTIN_TEMPLATE_IDS.bugfix,
        name: "kanban.templates.builtIn.bugfix",
        content: [
            "# Bug Fix: {{title}}",
            "",
            "## Problem Description",
            "{{description}}",
            "",
            "## Working Directory",
            "{{directory}}",
            "",
            "## Instructions",
            "1. Reproduce the bug and understand the root cause",
            "2. Write a failing test that captures the bug",
            "3. Fix the root cause (not just the symptom)",
            "4. Verify the test passes",
            "5. Check for similar issues elsewhere in the codebase",
            "",
            "## Commit Format",
            "fix: description of what was fixed",
        ].join("\n"),
        isBuiltIn: true,
        sortOrder: 1,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: BUILTIN_TEMPLATE_IDS.review,
        name: "kanban.templates.builtIn.review",
        content: [
            "# Code Review: {{title}}",
            "",
            "{{description}}",
            "",
            "## Working Directory",
            "{{directory}}",
            "",
            "## Review Dimensions",
            "Review the recent changes and evaluate:",
            "",
            "### 1. Correctness",
            "- Does the code do what it claims?",
            "- Are edge cases handled?",
            "",
            "### 2. Security",
            "- Input validation present?",
            "- No hardcoded secrets?",
            "- SQL injection / XSS prevention?",
            "",
            "### 3. Performance",
            "- Unnecessary re-renders or loops?",
            "- Proper async handling?",
            "",
            "### 4. Maintainability",
            "- Clear naming and structure?",
            "- Appropriate abstraction level?",
            "",
            "## Output Format",
            "For each issue found:",
            "- **Severity**: CRITICAL / HIGH / MEDIUM / LOW",
            "- **File**: path:line",
            "- **Issue**: description",
            "- **Fix**: suggested fix",
        ].join("\n"),
        isBuiltIn: true,
        sortOrder: 2,
        createdAt: 0,
        updatedAt: 0,
    },
];
