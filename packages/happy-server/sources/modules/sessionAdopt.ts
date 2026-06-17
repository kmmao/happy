/**
 * Session adopt — Phase 2 promote-in-place implementation.
 *
 * Per docs/plans/sessions-and-automation-ia.md §A6: a user takes an existing
 * Session that was started manually (or by automation pre-Workflow IA) and
 * binds it to an automation owner — an existing AgentLoop, a freshly-created
 * AgentLoop, or a freshly-created TriggerSchedule.
 *
 * This module owns the SERVER-SIDE half of the flow:
 *
 *  1. Validate session ownership (accountId).
 *  2. Resolve or create the automation owner per target.kind.
 *  3. Compute the AdoptedAutomationContext payload the client will
 *     stamp into Session.metadata.automationContext.
 *  4. Push a `session-adopted` ephemeral to the machine's daemon (when
 *     online) so GuardianSessionRegistry can resume the Session on the
 *     next trigger instead of spawning a fresh one.
 *
 * IMPORTANT — server NEVER decrypts `Session.metadata` (it's an opaque
 * encrypted blob owned by the clients). The actual metadata patch happens
 * on the client side: client reads the result here, merges automationContext
 * into its decrypted metadata, re-encrypts, and emits the existing
 * `update-metadata` socket event. That path emits `update-session` SyncUpdate
 * for cross-device fan-out.
 */

import { CronExpressionParser } from "cron-parser";
import * as wire from "@kmmao/happy-wire";
import { db } from "@/storage/db";
import { ownedSession, ownedAgentLoop } from "@/app/api/ownership";
import { createGenericAgentLoop } from "@/modules/agentLoopEngine";
import { eventRouter } from "@/app/events/eventRouter";
import { log } from "@/utils/log";

export type SessionAdoptOutcome =
    | {
          ok: true;
          response: wire.SessionAdoptResponse & { success: true };
      }
    | {
          ok: false;
          response: wire.SessionAdoptResponse & { success: false };
      };

/**
 * Drive a single sessionAdopt request end-to-end. The socket handler should
 * forward the parsed wire body here verbatim and ship the returned response
 * back through its callback.
 *
 * On success, also fires-and-forgets a `session-adopted` ephemeral to the
 * Session's machine (best effort — if the daemon is offline we still succeed
 * because the App's view-layer grouping doesn't depend on the daemon).
 */
