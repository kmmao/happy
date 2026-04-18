import { describe, expect, it } from "vitest";

import type { Machine } from "@/sync/storageTypes";
import { resolveCliSelfUpgradeSupport } from "./cliSelfUpgradeSupport";

function createMachine(
    overrides: Partial<Machine> = {},
): Machine {
    return {
        id: "machine-1",
        active: true,
        activeAt: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        rpcReady: true,
        metadataVersion: 1,
        metadata: {
            displayName: "HomeMac",
        },
        daemonState: {
            startedWithCliVersion: "0.71.43",
            status: "running",
        },
        daemonStateVersion: 1,
        ...overrides,
    } as Machine;
}

describe("resolveCliSelfUpgradeSupport", () => {
    it("allows self-upgrade for supported npm global installs", () => {
        const result = resolveCliSelfUpgradeSupport(
            createMachine({
                daemonState: {
                    startedWithCliVersion: "0.71.43",
                    status: "running",
                    cliInstall: {
                        source: "npm-global",
                        canSelfUpgrade: true,
                    },
                },
            }),
        );

        expect(result).toEqual({
            canSelfUpgrade: true,
            reason: null,
        });
    });

    it("blocks self-upgrade for local-source installs", () => {
        const result = resolveCliSelfUpgradeSupport(
            createMachine({
                daemonState: {
                    startedWithCliVersion: "0.71.43",
                    status: "running",
                    cliInstall: {
                        source: "local-source",
                        canSelfUpgrade: false,
                    },
                },
            }),
        );

        expect(result).toEqual({
            canSelfUpgrade: false,
            reason: "local-source",
        });
    });

    it("treats missing install info as legacy unsupported CLI", () => {
        const result = resolveCliSelfUpgradeSupport(createMachine());

        expect(result).toEqual({
            canSelfUpgrade: false,
            reason: "legacy-cli",
        });
    });
});
