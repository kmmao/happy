import { db } from "@/storage/db";
import { Fastify } from "../types";
import { z } from "zod";
import {
    AIBackendProfileSchema,
    type AIBackendProfile,
} from "@/types/aiBackendProfile";
import {
    decryptAiBackendProfile,
    encryptAiBackendProfile,
} from "@/modules/aiBackendProfileCrypto";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

type AiBackendProfileRow = {
    profileKey: string;
    revision: number;
    archivedAt: Date | null;
    encryptedPayload: Uint8Array<ArrayBuffer>;
};

const AiBackendProfileMutationSchema = AIBackendProfileSchema.omit({
    createdAt: true,
    updatedAt: true,
});

const AiBackendProfileResponseSchema = z.object({
    profile: AIBackendProfileSchema,
    revision: z.number().int().positive(),
    archivedAt: z.number().nullable(),
});

function serializeAiBackendProfile(accountId: string, row: AiBackendProfileRow) {
    return {
        profile: decryptAiBackendProfile(accountId, row.profileKey, row.encryptedPayload),
        revision: row.revision,
        archivedAt: row.archivedAt?.getTime() ?? null,
    };
}

export function accountProfileRoutes(app: Fastify) {
    app.get('/v1/account/profiles', {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    profiles: z.array(AiBackendProfileResponseSchema),
                }),
            },
        },
    }, async (request, reply) => {
        const rows = await db.$queryRaw<AiBackendProfileRow[]>(Prisma.sql`
            SELECT "profileKey", revision, "archivedAt", "encryptedPayload"
            FROM "AiBackendProfile"
            WHERE "accountId" = ${request.userId}
              AND "archivedAt" IS NULL
            ORDER BY "isBuiltIn" DESC, "updatedAt" DESC
        `);

        return reply.send({
            profiles: rows.map((row) => serializeAiBackendProfile(request.userId, row)),
        });
    });

    app.post('/v1/account/profiles', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                profile: AiBackendProfileMutationSchema,
            }),
            response: {
                200: AiBackendProfileResponseSchema,
            },
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const profile = {
            ...request.body.profile,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        } satisfies AIBackendProfile;
        const rowId = randomUUID();

        const [created] = await db.$queryRaw<AiBackendProfileRow[]>(Prisma.sql`
            INSERT INTO "AiBackendProfile" (
                id,
                "accountId",
                "profileKey",
                name,
                description,
                "isBuiltIn",
                "encryptedPayload",
                revision,
                "createdAt",
                "updatedAt"
            ) VALUES (
                ${rowId},
                ${userId},
                ${profile.id},
                ${profile.name},
                ${profile.description ?? null},
                ${profile.isBuiltIn},
                ${Buffer.from(encryptAiBackendProfile(userId, profile))},
                1,
                NOW(),
                NOW()
            )
            ON CONFLICT ("accountId", "profileKey")
            DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                "isBuiltIn" = EXCLUDED."isBuiltIn",
                "encryptedPayload" = EXCLUDED."encryptedPayload",
                revision = "AiBackendProfile".revision + 1,
                "archivedAt" = NULL,
                "updatedAt" = NOW()
            RETURNING "profileKey", revision, "archivedAt", "encryptedPayload"
        `);

        return reply.send(serializeAiBackendProfile(userId, created));
    });

    app.patch('/v1/account/profiles/:profileId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ profileId: z.string() }),
            body: z.object({
                profile: AiBackendProfileMutationSchema,
                expectedRevision: z.number().int().positive(),
            }),
            response: {
                200: z.union([
                    AiBackendProfileResponseSchema.extend({ success: z.literal(true) }),
                    z.object({
                        success: z.literal(false),
                        error: z.literal('revision-mismatch'),
                        current: AiBackendProfileResponseSchema,
                    }),
                ]),
                404: z.object({ error: z.literal('Profile not found') }),
            },
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { profileId } = request.params;
        const { profile, expectedRevision } = request.body;

        const [current] = await db.$queryRaw<AiBackendProfileRow[]>(Prisma.sql`
            SELECT "profileKey", revision, "archivedAt", "encryptedPayload"
            FROM "AiBackendProfile"
            WHERE "profileKey" = ${profileId}
              AND "accountId" = ${userId}
              AND "archivedAt" IS NULL
        `);

        if (!current) {
            return reply.code(404).send({ error: 'Profile not found' });
        }

        if (current.revision !== expectedRevision) {
            return reply.send({
                success: false,
                error: 'revision-mismatch',
                current: serializeAiBackendProfile(userId, current),
            });
        }

        const currentProfile = decryptAiBackendProfile(
            userId,
            current.profileKey,
            current.encryptedPayload,
        );
        const normalizedProfile: AIBackendProfile = {
            ...profile,
            id: profileId,
            createdAt: currentProfile.createdAt ?? Date.now(),
            updatedAt: Date.now(),
        };

        await db.$executeRaw(Prisma.sql`
            UPDATE "AiBackendProfile"
            SET
                name = ${normalizedProfile.name},
                description = ${normalizedProfile.description ?? null},
                "isBuiltIn" = ${normalizedProfile.isBuiltIn},
                "encryptedPayload" = ${Buffer.from(encryptAiBackendProfile(userId, normalizedProfile))},
                revision = revision + 1,
                "updatedAt" = NOW()
            WHERE "profileKey" = ${profileId}
              AND "accountId" = ${userId}
        `);

        const [updated] = await db.$queryRaw<AiBackendProfileRow[]>(Prisma.sql`
            SELECT "profileKey", revision, "archivedAt", "encryptedPayload"
            FROM "AiBackendProfile"
            WHERE "profileKey" = ${profileId}
              AND "accountId" = ${userId}
        `);

        return reply.send({
            success: true,
            ...serializeAiBackendProfile(userId, updated),
        });
    });

    app.delete('/v1/account/profiles/:profileId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ profileId: z.string() }),
            response: {
                200: z.object({ success: z.literal(true) }),
                409: z.object({
                    error: z.literal("profile_in_use"),
                    message: z.string(),
                    referenceCounts: z.object({
                        activeTasks: z.number().int().nonnegative(),
                        enabledSchedules: z.number().int().nonnegative(),
                        enabledWebhooks: z.number().int().nonnegative(),
                    }),
                }),
            },
        },
    }, async (request, reply) => {
        const { profileId } = request.params;

        // Archive-guard: refuse to archive a profile that's still bound to
        // live triggers (Cron schedules / webhooks) or in-flight tasks. The
        // operator must rebind or disable those first, otherwise the next
        // dispatch would fail "profile not found" and surface via the Inbox
        // `profile.resolve_failed` channel — cleaner to block up front.
        const [taskRefs, scheduleRefs, webhookRefs] = await Promise.all([
            db.task.count({
                where: {
                    accountId: request.userId,
                    profileId,
                    status: { in: ["queued", "dispatching", "running"] },
                },
            }),
            db.triggerSchedule.count({
                where: { accountId: request.userId, profileId, enabled: true },
            }),
            db.webhookTrigger.count({
                where: { accountId: request.userId, profileId, enabled: true },
            }),
        ]);
        const totalRefs = taskRefs + scheduleRefs + webhookRefs;
        if (totalRefs > 0) {
            return reply.code(409).send({
                error: "profile_in_use",
                message: `Profile is still referenced by ${totalRefs} active record(s). Rebind or disable them before archiving.`,
                referenceCounts: {
                    activeTasks: taskRefs,
                    enabledSchedules: scheduleRefs,
                    enabledWebhooks: webhookRefs,
                },
            });
        }

        await db.$executeRaw(Prisma.sql`
            UPDATE "AiBackendProfile"
            SET "archivedAt" = NOW(), "updatedAt" = NOW()
            WHERE "profileKey" = ${profileId}
              AND "accountId" = ${request.userId}
              AND "archivedAt" IS NULL
        `);

        return reply.send({ success: true });
    });
}