export async function sessionAdopt(opts: {
    userId: string;
    request: wire.SessionAdoptRequest;
}): Promise<SessionAdoptOutcome> {
    const { userId, request } = opts;
    const adoptedAt = Date.now();

    // 1. Validate Session ownership. ownedSession throws OwnedEntityNotFound,
    //    which the socket handler turns into a structured error envelope.
    let session;
    try {
        session = await ownedSession(userId, request.sessionId);
    } catch {
        return {
            ok: false,
            response: {
                success: false,
                errorMessage: "Session not found",
                errorCode: "session_not_found",
            },
        };
    }

    // The Session needs a Project (and thus a machineId) for almost all
    // automation owner kinds. The exception is `new-schedule` which the
    // App could plausibly target at a different machine, but right now we
    // gate everything on session.projectId for symmetry — adopting an
    // unprojected Session into automation has no daemon to reattach to.
    if (!session.projectId) {
        return {
            ok: false,
            response: {
                success: false,
                errorMessage: "Session is not attached to a project; cannot adopt",
                errorCode: "session_unattached_project",
            },
        };
    }
    const project = await db.project.findUnique({
        where: { id: session.projectId },
        select: { id: true, machineId: true, path: true },
    });
    if (!project) {
        return {
            ok: false,
            response: {
                success: false,
                errorMessage: "Session's project no longer exists",
                errorCode: "project_not_found",
            },
        };
    }

    // 2/3. Resolve owner + compute AdoptedAutomationContext.
    switch (request.target.kind) {
        case "existing-loop": {
            const target = request.target;
            let loop;
            try {
                loop = await ownedAgentLoop(userId, target.loopId);
            } catch {
                return {
                    ok: false,
                    response: {
                        success: false,
                        errorMessage: "Loop not found",
                        errorCode: "loop_not_found",
                    },
                };
            }
            const ctx: wire.AdoptedAutomationContext = {
                kind: "agent_loop",
                loopId: loop.id,
                projectId: loop.projectId,
                adoptedAt,
            };
            emitSessionAdoptedEphemeral({
                userId,
                machineId: project.machineId,
                sessionId: request.sessionId,
                projectId: loop.projectId,
                loopId: loop.id,
                guardianKey: `agent-loop:${loop.id}`,
            });
            return {
                ok: true,
                response: {
                    success: true,
                    sessionId: request.sessionId,
                    automationContext: ctx,
                    ownerId: loop.id,
                },
            };
        }

        case "new-loop": {
            const target = request.target;
            // Reuse the engine's create path so cron/interval validation,
            // genericConfig defaults, and the agent-loop-updated SyncUpdate
            // emission all fire the same way the regular create route does.
            const result = await createGenericAgentLoop({
                userId,
                projectId: session.projectId,
                body: {
                    prompt: target.prompt,
                    directory: target.directory,
                    // Wire defaults (zod .default()) only kick in via parse;
                    // when we hand-construct the body we must spell out
                    // every field with no optional marker.
                    agent: "claude",
                    enabled: true,
                    intervalMs: target.intervalMs,
                    cronExpression: target.cronExpression,
                    // Stash optional name + bootstrapSlashCommand in
                    // genericConfig — serializeAgentLoop reads name for
                    // the list view, and the CLI daemon's spreadGenericConfig
                    // promotes bootstrapSlashCommand into the trigger.
                    ...((target.name || target.bootstrapSlashCommand)
                        ? {
                            genericConfig: {
                                ...(target.name ? { name: target.name } : {}),
                                ...(target.bootstrapSlashCommand
                                    ? { bootstrapSlashCommand: target.bootstrapSlashCommand }
                                    : {}),
                            },
                        }
                        : {}),
                },
            });
            if (!result.ok) {
                return {
                    ok: false,
                    response: {
                        success: false,
                        errorMessage: result.error,
                        errorCode: "loop_create_failed",
                    },
                };
            }
            const ctx: wire.AdoptedAutomationContext = {
                kind: "agent_loop",
                loopId: result.value.loopId,
                projectId: session.projectId,
                adoptedAt,
            };
            emitSessionAdoptedEphemeral({
                userId,
                machineId: project.machineId,
                sessionId: request.sessionId,
                projectId: session.projectId,
                loopId: result.value.loopId,
                guardianKey: `agent-loop:${result.value.loopId}`,
            });
            return {
                ok: true,
                response: {
                    success: true,
                    sessionId: request.sessionId,
                    automationContext: ctx,
                    ownerId: result.value.loopId,
                },
            };
        }

        case "new-schedule": {
            const target = request.target;
            // Validate cron expression upfront so we don't write a broken
            // row that will never fire.
            let nextRunAt: Date | null = null;
            try {
                nextRunAt = CronExpressionParser.parse(target.cronExpression).next().toDate();
            } catch {
                return {
                    ok: false,
                    response: {
                        success: false,
                        errorMessage: "Invalid cron expression",
                        errorCode: "invalid_cron",
                    },
                };
            }
            const schedule = await db.triggerSchedule.create({
                data: {
                    accountId: userId,
                    machineId: project.machineId,
                    projectId: session.projectId,
                    name: target.name ?? null,
                    prompt: target.prompt,
                    cronExpression: target.cronExpression,
                    priority: "background",
                    skillIds: JSON.stringify([]),
                    nextRunAt,
                },
            });
            log(
                { module: "session-adopt" },
                `Schedule ${schedule.id} created for sessionAdopt session=${request.sessionId}`,
            );
            const ctx: wire.AdoptedAutomationContext = {
                kind: "task",
                triggerType: "cron",
                triggerRef: schedule.id,
                projectId: session.projectId,
                adoptedAt,
            };
            emitSessionAdoptedEphemeral({
                userId,
                machineId: project.machineId,
                sessionId: request.sessionId,
                projectId: session.projectId,
                guardianKey: `project:${session.projectId}:${schedule.id}:claude`,
            });
            return {
                ok: true,
                response: {
                    success: true,
                    sessionId: request.sessionId,
                    automationContext: ctx,
                    ownerId: schedule.id,
                },
            };
        }
    }
}

/**
 * Best-effort ephemeral notification to the Session's daemon. The daemon's
 * `apiMachine.ts` ephemeral handler matches on `type: "session-adopted"`
 * and calls `guardianSessionRegistry.rememberByKey()` so the next trigger
 * iteration reuses this Session instead of spawning a fresh one.
 *
 * Silently no-ops when the daemon is offline — the App's workflow grouping
 * works regardless, and the next time the daemon comes online the user can
 * re-adopt or the loop will simply spawn a fresh Session on the next fire.
 */
function emitSessionAdoptedEphemeral(opts: {
    userId: string;
    machineId: string;
    sessionId: string;
    projectId: string;
    loopId?: string;
    guardianKey: string;
}): void {
    const socket = eventRouter.findMachineSocket(opts.machineId);
    if (!socket) return;
    socket.emit("ephemeral", {
        type: "session-adopted",
        sessionId: opts.sessionId,
        projectId: opts.projectId,
        loopId: opts.loopId,
        guardianKey: opts.guardianKey,
    });
}
