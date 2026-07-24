import { type ScoringCredentials, type ScoringProvider } from "./optionScorer";

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

export interface OptionGenerateResult {
    options: string[];
    modelUsed: string;
    provider: ScoringProvider;
}

async function callAnthropic(creds: ScoringCredentials, userMessage: string): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    const model = creds.model || DEFAULT_GENERATION_MODELS.anthropic;

    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": creds.apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model,
            max_tokens: 256,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { content: { type: string; text: string }[] };
    return data.content[0]?.text ?? null;
}

async function callOpenAI(creds: ScoringCredentials, userMessage: string): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
    const model = creds.model || DEFAULT_GENERATION_MODELS.openai;

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${creds.apiKey}`,
        },
        body: JSON.stringify({
            model,
            max_tokens: 256,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userMessage },
            ],
            temperature: 0.7,
        }),
        signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? null;
}

async function callOllama(creds: ScoringCredentials, userMessage: string): Promise<string | null> {
    const url = creds.baseUrl || "http://localhost:11434";
    const model = creds.model || DEFAULT_GENERATION_MODELS.ollama;

    const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userMessage },
            ],
            stream: false,
            options: { temperature: 0.7 },
        }),
        signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return data.message?.content ?? null;
}

const CALL_FNS: Record<ScoringProvider, (creds: ScoringCredentials, msg: string) => Promise<string | null>> = {
    anthropic: callAnthropic,
    openai: callOpenAI,
    ollama: callOllama,
};

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
    const modelUsed = credentials.model || DEFAULT_GENERATION_MODELS[credentials.provider];
    const userMessage = buildUserMessage(contextSummary, sessionTitle);

    const callFn = CALL_FNS[credentials.provider];
    const raw = await callFn(credentials, userMessage);
    if (!raw) throw new Error("LLM returned empty response");

    const options = parseOptions(raw);
    if (!options) throw new Error(`Failed to parse generated options: ${raw.slice(0, 200)}`);

    return { options, modelUsed, provider: credentials.provider };
}
