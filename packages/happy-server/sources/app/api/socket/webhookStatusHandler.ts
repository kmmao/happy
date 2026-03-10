/**
 * Handle webhook-status events from CLI daemons.
 * Updates WebhookEvent records with completion/failure status.
 * On completion, broadcasts issue metadata to app so it can create
 * an IssueSessionLink (shows issue info in the session list).
 */

import { Socket } from "socket.io";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { eventRouter } from "@/app/events/eventRouter";

export function webhookStatusHandler(socket: Socket, userId: string): void {
  socket.on(
    "webhook-status",
    async (data: {
      webhookEventId: string;
      status: "dispatched" | "completed" | "failed";
      sessionId?: string;
      errorMessage?: string;
    }) => {
      try {
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
            eventRouter.emitEphemeral({
              userId,
              payload: {
                type: "webhook-issue-linked",
                issueNumber: event.issueNumber,
                issueTitle: event.issueTitle,
                issueUrl: event.issueUrl,
                repoUrl: event.repoUrl,
                repoPath: route.repoPath,
                machineId: event.machineId,
                sessionId: data.sessionId,
              },
              recipientFilter: {
                type: "user-scoped-only",
              },
            });
          }
        }
      } catch (error) {
        log(
          { module: "webhook", level: "error" },
          `webhook-status handler error: ${error}`,
        );
      }
    },
  );
}
