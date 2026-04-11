import type { SuggestionAcceptAudit, SuggestionSummary } from "@kmmao/happy-wire";
import { db } from "@/storage/db";
import { worldSuggestionAccept } from "./worldSuggestionAccept";

export interface WorldSuggestionAutoAcceptProjectConfig {
  autoAcceptSafeSuggestedTasks: boolean;
  maxAutoAcceptsPerDay: number | null;
}

export function parseWorldSuggestionAutoAcceptProjectConfig(
  supervisorConfig: string | null,
): WorldSuggestionAutoAcceptProjectConfig {
  try {
    if (supervisorConfig) {
      const cfg = JSON.parse(supervisorConfig);
      const enabled = cfg?.worldAutonomy?.autoAcceptSafeSuggestedTasks;
      const rawLimit = cfg?.worldAutonomy?.maxAutoAcceptsPerDay;
      const maxAutoAcceptsPerDay = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : null;
      if (typeof enabled === "boolean") {
        return {
          autoAcceptSafeSuggestedTasks: enabled,
          maxAutoAcceptsPerDay,
        };
      }
    }
  } catch {
    // Ignore invalid JSON and fall back to disabled.
  }

  return { autoAcceptSafeSuggestedTasks: false, maxAutoAcceptsPerDay: null };
}

export function shouldAutoAcceptSuggestedTask(input: {
  projectConfig: WorldSuggestionAutoAcceptProjectConfig;
  suggestion: SuggestionSummary;
}): boolean {
  if (!input.projectConfig.autoAcceptSafeSuggestedTasks) {
    return false;
  }

  if (input.suggestion.type !== "suggested_task") {
    return false;
  }

  if (input.suggestion.bucket !== "next_step") {
    return false;
  }

  if (input.suggestion.requiresHuman) {
    return false;
  }

  if (!input.suggestion.payload.task.title.trim() || !input.suggestion.payload.task.prompt.trim()) {
    return false;
  }

  if (input.suggestion.evidence.some((item) => item.kind === "message" || item.kind === "decision")) {
    return false;
  }

  return true;
}

export function buildAutoAcceptAudit(input: {
  suggestion: SuggestionSummary;
}): SuggestionAcceptAudit {
  return {
    rule: "safe_suggested_task_auto_accept",
    checks: [
      `type:${input.suggestion.type}`,
      `bucket:${input.suggestion.bucket}`,
      `requiresHuman:${String(input.suggestion.requiresHuman)}`,
      "payload:task_title_prompt_present",
      "evidence:no_message_decision",
    ],
  };
}

export async function autoAcceptSuggestedTasksIfEnabled(input: {
  accountId: string;
  projectId: string;
  supervisorConfig: string | null;
  suggestions: SuggestionSummary[];
}): Promise<void> {
  const projectConfig = parseWorldSuggestionAutoAcceptProjectConfig(input.supervisorConfig);
  const remainingQuota = await getRemainingDailyAutoAcceptQuota({
    accountId: input.accountId,
    projectId: input.projectId,
    maxAutoAcceptsPerDay: projectConfig.maxAutoAcceptsPerDay,
  });

  if (remainingQuota === 0) {
    return;
  }

  let acceptedCount = 0;

  for (const suggestion of input.suggestions) {
    if (!shouldAutoAcceptSuggestedTask({ projectConfig, suggestion })) {
      continue;
    }
    if (remainingQuota !== null && acceptedCount >= remainingQuota) {
      break;
    }

    await worldSuggestionAccept({
      accountId: input.accountId,
      projectId: input.projectId,
      suggestionId: suggestion.id,
      acceptSource: "system_auto",
      acceptAudit: buildAutoAcceptAudit({ suggestion }),
    });
    acceptedCount += 1;
  }
}

async function getRemainingDailyAutoAcceptQuota(input: {
  accountId: string;
  projectId: string;
  maxAutoAcceptsPerDay: number | null;
}): Promise<number | null> {
  if (input.maxAutoAcceptsPerDay === null) {
    return null;
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const currentCount = await db.worldSuggestion.count({
    where: {
      accountId: input.accountId,
      projectId: input.projectId,
      status: "accepted",
      acceptSource: "system_auto",
      actedAt: { gte: dayStart },
    },
  });

  return Math.max(input.maxAutoAcceptsPerDay - currentCount, 0);
}
