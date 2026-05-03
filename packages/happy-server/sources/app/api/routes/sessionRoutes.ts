import { eventRouter, buildNewSessionUpdate, buildNewProjectUpdate } from "@/app/events/eventRouter";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { allocateUserSeq } from "@/storage/seq";
import { sessionDelete } from "@/app/session/sessionDelete";
import { sessionArchive } from "@/app/session/sessionArchive";
import { activityCache } from "@/app/presence/sessionCache";

type SessionResponseRecord = {
    id: string;
    tag: string;
    seq: number;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    createdAt: Date;
    updatedAt: Date;
};

function hasPrismaErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === code;
}

function buildSessionResponse(session: SessionResponseRecord) {
    return {
        session: {
            id: session.id,
            tag: session.tag,
            seq: session.seq,
            metadata: session.metadata,
            metadataVersion: session.metadataVersion,
            agentState: session.agentState,
            agentStateVersion: session.agentStateVersion,
            dataEncryptionKey: session.dataEncryptionKey
                ? Buffer.from(session.dataEncryptionKey).toString("base64")
                : null,
            active: session.active,
            activeAt: session.lastActiveAt.getTime(),
            createdAt: session.createdAt.getTime(),
            updatedAt: session.updatedAt.getTime(),
            lastMessage: null,
        },
    };
}

/**
 * Resolve (find-or-create) a Project by accountId + machineId + path,
 * then link the given session to it. No-op if machineId or path is missing.
 */
async function resolveAndLinkProject(
    accountId: string,
    sessionId: string,
    machineId: string | null | undefined,
    path: string | null | undefined,
): Promise<void> {
    if (!machineId || !path) return;

    try {
        // Single atomic upsert via raw SQL to avoid Prisma's SELECT-then-INSERT race.
        // ON CONFLICT DO UPDATE ensures we always get RETURNING id, even for existing rows.
        // (DO NOTHING + separate SELECT had a gap where duplicates could slip through.)
        const rows = await db.$queryRaw<{ id: string }[]>`
            INSERT INTO "Project" (id, "accountId", "machineId", path, "metadataVersion", "supervisorConfigVersion", "supervisorScheduleEnabled", "supervisorDailyRunCount", "supervisorPushTriggerEnabled", archived, "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::text, ${accountId}, ${machineId}, ${path}, 0, 0, false, 0, false, false, NOW(), NOW())
            ON CONFLICT ("accountId", "machineId", path) DO UPDATE SET "updatedAt" = NOW()
            RETURNING id
        `;
        const projectId = rows[0].id;
        const project = await db.project.findUniqueOrThrow({
            where: { id: projectId },
        });

        // Link session to project
        await db.session.update({
            where: { id: sessionId },
            data: { projectId: project.id },
        });

        // Always emit project event — App merge is idempotent,
        // and skipping on false negatives would defeat the purpose of this fix
        const updSeq = await allocateUserSeq(accountId);
        const payload = buildNewProjectUpdate(
            project,
            updSeq,
            randomKeyNaked(12),
        );
        eventRouter.emitUpdate({
            userId: accountId,
            payload,
            recipientFilter: { type: "user-scoped-only" },
        });
    } catch (error) {
        // Non-critical: log and continue — session still works without project link
        log(
            { module: "session-create", sessionId, accountId },
            `Failed to resolve/link project (machineId=${machineId}, path=${path}): ${error}`,
        );
    }
}

