import type { Machine, Session } from "@/sync/storageTypes";
import { isMachineOnline } from "@/utils/machineUtils";
import { compareVersions } from "@/utils/versionUtils";

export interface SessionUpgradeBaseSpawnOptions {
    machineId: string;
    directory: string;
    happySessionId: string;
    agent: "claude" | "codex" | "gemini";
    claudeSessionId?: string;
}

export interface SessionUpgradeContext {
    machineCliVersion: string;
    baseSpawnOptions: SessionUpgradeBaseSpawnOptions;
}

function resolveSessionFlavor(session: Session): "claude" | "codex" | "gemini" | null {
    const rawFlavor = session.metadata?.flavor;
    if (rawFlavor === "codex" || rawFlavor === "gemini") {
        return rawFlavor;
    }
    if (!rawFlavor || rawFlavor === "claude") {
        return "claude";
    }
    return null;
}

/**
 * Returns the session upgrade context when we can safely restart the session
 * on the machine's newer CLI version while preserving the Happy session.
 *
 * Claude sessions require a resumable Claude session id.
 * Codex sessions require a resumable app-server thread id.
 * Other backends currently opt out until their resume semantics are proven.
 */
export function resolveSessionUpgradeContext(
    session: Session,
    machine: Machine | null | undefined,
): SessionUpgradeContext | null {
    const machineCliVersion = machine?.daemonState?.startedWithCliVersion;
    const sessionCliVersion = session.metadata?.version;
    const machineId = session.metadata?.machineId;
    const directory = session.metadata?.path;
    const flavor = resolveSessionFlavor(session);

    if (
        !session.active ||
        !machine ||
        !isMachineOnline(machine) ||
        !machineCliVersion ||
        !sessionCliVersion ||
        !machineId ||
        !directory ||
        !flavor ||
        compareVersions(sessionCliVersion, machineCliVersion) >= 0
    ) {
        return null;
    }

    if (flavor === "claude") {
        const claudeSessionId = session.metadata?.claudeSessionId;
        if (!claudeSessionId) {
            return null;
        }

        return {
            machineCliVersion,
            baseSpawnOptions: {
                machineId,
                directory,
                happySessionId: session.id,
                agent: "claude",
                claudeSessionId,
            },
        };
    }

    if (flavor === "codex") {
        const threadId = session.metadata?.codex?.threadId;
        const resolvedBackend = session.metadata?.codex?.resolvedBackend;
        if (!threadId || resolvedBackend === "codex-mcp-legacy") {
            return null;
        }

        return {
            machineCliVersion,
            baseSpawnOptions: {
                machineId,
                directory,
                happySessionId: session.id,
                agent: "codex",
            },
        };
    }

    return null;
}
