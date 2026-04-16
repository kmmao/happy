import { Session } from "@/sync/storageTypes";

function normalizeModelLabel(model: string): string {
  const normalized = model.replace(/-\d{8}$/, "").toLowerCase();

  if (normalized.includes("opus") && (normalized.includes("1m") || normalized.includes("[1m]"))) {
    return "Opus (1M)";
  }
  if (normalized.includes("opus")) {
    return "Opus";
  }
  if (normalized.includes("sonnet") && (normalized.includes("1m") || normalized.includes("[1m]"))) {
    return "Sonnet (1M)";
  }
  if (normalized.includes("sonnet")) {
    return "Sonnet";
  }
  if (normalized.includes("haiku")) {
    return "Haiku";
  }
  if (normalized.includes("gpt-5-mini")) {
    return "GPT-5 mini";
  }
  if (normalized.includes("gpt-5-nano")) {
    return "GPT-5 nano";
  }
  if (normalized.includes("gpt-5")) {
    return "GPT-5";
  }
  if (normalized.includes("gpt-4.1-mini") || normalized.includes("gpt-4-1-mini")) {
    return "GPT-4.1 mini";
  }
  if (normalized.includes("gpt-4.1") || normalized.includes("gpt-4-1")) {
    return "GPT-4.1";
  }
  if (normalized.includes("o4-mini")) {
    return "o4-mini";
  }
  if (normalized.includes("o3")) {
    return "o3";
  }
  if (normalized.includes("o1")) {
    return "o1";
  }
  if (normalized.includes("codex")) {
    return "Codex";
  }

  return model.replace(/-\d{8}$/, "");
}

function getPrimaryUsageModelKey(session: Session): string | null {
  const modelUsage = session.latestUsage?.modelUsage;
  if (!modelUsage) {
    return null;
  }

  const entries = Object.entries(modelUsage);
  if (entries.length === 0) {
    return null;
  }

  entries.sort((a, b) => {
    const aTotal = a[1].inputTokens + a[1].outputTokens + a[1].cacheReadInputTokens + a[1].cacheCreationInputTokens;
    const bTotal = b[1].inputTokens + b[1].outputTokens + b[1].cacheReadInputTokens + b[1].cacheCreationInputTokens;
    return bTotal - aTotal;
  });

  return entries[0][0];
}

export function getSessionDisplayModelLabel(session: Session): string | null {
  const candidate =
    getPrimaryUsageModelKey(session) ||
    session.resolvedModelId ||
    session.pinnedModelId ||
    session.metadata?.currentModelCode ||
    (session.modelMode && session.modelMode !== "default" ? session.modelMode : null) ||
    null;

  if (!candidate) {
    return null;
  }

  return normalizeModelLabel(candidate);
}
