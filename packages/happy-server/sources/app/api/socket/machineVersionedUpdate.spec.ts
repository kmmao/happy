import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirstMock, updateManyMock, emitMock } = vi.hoisted(() => ({
    findFirstMock: vi.fn(),
    updateManyMock: vi.fn(),
    emitMock: vi.fn(),
}));

vi.mock("@/storage/db", () => ({
    db: { machine: { findFirst: findFirstMock, updateMany: updateManyMock } },
}));
vi.mock("@/app/events/syncUpdate", () => ({ emitSyncUpdate: emitMock }));

import { machineVersionedUpdate } from "./machineVersionedUpdate";

describe("machineVersionedUpdate", () => {
    beforeEach(() => {
        findFirstMock.mockReset();
        updateManyMock.mockReset().mockResolvedValue({ count: 1 });
        emitMock.mockReset();
    });

    it("metadata: CAS at expected version, emits metadata slot, acks success", async () => {
        findFirstMock.mockResolvedValue({ metadataVersion: 3, metadata: "old" });
        const cb = vi.fn();
        const r = await machineVersionedUpdate({ userId: "u", machineId: "m", field: "metadata", value: "new", expectedVersion: 3, callback: cb });

        const write = updateManyMock.mock.calls[0][0];
        expect(write.where.metadataVersion).toBe(3); // guarded by expected version
        expect(write.data).toMatchObject({ metadata: "new", metadataVersion: 4 });
        expect(write.data.active).toBeUndefined(); // metadata write must NOT touch liveness
        expect(emitMock).toHaveBeenCalledWith("u", { t: "update-machine", machineId: "m", metadata: { value: "new", version: 4 } });
        expect(cb).toHaveBeenCalledWith({ result: "success", version: 4, metadata: "new" });
        expect(r).toEqual({ applied: true, newVersion: 4 });
    });

    it("daemonState: write also flips active/lastActiveAt, emits daemonState slot", async () => {
        findFirstMock.mockResolvedValue({ daemonStateVersion: 2, daemonState: "old" });
        const cb = vi.fn();
        await machineVersionedUpdate({ userId: "u", machineId: "m", field: "daemonState", value: "s2", expectedVersion: 2, callback: cb });

        const write = updateManyMock.mock.calls[0][0];
        expect(write.where.daemonStateVersion).toBe(2);
        expect(write.data.daemonStateVersion).toBe(3);
        expect(write.data.active).toBe(true);
        expect(write.data.lastActiveAt).toBeInstanceOf(Date);
        expect(emitMock).toHaveBeenCalledWith("u", { t: "update-machine", machineId: "m", daemonState: { value: "s2", version: 3 } });
        expect(cb).toHaveBeenCalledWith({ result: "success", version: 3, daemonState: "s2" });
    });

    it("stale expected version -> version-mismatch echo, no write", async () => {
        findFirstMock.mockResolvedValue({ metadataVersion: 5, metadata: "server" });
        const cb = vi.fn();
        const r = await machineVersionedUpdate({ userId: "u", machineId: "m", field: "metadata", value: "x", expectedVersion: 3, callback: cb });

        expect(updateManyMock).not.toHaveBeenCalled();
        expect(cb).toHaveBeenCalledWith({ result: "version-mismatch", version: 5, metadata: "server" });
        expect(r.applied).toBe(false);
    });

    it("concurrent writer wins the guarded update -> re-read reports the winner", async () => {
        findFirstMock
            .mockResolvedValueOnce({ metadataVersion: 3, metadata: "old" }) // passes pre-check
            .mockResolvedValueOnce({ metadataVersion: 4, metadata: "raced" }); // re-read after count===0
        updateManyMock.mockResolvedValue({ count: 0 });
        const cb = vi.fn();
        const r = await machineVersionedUpdate({ userId: "u", machineId: "m", field: "metadata", value: "x", expectedVersion: 3, callback: cb });

        expect(cb).toHaveBeenCalledWith({ result: "version-mismatch", version: 4, metadata: "raced" });
        expect(r.applied).toBe(false);
    });

    it("missing machine -> error ack", async () => {
        findFirstMock.mockResolvedValue(null);
        const cb = vi.fn();
        const r = await machineVersionedUpdate({ userId: "u", machineId: "m", field: "metadata", value: "x", expectedVersion: 3, callback: cb });

        expect(cb).toHaveBeenCalledWith({ result: "error", message: "Machine not found" });
        expect(r.applied).toBe(false);
    });
});
