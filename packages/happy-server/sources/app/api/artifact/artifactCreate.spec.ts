import { beforeEach, describe, expect, it, vi } from "vitest";
import * as privacyKit from "privacy-kit";

// In-memory `db.artifact` (findUnique/create) over `state.artifacts`, so the
// intake rule is exercised through its interface (input → result + broadcast)
// without Prisma.
const { dbMock, emitMock, resetState, seedArtifact } = vi.hoisted(() => {
    const state = { artifacts: [] as any[] };
    const resetState = () => {
        state.artifacts = [];
    };
    const seedArtifact = (input: { id: string; accountId: string }) => {
        state.artifacts.push({
            id: input.id,
            accountId: input.accountId,
            header: new Uint8Array([1]),
            headerVersion: 1,
            body: new Uint8Array([2]),
            bodyVersion: 1,
            dataEncryptionKey: new Uint8Array([3]),
            seq: 0,
            createdAt: new Date(0),
            updatedAt: new Date(0),
        });
    };

    const dbMock = {
        artifact: {
            findUnique: vi.fn(async ({ where }: any) =>
                state.artifacts.find((a) => a.id === where.id) ?? null,
            ),
            create: vi.fn(async ({ data }: any) => {
                const row = {
                    ...data,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                };
                state.artifacts.push(row);
                return row;
            }),
        },
    };

    const emitMock = vi.fn(async () => {});

    return { dbMock, emitMock, resetState, seedArtifact, state };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/app/events/syncUpdate", () => ({ emitSyncUpdate: emitMock }));

import { artifactCreate } from "./artifactCreate";

const b64 = (s: string) => privacyKit.encodeBase64(new TextEncoder().encode(s));

describe("artifactCreate", () => {
    const accountId = "user-1";

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it("creates a new artifact with the fixed initial shape and broadcasts new-artifact", async () => {
        const result = await artifactCreate({
            accountId,
            id: "a1",
            header: b64("h"),
            body: b64("b"),
            dataEncryptionKey: b64("k"),
        });

        expect(result.status).toBe("created");
        if (result.status !== "created") throw new Error("unreachable");
        expect(result.artifact.headerVersion).toBe(1);
        expect(result.artifact.bodyVersion).toBe(1);
        expect(result.artifact.seq).toBe(0);
        expect(result.artifact.accountId).toBe(accountId);
        // Base64 payloads decoded to bytes.
        expect(Array.from(result.artifact.header as Uint8Array)).toEqual(
            Array.from(new TextEncoder().encode("h")),
        );

        expect(emitMock).toHaveBeenCalledTimes(1);
        expect(emitMock).toHaveBeenCalledWith(accountId, {
            t: "new-artifact",
            artifact: result.artifact,
        });
    });

    it("returns the existing row idempotently (no create, no broadcast) for the same account", async () => {
        seedArtifact({ id: "a1", accountId });

        const result = await artifactCreate({
            accountId,
            id: "a1",
            header: b64("h"),
            body: b64("b"),
            dataEncryptionKey: b64("k"),
        });

        expect(result.status).toBe("existing");
        expect(dbMock.artifact.create).not.toHaveBeenCalled();
        expect(emitMock).not.toHaveBeenCalled();
    });

    it("returns conflict when the id belongs to a different account (no create, no broadcast)", async () => {
        seedArtifact({ id: "a1", accountId: "someone-else" });

        const result = await artifactCreate({
            accountId,
            id: "a1",
            header: b64("h"),
            body: b64("b"),
            dataEncryptionKey: b64("k"),
        });

        expect(result.status).toBe("conflict");
        expect(dbMock.artifact.create).not.toHaveBeenCalled();
        expect(emitMock).not.toHaveBeenCalled();
    });
});
