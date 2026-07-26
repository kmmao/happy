import {
    llmProviderCall,
    resolveLlmModel,
    type LlmCallOptions,
    type ScoringCredentials,
    type ScoringProvider,
} from "./llmProviderCall";

const SYSTEM_PROMPT =
    "You are a proactive assistant. Based on the conversation context, generate 2-4 specific, actionable next steps.\n" +
    "Rules:\n" +
    "- Start each option with an action verb (Fix, Add, Implement, Check, Deploy, Optimize... or Chinese equivalents like 修复/添加/优化/检查/部署)\n" +
    "- Be specific: reference filenames, function names, or concepts mentioned in the conversation\n" +
    "- If current tasks seem complete, suggest system-level improvements: tests, performance, documentation, deployment, monitoring, security\n" +
    "- Max 60 characters per option\n" +
    "- Match the language used in the conversation (Chinese or English)\n" +
    "Return ONLY a JSON array of strings, no markdown fences, no explanation.\n" +
    'Example: ["Fix edge case in payment validation", "Add unit tests for new endpoint", "Update API documentation"]';

const DEFAULT_GENERATION_MODELS: Record<ScoringProvider, string> = {
    anthropic: "claude-opus-5",
    openai: "gpt-4.5",
    ollama: "llama3",
};

/** Generation wants longer, more varied output and allows a slower call. */
const GENERATION_CALL_OPTIONS: LlmCallOptions = {
    systemPrompt: SYSTEM_PROMPT,
    defaultModels: DEFAULT_GENERATION_MODELS,
    maxTokens: 256,
    timeoutMs: 20000,
    temperature: 0.7,
};

export interface OptionGenerateResult {
    options: string[];
    modelUsed: string;
    provider: ScoringProvider;
}

function buildUserMessage(contextSummary: string, sessionTitle: string | null): string {
    const lines: string[] = ["Conversation context:"];
    if (sessionTitle) lines.push(`Task: ${sessionTitle.slice(0, 100)}`);
    lines.push(contextSummary);
    lines.push("\nGenerate the next 2-4 actionable steps:");
    return lines.join("\n");
}

function parseOptions(text: string): string[] | null {
    const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

    // Try direct JSON parse first (ideal case: LLM returned pure JSON array)
    try {
        const directParsed = JSON.parse(cleaned) as unknown;
        if (Array.isArray(directParsed)) {
            const options: string[] = [];
            for (const v of directParsed) {
                if (typeof v === "string" && v.trim().length > 0) options.push(v.trim().slice(0, 80));
            }
            return options.length >= 2 ? options.slice(0, 4) : null;
        }
    } catch { /* fall through */ }

    // Fallback: extract from first [ to last ] to handle brackets inside string values
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end <= start) return null;
    const jsonStr = cleaned.slice(start, end + 1);

    try {
        const parsed = JSON.parse(jsonStr) as unknown;
        if (!Array.isArray(parsed)) return null;
        const options: string[] = [];
        for (const v of parsed) {
            if (typeof v === "string" && v.trim().length > 0) {
                options.push(v.trim().slice(0, 80));
            }
        }
        return options.length >= 2 ? options.slice(0, 4) : null;
    } catch {
        return null;
    }
}

export async function generateOptionsWithLLM(
    credentials: ScoringCredentials,
    contextSummary: string,
    sessionTitle: string | null,
): Promise<OptionGenerateResult> {
    const modelUsed = resolveLlmModel(credentials, DEFAULT_GENERATION_MODELS);
    const userMessage = buildUserMessage(contextSummary, sessionTitle);

    const raw = await llmProviderCall(credentials, userMessage, GENERATION_CALL_OPTIONS);
    if (!raw) throw new Error("LLM returned empty response");

    const options = parseOptions(raw);
    if (!options) throw new Error(`Failed to parse generated options: ${raw.slice(0, 200)}`);

    return { options, modelUsed, provider: credentials.provider };
}
