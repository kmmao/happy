import axios from "axios";
import { logger } from "@/ui/logger";
import { configuration } from "@/configuration";
import { Credentials } from "@/persistence";

export interface AgentRolePromptContext {
  readonly roleId: string;
  readonly roleName: string;
  readonly roleType: string;
  readonly description: string | null;
  readonly duties: string[];
  readonly skills: ReadonlyArray<{ id: string; name: string; content: string }>;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  context: AgentRolePromptContext;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Resolve an agent role's prompt context from the server.
 * Uses an in-memory cache with 5-minute TTL.
 * Returns undefined on network failure (graceful degradation).
 */
export async function resolveAgentRoleContext(
  roleId: string,
  credential: Credentials,
): Promise<AgentRolePromptContext | undefined> {
  // Check cache
  const cached = cache.get(roleId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.context;
  }

  try {
    const response = await axios.get<AgentRolePromptContext>(
      `${configuration.serverUrl}/v1/agent-roles/${roleId}/prompt-context`,
      {
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    );

    const context = response.data;
    cache.set(roleId, { context, fetchedAt: Date.now() });
    return context;
  } catch (error) {
    logger.debug(
      `[AGENT ROLE] Failed to resolve role ${roleId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Return stale cache if available
    if (cached) {
      logger.debug(`[AGENT ROLE] Using stale cache for role ${roleId}`);
      return cached.context;
    }
    return undefined;
  }
}

/**
 * Format role context as markdown for prompt injection.
 */
export function formatRoleIdentitySection(ctx: AgentRolePromptContext): string {
  const parts: string[] = [
    `## Role Identity`,
    `You are the **${ctx.roleName}** (${ctx.roleType}) of this project.`,
    "",
  ];

  if (ctx.description) {
    parts.push("### Description", ctx.description.trim(), "");
  }

  if (ctx.duties.length > 0) {
    parts.push("### Duties");
    for (const duty of ctx.duties) {
      parts.push(`- ${duty}`);
    }
    parts.push("");
  }

  if (ctx.skills.length > 0) {
    parts.push("### Available Skills");
    for (const skill of ctx.skills) {
      parts.push(`#### ${skill.name}`, skill.content.trim(), "");
    }
  }

  return parts.join("\n");
}

/**
 * Clear the role context cache (useful for testing).
 */
export function clearRoleCache(): void {
  cache.clear();
}
