/**
 * Session adopt — wire contract for "promote a manual Session to automation".
 *
 * Per docs/plans/sessions-and-automation-ia.md (Phase 2 of the Workflow IA):
 * a user can take an existing Session that was started manually (`startedBy
 * = "terminal"`, no `automationContext`) and adopt it into an automation
 * owner — an existing AgentLoop, a freshly-created AgentLoop, or a
 * freshly-created TriggerSchedule.
 *
 * After adoption:
 *  - The Session's `metadata.automationContext` reflects the new owner.
 *  - The CLI Daemon's GuardianSessionRegistry knows about the Session, so
 *    the next trigger/loop fire resumes it instead of spawning fresh.
 *  - A SessionAdoptedSyncBody is emitted to all owning Account connections.
 *
 * Phase 2 is wire-local: this schema is shipped but NOT published to npm
 * until a coordinated CLI/Agent/Server/App release. Local development
 * picks it up via yarn workspace symlinking.
 */

import * as z from "zod";

// Discriminator for what kind of automation owner the user wants to bind
// the Session to. Each variant carries just enough to create or look up
// the owner; the server fills in defaults.
export const SessionAdoptTargetSchema = z.discriminatedUnion("kind", [
    // Adopt into an already-existing AgentLoop (chosen from the App's
    // picker). The server validates the loop exists on the same Machine.
    z.object({
        kind: z.literal("existing-loop"),
        loopId: z.string(),
    }),
    // Promote into a brand-new AgentLoop spun up from this Session's
    // directory and last user prompt. Fields below are minimum-viable; the
    // server may infer additional config (agent, profile) from the Session.
    z.object({
        kind: z.literal("new-loop"),
        name: z.string().optional(),
        intervalMs: z.number().int().positive().optional(),
        cronExpression: z.string().optional(),
        prompt: z.string(),
        directory: z.string(),
    }),
    // "Make this recurring" — create a TriggerSchedule that, on each fire,
    // reuses this Session via the Guardian registry.
    z.object({
        kind: z.literal("new-schedule"),
        name: z.string().optional(),
        cronExpression: z.string(),
        prompt: z.string(),
    }),
]);

export type SessionAdoptTarget = z.infer<typeof SessionAdoptTargetSchema>;

export const SessionAdoptRequestSchema = z.object({
    sessionId: z.string(),
    target: SessionAdoptTargetSchema,
});

export type SessionAdoptRequest = z.infer<typeof SessionAdoptRequestSchema>;

// Echoed-back automation context to confirm what the server actually
// bound. The client mutates local Session state with this body before the
// SyncUpdate arrives so the UI reflects the change immediately.
export const AdoptedAutomationContextSchema = z.object({
    kind: z.enum(["agent_loop", "supervisor", "webhook", "task"]),
    loopId: z.string().optional(),
    triggerType: z.enum(["manual", "cron", "webhook"]).optional(),
    triggerRef: z.string().optional(),
    projectId: z.string().optional(),
    adoptedAt: z.number(),
});

export type AdoptedAutomationContext = z.infer<typeof AdoptedAutomationContextSchema>;

export const SessionAdoptResponseSchema = z.discriminatedUnion("success", [
    z.object({
        success: z.literal(true),
        sessionId: z.string(),
        automationContext: AdoptedAutomationContextSchema,
        // The id of the loop/schedule that now owns the Session — useful
        // when the request kind was "new-loop" or "new-schedule".
        ownerId: z.string(),
    }),
    z.object({
        success: z.literal(false),
        errorMessage: z.string(),
        // Stable codes for client-side branching: "session_busy" if the
        // Session is in a state that can't be adopted (e.g. archived),
        // "loop_not_found", "duplicate_continuity_key", etc.
        errorCode: z.string().optional(),
    }),
]);

export type SessionAdoptResponse = z.infer<typeof SessionAdoptResponseSchema>;

// SyncUpdate body broadcast to all Account connections when a Session
// is adopted. Receivers should patch local Session metadata so the
// Workflow list re-groups the row under its new owner without refetch.
export const SessionAdoptedSyncBodySchema = z.object({
    t: z.literal("session-adopted"),
    sessionId: z.string(),
    automationContext: AdoptedAutomationContextSchema,
});

export type SessionAdoptedSyncBody = z.infer<typeof SessionAdoptedSyncBodySchema>;
