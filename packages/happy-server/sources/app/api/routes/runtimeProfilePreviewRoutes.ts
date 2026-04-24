/**
 * Runtime profile preview endpoint — exposes "what profile would this
 * dispatch actually resolve to?" without actually spawning a session.
 *
 * Driven by the unified runtimeProfileResolver shipped in C4. The App uses
 * this to label profile pickers with the currently-effective binding (e.g.
 * "Default · Anthropic (project-default)" under every ProfilePicker in the
 * supervisor settings / trigger editor screens).
 *
 * Non-destructive: this endpoint does NOT trigger the Inbox
 * `profile.resolve_failed` notification on failure — it just returns the
 * failure reason so the UI can render a warning. Only live dispatch paths
 * (Cron runner, task route) call `notifyRuntimeProfileFailure`.
 */

import { z } from "zod";
import { db } from "@/storage/db";
import type { Fastify } from "../types";
import {
    resolveRuntimeProfile,
    type RuntimeProfilePurpose,
} from "@/modules/runtimeProfileResolver";

const PurposeSchema = z.enum([
    "supervisor",
    "webhook",
    "cron",
    "task-manual",
    "task-retry",
    "research",
    "health",
]);

type PurposeQuery = z.infer<typeof PurposeSchema>;

const PreviewParamsSchema = z.object({ id: z.string() });
const PreviewQuerySchema = z.object({
    purpose: PurposeSchema.optional(),
});

/**
 * Supervisor config JSON shape — only the profile fields are read here,
 * other fields (mode, schedule, etc.) are ignored.
 */
interface SupervisorProfileConfig {
    defaultProfileId?: string | null;
    healthCheckProfileId?: string | null;
    researchProfileId?: string | null;
}

function parseSupervisorConfig(raw: string | null): SupervisorProfileConfig {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as SupervisorProfileConfig;
        return parsed ?? {};
    } catch {
        return {};
    }
}

/**
 * Pick the purpose-specific profileId override from project.supervisorConfig.
 * When null, the resolver will fall through to `defaultProfileId` itself.
 */
function extractPurposeOverride(
    config: SupervisorProfileConfig,
    purpose: PurposeQuery,
): string | null {
    switch (purpose) {
        case "health":
        case "supervisor":
            return config.healthCheckProfileId ?? null;
        case "research":
            return config.researchProfileId ?? null;
        // webhook / cron / task-* have no per-purpose override at the
        // project level (those bind profileId on the trigger record itself).
        default:
            return null;
    }
}

/**
 * Collapse the `health` alias onto the resolver's RuntimeProfilePurpose.
 * The resolver only needs this for logging / Inbox group keys; the
 * preview path never hits Inbox so we just keep it informational.
 */
function resolverPurpose(purpose: PurposeQuery): RuntimeProfilePurpose {
    if (purpose === "health") return "supervisor";
    return purpose;
}

export function runtimeProfilePreviewRoutes(app: Fastify) {
    app.get(
        "/v1/projects/:id/runtime-profile/preview",
        {
            preHandler: app.authenticate,
            schema: {
                params: PreviewParamsSchema,
                querystring: PreviewQuerySchema,
            },
        },
        async (request, reply) => {
            const project = await db.project.findFirst({
                where: {
                    id: request.params.id,
                    accountId: request.userId,
                },
                select: {
                    id: true,
                    supervisorConfig: true,
                },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const purpose: PurposeQuery = request.query.purpose ?? "supervisor";
            const supervisorConfig = parseSupervisorConfig(project.supervisorConfig);
            const explicitOverride = extractPurposeOverride(supervisorConfig, purpose);

            const result = await resolveRuntimeProfile({
                accountId: request.userId,
                explicitProfileId: explicitOverride,
                projectSupervisorConfig: project.supervisorConfig,
                purpose: resolverPurpose(purpose),
            });

            if (result.ok) {
                return reply.send({
                    ok: true as const,
                    profileId: result.profileId,
                    profileName: result.profileName ?? null,
                    profileSource: result.profileSource,
                    purpose,
                });
            }
            return reply.send({
                ok: false as const,
                reason: result.reason,
                message: result.message,
                profileId: result.profileId ?? null,
                purpose,
            });
        },
    );
}
