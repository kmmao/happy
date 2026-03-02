import { trimIdent } from "@/utils/trimIdent";

export const systemPrompt = trimIdent(`
    Work exactly as you would in native Claude Code CLI. Start by reading the relevant CLAUDE.md to understand project conventions, then investigate code precisely. No shortcuts — provide thorough analysis before asking questions.
`);
