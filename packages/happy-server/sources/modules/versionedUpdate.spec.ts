import { describe, expect, it, vi } from "vitest";
import { versionedUpdate } from "./versionedUpdate";

describe("versionedUpdate", () => {
    it("applies and reports the next version on a matching expected version", async () => {
        const write = vi.fn(async () => 1);
        const result = await versionedUpdate<string>({
            expectedVersion: 3,
            read: async () => ({ version: 3, value: "before" }),
            write,
        });
        expect(result).toEqual({ applied: true, newVersion: 4 });
        expect(write).toHaveBeenCalledWith(3);
    });

    it("returns not-found when the row is missing", async () => {
        const write = vi.fn(async () => 1);
        const result = await versionedUpdate<string>({
            expectedVersion: 0,
            read: async () => null,
            write,
        });
        expect(result).toEqual({ applied: false, reason: "not-found" });
        expect(write).not.toHaveBeenCalled();
    });

    it("rejects a stale expected version before writing", async () => {
        const write = vi.fn(async () => 1);
        const result = await versionedUpdate<string>({
            expectedVersion: 2,
            read: async () => ({ version: 5, value: "current" }),
            write,
        });
        expect(result).toEqual({
            applied: false,
            reason: "version-mismatch",
            currentVersion: 5,
            currentValue: "current",
        });
        expect(write).not.toHaveBeenCalled();
    });

    it("re-reads and reports the winner when a concurrent write loses the guard", async () => {
        // read #1 sees the expected version, the guarded write matches 0 rows
        // (someone else won), read #2 reports whoever landed.
        const read = vi.fn<() => Promise<{ version: number; value: string } | null>>()
            .mockResolvedValueOnce({ version: 7, value: "mine" })
            .mockResolvedValueOnce({ version: 8, value: "theirs" });
        const result = await versionedUpdate<string>({
            expectedVersion: 7,
            read,
            write: async () => 0,
        });
        expect(result).toEqual({
            applied: false,
            reason: "version-mismatch",
            currentVersion: 8,
            currentValue: "theirs",
        });
        expect(read).toHaveBeenCalledTimes(2);
    });

    it("returns not-found when the row vanishes between write and re-read", async () => {
        const read = vi.fn<() => Promise<{ version: number; value: string } | null>>()
            .mockResolvedValueOnce({ version: 1, value: "mine" })
            .mockResolvedValueOnce(null);
        const result = await versionedUpdate<string>({
            expectedVersion: 1,
            read,
            write: async () => 0,
        });
        expect(result).toEqual({ applied: false, reason: "not-found" });
    });

    it("carries a null value through the mismatch result", async () => {
        const result = await versionedUpdate<string | null>({
            expectedVersion: 0,
            read: async () => ({ version: 2, value: null }),
            write: async () => 1,
        });
        expect(result).toEqual({
            applied: false,
            reason: "version-mismatch",
            currentVersion: 2,
            currentValue: null,
        });
    });
});
