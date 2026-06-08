import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { auth } from "@/app/auth/auth";
import { resolveConfiguredSupervisorProfile } from "@/modules/supervisorConfiguredProfile";

interface SupervisorFixActionTriggerInput {
    title: string;
    description: string;
    suggestedFix: string | null;
    category: string;
    severity: string;
    issueNumber?: number;
}

interface EmitConfiguredSupervisorFixTriggerInput {
    userId: string;
    projectId: string;
    actionId: string;
    machineId: string;
    repoPath: string;
    supervisorConfig: string | null;
    fixStrategy?: string | null;
    mode?: string;
    fixMode?: string;
    analyzeAutoFix?: boolean;
    maxConcurrentAnalysis?: number;
    maxConcurrentFix?: number;
    fixAction: SupervisorFixActionTriggerInput;
}

export async function emitConfiguredSupervisorFixTrigger(
    input: EmitConfiguredSupervisorFixTriggerInput,
): Promise<void> {
    const resolved = await resolveConfiguredSupervisorProfile({
        userId: input.userId,
        supervisorConfig: input.supervisorConfig,
    });
    if (!resolved.ok) {
        throw new Error(resolved.error);
    }
    const resolvedProfile = resolved.resolvedProfile;
    const callbackToken = await auth.createSupervisorCallbackToken({
        userId: input.userId,
        projectId: input.projectId,
        machineId: input.machineId,
        purpose: "fix-status",
        actionId: input.actionId,
    });

    await emitSyncEphemeral(input.userId, {
        t: "supervisor-trigger",
        projectId: input.projectId,
        runId: input.actionId,
        trigger: "fix",
        machineId: input.machineId,
        repoPath: input.repoPath,
        callbackToken,
        mode: input.mode,
        fixAction: input.fixAction,
        fixStrategy: input.fixStrategy ?? undefined,
        fixMode: input.fixMode,
        analyzeAutoFix: input.analyzeAutoFix,
        maxConcurrentAnalysis: input.maxConcurrentAnalysis,
        maxConcurrentFix: input.maxConcurrentFix,
        runtimeProfile: resolvedProfile.runtimeProfile,
    });
}
