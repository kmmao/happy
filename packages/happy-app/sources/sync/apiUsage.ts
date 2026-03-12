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
 * Fill in missing time slots with zero-value data points so
 * charts always show the full range (e.g. 7 bars for 7 days).
 */
function fillTimeGaps(
  data: UsageDataPoint[],
  startTime: number,
  endTime: number,
  groupBy: "hour" | "day",
): UsageDataPoint[] {
  const stepSeconds = groupBy === "hour" ? 3600 : 86400;

  // Round startTime down to the boundary
  const startDate = new Date(startTime * 1000);
  if (groupBy === "hour") {
    startDate.setMinutes(0, 0, 0);
  } else {
    startDate.setHours(0, 0, 0, 0);
  }
  const alignedStart = Math.floor(startDate.getTime() / 1000);

  // Re-align existing data points to local timezone boundaries.
  // Server timestamps may use a different timezone, so we snap each
  // point to the client's local day/hour start for correct matching.
  const alignToLocal = (ts: number): number => {
    const d = new Date(ts * 1000);
    if (groupBy === "hour") {
      d.setMinutes(0, 0, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return Math.floor(d.getTime() / 1000);
  };

  const existingMap = new Map<number, UsageDataPoint>();
  for (const point of data) {
    const aligned = alignToLocal(point.timestamp);
    const prev = existingMap.get(aligned);
    if (prev) {
      // Merge if multiple server buckets map to the same local slot
      const merged: UsageDataPoint = {
        timestamp: aligned,
        tokens: { ...prev.tokens },
        cost: { ...prev.cost },
        reportCount: prev.reportCount + point.reportCount,
      };
      for (const [k, v] of Object.entries(point.tokens)) {
        if (typeof v === "number") {
          merged.tokens[k] = (merged.tokens[k] || 0) + v;
        }
      }
      for (const [k, v] of Object.entries(point.cost)) {
        if (typeof v === "number") {
          merged.cost[k] = (merged.cost[k] || 0) + v;
        }
      }
      existingMap.set(aligned, merged);
    } else {
      existingMap.set(aligned, { ...point, timestamp: aligned });
    }
  }

  // Generate all time slots
  const result: UsageDataPoint[] = [];
  let current = alignedStart;
  while (current <= endTime) {
    const existing = existingMap.get(current);
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        timestamp: current,
        tokens: { total: 0 },
        cost: { total: 0 },
        reportCount: 0,
      });
    }
    // Advance by step, handling DST correctly for day grouping
    if (groupBy === "day") {
      const d = new Date(current * 1000);
      d.setDate(d.getDate() + 1);
      current = Math.floor(d.getTime() / 1000);
    } else {
      current += stepSeconds;
    }
  }

  return result;
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

  const response = await queryUsage(credentials, {
    sessionId,
    startTime,
    endTime: now,
    groupBy,
  });

  return {
    ...response,
    usage: fillTimeGaps(response.usage || [], startTime, now, groupBy),
  };
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
