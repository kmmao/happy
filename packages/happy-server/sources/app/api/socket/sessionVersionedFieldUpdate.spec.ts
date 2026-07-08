import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock, updateManyMock, emitMock } = vi.hoisted(() => ({
    findUniqueMock: vi.fn(),
    updateManyMock: vi.fn(),
    emitMock: vi.fn(),
}));

vi.mock("@/storage/db", () => ({
    db: { session: { findUnique: findUniqueMock, updateMany: updateManyMock } },
}));
vi.mock("@/app/events/syncUpdate", () => ({ emitSyncUpdate: emitMock }));

import { sessionVersionedFieldUpdate } from "./sessionVersionedFieldUpdate";

describe("sessionVersionedFieldUpdate", () => {
    beforeEach(() => {
        findUniqueMock.mockReset();
        updateManyMock.mockReset().mockResolvedValue({ count: 1 });
        emitMock.mockReset();
    });

    it("preferences: CAS at expected version, emits preferences slot, acks success", async () => {
        findUniqueMock.mockResolvedValue({ preferencesVersion: 2, preferences: "old" });
        const cb = vi.fn();
        await sessionVersionedFieldUpdate({ userId: "u", sid: "s", field: "preferences", value: "new", expectedVersion: 2, callback: cb });

        const write = updateManyMock.mock.calls[0][0];
        expect(write.where.preferencesVersion).toBe(2);
        expect(write.data).toMatchObject({ preferences: "new", preferencesVersion: 3 });
        expect(emitMock).toHaveBeenCalledWith("u", { t: "update-session", sessionId: "s", preferences: { value: "new", version: 3 } });
        expect(cb).toHaveBeenCalledWith({ result: "success", version: 3, preferences: "new" });
    });

    it("metadata: emits metadata slot (regression — folding preferences did not disturb it)", async () => {
        findUniqueMock.mockResolvedValue({ metadataVersion: 4, metadata: "m0" });
        const cb = vi.fn();
        await sessionVersionedFieldUpdate({ userId: "u", sid: "s", field: "metadata", value: "m1", expectedVersion: 4, callback: cb });

        expect(emitMock).toHaveBeenCalledWith("u", { t: "update-session", sessionId: "s", metadata: { value: "m1", version: 5 } });
        expect(cb).toHaveBeenCalledWith({ result: "success", version: 5, metadata: "m1" });
    });

    it("preferences stale version -> version-mismatch echo, no write", async () => {
        findUniqueMock.mockResolvedValue({ preferencesVersion: 7, preferences: "server" });
        const cb = vi.fn();
        await sessionVersionedFieldUpdate({ userId: "u", sid: "s", field: "preferences", value: "x", expectedVersion: 3, callback: cb });

        expect(updateManyMock).not.toHaveBeenCalled();
        expect(cb).toHaveBeenCalledWith({ result: "version-mismatch", version: 7, preferences: "server" });
    });

    it("preferences concurrent writer wins -> re-read reports the winner (not the stale read)", async () => {
        findUniqueMock
            .mockResolvedValueOnce({ preferencesVersion: 3, preferences: "old" })
            .mockResolvedValueOnce({ preferencesVersion: 4, preferences: "raced" });
        updateManyMock.mockResolvedValue({ count: 0 });
        const cb = vi.fn();
        await sessionVersionedFieldUpdate({ userId: "u", sid: "s", field: "preferences", value: "x", expectedVersion: 3, callback: cb });

        expect(cb).toHaveBeenCalledWith({ result: "version-mismatch", version: 4, preferences: "raced" });
    });

    it("missing session -> error ack", async () => {
        findUniqueMock.mockResolvedValue(null);
        const cb = vi.fn();
        await sessionVersionedFieldUpdate({ userId: "u", sid: "s", field: "preferences", value: "x", expectedVersion: 1, callback: cb });

        expect(cb).toHaveBeenCalledWith({ result: "error" });
    });
});
