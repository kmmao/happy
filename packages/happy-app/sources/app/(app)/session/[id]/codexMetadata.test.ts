import { describe, expect, it } from "vitest";
import {
    formatCodexThreadIdPreview,
    formatCodexReasoningEffortMetadata,
    formatCodexReasoningSummaryMetadata,
    hasCodexMetadataSection,
    resolveCodexEffectiveReasoningEffort,
    resolveCodexEffectiveReasoningSummary,
} from "./codexMetadata";

const translate = (key: string) => key;

describe("resolveCodexEffectiveReasoningEffort", () => {
    it("prefers the session-level override over Codex config", () => {
        expect(
            resolveCodexEffectiveReasoningEffort({
                effortLevel: "high",
                metadata: {
                    codex: {
                        config: {
                            reasoningEffort: "low",
                        },
                    },
                },
            } as any),
        ).toBe("high");
    });

    it("falls back to the effective Codex config when no override exists", () => {
        expect(
            resolveCodexEffectiveReasoningEffort({
                effortLevel: null,
                metadata: {
                    codex: {
                        config: {
                            reasoningEffort: "medium",
                        },
                    },
                },
            } as any),
        ).toBe("medium");
    });

    it("returns null when neither session override nor config is available", () => {
        expect(
            resolveCodexEffectiveReasoningEffort({
                effortLevel: null,
                metadata: {
                    codex: {
                        config: {
                            reasoningEffort: null,
                        },
                    },
                },
            } as any),
        ).toBeNull();
    });
});

describe("formatCodexReasoningEffortMetadata", () => {
    it("translates known effort levels", () => {
        expect(
            formatCodexReasoningEffortMetadata(
                {
                    effortLevel: "xhigh",
                    metadata: null,
                } as any,
                translate,
            ),
        ).toBe("agentInput.effort.xhigh");
    });

    it("preserves unknown future effort labels instead of hiding them", () => {
        expect(
            formatCodexReasoningEffortMetadata(
                {
                    effortLevel: null,
                    metadata: {
                        codex: {
                            config: {
                                reasoningEffort: "deep",
                            },
                        },
                    },
                } as any,
                translate,
            ),
        ).toBe("deep");
    });
});

describe("resolveCodexEffectiveReasoningSummary", () => {
    it("returns the effective Codex config summary when present", () => {
        expect(
            resolveCodexEffectiveReasoningSummary({
                metadata: {
                    codex: {
                        config: {
                            reasoningSummary: "concise",
                        },
                    },
                },
            } as any),
        ).toBe("concise");
    });

    it("returns null when no Codex reasoning summary is available", () => {
        expect(
            resolveCodexEffectiveReasoningSummary({
                metadata: {
                    codex: {
                        config: {
                            reasoningSummary: null,
                        },
                    },
                },
            } as any),
        ).toBeNull();
    });
});

describe("formatCodexReasoningSummaryMetadata", () => {
    it("preserves the effective summary label", () => {
        expect(
            formatCodexReasoningSummaryMetadata({
                metadata: {
                    codex: {
                        config: {
                            reasoningSummary: "concise",
                        },
                    },
                },
            } as any),
        ).toBe("concise");
    });
});

describe("formatCodexThreadIdPreview", () => {
    it("returns a shortened preview for long thread ids", () => {
        expect(
            formatCodexThreadIdPreview(
                "019d9fc6-b35c-7042-aedf-afa668e6eda0",
            ),
        ).toBe("019d9fc6...68e6eda0");
    });

    it("keeps short thread ids unchanged", () => {
        expect(formatCodexThreadIdPreview("thread-1")).toBe("thread-1");
    });
});

describe("hasCodexMetadataSection", () => {
    it("returns true for codex sessions with codex-specific metadata", () => {
        expect(
            hasCodexMetadataSection({
                effortLevel: null,
                metadata: {
                    flavor: "codex",
                    slashCommands: ["plan"],
                    codex: {
                        requestedBackend: "auto",
                    },
                },
            } as any),
        ).toBe(true);
    });

    it("returns false for non-codex sessions", () => {
        expect(
            hasCodexMetadataSection({
                effortLevel: "high",
                metadata: {
                    flavor: "claude",
                    codex: {
                        requestedBackend: "auto",
                    },
                },
            } as any),
        ).toBe(false);
    });

    it("returns false when codex metadata is empty", () => {
        expect(
            hasCodexMetadataSection({
                effortLevel: null,
                metadata: {
                    flavor: "codex",
                    slashCommands: [],
                    codex: {
                        config: {
                            profile: null,
                            reasoningEffort: null,
                            reasoningSummary: null,
                        },
                        skills: [],
                        agents: [],
                        mcpServers: [],
                    },
                },
            } as any),
        ).toBe(false);
    });

    it("returns true when a codex session has a thread id to display", () => {
        expect(
            hasCodexMetadataSection({
                effortLevel: null,
                metadata: {
                    flavor: "codex",
                    codex: {
                        threadId: "019d9fc6-b35c-7042-aedf-afa668e6eda0",
                    },
                },
            } as any),
        ).toBe(true);
    });
});
