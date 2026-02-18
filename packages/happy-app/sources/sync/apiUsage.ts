import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

export interface UsageDataPoint {
  timestamp: number;
  tokens: Record<string, number>;
  cost: Record<string, number>;
  reportCount: number;
}

export interface UsageQueryParams {
  sessionId?: string;
  startTime?: number; // Unix timestamp in seconds
  endTime?: number; // Unix timestamp in seconds
  groupBy?: "hour" | "day";
}

export interface UsageResponse {
  usage: UsageDataPoint[];
}

/**
 * Query usage data from the server
 */
export async function queryUsage(
  credentials: AuthCredentials,
  params: UsageQueryParams = {},
): Promise<UsageResponse> {
  const API_ENDPOINT = getServerUrl();

  return await backoff(async () => {
    const response = await fetch(`${API_ENDPOINT}/v1/usage/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      if (response.status === 404 && params.sessionId) {
        throw new Error("Session not found");
      }
      throw new Error(`Failed to query usage: ${response.status}`);
    }

    const data = (await response.json()) as UsageResponse;
    return data;
  });
}

/**
 * Helper function to get usage for a specific time period
 */
export async function getUsageForPeriod(
  credentials: AuthCredentials,
  period: "today" | "7days" | "30days",
  sessionId?: string,
): Promise<UsageResponse> {
  const now = Math.floor(Date.now() / 1000);
  const oneDaySeconds = 24 * 60 * 60;

  let startTime: number;
  let groupBy: "hour" | "day";

  switch (period) {
    case "today":
      // Start of today (local timezone)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      startTime = Math.floor(today.getTime() / 1000);
      groupBy = "hour";
      break;
    case "7days":
      startTime = now - 7 * oneDaySeconds;
      groupBy = "day";
      break;
    case "30days":
      startTime = now - 30 * oneDaySeconds;
      groupBy = "day";
      break;
  }

  return queryUsage(credentials, {
    sessionId,
    startTime,
    endTime: now,
    groupBy,
  });
}

export interface SessionUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastCacheCreation: number;
  lastCacheRead: number;
  reportCount: number;
}

/**
 * Get cumulative token usage for a specific session from server.
 * Used as baseline after page refresh so totals don't reset to zero.
 */
export async function getSessionUsageSummary(
  credentials: AuthCredentials,
  sessionId: string,
): Promise<SessionUsageSummary> {
  const API_ENDPOINT = getServerUrl();

  return await backoff(async () => {
    const response = await fetch(
      `${API_ENDPOINT}/v1/sessions/${sessionId}/usage/summary`,
      {
        headers: {
          Authorization: `Bearer ${credentials.token}`,
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        return {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          lastInputTokens: 0,
          lastOutputTokens: 0,
          lastCacheCreation: 0,
          lastCacheRead: 0,
          reportCount: 0,
        };
      }
      throw new Error(
        `Failed to get session usage summary: ${response.status}`,
      );
    }

    return (await response.json()) as SessionUsageSummary;
  });
}

// Known token type keys that are NOT model names
const TOKEN_TYPE_KEYS = new Set([
  "total",
  "input",
  "output",
  "cache_creation",
  "cache_read",
]);

const COST_TYPE_KEYS = new Set(["total", "input", "output"]);

/**
 * Calculate total tokens and cost from usage data
 */
export function calculateTotals(usage: UsageDataPoint[]): {
  totalTokens: number;
  totalCost: number;
  tokensByType: Record<string, number>;
  tokensByModel: Record<string, number>;
  costByType: Record<string, number>;
  costByModel: Record<string, number>;
} {
  const result = {
    totalTokens: 0,
    totalCost: 0,
    tokensByType: {} as Record<string, number>,
    tokensByModel: {} as Record<string, number>,
    costByType: {} as Record<string, number>,
    costByModel: {} as Record<string, number>,
  };

  for (const dataPoint of usage) {
    // Use the 'total' key for totalTokens to avoid double counting
    const totalForPoint =
      typeof dataPoint.tokens.total === "number" ? dataPoint.tokens.total : 0;
    result.totalTokens += totalForPoint;

    // Categorize token keys into types vs model names
    for (const [key, tokens] of Object.entries(dataPoint.tokens)) {
      if (typeof tokens !== "number" || key === "total") {
        continue;
      }
      if (TOKEN_TYPE_KEYS.has(key)) {
        result.tokensByType[key] = (result.tokensByType[key] || 0) + tokens;
      } else {
        result.tokensByModel[key] = (result.tokensByModel[key] || 0) + tokens;
      }
    }

    // Use the 'total' key for totalCost
    const costTotal =
      typeof dataPoint.cost.total === "number" ? dataPoint.cost.total : 0;
    result.totalCost += costTotal;

    // Categorize cost keys into types vs model names
    for (const [key, cost] of Object.entries(dataPoint.cost)) {
      if (typeof cost !== "number" || key === "total") {
        continue;
      }
      if (COST_TYPE_KEYS.has(key)) {
        result.costByType[key] = (result.costByType[key] || 0) + cost;
      } else {
        result.costByModel[key] = (result.costByModel[key] || 0) + cost;
      }
    }
  }

  return result;
}
