import type { Machine } from "@/sync/storageTypes";

export type CliSelfUpgradeBlockReason =
    | "legacy-cli"
    | "local-source"
    | "unknown";

export interface CliSelfUpgradeSupport {
    canSelfUpgrade: boolean;
    reason: CliSelfUpgradeBlockReason | null;
}

export function resolveCliSelfUpgradeSupport(
    machine: Machine | null | undefined,
): CliSelfUpgradeSupport {
    const installInfo = machine?.daemonState?.cliInstall;

    if (!installInfo) {
        return {
            canSelfUpgrade: false,
            reason: "legacy-cli",
        };
    }

    if (installInfo.canSelfUpgrade) {
        return {
            canSelfUpgrade: true,
            reason: null,
        };
    }

    if (installInfo.source === "local-source") {
        return {
            canSelfUpgrade: false,
            reason: "local-source",
        };
    }

    return {
        canSelfUpgrade: false,
        reason: "unknown",
    };
}
