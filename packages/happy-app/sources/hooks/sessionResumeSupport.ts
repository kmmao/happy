import type { Machine, Session } from "@/sync/storageTypes";
import { isMachineOnline } from "@/utils/machineUtils";

export interface SessionResumeBaseSpawnOptions {
    machineId: string;
    directory: string;
    happySessionId: string;
    agent: "claude" | "codex";
    claudeSessionId?: string;
}

export interface SessionResumeContext {
    baseSpawnOptions: SessionResumeBaseSpawnOptions;
}

export type SessionReactivationMode =
    | "resume"
    | "unarchive";

export interface SessionReactivationContext {
    mode: SessionReactivationMode;
    resumeContext?: SessionResumeContext;
}

function resolveSessionFlavor(
    session: Session,
): "claude" | "codex" | null {
    const rawFlavor = session.metadata?.flavor;
    if (rawFlavor === "codex") {
        return "codex";
    }
    if (!rawFlavor || rawFlavor === "claude") {
        return "claude";
    }
    return null;
}

export function resolveSessionResumeContext(
    session: Session,
    machine: Machine | null | undefined,
): SessionResumeContext | null {
    const machineId = session.metadata?.machineId;
    const directory = session.metadata?.path;
    const flavor = resolveSessionFlavor(session);

    if (
        session.active
        || !machine
        || !isMachineOnline(machine)
        || !machineId
        || !directory
        || !flavor
    ) {
        return null;
    }

    if (flavor === "claude") {
        const claudeSessionId = session.metadata?.claudeSessionId;
        if (!claudeSessionId) {
            return null;
        }

        return {
            baseSpawnOptions: {
                machineId,
                directory,
                happySessionId: session.id,
                agent: "claude",
                claudeSessionId,
            },
        };
    }

    const threadId = session.metadata?.codex?.threadId;
    const resolvedBackend = session.metadata?.codex?.resolvedBackend;
    if (!threadId || resolvedBackend === "codex-mcp-legacy") {
        return null;
    }

    return {
        baseSpawnOptions: {
            machineId,
            directory,
            happySessionId: session.id,
            agent: "codex",
        },
    };
}

export function resolveSessionReactivationContext(
    session: Session,
    machine: Machine | null | undefined,
): SessionReactivationContext | null {
    const resumeContext = resolveSessionResumeContext(session, machine);
    if (resumeContext) {
        return {
            mode: "resume",
            resumeContext,
        };
    }

    if (!session.active) {
        return {
            mode: "unarchive",
        };
    }

    return null;
}
