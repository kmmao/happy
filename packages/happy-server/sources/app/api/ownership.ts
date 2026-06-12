import { db } from "@/storage/db";

/**
 * Ownership loading seam.
 *
 * Every Account-owned entity that routes load by id goes through one of these
 * loaders. The loader owns the full interface of "load by id with ownership":
 * the ownership predicate ({ id, accountId }), the error mode (404 with the
 * legacy flat body { error: "<Entity> not found" }, preserved via the
 * OwnedEntityNotFound branch in enableErrorHandlers), and the return type
 * (the full row). Routes that need a custom select/include or a non-standard
 * error body keep a hand-rolled query instead of widening this interface.
 */
export class OwnedEntityNotFound extends Error {
    readonly statusCode = 404;
    constructor(label: string) {
        super(`${label} not found`);
        this.name = "OwnedEntityNotFound";
    }
}

export async function ownedProject(accountId: string, projectId: string) {
    const row = await db.project.findFirst({ where: { id: projectId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Project");
    return row;
}

export async function ownedSession(accountId: string, sessionId: string) {
    const row = await db.session.findFirst({ where: { id: sessionId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Session");
    return row;
}

export async function ownedMachine(accountId: string, machineId: string) {
    const row = await db.machine.findFirst({ where: { id: machineId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Machine");
    return row;
}

export async function ownedTask(accountId: string, taskId: string) {
    const row = await db.task.findFirst({ where: { id: taskId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Task");
    return row;
}

export async function ownedArtifact(accountId: string, artifactId: string) {
    const row = await db.artifact.findFirst({ where: { id: artifactId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Artifact");
    return row;
}

export async function ownedSkill(accountId: string, skillId: string) {
    const row = await db.skill.findFirst({ where: { id: skillId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Skill");
    return row;
}

export async function ownedTriggerSchedule(accountId: string, triggerScheduleId: string) {
    const row = await db.triggerSchedule.findFirst({ where: { id: triggerScheduleId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Trigger schedule");
    return row;
}

export async function ownedWebhookTrigger(accountId: string, webhookTriggerId: string) {
    const row = await db.webhookTrigger.findFirst({ where: { id: webhookTriggerId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Webhook trigger");
    return row;
}

export async function ownedAgentLoop(accountId: string, agentLoopId: string) {
    const row = await db.agentLoop.findFirst({ where: { id: agentLoopId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Loop");
    return row;
}

export async function ownedSupervisorRun(accountId: string, supervisorRunId: string) {
    const row = await db.supervisorRun.findFirst({ where: { id: supervisorRunId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Supervisor run");
    return row;
}

export async function ownedSupervisorAction(accountId: string, supervisorActionId: string) {
    const row = await db.supervisorAction.findFirst({ where: { id: supervisorActionId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Action");
    return row;
}

export async function ownedSupervisorDimension(accountId: string, supervisorDimensionId: string) {
    const row = await db.supervisorDimension.findFirst({ where: { id: supervisorDimensionId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Dimension");
    return row;
}

export async function ownedAiBackendProfile(accountId: string, profileId: string) {
    const row = await db.aiBackendProfile.findFirst({ where: { id: profileId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Profile");
    return row;
}

export async function ownedProvisionToken(accountId: string, tokenId: string) {
    const row = await db.provisionToken.findFirst({ where: { id: tokenId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Token");
    return row;
}

export async function ownedWebhookRoute(accountId: string, webhookRouteId: string) {
    const row = await db.webhookRoute.findFirst({ where: { id: webhookRouteId, accountId } });
    if (!row) throw new OwnedEntityNotFound("Route");
    return row;
}

// ─── Existence-only variants ────────────────────────────────────────────────
// Same ownership predicate and error mode as the loaders above, but they fetch
// nothing (select: { id: true }) and return void. Use these when the route
// only needs the 404 guard — the full-row loaders pull every column, which on
// hot paths (message pagination, knowledge two-step checks) means shipping
// large encrypted text columns (Session.metadata/agentState,
// Project.metadata/supervisorConfig) that the handler never reads.

export async function assertOwnedProject(accountId: string, projectId: string): Promise<void> {
    const row = await db.project.findFirst({ where: { id: projectId, accountId }, select: { id: true } });
    if (!row) throw new OwnedEntityNotFound("Project");
}

export async function assertOwnedSession(accountId: string, sessionId: string): Promise<void> {
    const row = await db.session.findFirst({ where: { id: sessionId, accountId }, select: { id: true } });
    if (!row) throw new OwnedEntityNotFound("Session");
}

export async function assertOwnedMachine(accountId: string, machineId: string): Promise<void> {
    const row = await db.machine.findFirst({ where: { id: machineId, accountId }, select: { id: true } });
    if (!row) throw new OwnedEntityNotFound("Machine");
}

export async function assertOwnedArtifact(accountId: string, artifactId: string): Promise<void> {
    const row = await db.artifact.findFirst({ where: { id: artifactId, accountId }, select: { id: true } });
    if (!row) throw new OwnedEntityNotFound("Artifact");
}

export async function assertOwnedProvisionToken(accountId: string, tokenId: string): Promise<void> {
    const row = await db.provisionToken.findFirst({ where: { id: tokenId, accountId }, select: { id: true } });
    if (!row) throw new OwnedEntityNotFound("Token");
}
