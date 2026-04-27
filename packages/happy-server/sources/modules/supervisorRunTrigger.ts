import {
    eventRouter,
    buildSupervisorTriggerEphemeral,
} from "@/app/events/eventRouter";
import { auth } from "@/app/auth/auth";
import {
    resolveConfiguredSupervisorProfile,
    type ResolveConfiguredSupervisorProfileInput,
    type ResolveConfiguredSupervisorProfileResult,
} from "@/modules/supervisorConfiguredProfile";
import { type ResolvedSupervisorProfile } from "@/modules/supervisorProfileResolver";

type ExistingActionSummary = {
    category: string;
    title: string;
    severity: string;
    approval: string;
    fixStatus: string | null;
};

type ResolveConfiguredSupervisorRunProfileInput =
    ResolveConfiguredSupervisorProfileInput;

type ResolveConfiguredSupervisorRunProfileResult =
    ResolveConfiguredSupervisorProfileResult;

interface EmitResolvedSupervisorRunTriggerInput {
    userId: string;
    projectId: string;
    runId: string;
    trigger: string;
    machineId: string;
    repoPath: string;
    resolvedProfile: ResolvedSupervisorProfile;
    mode?: string;
    dimensions?: string[];
    changedFiles?: string[];
    customRules?: string;
    customDimensions?: ReadonlyArray<{ key: string; title: string; prompt: string }>;
    researchParams?: string;
    existingActions?: readonly ExistingActionSummary[];
    maxConcurrentAnalysis?: number;
    maxConcurrentFix?: number;
    maxFindings?: number;
    /** Agent type to use. CLI infers from profile when absent. */
    agent?: string;
}

interface EmitConfiguredSupervisorRunTriggerInput
    extends Omit<EmitResolvedSupervisorRunTriggerInput, "resolvedProfile">,
        ResolveConfiguredSupervisorRunProfileInput {}

export async function resolveConfiguredSupervisorRunProfile(
    input: ResolveConfiguredSupervisorRunProfileInput,
): Promise<ResolveConfiguredSupervisorRunProfileResult> {
    return resolveConfiguredSupervisorProfile(input);
}

export async function emitResolvedSupervisorRunTrigger(
    input: EmitResolvedSupervisorRunTriggerInput,
): Promise<void> {
    const callbackToken = await auth.createSupervisorCallbackToken({
        userId: input.userId,
        projectId: input.projectId,
        machineId: input.machineId,
        purpose: "run-status",
        runId: input.runId,
    });

    eventRouter.emitEphemeral({
        userId: input.userId,
        payload: buildSupervisorTriggerEphemeral({
            projectId: input.projectId,
            runId: input.runId,
            trigger: input.trigger,
            machineId: input.machineId,
            repoPath: input.repoPath,
            callbackToken,
            mode: input.mode,
            dimensions: input.dimensions,
            changedFiles: input.changedFiles,
            customRules: input.customRules,
            customDimensions: input.customDimensions,
            researchParams: input.researchParams,
            existingActions: input.existingActions,
            maxConcurrentAnalysis: input.maxConcurrentAnalysis,
            maxConcurrentFix: input.maxConcurrentFix,
            maxFindings: input.maxFindings,
            runtimeProfile: input.resolvedProfile.runtimeProfile,
            agent: input.agent,
        }),
        recipientFilter: {
            type: "machine-scoped-only",
            machineId: input.machineId,
        },
    });
}

export async function emitConfiguredSupervisorRunTrigger(
    input: EmitConfiguredSupervisorRunTriggerInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const resolvedProfile = await resolveConfiguredSupervisorRunProfile(input);
    if (!resolvedProfile.ok) {
        return resolvedProfile;
    }

    await emitResolvedSupervisorRunTrigger({
        ...input,
        resolvedProfile: resolvedProfile.resolvedProfile,
    });
    return { ok: true };
}
