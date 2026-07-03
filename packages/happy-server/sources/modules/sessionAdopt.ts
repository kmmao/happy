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
 * What a successful target branch resolves to. Carries everything the single
 * success tail needs — the response's ownerId + automationContext, and the
 * `session-adopted` emit's guardian params. Branches produce this instead of
 * emitting + returning inline, so the emit lives at exactly one place and no
 * success path can skip it.
 */
interface AdoptResolution {
    ownerId: string;
    automationContext: wire.AdoptedAutomationContext;
    guardian: {
        projectId: string;
        loopId?: string;
        guardianKey: string;
    };
}

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

    // 2/3. Resolve owner + compute the adopted context for this target. Each
    //      branch either returns an error outcome (failures never emit) or
    //      assigns `resolution`; the single success tail below owns the
    //      `session-adopted` emit + response, so no branch can succeed without
    //      notifying the daemon. Adding a target.kind without producing a
    //      resolution fails to compile at the exhaustiveness `default`.
    let resolution: AdoptResolution;
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
            resolution = {
                ownerId: loop.id,
                automationContext: {
                    kind: "agent_loop",
                    loopId: loop.id,
                    projectId: loop.projectId,
                    adoptedAt,
                },
                guardian: {
                    projectId: loop.projectId,
                    loopId: loop.id,
                    guardianKey: `agent-loop:${loop.id}`,
                },
            };
            break;
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
                    // Carry the source Session's model + reasoning effort
                    // through to the spawned iterations so the user's
                    // current preferences are inherited by default. Before
                    // this, adopted loops ignored the picks entirely and
                    // every iteration fell back to the CLI default
                    // (Sonnet 4.6 + medium effort) regardless of what the
                    // adopted Session was running. App pre-fills the
                    // request from session.modelMode / session.preferences.effortLevel.
                    modelMode: target.modelMode ?? undefined,
                    effort: target.effort ?? undefined,
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
            resolution = {
                ownerId: result.value.loopId,
                automationContext: {
                    kind: "agent_loop",
                    loopId: result.value.loopId,
                    projectId: session.projectId,
                    adoptedAt,
                },
                guardian: {
                    projectId: session.projectId,
                    loopId: result.value.loopId,
                    guardianKey: `agent-loop:${result.value.loopId}`,
                },
            };
            break;
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
            resolution = {
                ownerId: schedule.id,
                automationContext: {
                    kind: "task",
                    triggerType: "cron",
                    triggerRef: schedule.id,
                    projectId: session.projectId,
                    adoptedAt,
                },
                guardian: {
                    projectId: session.projectId,
                    guardianKey: `project:${session.projectId}:${schedule.id}:claude`,
                },
            };
            break;
        }

        default: {
            // Exhaustiveness guard: a new target.kind must add a case that
            // produces a resolution, or this fails to compile.
            const _exhaustive: never = request.target;
            throw new Error(
                `Unhandled sessionAdopt target kind: ${(_exhaustive as { kind?: string }).kind}`,
            );
        }
    }

    // Single success tail. Reaching here means a branch produced a resolution,
    // so the `session-adopted` emit is structurally unavoidable for any success.
    emitSessionAdoptedEphemeral({
        userId,
        machineId: project.machineId,
        sessionId: request.sessionId,
        projectId: resolution.guardian.projectId,
        loopId: resolution.guardian.loopId,
        guardianKey: resolution.guardian.guardianKey,
    });
    return {
        ok: true,
        response: {
            success: true,
            sessionId: request.sessionId,
            automationContext: resolution.automationContext,
            ownerId: resolution.ownerId,
        },
    };
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
