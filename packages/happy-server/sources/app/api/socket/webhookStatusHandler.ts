/**
 * Handle webhook-status events from CLI daemons.
 * Updates WebhookEvent records with completion/failure status.
 * On completion, broadcasts issue metadata to app so it can create
 * an IssueSessionLink (shows issue info in the session list).
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { registerSocketEvent } from "./registerSocketEvent";

const webhookStatusSchema = z.object({
  webhookEventId: z.string().min(1),
  status: z.enum(["dispatched", "completed", "failed"]),
  sessionId: z.string().min(1).optional(),
  errorMessage: z.string().optional(),
});

export function webhookStatusHandler(socket: Socket, userId: string): void {
  registerSocketEvent({
    socket,
    userId,
    event: "webhook-status",
    schema: webhookStatusSchema,
    module: "webhook",
    handler: async (data) => {
      const event = await db.webhookEvent.findFirst({
        where: {
          id: data.webhookEventId,
          accountId: userId,
        },
      });

      if (!event) {
        log(
          { module: "webhook", level: "warn" },
          `webhook-status: event ${data.webhookEventId} not found for user ${userId}`,
        );
        return;
      }

      // Verify sessionId ownership if provided
      if (data.sessionId) {
        const session = await db.session.findFirst({
          where: { id: data.sessionId, accountId: userId },
          select: { id: true },
        });
        if (!session) {
          log(
            { module: "webhook", level: "warn" },
            `webhook-status: sessionId ${data.sessionId} does not belong to user ${userId}`,
          );
          return;
        }
      }

      await db.webhookEvent.update({
        where: { id: data.webhookEventId },
        data: {
          status: data.status,
          sessionId: data.sessionId ?? event.sessionId,
          errorMessage: data.errorMessage ?? event.errorMessage,
        },
      });

      log(
        { module: "webhook" },
        `webhook-status: event ${data.webhookEventId} → ${data.status}`,
      );

      // When a webhook session is successfully created, notify the
      // app so it can create an IssueSessionLink for the session list.
      if (data.status === "completed" && data.sessionId && event.machineId) {
        const route = await db.webhookRoute.findFirst({
          where: {
            accountId: userId,
            repoUrl: event.repoUrl,
            provider: event.provider,
          },
        });

        if (route) {
          await emitSyncEphemeral(userId, {
            t: "webhook-issue-linked",
            issueNumber: event.issueNumber,
            issueTitle: event.issueTitle,
            issueBody: event.issueBody,
            issueAuthor: event.issueAuthor,
            issueLabels: event.issueLabels,
            issueUrl: event.issueUrl,
            repoUrl: event.repoUrl,
            repoPath: route.repoPath,
            machineId: event.machineId,
            sessionId: data.sessionId,
          });
        }
      }
    },
  });
}
