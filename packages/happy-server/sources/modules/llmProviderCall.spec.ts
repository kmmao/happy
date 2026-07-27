import { describe, it, expect, vi, afterEach } from "vitest";
import {
    llmProviderCall,
    resolveLlmModel,
    detectProviderFromEnv,
    type LlmCallOptions,
    type ScoringCredentials,
} from "./llmProviderCall";

/**
 * These pin the provider wire contract this seam owns.
 *
 * The refactor that created this module collapsed two byte-for-byte copies of
 * the provider calls into one, moving their four differences (system prompt,
 * default models, max tokens, timeout, temperature) into an options argument.
 * The risk that refactor carries is a silently wrong parameter mapping — e.g.
 * generation quietly inheriting scoring's temperature 0.1, or the Anthropic
 * path gaining a `temperature` field neither original copy sent. Every
 * assertion below exists to catch exactly that class of drift.
 */

const OPTIONS: LlmCallOptions = {
    systemPrompt: "SYS",
    defaultModels: { anthropic: "a-default", openai: "o-default", ollama: "l-default" },
    maxTokens: 123,
    timeoutMs: 4567,
    temperature: 0.42,
};

function mockFetchOnce(body: unknown, ok = true, status = 200) {
    const spy = vi.fn(async () => ({
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;
    globalThis.fetch = spy;
    return spy as unknown as ReturnType<typeof vi.fn>;
}

function lastRequestBody(spy: ReturnType<typeof vi.fn>): any {
    return JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
}

const originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

describe("llmProviderCall", () => {
    describe("anthropic", () => {
        const creds: ScoringCredentials = { provider: "anthropic", apiKey: "k" };

        it("maps options onto the Messages API shape and returns the first text block", async () => {
            const spy = mockFetchOnce({ content: [{ type: "text", text: "hello" }] });

            const result = await llmProviderCall(creds, "USER", OPTIONS);

            expect(result).toBe("hello");
            const body = lastRequestBody(spy);
            expect(body.model).toBe("a-default");
            expect(body.max_tokens).toBe(123);
            expect(body.system).toBe("SYS");
            expect(body.messages).toEqual([{ role: "user", content: "USER" }]);
        });

        it("does NOT send temperature — neither original copy did, and the API treats it differently", async () => {
            const spy = mockFetchOnce({ content: [{ type: "text", text: "x" }] });

            await llmProviderCall(creds, "USER", OPTIONS);

            expect(lastRequestBody(spy)).not.toHaveProperty("temperature");
        });

        it("prefers an explicit credential model over the default", async () => {
            const spy = mockFetchOnce({ content: [{ type: "text", text: "x" }] });

            await llmProviderCall({ ...creds, model: "explicit" }, "USER", OPTIONS);

            expect(lastRequestBody(spy).model).toBe("explicit");
        });

        it("strips trailing slashes from a custom baseUrl", async () => {
            const spy = mockFetchOnce({ content: [{ type: "text", text: "x" }] });

            await llmProviderCall({ ...creds, baseUrl: "https://proxy.test///" }, "USER", OPTIONS);

            expect(spy.mock.calls[0][0]).toBe("https://proxy.test/v1/messages");
        });

        it("throws with the status and a truncated body on a non-2xx response", async () => {
            mockFetchOnce({ error: "nope" }, false, 429);

            await expect(llmProviderCall(creds, "USER", OPTIONS)).rejects.toThrow(
                /Anthropic API error 429/,
            );
        });

        it("returns null when the response carries no content block", async () => {
            mockFetchOnce({ content: [] });

            await expect(llmProviderCall(creds, "USER", OPTIONS)).resolves.toBeNull();
        });

        it("skips a leading thinking block and returns the first text block", async () => {
            // Thinking-capable models (claude-opus-5) intermittently lead with a
            // `thinking` block that has no `text` field. Reading content[0].text
            // returned undefined and surfaced as "LLM returned empty response"
            // for a random subset of requests.
            mockFetchOnce({
                content: [
                    { type: "thinking", thinking: "deliberating", signature: "sig" },
                    { type: "text", text: '["a","b"]' },
                ],
            });

            await expect(llmProviderCall(creds, "USER", OPTIONS)).resolves.toBe('["a","b"]');
        });

        it("returns null when every block is non-text", async () => {
            mockFetchOnce({ content: [{ type: "thinking", thinking: "only thought" }] });

            await expect(llmProviderCall(creds, "USER", OPTIONS)).resolves.toBeNull();
        });
    });

    describe("openai", () => {
        const creds: ScoringCredentials = { provider: "openai", apiKey: "k" };

        it("sends temperature and the system/user message pair", async () => {
            const spy = mockFetchOnce({ choices: [{ message: { content: "hi" } }] });

            const result = await llmProviderCall(creds, "USER", OPTIONS);

            expect(result).toBe("hi");
            const body = lastRequestBody(spy);
            expect(body.temperature).toBe(0.42);
            expect(body.max_tokens).toBe(123);
            expect(body.model).toBe("o-default");
            expect(body.messages).toEqual([
                { role: "system", content: "SYS" },
                { role: "user", content: "USER" },
            ]);
        });

        it("throws on a non-2xx response", async () => {
            mockFetchOnce({}, false, 500);
            await expect(llmProviderCall(creds, "USER", OPTIONS)).rejects.toThrow(
                /OpenAI API error 500/,
            );
        });
    });

    describe("ollama", () => {
        const creds: ScoringCredentials = { provider: "ollama", apiKey: "" };

        it("nests temperature under options and disables streaming", async () => {
            const spy = mockFetchOnce({ message: { content: "yo" } });

            const result = await llmProviderCall(creds, "USER", OPTIONS);

            expect(result).toBe("yo");
            const body = lastRequestBody(spy);
            expect(body.options).toEqual({ temperature: 0.42 });
            expect(body.stream).toBe(false);
            expect(body.model).toBe("l-default");
        });

        it("defaults to localhost when no baseUrl is given", async () => {
            const spy = mockFetchOnce({ message: { content: "x" } });

            await llmProviderCall(creds, "USER", OPTIONS);

            expect(spy.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");
        });

        it("throws on a non-2xx response", async () => {
            mockFetchOnce({}, false, 404);
            await expect(llmProviderCall(creds, "USER", OPTIONS)).rejects.toThrow(
                /Ollama API error 404/,
            );
        });
    });
});

describe("resolveLlmModel", () => {
    const defaults = { anthropic: "a", openai: "o", ollama: "l" };

    it("falls back to the per-provider default", () => {
        expect(resolveLlmModel({ provider: "openai", apiKey: "" }, defaults)).toBe("o");
    });

    it("prefers an explicit model", () => {
        expect(resolveLlmModel({ provider: "openai", apiKey: "", model: "m" }, defaults)).toBe("m");
    });
});

describe("detectProviderFromEnv", () => {
    it("prefers ANTHROPIC_AUTH_TOKEN over ANTHROPIC_API_KEY", () => {
        expect(
            detectProviderFromEnv({ ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k" }),
        ).toEqual({ provider: "anthropic", apiKey: "t", baseUrl: undefined });
    });

    it("ranks anthropic above openai above ollama", () => {
        expect(detectProviderFromEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })?.provider)
            .toBe("anthropic");
        expect(detectProviderFromEnv({ OPENAI_API_KEY: "o", OLLAMA_URL: "u" })?.provider)
            .toBe("openai");
        expect(detectProviderFromEnv({ OLLAMA_URL: "u" })?.provider).toBe("ollama");
    });

    it("returns null when nothing is configured", () => {
        expect(detectProviderFromEnv({})).toBeNull();
    });
});
