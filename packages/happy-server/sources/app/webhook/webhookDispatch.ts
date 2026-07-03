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
  parseWebhookPROpen,
  parseWebhookPush,
  parseWebhookCiRun,
  getEventTypeHeader,
  getDeliveryId,
} from "./webhookParsers";
import type {
  ParsedWebhookIssue,
  ParsedWebhookPRMerge,
  ParsedWebhookPROpen,
  ParsedWebhookCiRun,
} from "./webhookParsers";
import { redis } from "@/storage/redis";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { fetchIssueLabelsFromProvider } from "./webhookFetchLabels";
import { checkDailyRunLimit } from "@/modules/supervisorLimits";
import { emitConfiguredSupervisorRunTrigger } from "@/modules/supervisorRunTrigger";
import {
  isUnifiedRuntimeProfileResolverEnabled,
  resolveRuntimeProfile,
  notifyRuntimeProfileFailure,
} from "@/modules/runtimeProfileResolver";

/**
 * Extract the repository URL from a webhook body.
 * Each provider puts it in a slightly different place.
 */
export function extractRepoUrl(provider: string, body: unknown): string | null {
  const b = body as Record<string, Record<string, unknown>> | null | undefined;
  switch (provider) {
    case "github":
    case "gitea":
      return (b?.repository?.html_url as string) ?? null;
    case "gitlab":
      return (b?.project?.web_url as string) ?? null;
    default:
      return null;
  }
}

/**
 * Normalize a repo URL for consistent matching.
 * Removes trailing slashes and .git suffix, lowercases.
 */
