import { describe, it, expect } from "vitest";
import { classifyTurnLifecycle } from "./turnLifecycleClassify";

describe("classifyTurnLifecycle", () => {
    it("returns all-false for null/undefined/empty content", () => {
        expect(classifyTurnLifecycle(null)).toEqual({
            isTaskStarted: false,
            isTaskComplete: false,
        });
        expect(classifyTurnLifecycle(undefined)).toEqual({
            isTaskStarted: false,
            isTaskComplete: false,
        });
        expect(classifyTurnLifecycle({})).toEqual({
            isTaskStarted: false,
            isTaskComplete: false,
        });
    });

    describe("Codex / ACP provider (content.data.type)", () => {
        for (const type of ["acp", "codex"] as const) {
            it(`${type}: task_started → started`, () => {
                expect(
                    classifyTurnLifecycle({
                        content: { type, data: { type: "task_started" } },
                    }),
                ).toEqual({ isTaskStarted: true, isTaskComplete: false });
            });

            it(`${type}: task_complete → complete`, () => {
                expect(
                    classifyTurnLifecycle({
                        content: { type, data: { type: "task_complete" } },
                    }),
                ).toEqual({ isTaskStarted: false, isTaskComplete: true });
            });

            it(`${type}: turn_aborted → complete`, () => {
                expect(
                    classifyTurnLifecycle({
                        content: { type, data: { type: "turn_aborted" } },
                    }),
                ).toEqual({ isTaskStarted: false, isTaskComplete: true });
            });
        }

        it("ignores task_started/complete under a non-acp/codex content type", () => {
            expect(
                classifyTurnLifecycle({
                    content: { type: "text", data: { type: "task_complete" } },
                }),
            ).toEqual({ isTaskStarted: false, isTaskComplete: false });
        });
    });

    describe("session content (content.data.ev.t)", () => {
        it("turn-start → started", () => {
            expect(
                classifyTurnLifecycle({
                    content: { type: "session", data: { ev: { t: "turn-start" } } },
                }),
            ).toEqual({ isTaskStarted: true, isTaskComplete: false });
        });

        it("turn-end → complete", () => {
            expect(
                classifyTurnLifecycle({
                    content: { type: "session", data: { ev: { t: "turn-end" } } },
                }),
            ).toEqual({ isTaskStarted: false, isTaskComplete: true });
        });

        it("requires content.type === 'session' (ev alone is not enough)", () => {
            expect(
                classifyTurnLifecycle({
                    content: { type: "codex", data: { ev: { t: "turn-end" } } },
                }),
            ).toEqual({ isTaskStarted: false, isTaskComplete: false });
        });
    });

    describe("session-protocol envelope (role === 'session' + content.ev.t)", () => {
        it("turn-start → started", () => {
            expect(
                classifyTurnLifecycle({
                    role: "session",
                    content: { ev: { t: "turn-start" } },
                }),
            ).toEqual({ isTaskStarted: true, isTaskComplete: false });
        });

        it("turn-end → complete", () => {
            expect(
                classifyTurnLifecycle({
                    role: "session",
                    content: { ev: { t: "turn-end" } },
                }),
            ).toEqual({ isTaskStarted: false, isTaskComplete: true });
        });

        it("requires role === 'session' (envelope ev without the role is ignored)", () => {
            expect(
                classifyTurnLifecycle({
                    role: "agent",
                    content: { ev: { t: "turn-end" } },
                }),
            ).toEqual({ isTaskStarted: false, isTaskComplete: false });
        });
    });

    it("a plain content message announces no lifecycle transition", () => {
        expect(
            classifyTurnLifecycle({
                role: "agent",
                content: { type: "text" },
            }),
        ).toEqual({ isTaskStarted: false, isTaskComplete: false });
    });
});
