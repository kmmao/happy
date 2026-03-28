import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { regenerateProfile } from "./knowledgeProfileGenerator";

// Mock db
vi.mock("@/storage/db", () => ({
    db: {
        projectKnowledge: {
            findMany: vi.fn(),
        },
        projectProfile: {
            upsert: vi.fn(),
        },
    },
}));

import { db } from "@/storage/db";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const VALID_PROFILE_JSON = JSON.stringify({
    techStack: ["TypeScript", "React", "Prisma"],
    architectureType: "monorepo",
    knownPitfalls: ["No mocking in CLI tests"],
    coreConventions: ["Functional programming preferred"],
    lastUpdatedAt: 1700000000000,
    lastUpdatedBy: "auto-profile-generator",
});

const FAKE_ENTRIES = [
    { entryType: "discovery", title: "Tech Stack", content: "TypeScript monorepo with React", tags: "tech", confidence: "high" },
    { entryType: "fix", title: "Bug Fix", content: "Fixed auth token refresh", tags: "auth", confidence: "high" },
];

describe("knowledgeProfileGenerator", () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.mocked(db.projectKnowledge.findMany).mockReset();
        vi.mocked(db.projectProfile.upsert).mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe("provider detection", () => {
        it("should fall back to ollama when no explicit provider and no anthropic key", async () => {
            // getOllamaUrl() always returns a default, so provider is never "none"
            // unless PROFILE_PROVIDER is explicitly set to something invalid
            vi.stubEnv("PROFILE_PROVIDER", "");
            vi.stubEnv("ANTHROPIC_API_KEY", "");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);
            vi.mocked(db.projectProfile.upsert).mockResolvedValue({ projectId: "test", content: "", version: 1 } as never);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    message: { content: VALID_PROFILE_JSON },
                }),
            });

            const result = await regenerateProfile("test-project");
            expect(result.success).toBe(true);

            const [url] = mockFetch.mock.calls[0];
            expect(url).toContain("/api/chat");
        });

        it("should use anthropic when PROFILE_PROVIDER=anthropic", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "anthropic");
            vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);
            vi.mocked(db.projectProfile.upsert).mockResolvedValue({ projectId: "test", content: "", version: 1 } as never);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: VALID_PROFILE_JSON }],
                }),
            });

            const result = await regenerateProfile("test-project");
            expect(result.success).toBe(true);

            const [url] = mockFetch.mock.calls[0];
            expect(url).toContain("/v1/messages");
        });

        it("should use ollama when PROFILE_PROVIDER=ollama", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "ollama");
            vi.stubEnv("OLLAMA_URL", "http://localhost:11434");
            vi.stubEnv("ANTHROPIC_API_KEY", "");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);
            vi.mocked(db.projectProfile.upsert).mockResolvedValue({ projectId: "test", content: "", version: 1 } as never);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    message: { content: VALID_PROFILE_JSON },
                }),
            });

            const result = await regenerateProfile("test-project");
            expect(result.success).toBe(true);

            const [url] = mockFetch.mock.calls[0];
            expect(url).toContain("/api/chat");
        });
    });

    describe("ANTHROPIC_BASE_URL", () => {
        it("should use default Anthropic URL when ANTHROPIC_BASE_URL is not set", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "anthropic");
            vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
            vi.stubEnv("ANTHROPIC_BASE_URL", "");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);
            vi.mocked(db.projectProfile.upsert).mockResolvedValue({ projectId: "test", content: "", version: 1 } as never);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: VALID_PROFILE_JSON }],
                }),
            });

            await regenerateProfile("test-project");

            const [url] = mockFetch.mock.calls[0];
            expect(url).toBe("https://api.anthropic.com/v1/messages");
        });

        it("should use custom ANTHROPIC_BASE_URL when set", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "anthropic");
            vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
            vi.stubEnv("ANTHROPIC_BASE_URL", "http://my-proxy:8899");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);
            vi.mocked(db.projectProfile.upsert).mockResolvedValue({ projectId: "test", content: "", version: 1 } as never);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: VALID_PROFILE_JSON }],
                }),
            });

            await regenerateProfile("test-project");

            const [url] = mockFetch.mock.calls[0];
            expect(url).toBe("http://my-proxy:8899/v1/messages");
        });

        it("should strip trailing slashes from ANTHROPIC_BASE_URL", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "anthropic");
            vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
            vi.stubEnv("ANTHROPIC_BASE_URL", "http://my-proxy:8899///");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);
            vi.mocked(db.projectProfile.upsert).mockResolvedValue({ projectId: "test", content: "", version: 1 } as never);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: VALID_PROFILE_JSON }],
                }),
            });

            await regenerateProfile("test-project");

            const [url] = mockFetch.mock.calls[0];
            expect(url).toBe("http://my-proxy:8899/v1/messages");
        });
    });

    describe("Anthropic call details", () => {
        it("should send correct headers and body", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "anthropic");
            vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-123");
            vi.stubEnv("ANTHROPIC_PROFILE_MODEL", "claude-haiku-4-5-20251001");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);
            vi.mocked(db.projectProfile.upsert).mockResolvedValue({ projectId: "test", content: "", version: 1 } as never);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: VALID_PROFILE_JSON }],
                }),
            });

            await regenerateProfile("test-project");

            const [, options] = mockFetch.mock.calls[0];
            expect(options.headers["x-api-key"]).toBe("sk-ant-test-123");
            expect(options.headers["anthropic-version"]).toBe("2023-06-01");

            const body = JSON.parse(options.body);
            expect(body.model).toBe("claude-haiku-4-5-20251001");
            expect(body.max_tokens).toBe(1024);
            expect(body.system).toContain("project knowledge analyst");
        });
    });

    describe("error handling", () => {
        it("should return error when no knowledge entries exist", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "anthropic");
            vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue([]);

            const result = await regenerateProfile("test-project");
            expect(result.success).toBe(false);
            expect(result.error).toContain("No knowledge entries");
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("should return error on API failure after retries", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "anthropic");
            vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);

            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => "Internal Server Error",
            });

            const result = await regenerateProfile("test-project");
            expect(result.success).toBe(false);
            expect(result.error).toContain("Anthropic API error 500");
        });

        it("should return error when LLM returns invalid JSON", async () => {
            vi.stubEnv("PROFILE_PROVIDER", "anthropic");
            vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
            vi.mocked(db.projectKnowledge.findMany).mockResolvedValue(FAKE_ENTRIES as never);

            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: "This is not JSON at all" }],
                }),
            });

            const result = await regenerateProfile("test-project");
            expect(result.success).toBe(false);
            expect(result.error).toContain("No JSON object found");
        });
    });
});