export function normalizeRepoUrl(url: string): string {
  return url
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Check if an issue's labels match any of the route's trigger labels.
 */
export function labelsMatch(
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
export function authorAllowed(
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
  body: unknown,
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
    select: {
      id: true,
      accountId: true,
      repoUrl: true,
      webhookSecret: true,
      apiToken: true,
      labels: true,
      authors: true,
      machineId: true,
      repoPath: true,
      provider: true,
      profileId: true,
    },
    take: 1000,
  });

  if (routes.length >= 1000) {
    log(
      { module: "webhook", level: "warn" },
      `webhookRoute query hit the 1000-row limit for repoUrl=${normalizedUrl} — some routes may be missing`,
    );
  }

  if (routes.length === 0) {
    return { dispatched: false, reason: "no_matching_routes" };
  }

  // 3. Get event type and delivery ID
  const eventType = getEventTypeHeader(provider, headers);
  const deliveryId = getDeliveryId(provider, headers);

  if (!deliveryId) {
    return { dispatched: false, reason: "no_delivery_id" };
  }

  // 4. Parse the issue data — or try PR merge / push
  const issue = parseWebhookIssue(provider, body, eventType);
  if (!issue) {
    // Not an issue event — check if it's a PR merge
    const prMerge = parseWebhookPRMerge(provider, body, eventType);
    if (!prMerge) {
      // Not a PR merge — check if it's a push event
      const pushEvent = parseWebhookPush(provider, body, eventType);
      if (pushEvent && pushEvent.changedFiles.length > 0) {
        return await handlePushSupervisorTrigger(
          normalizedUrl,
          pushEvent.changedFiles,
          pushEvent.branch,
          routes,
          provider,
          rawBody,
          headers,
        );
      }

      // Check if it's a PR open event (for supervisor prReview dimension)
      const prOpen = parseWebhookPROpen(provider, body, eventType);
      if (prOpen) {
        return await handlePROpenSupervisorTrigger(
          normalizedUrl,
          prOpen,
          routes,
          provider,
          rawBody,
          headers,
        );
      }

      // Check if it's a CI run event (GitHub Actions workflow_run)
      const ciRun = parseWebhookCiRun(provider, body, eventType);
      if (ciRun) {
        await storeCiRunForRoutes(routes, ciRun, provider, rawBody, headers);
        return { dispatched: true };
      }

      return { dispatched: false, reason: "not_supported_event" };
    }

    if (prMerge.linkedIssueNumbers.length === 0) {
      return { dispatched: false, reason: "pr_no_linked_issues" };
    }

    // Handle PR merge: archive associated sessions (concurrent)
    const prMergeResults = await Promise.allSettled(
      routes.map((route) =>
        processRoutePRMerge(route, provider, rawBody, headers, deliveryId, prMerge),
      ),
    );

    let anyDispatched = false;
    for (const result of prMergeResults) {
      if (result.status === "fulfilled" && result.value) {
        anyDispatched = true;
      } else if (result.status === "rejected") {
        log(
          { module: "webhook", level: "error" },
          `Failed to process PR merge: ${result.reason}`,
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

/**
 * The single route-signature gate every dispatch path crosses. Owns the one fact
 * a caller must NOT get wrong: the secret is decrypted under the
 * `["webhook-route", "<accountId>:<repoUrl>"]` scope before verifying — so that
 * key derivation lives here once instead of being copy-pasted at each call site
 * (a mismatch would silently fail all verification). Returns true iff the
 * signature is valid.
 *
 * `options.failureLog` preserves each caller's historical failure logging:
 * omitted → generic warn; `{ label }` → prefixed warn; `false` → silent.
 */
function verifyRouteSignature(
  route: { id: string; accountId: string; repoUrl: string; webhookSecret: Uint8Array<ArrayBuffer> },
  provider: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
  options?: { failureLog?: false | { label: string } },
): boolean {
  const secret = decryptString(
    ["webhook-route", `${route.accountId}:${route.repoUrl}`],
    route.webhookSecret as unknown as Uint8Array<ArrayBuffer>,
  );
  const valid = verifyWebhookSignature(provider, secret, rawBody, headers);
  if (!valid && options?.failureLog !== false) {
    const label = options?.failureLog?.label;
    log(
      { module: "webhook", level: "warn" },
      `${label ? label + " s" : "S"}ignature verification failed for route ${route.id}`,
    );
  }
  return valid;
}

/**
 * Resolve effective labels for an issue.
 * Falls back to fetching from provider API when payload labels are empty (Gitea bug workaround).
 */
async function resolveEffectiveLabels(
  issue: ParsedWebhookIssue,
  route: { labels: string[]; apiToken: Uint8Array<ArrayBuffer> | null; accountId: string },
  provider: string,
): Promise<readonly string[]> {
  if (
    issue.issueLabels.length > 0 ||
    route.labels.length === 0 ||
    !route.apiToken
  ) {
    return issue.issueLabels;
  }

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
    log(
      { module: "webhook" },
      `Fetched labels from API for issue #${issue.issueNumber}: [${fetched.join(",")}]`,
    );
    return fetched;
  }
  return issue.issueLabels;
}

/**
 * Dedup check + create a pending webhook event in a single transaction.
 * Returns null if the issue was already processed.
 */
async function createWebhookEventIfNew(
  route: { accountId: string; machineId: string },
  provider: string,
  deliveryId: string,
  issue: ParsedWebhookIssue,
  effectiveLabels: readonly string[],
) {
  return await inTx(async (tx) => {
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
        issueLabels: [...effectiveLabels],
        issueUrl: issue.issueUrl,
        status: "pending",
        machineId: route.machineId,
      },
    });
  });
}

/**
 * Decrypt the route's API token for CLI-side use (comment fetching, PR creation).
 * Returns undefined if no token or decryption fails (non-critical).
 */
function decryptRouteApiToken(
  route: { apiToken: Uint8Array<ArrayBuffer> | null; accountId: string; repoUrl: string },
): string | undefined {
  if (!route.apiToken) return undefined;
  try {
    return decryptString(
      ["webhook-route-token", `${route.accountId}:${route.repoUrl}`],
      route.apiToken as unknown as Uint8Array<ArrayBuffer>,
    );
  } catch (err) {
    log(
      { module: "webhook", level: "warn" },
      `Failed to decrypt API token for route ${route.accountId}:${route.repoUrl}: ${String(err)}`,
    );
    return undefined;
  }
}

/**
 * Process a single route for an issue webhook event.
 * Orchestrates: signature verification → label matching → author check → dedup → dispatch.
 */
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
    profileId: string | null;
  },
  provider: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
  deliveryId: string,
  issue: ParsedWebhookIssue,
): Promise<boolean> {
  if (!verifyRouteSignature(route, provider, rawBody, headers)) return false;

  const effectiveLabels = await resolveEffectiveLabels(issue, route, provider);

  if (!labelsMatch(effectiveLabels, route.labels)) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} labels don't match route ${route.id} — issue has [${effectiveLabels.join(",")}], route expects [${route.labels.join(",")}]`,
    );
    return false;
  }

  if (!authorAllowed(issue.issueAuthor, route.authors)) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} author "${issue.issueAuthor}" not allowed for route ${route.id}`,
    );
    return false;
  }

  const event = await createWebhookEventIfNew(route, provider, deliveryId, issue, effectiveLabels);
  if (!event) {
    log(
      { module: "webhook" },
      `Issue #${issue.issueNumber} already processed for route ${route.id}`,
    );
    return false;
  }

  const decryptedApiToken = decryptRouteApiToken(route);

  let resolvedRuntimeProfile: Awaited<ReturnType<typeof resolveRuntimeProfile>> | null = null;
  if (isUnifiedRuntimeProfileResolverEnabled()) {
    resolvedRuntimeProfile = await resolveRuntimeProfile({
      accountId: route.accountId,
      explicitProfileId: route.profileId,
      purpose: "webhook",
    });
    if (!resolvedRuntimeProfile.ok) {
      // No silent fallback (per runtimeProfileResolver contract): surface the
      // failure to the operator and skip dispatch, mirroring the cron
      // (triggerScheduleRunner) and inbound-trigger (webhookTriggerRoutes)
      // paths. Mark the event "failed" (not "skipped") so a later redelivery
      // can retry once the profile binding is fixed.
      notifyRuntimeProfileFailure({
        accountId: route.accountId,
        purpose: "webhook",
        failure: resolvedRuntimeProfile,
        referenceUrl: issue.issueUrl,
        refType: "webhookRoute",
        refId: route.id,
      });
      await db.webhookEvent.update({
        where: { id: event.id },
        data: { status: "failed", errorMessage: resolvedRuntimeProfile.message },
      });
      return false;
    }
  }

  await emitSyncEphemeral(route.accountId, {
    t: "webhook-trigger",
    machineId: route.machineId,
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
    apiToken: decryptedApiToken ?? null,
    ...(resolvedRuntimeProfile?.ok ? { runtimeProfile: resolvedRuntimeProfile.runtimeProfile } : {}),
  });

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
  if (!verifyRouteSignature(route, provider, rawBody, headers, { failureLog: { label: "PR merge" } })) {
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
    take: 1000,
  });

  if (webhookEvents.length >= 1000) {
    log(
      { module: "webhook", level: "warn" },
      `webhookEvent query hit the 1000-row limit for PR #${prMerge.prNumber} in route ${route.id} — some sessions may be missing`,
    );
  }

  if (webhookEvents.length === 0) {
    log(
      { module: "webhook" },
      `PR #${prMerge.prNumber} merge: no matching webhook sessions found for issues [${prMerge.linkedIssueNumbers.join(",")}]`,
    );
    return false;
  }

  // 4. Batch-archive all associated sessions in a single DB call
  const sessionIds = webhookEvents
    .map((e) => e.sessionId)
    .filter((id): id is string => id != null);

  if (sessionIds.length === 0) return false;

  const now = Date.now();

  try {
    await db.session.updateMany({
      where: {
        id: { in: sessionIds },
        accountId: route.accountId,
        active: true,
      },
      data: {
        active: false,
        lastActiveAt: new Date(now),
      },
    });
  } catch (error) {
    log(
      { module: "webhook", level: "error" },
      `Failed to batch-archive sessions for PR #${prMerge.prNumber}: ${error}`,
    );
    return false;
  }

  // Evict from cache and emit events for each session
  for (const webhookEvent of webhookEvents) {
    if (!webhookEvent.sessionId) continue;

    activityCache.invalidateSession(webhookEvent.sessionId);

    await emitSyncEphemeral(route.accountId, {
      t: "session-activity",
      sessionId: webhookEvent.sessionId,
      active: false,
      activeAt: now,
    });

    await emitSyncEphemeral(route.accountId, {
      t: "webhook-pr-merged",
      prNumber: prMerge.prNumber,
      prUrl: prMerge.prUrl,
      issueNumber: webhookEvent.issueNumber,
      sessionId: webhookEvent.sessionId,
      machineId: route.machineId,
      repoPath: route.repoPath,
    });

    log(
      { module: "webhook" },
      `PR #${prMerge.prNumber} merged: archived session ${webhookEvent.sessionId} for issue #${webhookEvent.issueNumber}`,
    );
  }

  return true;
}

