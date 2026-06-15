/**
 * parseAutomationContextEnv — read the daemon-injected
 * `HAPPY_AUTOMATION_CONTEXT_JSON` env var and turn it into a
 * `metadata.automationContext` patch object suitable for spreading
 * into a metadata literal.
 *
 * The daemon stamps this env var on every automation spawn
 * (loop / supervisor / webhook / task) — see `startDaemon.spawnSession`
 * where it JSON-encodes `SpawnSessionOptions.automationContext`.
 * Three different backend launchers (claude / codex / gemini) all
 * build their own `Metadata` object inline, so this helper lets them
 * all wire up the same env-var → metadata path without copy-pasting
 * the parse logic three times.
 *
 * Failure modes (env var absent, empty payload, bad JSON, missing
 * discriminator) all return `{}` so a spread becomes a no-op. We
 * never throw — the worst case is a manual-feel session that ends
 * up in Ad-hoc instead of under its owning Workflow row.
 */
import type { Metadata } from "@/api/types";
import { logger } from "@/ui/logger";

export function parseAutomationContextEnv(): Pick<Metadata, "automationContext"> | {} {
  const raw = process.env.HAPPY_AUTOMATION_CONTEXT_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.kind !== "string"
    ) {
      return {};
    }
    return { automationContext: parsed as Metadata["automationContext"] };
  } catch (error) {
    logger.debug(
      `[SESSION] Failed to parse HAPPY_AUTOMATION_CONTEXT_JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
}
