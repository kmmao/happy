/**
 * Webhook dispatch — orchestrates the full webhook processing pipeline.
 *
 * 1. Extract repo URL from body
 * 2. Find matching WebhookRoutes by repoUrl
 * 3. For each route: verify signature → parse issue → match labels/authors → dedup → create event → notify CLI
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { decryptString } from "@/modules/encrypt";
import { verifyWebhookSignature } from "./webhookVerify";
import {
  parseWebhookIssue,
  getEventTypeHeader,
  getDeliveryId,
} from "./webhookParsers";
import type { ParsedWebhookIssue } from "./webhookParsers";
import { eventRouter } from "@/app/events/eventRouter";

/**
 * Extract the repository URL from a webhook body.
 * Each provider puts it in a slightly different place.
 */
function extractRepoUrl(provider: string, body: any): string | null {
  switch (provider) {
    case "github":
    case "gitea":
      return body?.repository?.html_url ?? null;
    case "gitlab":
      return body?.project?.web_url ?? null;
    default:
      return null;
  }
}

/**
 * Normalize a repo URL for consistent matching.
 * Removes trailing slashes and .git suffix, lowercases.
 */
function normalizeRepoUrl(url: string): string {
  return url
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Check if an issue's labels match any of the route's trigger labels.
 */
function labelsMatch(
  issueLabels: readonly string[],
  routeLabels: readonly string[],
): boolean {
  const triggerSet = new Set(routeLabels.map((l) => l.trim().toLowerCase()));
  return issueLabels.some((l) => triggerSet.has(l));
}

/**
 * Check if the issue author is in the route's allowed authors list.
 */
function authorAllowed(
  author: string,
  allowedAuthors: readonly string[],
): boolean {
  const allowedSet = new Set(allowedAuthors.map((a) => a.trim().toLowerCase()));
  return allowedSet.has(author.toLowerCase());
}

export interface DispatchResult {
  readonly dispatched: boolean;
  readonly reason?: string;
}

/**
 * Process an incoming webhook from any supported provider.
 */
export async function dispatchWebhook(
  provider: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
  body: any,
): Promise<DispatchResult> {
  // 1. Extract repo URL
  const repoUrl = extractRepoUrl(provider, body);
  if (!repoUrl) {
    return { dispatched: false, reason: "no_repo_url" };
  }

  const normalizedUrl = normalizeRepoUrl(repoUrl);

  // 2. Find all matching routes (could be multiple users watching same repo)
  const routes = await db.webhookRoute.findMany({
    where: {
      repoUrl: normalizedUrl,
      provider,
      enabled: true,
    },
  });

  if (routes.length === 0) {
    return { dispatched: false, reason: "no_matching_routes" };
  }

  // 3. Get event type and delivery ID
  const eventType = getEventTypeHeader(provider, headers);
  const deliveryId = getDeliveryId(provider, headers);

  if (!deliveryId) {
    return { dispatched: false, reason: "no_delivery_id" };
  }

  // 4. Parse the issue data
  const issue = parseWebhookIssue(provider, body, eventType);
  if (!issue) {
    return { dispatched: false, reason: "not_issue_event" };
  }

  let anyDispatched = false;

  // 5. Process each matching route
  for (const route of routes) {
    try {
      await processRoute(route, provider, rawBody, headers, deliveryId, issue);
      anyDispatched = true;
    } catch (error) {
      log(
        { module: "webhook", level: "error" },
        `Failed to process webhook for route ${route.id}: ${error}`,
      );
    }
  }

  return {
    dispatched: anyDispatched,
    reason: anyDispatched ? undefined : "all_routes_failed",
  };
}

async function processRoute(
  route: {
    id: string;
    accountId: string;
    webhookSecret: Uint8Array<ArrayBuffer>;
    labels: string[];
    authors: string[];
    machineId: string;
    repoPath: string;
    provider: string;
  },
  provider: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
  deliveryId: string,
  issue: ParsedWebhookIssue,
): Promise<void> {
  // 1. Decrypt webhook secret and verify signature
  const secret = decryptString(
    ["webhook-route", route.id],
    route.webhookSecret as unknown as Uint8Array<ArrayBuffer>,
  );
  const valid = verifyWebhookSignature(provider, secret, rawBody, headers);
  if (!valid) {
    log(
      { module: "webhook", level: "warn" },
      `Signature verification failed for route ${route.id}`,
    );
    return;
  }

  // 2. Match labels
  if (!labelsMatch(issue.issueLabels, route.labels)) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} labels don't match route ${route.id}`,
    );
    return;
  }

  // 3. Match author
  if (!authorAllowed(issue.issueAuthor, route.authors)) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} author "${issue.issueAuthor}" not allowed for route ${route.id}`,
    );
    return;
  }

  // 4. Dedup — check if we already processed this issue
  const existing = await db.webhookEvent.findFirst({
    where: {
      repoUrl: issue.repoUrl.toLowerCase(),
      issueNumber: issue.issueNumber,
      accountId: route.accountId,
      status: { notIn: ["skipped", "failed"] },
    },
  });
  if (existing) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} already processed (event ${existing.id}, status=${existing.status})`,
    );
    return;
  }

  // 5. Create webhook event record
  const event = await db.webhookEvent.create({
    data: {
      accountId: route.accountId,
      provider,
      deliveryId,
      repoUrl: issue.repoUrl.toLowerCase(),
      issueNumber: issue.issueNumber,
      issueTitle: issue.issueTitle,
      issueAuthor: issue.issueAuthor,
      issueLabels: issue.issueLabels,
      issueUrl: issue.issueUrl,
      status: "pending",
      machineId: route.machineId,
    },
  });

  // 6. Emit ephemeral event to target machine
  eventRouter.emitEphemeral({
    userId: route.accountId,
    payload: {
      type: "webhook-trigger",
      webhookEventId: event.id,
      issueNumber: issue.issueNumber,
      issueTitle: issue.issueTitle,
      issueBody: issue.issueBody,
      issueAuthor: issue.issueAuthor,
      issueLabels: issue.issueLabels,
      issueUrl: issue.issueUrl,
      repoUrl: issue.repoUrl,
      repoPath: route.repoPath,
      provider,
    },
    recipientFilter: {
      type: "machine-scoped-only",
      machineId: route.machineId,
    },
  });

  // 7. Update status to dispatched
  await db.webhookEvent.update({
    where: { id: event.id },
    data: { status: "dispatched" },
  });

  log(
    { module: "webhook" },
    `Dispatched webhook for issue #${issue.issueNumber} to machine ${route.machineId}`,
  );
}
