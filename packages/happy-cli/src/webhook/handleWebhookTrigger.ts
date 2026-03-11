/**
 * Handle incoming webhook-trigger events from the Server.
 *
 * Orchestrates: worktree creation → prompt building → session spawning →
 * initial prompt delivery via temp file → status reporting.
 */

import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { logger } from "@/ui/logger";
import {
  createWorktreeLocal,
  removeWorktreeForced,
} from "./createWorktreeLocal";
import { fetchIssueComments } from "./fetchIssueComments";
import { buildIssuePrompt } from "./buildIssuePrompt";
import type { WebhookTriggerData } from "@/api/apiMachine";
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";

export interface WebhookHandlerDeps {
  readonly spawnSession: (
    options: SpawnSessionOptions,
  ) => Promise<SpawnSessionResult>;
  readonly emitWebhookStatus: (data: {
    webhookEventId: string;
    status: "dispatched" | "completed" | "failed";
    sessionId?: string;
    errorMessage?: string;
  }) => void;
}

// Track in-flight webhook events to prevent duplicate processing
const processingEvents = new Set<string>();

export async function handleWebhookTrigger(
  data: WebhookTriggerData,
  deps: WebhookHandlerDeps,
): Promise<void> {
  const { webhookEventId, issueNumber, repoPath, provider, repoUrl } = data;

  // Guard against duplicate processing
  if (processingEvents.has(webhookEventId)) {
    logger.debug(
      `[WEBHOOK] Event ${webhookEventId} already being processed, skipping`,
    );
    return;
  }
  processingEvents.add(webhookEventId);

  let createdWorktreeBranch: string | undefined;

  try {
    logger.debug(
      `[WEBHOOK] Processing webhook event ${webhookEventId} for issue #${issueNumber}`,
    );

    // 1. Create worktree locally
    const worktreeResult = await createWorktreeLocal(repoPath);
    if (!worktreeResult.success) {
      const errorMessage = worktreeResult.error ?? "Failed to create worktree";
      logger.debug(`[WEBHOOK] Worktree creation failed: ${errorMessage}`);
      deps.emitWebhookStatus({
        webhookEventId,
        status: "failed",
        errorMessage,
      });
      return;
    }

    logger.debug(
      `[WEBHOOK] Worktree created: ${worktreeResult.worktreePath} (branch: ${worktreeResult.branchName})`,
    );
    createdWorktreeBranch = worktreeResult.branchName;

    // 2. Fetch issue comments (non-critical)
    let comments: readonly {
      author: string;
      body: string;
      createdAt: number;
    }[] = [];
    try {
      comments = await fetchIssueComments(
        provider,
        repoUrl,
        issueNumber,
        repoPath,
      );
      logger.debug(
        `[WEBHOOK] Fetched ${comments.length} comments for issue #${issueNumber}`,
      );
    } catch (error) {
      logger.debug(
        `[WEBHOOK] Failed to fetch comments for issue #${issueNumber}: ${error}`,
      );
    }

    // 3. Build the initial prompt
    const prompt = buildIssuePrompt(
      {
        issueNumber: data.issueNumber,
        issueTitle: data.issueTitle,
        issueBody: data.issueBody,
        issueAuthor: data.issueAuthor,
        issueLabels: data.issueLabels,
        issueUrl: data.issueUrl,
        repoUrl: data.repoUrl,
      },
      comments,
      {
        branchName: worktreeResult.branchName,
        parentBranch: worktreeResult.parentBranch,
      },
    );

    // 4. Write prompt to temp file in the worktree
    const promptDir = join(worktreeResult.worktreePath, ".claude");
    await mkdir(promptDir, { recursive: true });
    const promptFilePath = join(promptDir, "initial-prompt.txt");
    await writeFile(promptFilePath, prompt, "utf-8");
    logger.debug(`[WEBHOOK] Wrote initial prompt to ${promptFilePath}`);

    // 5. Spawn session in the worktree directory
    const spawnResult = await deps.spawnSession({
      directory: worktreeResult.worktreePath,
      approvedNewDirectoryCreation: true,
      agent: "claude",
      environmentVariables: {
        HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      },
    });

    if (spawnResult.type !== "success") {
      const errorMessage =
        spawnResult.type === "error"
          ? spawnResult.errorMessage
          : "Failed to spawn session";
      logger.debug(`[WEBHOOK] Session spawn failed: ${errorMessage}`);
      deps.emitWebhookStatus({
        webhookEventId,
        status: "failed",
        errorMessage,
      });
      // Clean up prompt file and worktree on failure
      try {
        await unlink(promptFilePath);
      } catch {
        // best-effort
      }
      try {
        await removeWorktreeForced(repoPath, worktreeResult.branchName);
      } catch {
        // best-effort
      }
      return;
    }

    // 6. Report success
    logger.debug(
      `[WEBHOOK] Session ${spawnResult.sessionId} spawned for issue #${issueNumber}`,
    );
    deps.emitWebhookStatus({
      webhookEventId,
      status: "completed",
      sessionId: spawnResult.sessionId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.debug(
      `[WEBHOOK] Failed to handle webhook event ${webhookEventId}: ${errorMessage}`,
    );
    deps.emitWebhookStatus({
      webhookEventId,
      status: "failed",
      errorMessage,
    });
    // Clean up worktree if it was created before the error
    if (createdWorktreeBranch) {
      try {
        await removeWorktreeForced(repoPath, createdWorktreeBranch);
      } catch {
        // best-effort
      }
    }
  } finally {
    processingEvents.delete(webhookEventId);
  }
}
