import {
    machineCreateAgentLoopBootstrapProfile,
    machineCreateAutoDreamProfile,
    type MachineAgentLoopBootstrapProfile,
    type MachineAutoDreamProfile,
} from "@/sync/ops";
import { normalizeMachineRootPath, parseIntervalMs } from "./loopsUtils";

const BOOTSTRAP_INTERVAL_MS = parseIntervalMs("6h")!;
const AUTO_DREAM_INTERVAL_MS = parseIntervalMs("12h")!;

function hasProfileForRoot(
    profiles: ReadonlyArray<{ rootDirectory: string }>,
    normRoot: string,
): boolean {
    return profiles.some((p) => normalizeMachineRootPath(p.rootDirectory) === normRoot);
}

export type MachineAutomationOutcome = "created" | "already" | "bad_root";

export interface EnsureMachineAutomationOptions {
    /** Default true. One-click flow sets false — scan already covers new repos; Bootstrap is optional scheduled re-scan. */
    readonly createBootstrap?: boolean;
    /** Default true. */
    readonly createAutoDream?: boolean;
}

export async function ensureMachineAutomationProfiles(
    machineId: string,
    rootDirectory: string,
    existingBootstrap: ReadonlyArray<MachineAgentLoopBootstrapProfile>,
    existingAutoDream: ReadonlyArray<MachineAutoDreamProfile>,
    options?: EnsureMachineAutomationOptions,
): Promise<{
    outcome: MachineAutomationOutcome;
    bootstrapCreated: boolean;
    autoDreamCreated: boolean;
    normalizedRoot: string;
    errorMessages: string[];
}> {
    const normRoot = normalizeMachineRootPath(rootDirectory);
    const errorMessages: string[] = [];
    if (!normRoot || normRoot === "/") {
        return {
            outcome: "bad_root",
            bootstrapCreated: false,
            autoDreamCreated: false,
            normalizedRoot: normRoot,
            errorMessages,
        };
    }

    const createBootstrap = options?.createBootstrap !== false;
    const createAutoDream = options?.createAutoDream !== false;

    const hadBootstrap = hasProfileForRoot(existingBootstrap, normRoot);
    const hadDream = hasProfileForRoot(existingAutoDream, normRoot);
    let bootstrapCreated = false;
    let autoDreamCreated = false;

    if (createBootstrap && !hadBootstrap) {
        const r = await machineCreateAgentLoopBootstrapProfile(machineId, {
            rootDirectory: normRoot,
            intervalMs: BOOTSTRAP_INTERVAL_MS,
            agent: "claude",
            autoRunCreatedLoops: false,
            runNow: false,
        });
        if (r.success) {
            bootstrapCreated = true;
        } else if (r.errorMessage) {
            errorMessages.push(r.errorMessage);
        }
    }

    if (createAutoDream && !hadDream) {
        const r = await machineCreateAutoDreamProfile(machineId, {
            rootDirectory: normRoot,
            intervalMs: AUTO_DREAM_INTERVAL_MS,
            runNow: false,
        });
        if (r.success) {
            autoDreamCreated = true;
        } else if (r.errorMessage) {
            errorMessages.push(r.errorMessage);
        }
    }

    const outcome: MachineAutomationOutcome =
        bootstrapCreated || autoDreamCreated ? "created" : "already";

    return {
        outcome,
        bootstrapCreated,
        autoDreamCreated,
        normalizedRoot: normRoot,
        errorMessages,
    };
}