export function sessionRoutes(app: Fastify) {
  // Sessions API
  app.get(
    "/v1/sessions",
    {
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;

      const sessions = await db.session.findMany({
        where: { accountId: userId },
        orderBy: { updatedAt: "desc" },
        take: 150,
        select: {
          id: true,
          seq: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          metadataVersion: true,
          agentState: true,
          agentStateVersion: true,
          preferences: true,
          preferencesVersion: true,
          dataEncryptionKey: true,
          active: true,
          lastActiveAt: true,
        },
      });

      return reply.send({
        sessions: sessions.map((v) => {
          const sessionUpdatedAt = v.updatedAt.getTime();

          return {
            id: v.id,
            seq: v.seq,
            createdAt: v.createdAt.getTime(),
            updatedAt: sessionUpdatedAt,
            active: v.active,
            activeAt: v.lastActiveAt.getTime(),
            metadata: v.metadata,
            metadataVersion: v.metadataVersion,
            agentState: v.agentState,
            agentStateVersion: v.agentStateVersion,
            preferences: v.preferences,
            preferencesVersion: v.preferencesVersion,
            dataEncryptionKey: v.dataEncryptionKey
              ? Buffer.from(v.dataEncryptionKey).toString("base64")
              : null,
            lastMessage: null,
          };
        }),
      });
    },
  );

  // V2 Sessions API - Active sessions only
  app.get(
    "/v2/sessions/active",
    {
      preHandler: app.authenticate,
      schema: {
        querystring: z
          .object({
            limit: z.coerce.number().int().min(1).max(500).default(150),
          })
          .optional(),
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const limit = request.query?.limit || 150;

      const sessions = await db.session.findMany({
        where: {
          accountId: userId,
          active: true,
          lastActiveAt: {
            gt: new Date(Date.now() - 1000 * 60 * 15) /* 15 minutes */,
          },
        },
        orderBy: { lastActiveAt: "desc" },
        take: limit,
        select: {
          id: true,
          seq: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          metadataVersion: true,
          agentState: true,
          agentStateVersion: true,
          preferences: true,
          preferencesVersion: true,
          dataEncryptionKey: true,
          active: true,
          lastActiveAt: true,
        },
      });

      return reply.send({
        sessions: sessions.map((v) => ({
          id: v.id,
          seq: v.seq,
          createdAt: v.createdAt.getTime(),
          updatedAt: v.updatedAt.getTime(),
          active: v.active,
          activeAt: v.lastActiveAt.getTime(),
          metadata: v.metadata,
          metadataVersion: v.metadataVersion,
          agentState: v.agentState,
          agentStateVersion: v.agentStateVersion,
          preferences: v.preferences,
          preferencesVersion: v.preferencesVersion,
          dataEncryptionKey: v.dataEncryptionKey
            ? Buffer.from(v.dataEncryptionKey).toString("base64")
            : null,
        })),
      });
    },
  );

  // V2 Sessions API - Cursor-based pagination with change tracking
  app.get(
    "/v2/sessions",
    {
      preHandler: app.authenticate,
      schema: {
        querystring: z
          .object({
            cursor: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            changedSince: z.coerce.number().int().positive().optional(),
          })
          .optional(),
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { cursor, limit = 50, changedSince } = request.query || {};

      // Decode cursor - simple ID-based cursor
      let cursorSessionId: string | undefined;
      if (cursor) {
        if (cursor.startsWith("cursor_v1_")) {
          cursorSessionId = cursor.substring(10);
        } else {
          return reply.code(400).send({ error: "Invalid cursor format" });
        }
      }

      // Build where clause
      const where: Prisma.SessionWhereInput = { accountId: userId };

      // Add changedSince filter (just a filter, doesn't affect pagination)
      if (changedSince) {
        where.updatedAt = {
          gt: new Date(changedSince),
        };
      }

      // Add cursor pagination - always by ID descending (most recent first)
      if (cursorSessionId) {
        where.id = {
          lt: cursorSessionId, // Get sessions with ID less than cursor (for desc order)
        };
      }

      // Always sort by ID descending for consistent pagination
      const orderBy = { id: "desc" as const };

      const sessions = await db.session.findMany({
        where,
        orderBy,
        take: limit + 1, // Fetch one extra to determine if there are more
        select: {
          id: true,
          seq: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          metadataVersion: true,
          agentState: true,
          agentStateVersion: true,
          preferences: true,
          preferencesVersion: true,
          dataEncryptionKey: true,
          active: true,
          lastActiveAt: true,
          forkedFromSessionId: true,
        },
      });

      // Check if there are more results
      const hasNext = sessions.length > limit;
      const resultSessions = hasNext ? sessions.slice(0, limit) : sessions;

      // Generate next cursor - simple ID-based cursor
      let nextCursor: string | null = null;
      if (hasNext && resultSessions.length > 0) {
        const lastSession = resultSessions[resultSessions.length - 1];
        nextCursor = `cursor_v1_${lastSession.id}`;
      }

      return reply.send({
        sessions: resultSessions.map((v) => ({
          id: v.id,
          seq: v.seq,
          createdAt: v.createdAt.getTime(),
          updatedAt: v.updatedAt.getTime(),
          active: v.active,
          activeAt: v.lastActiveAt.getTime(),
          metadata: v.metadata,
          metadataVersion: v.metadataVersion,
          agentState: v.agentState,
          agentStateVersion: v.agentStateVersion,
          preferences: v.preferences,
          preferencesVersion: v.preferencesVersion,
          dataEncryptionKey: v.dataEncryptionKey
            ? Buffer.from(v.dataEncryptionKey).toString("base64")
            : null,
          forkedFromSessionId: v.forkedFromSessionId ?? null,
        })),
        nextCursor,
        hasNext,
      });
    },
  );

  // Create or load session by tag
  app.post(
    "/v1/sessions",
    {
      schema: {
        body: z.object({
          tag: z.string(),
          metadata: z.string(),
          agentState: z.string().nullish(),
          dataEncryptionKey: z.string().nullish(),
          sessionId: z.string().nullish(),
          machineId: z.string().nullish(),
          path: z.string().nullish(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { tag, metadata, dataEncryptionKey, sessionId, machineId, path } = request.body;

      // Internal reconnect to an existing Happy session by ID
      // (used by runtime resume and fork pre-allocation, not by simple unarchive).
      if (sessionId) {
        const existing = await db.session.findFirst({
          where: { id: sessionId, accountId: userId },
        });
        if (!existing) {
          // Session not found — create a new one with the requested ID.
          // For sessionId-driven reconnect/fork pre-allocation we must not reuse
          // the sentinel "reconnect" tag, otherwise the next fork collides on the
          // (accountId, tag) unique index and the server throws 500.
          try {
            const created = await db.session.create({
              data: {
                id: sessionId,
                accountId: userId,
                tag: sessionId,
                metadata: metadata,
                dataEncryptionKey: dataEncryptionKey
                  ? new Uint8Array(Buffer.from(dataEncryptionKey, "base64"))
                  : undefined,
              },
            });
            await resolveAndLinkProject(userId, created.id, machineId, path);
            const updSeq = await allocateUserSeq(userId);
            const updatePayload = buildNewSessionUpdate(created, updSeq, randomKeyNaked(12));
            eventRouter.emitUpdate({ userId, payload: updatePayload, recipientFilter: { type: "user-scoped-only" } });
            return reply.send(buildSessionResponse(created));
          } catch (error) {
            if (!hasPrismaErrorCode(error, "P2002")) {
              throw error;
            }

            const conflicted = await db.session.findFirst({
              where: { id: sessionId, accountId: userId },
            });
            if (!conflicted) {
              throw error;
            }

            log(
              { module: "session-create", sessionId, userId, tag },
              `Recovered from duplicate pre-allocated session create for ${sessionId}`,
            );
            if (!conflicted.projectId) {
              await resolveAndLinkProject(userId, conflicted.id, machineId, path);
            }
            return reply.send(buildSessionResponse(conflicted));
          }
        }

        log(
          { module: "session-create", sessionId: existing.id, userId },
          `Reconnecting to existing session: ${existing.id}`,
        );

        // Resolve seq for the update event
        const updSeq = await allocateUserSeq(userId);

        // Reactivate the session and rotate the encryption key if provided.
        // IMPORTANT: Do not overwrite `metadata` here. The encrypted blob
        // accumulates agent-driven state (progress / sessionSummary /
        // summary / tools / ...) that outlives any single CLI process, and
        // reconnects triggered by daemon restarts or `npm upgrade` ship
        // only a fresh set of startup fields (path / version / pid / ...).
        // Overwriting would wipe all agent-accumulated state. CLI merges
        // its startup fields over the preserved blob via the
        // `update-metadata` socket event (optimistic concurrency).
        const updated = await db.session.update({
          where: { id: sessionId },
          data: {
            ...(dataEncryptionKey
              ? {
                  dataEncryptionKey: new Uint8Array(
                    Buffer.from(dataEncryptionKey, "base64"),
                  ),
                }
              : {}),
            active: true,
            lastActiveAt: new Date(),
          },
        });

        // Evict stale cache so heartbeats are accepted immediately
        activityCache.invalidateSession(sessionId);

        // Auto-resolve project if machineId + path provided and session has no project
        if (!existing.projectId) {
          await resolveAndLinkProject(userId, existing.id, machineId, path);
        }

        // Emit new-session event so App re-fetches sessions and picks up the new dataEncryptionKey
        const updatePayload = buildNewSessionUpdate(
          updated,
          updSeq,
          randomKeyNaked(12),
        );
        eventRouter.emitUpdate({
          userId,
          payload: updatePayload,
          recipientFilter: { type: "user-scoped-only" },
        });

        return reply.send(buildSessionResponse(updated));
      }

      const session = await db.session.findFirst({
        where: {
          accountId: userId,
          tag: tag,
        },
      });
      if (session) {
        log(
          { module: "session-create", sessionId: session.id, userId, tag },
          `Found existing session: ${session.id} for tag ${tag}`,
        );

        // Auto-resolve project if machineId + path provided and session has no project
        if (!session.projectId) {
          await resolveAndLinkProject(userId, session.id, machineId, path);
        }

        return reply.send(buildSessionResponse(session));
      } else {
        try {
          // Create session
          log(
            { module: "session-create", userId, tag },
            `Creating new session for user ${userId} with tag ${tag}`,
          );
          const session = await db.session.create({
            data: {
              accountId: userId,
              tag: tag,
              metadata: metadata,
              dataEncryptionKey: dataEncryptionKey
                ? new Uint8Array(Buffer.from(dataEncryptionKey, "base64"))
                : undefined,
            },
          });
          log(
            { module: "session-create", sessionId: session.id, userId },
            `Session created: ${session.id}`,
          );

          // Auto-resolve project if machineId + path provided
          await resolveAndLinkProject(userId, session.id, machineId, path);

          // Emit new session update
          const updSeq = await allocateUserSeq(userId);
          const updatePayload = buildNewSessionUpdate(
            session,
            updSeq,
            randomKeyNaked(12),
          );
          log(
            {
              module: "session-create",
              userId,
              sessionId: session.id,
              updateType: "new-session",
              updatePayload: JSON.stringify(updatePayload),
            },
            `Emitting new-session update to user-scoped connections`,
          );
          eventRouter.emitUpdate({
            userId,
            payload: updatePayload,
            recipientFilter: { type: "user-scoped-only" },
          });

          return reply.send(buildSessionResponse(session));
        } catch (error) {
          if (!hasPrismaErrorCode(error, "P2002")) {
            throw error;
          }

          const conflicted = await db.session.findFirst({
            where: {
              accountId: userId,
              tag: tag,
            },
          });
          if (!conflicted) {
            throw error;
          }

          log(
            { module: "session-create", sessionId: conflicted.id, userId, tag },
            `Recovered from duplicate session create for tag ${tag}`,
          );
          if (!conflicted.projectId) {
            await resolveAndLinkProject(userId, conflicted.id, machineId, path);
          }
          return reply.send(buildSessionResponse(conflicted));
        }
      }
    },
  );

  app.get(
    "/v1/sessions/:sessionId/messages",
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      // Verify session belongs to user
      const session = await db.session.findFirst({
        where: {
          id: sessionId,
          accountId: userId,
        },
      });

      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const messages = await db.sessionMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: 150,
        select: {
          id: true,
          seq: true,
          localId: true,
          content: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return reply.send({
        messages: messages.map((v) => ({
          id: v.id,
          seq: v.seq,
          content: v.content,
          localId: v.localId,
          createdAt: v.createdAt.getTime(),
          updatedAt: v.updatedAt.getTime(),
        })),
      });
    },
  );

  // Get cumulative token usage summary for a session
  app.get(
    "/v1/sessions/:sessionId/usage/summary",
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      const session = await db.session.findFirst({
        where: {
          id: sessionId,
          accountId: userId,
        },
        select: { id: true },
      });

      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const reports = await db.usageReport.findMany({
        where: {
          sessionId,
          accountId: userId,
        },
        select: { data: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheCreationTokens = 0;
      let totalCacheReadTokens = 0;

      // Track the last report's per-call values for contextSize restoration
      let lastInputTokens = 0;
      let lastOutputTokens = 0;
      let lastCacheCreation = 0;
      let lastCacheRead = 0;

      for (const report of reports) {
        const data = report.data as PrismaJson.UsageReportData;
        const input = Number(data.tokens?.input || 0);
        const output = Number(data.tokens?.output || 0);
        const cacheCreation = Number(data.tokens?.cache_creation || 0);
        const cacheRead = Number(data.tokens?.cache_read || 0);

        totalInputTokens += input + cacheCreation + cacheRead;
        totalOutputTokens += output;
        totalCacheCreationTokens += cacheCreation;
        totalCacheReadTokens += cacheRead;

        lastInputTokens = input;
        lastOutputTokens = output;
        lastCacheCreation = cacheCreation;
        lastCacheRead = cacheRead;
      }

      return reply.send({
        totalInputTokens,
        totalOutputTokens,
        totalCacheCreationTokens,
        totalCacheReadTokens,
        lastInputTokens,
        lastOutputTokens,
        lastCacheCreation,
        lastCacheRead,
        reportCount: reports.length,
      });
    },
  );

  const unarchiveSessionHandler = async (
    request: FastifyRequest<{
      Params: {
        sessionId: string;
      };
    }>,
    reply: FastifyReply,
  ) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      const session = await db.session.findFirst({
        where: {
          id: sessionId,
          accountId: userId,
        },
      });

      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      if (session.active) {
        return reply.code(400).send({ error: "Session is already active" });
      }

      const updSeq = await allocateUserSeq(userId);

      const updated = await db.session.update({
        where: { id: sessionId },
        data: {
          active: true,
          lastActiveAt: new Date(),
        },
      });

      // Evict stale cache so heartbeats are accepted immediately
      activityCache.invalidateSession(sessionId);

      const updatePayload = buildNewSessionUpdate(
        updated,
        updSeq,
        randomKeyNaked(12),
      );
      eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: "user-scoped-only" },
      });

      return reply.send({ success: true });
  };

  // Unarchive session without restarting the underlying agent process.
  app.patch(
    "/v1/sessions/:sessionId/unarchive",
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    unarchiveSessionHandler,
  );

  // Archive session — server-side fallback when the killSession RPC cannot reach the daemon.
  // Sets active=false and sends session-terminate to the daemon (no-op if process already gone).
  app.patch(
    "/v1/sessions/:sessionId/archive",
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      const archived = await sessionArchive({ uid: userId }, sessionId);

      if (!archived) {
        return reply.code(404).send({ error: "Session not found or not owned by user" });
      }

      return reply.send({ success: true });
    },
  );

  // Legacy alias kept for backward compatibility.
  app.patch(
    "/v1/sessions/:sessionId/restore",
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    unarchiveSessionHandler,
  );

  // Set fork source — records which parent session this was forked from
  app.patch(
    "/v1/sessions/:sessionId/fork-source",
    {
      preHandler: app.authenticate,
      schema: {
        params: z.object({ sessionId: z.string() }),
        body: z.object({ forkedFromSessionId: z.string() }),
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;
      const { forkedFromSessionId } = request.body;

      const session = await db.session.findFirst({
        where: { id: sessionId, accountId: userId },
      });
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const updSeq = await allocateUserSeq(userId);
      const updated = await db.session.update({
        where: { id: sessionId },
        data: { forkedFromSessionId },
      });

      const updatePayload = buildNewSessionUpdate(updated, updSeq, randomKeyNaked(12));
      eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: "user-scoped-only" },
      });

      return reply.send({ success: true });
    },
  );

  // Export session transcript as JSONL (one message per line)
  app.get(
    "/v1/sessions/:sessionId/transcript",
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
        querystring: z
          .object({
            format: z.enum(["jsonl", "json"]).default("jsonl"),
          })
          .optional(),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;
      const format = request.query?.format ?? "jsonl";

      const session = await db.session.findFirst({
        where: { id: sessionId, accountId: userId },
        select: { id: true },
      });

      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const messages = await db.sessionMessage.findMany({
        where: { sessionId },
        orderBy: { seq: "asc" },
        select: {
          id: true,
          seq: true,
          localId: true,
          content: true,
          createdAt: true,
        },
      });

      const records = messages.map((m) => ({
        id: m.id,
        seq: m.seq,
        localId: m.localId,
        content: m.content,
        createdAt: m.createdAt.getTime(),
      }));

      if (format === "json") {
        return reply.send({ sessionId, messages: records });
      }

      reply.header("Content-Type", "application/x-ndjson");
      const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
      return reply.send(jsonl);
    },
  );

  // Delete session
  app.delete(
    "/v1/sessions/:sessionId",
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      const deleted = await sessionDelete({ uid: userId }, sessionId);

      if (!deleted) {
        return reply
          .code(404)
          .send({ error: "Session not found or not owned by user" });
      }

      return reply.send({ success: true });
    },
  );
}
