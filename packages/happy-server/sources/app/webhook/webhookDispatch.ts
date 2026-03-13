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
import { inTx } from "@/storage/inTx";
import { Prisma } from "@prisma/client";
import { activityCache } from "@/app/presence/sessionCache";
import { verifyWebhookSignature } from "./webhookVerify";
import {
  parseWebhookIssue,
  parseWebhookPRMerge,
  getEventTypeHeader,
  getDeliveryId,
} from "./webhookParsers";
import type {
  ParsedWebhookIssue,
  ParsedWebhookPRMerge,
} from "./webhookParsers";
import {
  buildSessionActivityEphemeral,
  eventRouter,
} from "@/app/events/eventRouter";
import { fetchIssueLabelsFromProvider } from "./webhookFetchLabels";

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
  // Empty route labels = match any issue (no label filter)
  if (routeLabels.length === 0) return true;
  const triggerSet = new Set(
    routeLabels
      .flatMap((l) => l.split(",").map((s) => s.trim().toLowerCase()))
      .filter(Boolean),
  );
  return issueLabels.some((l) => triggerSet.has(l));
}

/**
 * Check if the issue author is in the route's allowed authors list.
 */
function authorAllowed(
  author: string,
  allowedAuthors: readonly string[],
): boolean {
  // Empty allowed list = allow any author (no author filter)
  if (allowedAuthors.length === 0) return true;
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

  // 4. Parse the issue data — or try PR merge
  const issue = parseWebhookIssue(provider, body, eventType);
  if (!issue) {
    // Not an issue event — check if it's a PR merge
    const prMerge = parseWebhookPRMerge(provider, body, eventType);
    if (!prMerge) {
      return { dispatched: false, reason: "not_supported_event" };
    }

    if (prMerge.linkedIssueNumbers.length === 0) {
      return { dispatched: false, reason: "pr_no_linked_issues" };
    }

    // Handle PR merge: archive associated sessions
    let anyDispatched = false;
    for (const route of routes) {
      try {
        const dispatched = await processRoutePRMerge(
          route,
          provider,
          rawBody,
          headers,
          deliveryId,
          prMerge,
        );
        if (dispatched) anyDispatched = true;
      } catch (error) {
        log(
          { module: "webhook", level: "error" },
          `Failed to process PR merge for route ${route.id}: ${error}`,
        );
      }
    }

    return {
      dispatched: anyDispatched,
      reason: anyDispatched ? undefined : "all_routes_failed",
    };
  }

  let anyDispatched = false;

  // 5. Process each matching route
  for (const route of routes) {
    try {
      const dispatched = await processRoute(
        route,
        provider,
        rawBody,
        headers,
        deliveryId,
        issue,
      );
      if (dispatched) anyDispatched = true;
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
    repoUrl: string;
    webhookSecret: Uint8Array<ArrayBuffer>;
    apiToken: Uint8Array<ArrayBuffer> | null;
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
): Promise<boolean> {
  // 1. Decrypt webhook secret and verify signature (use route.repoUrl — already normalized in DB)
  const secret = decryptString(
    ["webhook-route", `${route.accountId}:${route.repoUrl}`],
    route.webhookSecret as unknown as Uint8Array<ArrayBuffer>,
  );
  const valid = verifyWebhookSignature(provider, secret, rawBody, headers);
  if (!valid) {
    log(
      { module: "webhook", level: "warn" },
      `Signature verification failed for route ${route.id}`,
    );
    return false;
  }

  // 2. Match labels — if payload labels are empty and we have an API token,
  //    fetch real labels from the provider API (Gitea bug workaround).
  let effectiveLabels = issue.issueLabels;
  if (
    effectiveLabels.length === 0 &&
    route.labels.length > 0 &&
    route.apiToken
  ) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} has no labels in payload, fetching from API...`,
    );
    const fetched = await fetchIssueLabelsFromProvider({
      provider,
      repoUrl: issue.repoUrl,
      issueNumber: issue.issueNumber,
      encryptedApiToken: route.apiToken as unknown as Uint8Array<ArrayBuffer>,
      accountId: route.accountId,
    });
    if (fetched) {
      effectiveLabels = fetched;
      log(
        { module: "webhook" },
        `Fetched labels from API for issue #${issue.issueNumber}: [${fetched.join(",")}]`,
      );
    }
  }

  if (!labelsMatch(effectiveLabels, route.labels)) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} labels don't match route ${route.id} — issue has [${effectiveLabels.join(",")}], route expects [${route.labels.join(",")}]`,
    );
    return false;
  }

  // 3. Match author
  if (!authorAllowed(issue.issueAuthor, route.authors)) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} author "${issue.issueAuthor}" not allowed for route ${route.id}`,
    );
    return false;
  }

  // 4. Dedup + create in a single transaction to prevent race conditions
  const event = await inTx(async (tx) => {
    const existing = await tx.webhookEvent.findFirst({
      where: {
        repoUrl: issue.repoUrl.toLowerCase(),
        issueNumber: issue.issueNumber,
        accountId: route.accountId,
        status: { notIn: ["skipped", "failed"] },
      },
    });
    if (existing) return null;

    return await tx.webhookEvent.create({
      data: {
        accountId: route.accountId,
        provider,
        deliveryId,
        repoUrl: issue.repoUrl.toLowerCase(),
        issueNumber: issue.issueNumber,
        issueTitle: issue.issueTitle,
        issueBody: issue.issueBody,
        issueAuthor: issue.issueAuthor,
        issueLabels: effectiveLabels,
        issueUrl: issue.issueUrl,
        status: "pending",
        machineId: route.machineId,
      },
    });
  });

  if (!event) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} already processed for route ${route.id}`,
    );
    return false;
  }

  // 5. Decrypt API token for CLI-side use (comment fetching, PR creation)
  let decryptedApiToken: string | undefined;
  if (route.apiToken) {
    try {
      decryptedApiToken = decryptString(
        ["webhook-route-token", `${route.accountId}:${route.repoUrl}`],
        route.apiToken as unknown as Uint8Array<ArrayBuffer>,
      );
    } catch {
      // Non-critical: CLI will proceed without token
    }
  }

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
      issueLabels: effectiveLabels,
      issueUrl: issue.issueUrl,
      repoUrl: issue.repoUrl,
      repoPath: route.repoPath,
      provider,
      apiToken: decryptedApiToken,
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

  return true;
}

