/**
 * The one place that knows how to speak to each LLM provider.
 *
 * `optionScorer` and `optionGenerator` each used to carry their own
 * byte-for-byte copy of `callAnthropic` / `callOpenAI` / `callOllama` — 93 lines
 * apiece, differing only in four call-site parameters. Two adapters make the
 * seam real (the project's "one adapter = hypothetical seam; two = real seam"
 * rule), so the provider wire details live here once and the differences move
 * into an explicit options argument.
 *
 * What stays caller-owned: the system prompt, the default-model table, the
 * token ceiling, the timeout and the sampling temperature. Those are the four
 * axes on which scoring (terse, deterministic) and generation (longer, creative)
 * genuinely differ, so they are parameters rather than branches in here.
 *
 * Note on `temperature`: Anthropic's Messages API call deliberately omits it —
 * neither original copy sent one on that path, and preserving that is what keeps
 * this refactor behaviour-identical.
 */

export type ScoringProvider = "anthropic" | "openai" | "ollama";

export interface ScoringCredentials {
    provider: ScoringProvider;
    apiKey: string;
    baseUrl?: string;
    model?: string;
}

export interface LlmCallOptions {
    /** System prompt for this call site's task. */
    systemPrompt: string;
    /** Per-provider fallback model, used when the credentials carry none. */
    defaultModels: Record<ScoringProvider, string>;
    /** Output ceiling. */
    maxTokens: number;
    /** Request timeout in milliseconds. */
    timeoutMs: number;
    /** Sampling temperature; applied to OpenAI and Ollama, not Anthropic. */
    temperature: number;
}

async function callAnthropic(
    creds: ScoringCredentials,
    userMessage: string,
    options: LlmCallOptions,
): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    const model = creds.model || options.defaultModels.anthropic;

    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": creds.apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model,
            max_tokens: options.maxTokens,
            system: options.systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { content: { type: string; text: string }[] };
    return data.content[0]?.text ?? null;
}

async function callOpenAI(
    creds: ScoringCredentials,
    userMessage: string,
    options: LlmCallOptions,
): Promise<string | null> {
    const baseUrl = (creds.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
    const model = creds.model || options.defaultModels.openai;

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${creds.apiKey}`,
        },
        body: JSON.stringify({
            model,
            max_tokens: options.maxTokens,
            messages: [
                { role: "system", content: options.systemPrompt },
                { role: "user", content: userMessage },
            ],
            temperature: options.temperature,
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? null;
}

async function callOllama(
    creds: ScoringCredentials,
    userMessage: string,
    options: LlmCallOptions,
): Promise<string | null> {
    const url = creds.baseUrl || "http://localhost:11434";
    const model = creds.model || options.defaultModels.ollama;

    const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: options.systemPrompt },
                { role: "user", content: userMessage },
            ],
            stream: false,
            options: { temperature: options.temperature },
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return data.message?.content ?? null;
}

const CALL_FNS: Record<
    ScoringProvider,
    (creds: ScoringCredentials, msg: string, options: LlmCallOptions) => Promise<string | null>
> = {
    anthropic: callAnthropic,
    openai: callOpenAI,
    ollama: callOllama,
};

/**
 * Dispatch one completion request to the credentials' provider.
 * Returns the raw text; parsing is the caller's job. Throws on a non-2xx
 * response, carrying the provider name and a truncated body.
 */
export async function llmProviderCall(
    creds: ScoringCredentials,
    userMessage: string,
    options: LlmCallOptions,
): Promise<string | null> {
    return CALL_FNS[creds.provider](creds, userMessage, options);
}

/** Resolve the model that a call with these credentials would actually use. */
export function resolveLlmModel(
    creds: ScoringCredentials,
    defaultModels: Record<ScoringProvider, string>,
): string {
    return creds.model || defaultModels[creds.provider];
}

export function detectProviderFromEnv(env: Record<string, string>): ScoringCredentials | null {
    if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) {
        return {
            provider: "anthropic",
            apiKey: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY,
            baseUrl: env.ANTHROPIC_BASE_URL,
        };
    }
    if (env.OPENAI_API_KEY) {
        return {
            provider: "openai",
            apiKey: env.OPENAI_API_KEY,
            baseUrl: env.OPENAI_BASE_URL,
        };
    }
    if (env.OLLAMA_URL) {
        return {
            provider: "ollama",
            apiKey: "",
            baseUrl: env.OLLAMA_URL,
        };
    }
    return null;
}
