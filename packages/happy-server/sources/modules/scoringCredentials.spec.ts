import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serverEnvScoringCredentials } from "./scoringCredentials";

/**
 * Pins the server-env fallback that the four LLM-scoring routes used to inline
 * byte-for-byte. The mapping from env var names to a ScoringCredentials shape
 * is the invariant single-sourced here; a drift in one route copy used to be
 * invisible.
 */
describe("serverEnvScoringCredentials", () => {
    const SCORING_ENV_KEYS = [
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "OLLAMA_URL",
    ] as const;

    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = {};
        for (const k of SCORING_ENV_KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const k of SCORING_ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    it("returns null when no provider env var is set", () => {
        expect(serverEnvScoringCredentials()).toBeNull();
    });

    it("maps ANTHROPIC_API_KEY (+ base url) to the anthropic provider", () => {
        process.env.ANTHROPIC_API_KEY = "sk-ant-test";
        process.env.ANTHROPIC_BASE_URL = "https://proxy.example/anthropic";
        expect(serverEnvScoringCredentials()).toEqual({
            provider: "anthropic",
            apiKey: "sk-ant-test",
            baseUrl: "https://proxy.example/anthropic",
        });
    });

    it("falls through to OPENAI_API_KEY when no anthropic key is present", () => {
        process.env.OPENAI_API_KEY = "sk-openai-test";
        expect(serverEnvScoringCredentials()).toEqual({
            provider: "openai",
            apiKey: "sk-openai-test",
            baseUrl: "",
        });
    });

    it("falls through to OLLAMA_URL when no api keys are present", () => {
        process.env.OLLAMA_URL = "http://localhost:11434";
        expect(serverEnvScoringCredentials()).toEqual({
            provider: "ollama",
            apiKey: "",
            baseUrl: "http://localhost:11434",
        });
    });
});