/**
 * Process a PR merge event for a single route.
 * Finds the associated webhook session via linked issue numbers and archives it.
 */
async function processRoutePRMerge(
  route: {
    id: string;
    accountId: string;
    repoUrl: string;
    webhookSecret: Uint8Array<ArrayBuffer>;
    machineId: string;
    repoPath: string;
    provider: string;
  },
  provider: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
  deliveryId: string,
  prMerge: ParsedWebhookPRMerge,
): Promise<boolean> {
  // 1. Verify signature (use route.repoUrl which is already normalized in DB)
  const secret = decryptString(
    ["webhook-route", `${route.accountId}:${route.repoUrl}`],
    route.webhookSecret as unknown as Uint8Array<ArrayBuffer>,
  );
  const valid = verifyWebhookSignature(provider, secret, rawBody, headers);
  if (!valid) {
    log(
      { module: "webhook", level: "warn" },
      `PR merge signature verification failed for route ${route.id}`,
    );
    return false;
  }

  // 2. Dedup — create a WebhookEvent record for this delivery.
  //    The @@unique([provider, deliveryId]) constraint prevents duplicate processing.
  try {
    await db.webhookEvent.create({
      data: {
        accountId: route.accountId,
        provider,
        deliveryId,
        repoUrl: prMerge.repoUrl.toLowerCase(),
        issueNumber: prMerge.prNumber,
        issueTitle: `PR #${prMerge.prNumber} merged`,
        issueAuthor: prMerge.mergedBy,
        issueLabels: [],
        issueUrl: prMerge.prUrl,
        status: "completed",
        machineId: route.machineId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      log(
        { module: "webhook" },
        `PR merge delivery ${deliveryId} already processed for route ${route.id}`,
      );
      return false;
    }
    throw error;
  }

  // 3. Find associated webhook events by linked issue numbers
  const webhookEvents = await db.webhookEvent.findMany({
    where: {
      repoUrl: prMerge.repoUrl.toLowerCase(),
      issueNumber: { in: [...prMerge.linkedIssueNumbers] },
      accountId: route.accountId,
      status: { in: ["completed", "dispatched"] },
      sessionId: { not: null },
    },
  });

  if (webhookEvents.length === 0) {
    log(
      { module: "webhook" },
      `PR #${prMerge.prNumber} merge: no matching webhook sessions found for issues [${prMerge.linkedIssueNumbers.join(",")}]`,
    );
    return false;
  }

  let anyArchived = false;

  // 4. Archive each associated session
  for (const webhookEvent of webhookEvents) {
    if (!webhookEvent.sessionId) continue;

    try {
      const now = Date.now();

      // Archive the session
      const updated = await db.session.updateMany({
        where: {
          id: webhookEvent.sessionId,
          accountId: route.accountId,
          active: true,
        },
        data: {
          active: false,
          lastActiveAt: new Date(now),
        },
      });

      // Evict from cache so heartbeats are immediately rejected
      activityCache.invalidateSession(webhookEvent.sessionId);

      // Notify App: session is no longer active
      eventRouter.emitEphemeral({
        userId: route.accountId,
        payload: buildSessionActivityEphemeral(
          webhookEvent.sessionId,
          false,
          now,
          false,
        ),
        recipientFilter: { type: "user-scoped-only" },
      });

      // Notify App: PR was merged, update IssueSessionLink status
      eventRouter.emitEphemeral({
        userId: route.accountId,
        payload: {
          type: "webhook-pr-merged",
          prNumber: prMerge.prNumber,
          prUrl: prMerge.prUrl,
          issueNumber: webhookEvent.issueNumber,
          sessionId: webhookEvent.sessionId,
          machineId: route.machineId,
          repoPath: route.repoPath,
        },
        recipientFilter: { type: "user-scoped-only" },
      });

      log(
        { module: "webhook" },
        `PR #${prMerge.prNumber} merged: archived session ${webhookEvent.sessionId} for issue #${webhookEvent.issueNumber}${updated.count === 0 ? " (already inactive)" : ""}`,
      );

      anyArchived = true;
    } catch (error) {
      log(
        { module: "webhook", level: "error" },
        `Failed to archive session ${webhookEvent.sessionId} for PR #${prMerge.prNumber}: ${error}`,
      );
    }
  }

  return anyArchived;
}
