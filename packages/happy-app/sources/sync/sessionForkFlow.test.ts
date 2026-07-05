import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `forkSessionFromMessage` drives a two-step flow — CLI `forkSession` RPC then
 * daemon spawn — and folds every failure mode into a tagged `ForkSessionOutcome`
 * union so call sites never try/catch. These tests pin the state machine:
 * which step's failure surfaces which outcome, that the spawn is skipped when
 * the fork RPC fails, and the directory-approval retry sub-machine.
 */

const sessionForkSession = vi.fn();
const machineSpawnNewSession = vi.fn();

vi.mock("@/sync/ops", () => ({
    sessionForkSession: (...args: any[]) => sessionForkSession(...args),
    machineSpawnNewSession: (...args: any[]) => machineSpawnNewSession(...args),
}));

import { forkSessionFromMessage } from "./sessionForkFlow";

const baseInput = {
    sourceSessionId: "src-1",
    baseSpawnOptions: { directory: "/orig", machineId: "m1" } as any,
};

beforeEach(() => {
    sessionForkSession.mockReset();
    machineSpawnNewSession.mockReset();
});

describe("forkSessionFromMessage", () => {
    it("returns error and skips the spawn when the fork RPC fails", async () => {
        sessionForkSession.mockResolvedValue({ error: "fork boom" });

        const out = await forkSessionFromMessage(baseInput);

        expect(out).toEqual({ type: "error", errorMessage: "fork boom" });
        expect(machineSpawnNewSession).not.toHaveBeenCalled();
    });

    it("spawns the forked session using the CLI-returned path and ids on success", async () => {
        sessionForkSession.mockResolvedValue({
            claudeSessionId: "claude-new",
            path: "/forked/path",
        });
        machineSpawnNewSession.mockResolvedValue({
            type: "success",
            sessionId: "happy-new",
        });

        const out = await forkSessionFromMessage({
            ...baseInput,
            upToMessageId: "uuid-9",
            title: "My Fork",
        });

        expect(out).toEqual({ type: "success", sessionId: "happy-new" });
        // fork RPC gets the anchor + title
        expect(sessionForkSession).toHaveBeenCalledWith("src-1", {
            upToMessageId: "uuid-9",
            title: "My Fork",
        });
        // spawn uses the forked path/ids and carries lineage
        expect(machineSpawnNewSession).toHaveBeenCalledWith(
            expect.objectContaining({
                directory: "/forked/path",
                claudeSessionId: "claude-new",
                forkSourceId: "src-1",
            }),
        );
    });

    it("omits upToMessageId and title from the RPC when not provided (fork-from-active)", async () => {
        sessionForkSession.mockResolvedValue({
            claudeSessionId: "c",
            path: "/p",
        });
        machineSpawnNewSession.mockResolvedValue({ type: "success", sessionId: "s" });

        await forkSessionFromMessage(baseInput);

        expect(sessionForkSession).toHaveBeenCalledWith("src-1", {});
    });

    it("surfaces a spawn error as an error outcome", async () => {
        sessionForkSession.mockResolvedValue({ claudeSessionId: "c", path: "/p" });
        machineSpawnNewSession.mockResolvedValue({
            type: "error",
            errorMessage: "spawn boom",
        });

        const out = await forkSessionFromMessage(baseInput);

        expect(out).toEqual({ type: "error", errorMessage: "spawn boom" });
    });

    describe("directory-approval retry sub-machine", () => {
        beforeEach(() => {
            sessionForkSession.mockResolvedValue({ claudeSessionId: "c", path: "/p" });
        });

        it("returns a retry closure when the daemon asks to approve directory creation", async () => {
            machineSpawnNewSession.mockResolvedValueOnce({
                type: "requestToApproveDirectoryCreation",
                directory: "/p",
            });

            const out = await forkSessionFromMessage(baseInput);

            expect(out.type).toBe("requestToApproveDirectoryCreation");
            if (out.type !== "requestToApproveDirectoryCreation") throw new Error("unreachable");
            expect(out.directory).toBe("/p");
            expect(typeof out.retry).toBe("function");
        });

        it("retry re-spawns with approval flag and succeeds", async () => {
            machineSpawnNewSession
                .mockResolvedValueOnce({
                    type: "requestToApproveDirectoryCreation",
                    directory: "/p",
                })
                .mockResolvedValueOnce({ type: "success", sessionId: "happy-retry" });

            const out = await forkSessionFromMessage(baseInput);
            if (out.type !== "requestToApproveDirectoryCreation") throw new Error("unreachable");

            const retryOut = await out.retry();

            expect(retryOut).toEqual({ type: "success", sessionId: "happy-retry" });
            expect(machineSpawnNewSession).toHaveBeenLastCalledWith(
                expect.objectContaining({ approvedNewDirectoryCreation: true }),
            );
        });

        it("retry honors an approved directory override", async () => {
            machineSpawnNewSession
                .mockResolvedValueOnce({
                    type: "requestToApproveDirectoryCreation",
                    directory: "/p",
                })
                .mockResolvedValueOnce({ type: "success", sessionId: "s" });

            const out = await forkSessionFromMessage(baseInput);
            if (out.type !== "requestToApproveDirectoryCreation") throw new Error("unreachable");

            await out.retry("/approved/dir");

            expect(machineSpawnNewSession).toHaveBeenLastCalledWith(
                expect.objectContaining({ directory: "/approved/dir" }),
            );
        });

        it("retry surfaces a persistent approval request as an error (no infinite loop)", async () => {
            machineSpawnNewSession
                .mockResolvedValueOnce({
                    type: "requestToApproveDirectoryCreation",
                    directory: "/p",
                })
                .mockResolvedValueOnce({
                    type: "requestToApproveDirectoryCreation",
                    directory: "/p",
                });

            const out = await forkSessionFromMessage(baseInput);
            if (out.type !== "requestToApproveDirectoryCreation") throw new Error("unreachable");

            const retryOut = await out.retry();

            expect(retryOut.type).toBe("error");
        });

        it("retry surfaces a spawn error", async () => {
            machineSpawnNewSession
                .mockResolvedValueOnce({
                    type: "requestToApproveDirectoryCreation",
                    directory: "/p",
                })
                .mockResolvedValueOnce({ type: "error", errorMessage: "retry boom" });

            const out = await forkSessionFromMessage(baseInput);
            if (out.type !== "requestToApproveDirectoryCreation") throw new Error("unreachable");

            expect(await out.retry()).toEqual({ type: "error", errorMessage: "retry boom" });
        });
    });
});
