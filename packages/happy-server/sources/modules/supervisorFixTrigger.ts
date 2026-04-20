import {
    eventRouter,
    buildSupervisorTriggerEphemeral,
} from "@/app/events/eventRouter";
import { auth } from "@/app/auth/auth";
import {
    resolveConfiguredSupervisorProfile,
} from "@/modules/supervisorConfiguredProfile";

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

export async function resolveSupervisorProfileFromConfig(
    userId: string,
    supervisorConfig: string | null,
) {
    const result = await resolveConfiguredSupervisorProfile({
        userId,
        supervisorConfig,
    });
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.resolvedProfile;
}

export async function emitConfiguredSupervisorFixTrigger(
    input: EmitConfiguredSupervisorFixTriggerInput,
): Promise<void> {
    const resolvedProfile = await resolveSupervisorProfileFromConfig(
        input.userId,
        input.supervisorConfig,
    );
    const callbackToken = await auth.createSupervisorCallbackToken({
        userId: input.userId,
        projectId: input.projectId,
        machineId: input.machineId,
        purpose: "fix-status",
        actionId: input.actionId,
    });

    eventRouter.emitEphemeral({
        userId: input.userId,
        payload: buildSupervisorTriggerEphemeral({
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
        }),
        recipientFilter: {
            type: "machine-scoped-only",
            machineId: input.machineId,
        },
    });
}