/**
 * Handle a push event by triggering incremental supervisor scans
 * for projects that have push trigger enabled.
 */
async function handlePushSupervisorTrigger(
  normalizedRepoUrl: string,
  changedFiles: string[],
  branch: string,
  routes: Array<{
    id: string;
    accountId: string;
    repoUrl: string;
    webhookSecret: Uint8Array<ArrayBuffer>;
    machineId: string;
    repoPath: string;
    provider: string;
  }>,
  provider: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
): Promise<DispatchResult> {
  // Find projects with push trigger enabled that match this repo
  const projects = await db.project.findMany({
    where: {
      repoUrl: normalizedRepoUrl,
      archived: false,
      supervisorPushTriggerEnabled: true,
      supervisorConfig: { not: null },
    },
    select: {
      id: true,
      accountId: true,
      machineId: true,
      path: true,
      supervisorMode: true,
      supervisorEnabledDimensions: true,
      supervisorCustomRules: true,
      supervisorConfig: true,
    },
    take: 1000,
  });

  if (projects.length >= 1000) {
    log(
      { module: "webhook", level: "warn" },
      `project push-trigger query hit the 1000-row limit for repoUrl=${normalizedRepoUrl} — some projects may be missing`,
    );
  }

  if (projects.length === 0) {
    return { dispatched: false, reason: "no_push_trigger_projects" };
  }

  // Process projects concurrently
  const results = await Promise.allSettled(
    projects.map(async (project) => {
      // Find a matching route for signature verification
      const route = routes.find(
        (r) => r.accountId === project.accountId,
      );
      if (!route) return false;

      // Verify signature
      if (!verifyRouteSignature(route, provider, rawBody, headers, { failureLog: false })) {
        return false;
      }

      // Check daily limit
      const limitCheck = await checkDailyRunLimit(project.id);
      if (!limitCheck.allowed) {
        log(
          { module: "webhook" },
          `Push trigger: daily limit reached for project ${project.id}`,
        );
        return false;
      }

      // Check no active run + create in a single transaction to prevent race conditions
      const run = await inTx(async (tx) => {
        const existingRun = await tx.supervisorRun.findFirst({
          where: {
            projectId: project.id,
            accountId: project.accountId,
            status: { in: ["pending", "running"] },
          },
          select: { id: true },
        });
        if (existingRun) return null;

        const created = await tx.supervisorRun.create({
          data: {
            projectId: project.id,
            accountId: project.accountId,
            trigger: "push",
            status: "pending",
          },
        });

        const todayStart = new Date(Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          new Date().getUTCDate(),
        ));
        await tx.project.update({
          where: { id: project.id },
          data: {
            supervisorDailyRunCount: { increment: 1 },
            supervisorDailyRunCountResetAt: todayStart,
          },
        });

        return created;
      });
      if (!run) return false;

      // Parse dimensions
      const dimensions = project.supervisorEnabledDimensions
        ? project.supervisorEnabledDimensions.split(",").map((d) => d.trim()).filter(Boolean)
        : undefined;

      // Emit trigger with changed files
      await emitConfiguredSupervisorRunTrigger({
        userId: project.accountId,
        projectId: project.id,
        runId: run.id,
        trigger: "push",
        machineId: project.machineId,
        repoPath: project.path,
        supervisorConfig: project.supervisorConfig,
        mode: project.supervisorMode ?? undefined,
        dimensions,
        changedFiles,
        customRules: project.supervisorCustomRules ?? undefined,
      });

      log(
        { module: "webhook" },
        `Push trigger: started supervisor run ${run.id} for project ${project.id} (${changedFiles.length} files on ${branch})`,
      );

      return true;
    }),
  );

  let anyTriggered = false;
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      anyTriggered = true;
    } else if (result.status === "rejected") {
      log(
        { module: "webhook", level: "error" },
        `Push trigger failed: ${result.reason}`,
      );
    }
  }

  return {
    dispatched: anyTriggered,
    reason: anyTriggered ? undefined : "push_trigger_failed",
  };
}

