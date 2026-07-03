import { describe, it, expect, vi } from "vitest";
import { getSessionMachineIds } from "./getSessionMachineIds";

/** Minimal tx whose accessKey.findMany returns the seeded rows for `sessionId`. */
function makeTx(rows: Array<{ sessionId: string; machineId: string }>) {
    return {
        accessKey: {
            findMany: vi.fn(async ({ where }: any) =>
                rows
                    .filter((r) => r.sessionId === where.sessionId)
                    .map((r) => ({ machineId: r.machineId })),
            ),
        },
    } as any;
}

describe("getSessionMachineIds", () => {
    it("returns the distinct machine ids bound to the session", async () => {
        const tx = makeTx([
            { sessionId: "s1", machineId: "m1" },
            { sessionId: "s1", machineId: "m2" },
            { sessionId: "s1", machineId: "m1" }, // duplicate machine → deduped
            { sessionId: "s2", machineId: "m9" }, // other session → excluded
        ]);

        const ids = await getSessionMachineIds(tx, "s1");
        expect([...ids].sort()).toEqual(["m1", "m2"]);
    });

    it("returns an empty array when the session has no access keys", async () => {
        const tx = makeTx([{ sessionId: "other", machineId: "m1" }]);
        expect(await getSessionMachineIds(tx, "s1")).toEqual([]);
    });
});
