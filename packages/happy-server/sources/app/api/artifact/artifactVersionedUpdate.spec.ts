import { beforeEach, describe, expect, it, vi } from "vitest";
import * as privacyKit from "privacy-kit";

// A tiny in-memory `db.artifact` whose findFirst/updateMany operate over
// `state.artifacts`, so the two-field CAS is exercised through its interface
// (input → result) without Prisma. updateMany honours the guarded `where` so we
// can drive the lost-race (`count === 0`) path directly.
const { dbMock, resetState, seedArtifact, state } = vi.hoisted(() => {
    const state = { artifacts: [] as any[] };
    const resetState = () => {
        state.artifacts = [];
    };
    const seedArtifact = (input: {
        id: string;
        accountId: string;
        header: Uint8Array;
        headerVersion: number;
        body: Uint8Array;
        bodyVersion: number;
        seq: number;
    }) => {
        state.artifacts.push({ ...input });
    };

    const matches = (a: any, where: any) =>
        a.id === where.id &&
        a.accountId === where.accountId &&
        (where.headerVersion === undefined || a.headerVersion === where.headerVersion) &&
        (where.bodyVersion === undefined || a.bodyVersion === where.bodyVersion);

    const dbMock = {
        artifact: {
            findFirst: vi.fn(async ({ where }: any) =>
                state.artifacts.find(
                    (a) => a.id === where.id && a.accountId === where.accountId,
                ) ?? null,
            ),
            updateMany: vi.fn(async ({ where, data }: any) => {
                const artifact = state.artifacts.find((a) => matches(a, where));
                if (!artifact) return { count: 0 };
                Object.assign(artifact, data);
                return { count: 1 };
            }),
        },
    };

    return { dbMock, resetState, seedArtifact, state };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));

import { artifactVersionedUpdate } from "./artifactVersionedUpdate";

// Helpers: the module speaks base64 at its interface but stores raw bytes.
const b64 = (s: string) => privacyKit.encodeBase64(new TextEncoder().encode(s));
const bytes = (s: string) => new TextEncoder().encode(s);

describe("artifactVersionedUpdate", () => {
    const userId = "user-1";

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it("returns not-found when no artifact matches the user, without writing", async () => {
        seedArtifact({
            id: "a1",
            accountId: "someone-else",
            header: bytes("h"),
            headerVersion: 1,
            body: bytes("b"),
            bodyVersion: 1,
            seq: 0,
        });

        const result = await artifactVersionedUpdate({
            artifactId: "a1",
            userId,
            header: { data: b64("new"), expectedVersion: 1 },
        });

        expect(result).toEqual({ applied: false, reason: "not-found" });
        expect(dbMock.artifact.updateMany).not.toHaveBeenCalled();
    });

    it("applies a header-only update, bumps headerVersion + seq, leaves body untouched", async () => {
        seedArtifact({
            id: "a1",
            accountId: userId,
            header: bytes("old-header"),
            headerVersion: 4,
            body: bytes("body"),
            bodyVersion: 2,
            seq: 7,
        });

        const result = await artifactVersionedUpdate({
            artifactId: "a1",
            userId,
            header: { data: b64("new-header"), expectedVersion: 4 },
        });

        expect(result).toEqual({ applied: true, seq: 8, headerVersion: 5 });
        const stored = state.artifacts[0];
        expect(stored.headerVersion).toBe(5);
        expect(stored.bodyVersion).toBe(2); // untouched
        expect(new TextDecoder().decode(stored.header)).toBe("new-header");
        expect(stored.seq).toBe(8);
    });

    it("applies a two-field update atomically, bumping both versions in one write", async () => {
        seedArtifact({
            id: "a1",
            accountId: userId,
            header: bytes("h0"),
            headerVersion: 1,
            body: bytes("b0"),
            bodyVersion: 1,
            seq: 0,
        });

        const result = await artifactVersionedUpdate({
            artifactId: "a1",
            userId,
            header: { data: b64("h1"), expectedVersion: 1 },
            body: { data: b64("b1"), expectedVersion: 1 },
        });

        expect(result).toEqual({ applied: true, seq: 1, headerVersion: 2, bodyVersion: 2 });
        expect(dbMock.artifact.updateMany).toHaveBeenCalledTimes(1);
        const stored = state.artifacts[0];
        expect(stored.headerVersion).toBe(2);
        expect(stored.bodyVersion).toBe(2);
        expect(new TextDecoder().decode(stored.header)).toBe("h1");
        expect(new TextDecoder().decode(stored.body)).toBe("b1");
    });

    it("rejects before writing and echoes only the field whose expectedVersion is stale", async () => {
        seedArtifact({
            id: "a1",
            accountId: userId,
            header: bytes("current-header"),
            headerVersion: 9,
            body: bytes("current-body"),
            bodyVersion: 3,
            seq: 0,
        });

        const result = await artifactVersionedUpdate({
            artifactId: "a1",
            userId,
            header: { data: b64("x"), expectedVersion: 4 }, // stale
            body: { data: b64("y"), expectedVersion: 3 }, // current
        });

        expect(result).toEqual({
            applied: false,
            reason: "version-mismatch",
            header: { currentVersion: 9, currentData: b64("current-header") },
        });
        expect(dbMock.artifact.updateMany).not.toHaveBeenCalled();
    });

    it("loses the guarded race (count === 0) and re-reads the winner for every attempted field", async () => {
        seedArtifact({
            id: "a1",
            accountId: userId,
            header: bytes("h-mine"),
            headerVersion: 5,
            body: bytes("b-mine"),
            bodyVersion: 5,
            seq: 0,
        });

        // Pre-write check passes (expectedVersion matches the seed), but a
        // concurrent writer slips in between read and guarded write: mutate the
        // stored versions just before updateMany so the guard matches 0 rows.
        const realUpdateMany = dbMock.artifact.updateMany.getMockImplementation()!;
        dbMock.artifact.updateMany.mockImplementationOnce(async (args: any) => {
            const a = state.artifacts[0];
            a.headerVersion = 6;
            a.header = bytes("h-theirs");
            a.bodyVersion = 6;
            a.body = bytes("b-theirs");
            return realUpdateMany(args);
        });

        const result = await artifactVersionedUpdate({
            artifactId: "a1",
            userId,
            header: { data: b64("h-new"), expectedVersion: 5 },
            body: { data: b64("b-new"), expectedVersion: 5 },
        });

        expect(result).toEqual({
            applied: false,
            reason: "version-mismatch",
            header: { currentVersion: 6, currentData: b64("h-theirs") },
            body: { currentVersion: 6, currentData: b64("b-theirs") },
        });
        expect(dbMock.artifact.findFirst).toHaveBeenCalledTimes(2); // initial + re-read
    });
});