/**
 * Handle a PR open event by triggering a focused prReview supervisor scan
 * for projects that have push trigger enabled and prReview dimension configured.
 */
async function handlePROpenSupervisorTrigger(
  normalizedRepoUrl: string,
  prOpen: ParsedWebhookPROpen,
  routes: Array<{
    id: string;
    accountId: string;
    repoUrl: string;
    webhookSecret: Uint8Array<ArrayBuffer>;
    machineId: string;
    repoPath: string;
    provider: string;
  }>,
  provider: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
): Promise<DispatchResult> {
  // Find projects with push trigger enabled that have prReview in enabled dimensions
  const projects = await db.project.findMany({
    where: {
      repoUrl: normalizedRepoUrl,
      archived: false,
      supervisorPushTriggerEnabled: true,
      supervisorConfig: { not: null },
    },
    select: {
      id: true,
      accountId: true,
      machineId: true,
      path: true,
      supervisorMode: true,
      supervisorEnabledDimensions: true,
      supervisorCustomRules: true,
      supervisorConfig: true,
    },
    take: 1000,
  });

  if (projects.length >= 1000) {
    log(
      { module: "webhook", level: "warn" },
      `project pr-open trigger query hit the 1000-row limit for repoUrl=${normalizedRepoUrl} — some projects may be missing`,
    );
  }

  // Only process projects that have prReview dimension enabled
  const prReviewProjects = projects.filter((p) =>
    p.supervisorEnabledDimensions?.split(",").map((d) => d.trim()).includes("prReview"),
  );

  if (prReviewProjects.length === 0) {
    return { dispatched: false, reason: "no_pr_review_projects" };
  }

  const results = await Promise.allSettled(
    prReviewProjects.map(async (project) => {
      const route = routes.find((r) => r.accountId === project.accountId);
      if (!route) return false;

      // Verify signature
      if (!verifyRouteSignature(route, provider, rawBody, headers, { failureLog: false })) {
        return false;
      }

      // Check daily limit
      const limitCheck = await checkDailyRunLimit(project.id);
      if (!limitCheck.allowed) {
        log(
          { module: "webhook" },
          `PR open trigger: daily limit reached for project ${project.id}`,
        );
        return false;
      }

      // Create run atomically (prevent duplicate runs)
      const run = await inTx(async (tx) => {
        const existingRun = await tx.supervisorRun.findFirst({
          where: {
            projectId: project.id,
            accountId: project.accountId,
            status: { in: ["pending", "running"] },
          },
          select: { id: true },
        });
        if (existingRun) return null;

        const created = await tx.supervisorRun.create({
          data: {
            projectId: project.id,
            accountId: project.accountId,
            trigger: "pr-open",
            status: "pending",
          },
        });

        const todayStart = new Date(Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          new Date().getUTCDate(),
        ));
        await tx.project.update({
          where: { id: project.id },
          data: {
            supervisorDailyRunCount: { increment: 1 },
            supervisorDailyRunCountResetAt: todayStart,
          },
        });

        return created;
      });
      if (!run) return false;

      // Emit trigger with prReview dimension and PR context
      await emitConfiguredSupervisorRunTrigger({
        userId: project.accountId,
        projectId: project.id,
        runId: run.id,
        trigger: "pr-open",
        machineId: project.machineId,
        repoPath: project.path,
        supervisorConfig: project.supervisorConfig,
        mode: project.supervisorMode ?? undefined,
        dimensions: ["prReview"],
        customRules: project.supervisorCustomRules ?? undefined,
        prContext: {
          prNumber: prOpen.prNumber,
          prTitle: prOpen.prTitle,
          prDescription: prOpen.prDescription,
          prUrl: prOpen.prUrl,
          headBranch: prOpen.headBranch,
          baseBranch: prOpen.baseBranch,
          author: prOpen.author,
        },
      });

      log(
        { module: "webhook" },
        `PR open trigger: started supervisor run ${run.id} for project ${project.id} (PR #${prOpen.prNumber}: ${prOpen.prTitle})`,
      );

      return true;
    }),
  );

  let anyTriggered = false;
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      anyTriggered = true;
    } else if (result.status === "rejected") {
      log(
        { module: "webhook", level: "error" },
        `PR open trigger failed: ${result.reason}`,
      );
    }
  }

  return {
    dispatched: anyTriggered,
    reason: anyTriggered ? undefined : "pr_open_trigger_failed",
  };
}

