import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateEmbedding, generateEmbeddings, truncateForEmbedding, EMBEDDING_DIMENSIONS } from "./embeddingService";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("embeddingService", () => {
    beforeEach(() => {
        // Force OpenAI provider for tests
        vi.stubEnv("EMBEDDING_PROVIDER", "openai");
        vi.stubEnv("OPENAI_API_KEY", "test-key-123");
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe("truncateForEmbedding", () => {
        it("should pass through short text unchanged", () => {
            const text = "Short text";
            expect(truncateForEmbedding(text)).toBe(text);
        });

        it("should truncate text exceeding max tokens (estimated by chars)", () => {
            const longText = "a".repeat(3000);
            const result = truncateForEmbedding(longText);
            expect(result.length).toBeLessThan(longText.length);
        });

        it("should handle empty string", () => {
            expect(truncateForEmbedding("")).toBe("");
        });
    });

    describe("EMBEDDING_DIMENSIONS", () => {
        it("should be 1024 (unified for Ollama bge-m3 + OpenAI)", () => {
            expect(EMBEDDING_DIMENSIONS).toBe(1024);
        });
    });

    describe("generateEmbedding", () => {
        it("should return embedding array on success (OpenAI)", async () => {
            const fakeEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ embedding: fakeEmbedding }],
                }),
            });

            const result = await generateEmbedding("test text");
            expect(result).toEqual(fakeEmbedding);
            expect(result).toHaveLength(1024);

            expect(mockFetch).toHaveBeenCalledOnce();
            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toBe("https://api.openai.com/v1/embeddings");
            expect(options.headers["Authorization"]).toBe("Bearer test-key-123");
            const body = JSON.parse(options.body);
            expect(body.dimensions).toBe(1024);
        });

        it("should return null when no provider is configured", async () => {
            vi.stubEnv("EMBEDDING_PROVIDER", "");
            vi.stubEnv("OPENAI_API_KEY", "");
            const result = await generateEmbedding("test text");
            expect(result).toBeNull();
        });

        it("should return null on API error (graceful degradation)", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => "Rate limit exceeded",
            });

            const result = await generateEmbedding("test text");
            expect(result).toBeNull();
        });

        it("should return null on network error (graceful degradation)", async () => {
            mockFetch.mockRejectedValueOnce(new Error("Network error"));

            const result = await generateEmbedding("test text");
            expect(result).toBeNull();
        });
    });

    describe("generateEmbeddings", () => {
        it("should return array of embeddings for batch input", async () => {
            const fakeEmbeddings = [
                Array.from({ length: 1024 }, () => 0.1),
                Array.from({ length: 1024 }, () => 0.2),
            ];
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: fakeEmbeddings.map((embedding, index) => ({ embedding, index })),
                }),
            });

            const result = await generateEmbeddings(["text one", "text two"]);
            expect(result).toHaveLength(2);
            expect(result![0]).toHaveLength(1024);
            expect(result![1]).toHaveLength(1024);
        });

        it("should return null on failure", async () => {
            mockFetch.mockRejectedValueOnce(new Error("timeout"));

            const result = await generateEmbeddings(["text one"]);
            expect(result).toBeNull();
        });

        it("should return empty array for empty input array", async () => {
            const result = await generateEmbeddings([]);
            expect(result).toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
