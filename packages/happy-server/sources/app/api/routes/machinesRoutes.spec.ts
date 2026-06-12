import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";

type MachineRecord = {
    id: string;
    accountId: string;
    metadata: string;
    metadataVersion: number;
    daemonState: string | null;
    daemonStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    seq: number;
    createdAt: Date;
    updatedAt: Date;
};

const {
    state,
    dbMock,
    emitUpdateMock,
    resetState,
    seedMachine,
} = vi.hoisted(() => {
    const state = {
        machines: [] as MachineRecord[],
        nextSeq: 1,
    };

    const resetState = () => {
        state.machines = [];
        state.nextSeq = 1;
    };

    const seedMachine = (input: Partial<MachineRecord> & Pick<MachineRecord, "id" | "accountId">) => {
        const now = new Date();
        state.machines.push({
            id: input.id,
            accountId: input.accountId,
            metadata: input.metadata ?? "encrypted-meta",
            metadataVersion: input.metadataVersion ?? 1,
            daemonState: input.daemonState ?? null,
            daemonStateVersion: input.daemonStateVersion ?? 0,
            dataEncryptionKey: input.dataEncryptionKey ?? null,
            active: input.active ?? false,
            lastActiveAt: input.lastActiveAt ?? now,
            seq: input.seq ?? 0,
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        });
    };

    const machineFindFirst = vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        return state.machines.find(
            (m) => m.id === where.id && m.accountId === where.accountId,
        ) ?? null;
    });

    const machineFindMany = vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        return state.machines.filter((m) => m.accountId === where.accountId);
    });

    const machineCreate = vi.fn(async (args: any) => {
        const now = new Date();
        const data = args?.data ?? {};
        const machine: MachineRecord = {
            id: data.id,
            accountId: data.accountId,
            metadata: data.metadata,
            metadataVersion: data.metadataVersion ?? 1,
            daemonState: data.daemonState ?? null,
            daemonStateVersion: data.daemonStateVersion ?? 0,
            dataEncryptionKey: data.dataEncryptionKey ?? null,
            active: data.active ?? false,
            lastActiveAt: now,
            seq: 0,
            createdAt: now,
            updatedAt: now,
        };
        state.machines.push(machine);
        return machine;
    });

    const dbMock = {
        machine: {
            findFirst: machineFindFirst,
            findMany: machineFindMany,
            create: machineCreate,
        },
    };

    const emitUpdateMock = vi.fn();

    return { state, dbMock, emitUpdateMock, resetState, seedMachine };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/utils/randomKeyNaked", () => ({ randomKeyNaked: vi.fn(() => "update-id") }));
vi.mock("@/storage/seq", () => ({ allocateUserSeq: vi.fn(async () => state.nextSeq++) }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { _emitUpdateInternal: emitUpdateMock },
    buildNewMachineUpdate: vi.fn((_m: unknown, seq: number, id: string) => ({ id, seq, body: { t: "new-machine" } })),
    buildUpdateMachineUpdate: vi.fn((_mid: string, seq: number, id: string) => ({ id, seq, body: { t: "update-machine" } })),
}));

import { machinesRoutes } from "./machinesRoutes";

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    typed.decorate("authenticate", async (request: any, reply: any) => {
        const userId = request.headers["x-user-id"];
        if (typeof userId !== "string") {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        request.userId = userId;
    });

    machinesRoutes(typed);
    await typed.ready();
    return typed;
}

describe("machinesRoutes", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        emitUpdateMock.mockClear();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    describe("POST /v1/machines", () => {
        it("returns existing machine if already registered", async () => {
            seedMachine({ id: "machine-1", accountId: "user-1", metadata: "enc-meta" });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/machines",
                headers: { "x-user-id": "user-1" },
                payload: { id: "machine-1", metadata: "enc-meta" },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.machine.id).toBe("machine-1");
            expect(emitUpdateMock).not.toHaveBeenCalled();
        });

        it("creates a new machine and emits events", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/machines",
                headers: { "x-user-id": "user-1" },
                payload: { id: "machine-new", metadata: "enc-meta" },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.machine.id).toBe("machine-new");
            // Emits both new-machine and update-machine events
            expect(emitUpdateMock).toHaveBeenCalledTimes(2);
        });

        it("returns 401 without auth header", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/machines",
                payload: { id: "machine-1", metadata: "enc-meta" },
            });

            expect(res.statusCode).toBe(401);
        });
    });

    describe("GET /v1/machines", () => {
        it("returns all machines for the user", async () => {
            seedMachine({ id: "m1", accountId: "user-1" });
            seedMachine({ id: "m2", accountId: "user-1" });
            seedMachine({ id: "m3", accountId: "user-2" });
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/machines",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.machines).toHaveLength(2);
            expect(body.nextCursor).toBeNull();
        });

        it("returns 401 without auth header", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/machines",
            });

            expect(res.statusCode).toBe(401);
        });
    });

    describe("GET /v1/machines/:id", () => {
        it("returns a single machine by id", async () => {
            seedMachine({ id: "m1", accountId: "user-1", metadata: "enc-data" });
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/machines/m1",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json().machine.id).toBe("m1");
        });

        it("returns 404 for non-existent machine", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/machines/no-such",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(404);
        });

        it("returns 404 for another user's machine", async () => {
            seedMachine({ id: "m1", accountId: "user-2" });
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/machines/m1",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(404);
        });
    });
});