/**
 * Store a CI run event in Redis for each matching webhook route's account.
 * Uses a sorted set per (accountId, repoUrl) scored by updated_at timestamp.
 * Keeps at most 10 entries per key with a 7-day TTL.
 */
async function storeCiRunForRoutes(
  routes: Array<{
    id: string;
    accountId: string;
    repoUrl: string;
    webhookSecret: Uint8Array<ArrayBuffer>;
  }>,
  ciRun: ParsedWebhookCiRun,
  provider: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
): Promise<void> {
  const seen = new Set<string>();

  for (const route of routes) {
    // Only process each accountId once for this repoUrl
    if (seen.has(route.accountId)) continue;

    try {
      const secret = decryptString(
        ["webhook-route", `${route.accountId}:${route.repoUrl}`],
        route.webhookSecret as unknown as Uint8Array<ArrayBuffer>,
      );
      if (!verifyWebhookSignature(provider, secret, rawBody, headers)) continue;

      seen.add(route.accountId);

      const key = `ci:runs:${route.accountId}:${route.repoUrl}`;
      const score = new Date(ciRun.updatedAt).getTime();
      const member = JSON.stringify({
        runId: ciRun.runId,
        name: ciRun.name,
        branch: ciRun.branch,
        sha: ciRun.sha,
        status: ciRun.status,
        conclusion: ciRun.conclusion,
        url: ciRun.url,
        triggerEvent: ciRun.triggerEvent,
        createdAt: ciRun.createdAt,
        updatedAt: ciRun.updatedAt,
      });

      await redis.zadd(key, score, member);
      // Keep only the 10 most recent runs (remove oldest)
      await redis.zremrangebyrank(key, 0, -11);
      // TTL: 7 days
      await redis.expire(key, 7 * 24 * 3600);

      log(
        { module: "webhook" },
        `CI run ${ciRun.runId} (${ciRun.name}) stored for account ${route.accountId}, repo ${route.repoUrl}, status=${ciRun.status} conclusion=${ciRun.conclusion ?? "null"}`,
      );
    } catch (error) {
      log(
        { module: "webhook", level: "error" },
        `Failed to store CI run for route ${route.id}: ${error}`,
      );
    }
  }
}
