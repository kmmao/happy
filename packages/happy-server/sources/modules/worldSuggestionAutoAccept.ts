import type { SuggestionSummary } from "@kmmao/happy-wire";
import { worldSuggestionAccept } from "./worldSuggestionAccept";

export interface WorldSuggestionAutoAcceptProjectConfig {
  autoAcceptSafeSuggestedTasks: boolean;
}

export function parseWorldSuggestionAutoAcceptProjectConfig(
  supervisorConfig: string | null,
): WorldSuggestionAutoAcceptProjectConfig {
  try {
    if (supervisorConfig) {
      const cfg = JSON.parse(supervisorConfig);
      const enabled = cfg?.worldAutonomy?.autoAcceptSafeSuggestedTasks;
      if (typeof enabled === "boolean") {
        return { autoAcceptSafeSuggestedTasks: enabled };
      }
    }
  } catch {
    // Ignore invalid JSON and fall back to disabled.
  }

  return { autoAcceptSafeSuggestedTasks: false };
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

export async function autoAcceptSuggestedTasksIfEnabled(input: {
  accountId: string;
  projectId: string;
  supervisorConfig: string | null;
  suggestions: SuggestionSummary[];
}): Promise<void> {
  const projectConfig = parseWorldSuggestionAutoAcceptProjectConfig(input.supervisorConfig);

  for (const suggestion of input.suggestions) {
    if (!shouldAutoAcceptSuggestedTask({ projectConfig, suggestion })) {
      continue;
    }

    await worldSuggestionAccept({
      accountId: input.accountId,
      projectId: input.projectId,
      suggestionId: suggestion.id,
      acceptSource: "system_auto",
    });
  }
}
