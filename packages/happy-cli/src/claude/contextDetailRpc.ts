import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getProjectPath } from "./utils/path";

type DetailItem = {
  type: string;
  role?: string;
  content: string;
  uuid?: string;
  timestamp?: string;
};

const MAX_CONTENT_BYTES = 50 * 1024;

function truncate(s: string): string {
  if (s.length <= MAX_CONTENT_BYTES) return s;
  return s.slice(0, MAX_CONTENT_BYTES) + "\n…[truncated]";
}

function extractContent(record: Record<string, unknown>, raw = false): string {
  const t = raw ? (s: string) => s : truncate;
  const msg = record.message as Record<string, unknown> | undefined;
  if (msg) {
    const c = msg.content;
    if (typeof c === "string") return t(c);
    if (Array.isArray(c)) {
      return t(
        c
          .map((b: unknown) => {
            if (typeof b === "object" && b !== null) {
              const block = b as Record<string, unknown>;
              if (block.type === "text") return String(block.text ?? "");
              if (block.type === "tool_use") return `[tool_use: ${block.name}] ${JSON.stringify(block.input ?? {})}`;
              if (block.type === "tool_result") return `[tool_result] ${JSON.stringify(block.content ?? "")}`;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  const att = record.attachment as Record<string, unknown> | undefined;
  if (att) {
    const stdout = att.stdout as string | undefined;
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const hookOut = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
        const additional = hookOut?.additionalContext;
        if (typeof additional === "string") return t(additional);
      } catch { /* not JSON */ }
      return t(stdout);
    }
    const attContent = att.content;
    if (typeof attContent === "string") return t(attContent);
    return t(JSON.stringify(att));
  }
  if (typeof record.summary === "string") return t(record.summary);
  const { message: _m, attachment: _a, ...rest } = record;
  return t(JSON.stringify(rest));
}

function matchesCategory(record: Record<string, unknown>, cat: string): boolean {
  const lower = cat.toLowerCase();
  const type = String(record.type ?? "");
  if (lower.includes("message")) {
    return type === "user" || type === "assistant";
  }
  if (lower.includes("system prompt") || lower === "system") {
    return type === "system";
  }
  if (lower.includes("autocompact") || lower.includes("compact")) {
    return type === "summary";
  }
  if (lower.includes("skill") || lower.includes("agent") || lower.includes("memory") || lower.includes("attachment")) {
    return type === "attachment";
  }
  return type !== "custom-title" && type !== "queue-operation"
    && type !== "file-history-snapshot" && type !== "last-prompt";
}

function splitSystemReminders(
  fullContent: string,
  record: Record<string, unknown>,
): DetailItem[] {
  const results: DetailItem[] = [];
  const uuid = typeof record.uuid === "string" ? record.uuid : undefined;
  const ts = typeof record.timestamp === "string" ? record.timestamp : undefined;
  const sysReminderRegex = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  const userParts: string[] = [];

  while ((match = sysReminderRegex.exec(fullContent)) !== null) {
    const before = fullContent.slice(lastIndex, match.index).trim();
    if (before) userParts.push(before);
    lastIndex = match.index + match[0].length;

    results.push({
      type: "system-reminder",
      role: "injected",
      content: truncate(match[1].trim()),
      uuid,
      timestamp: ts,
    });
  }

  const tail = fullContent.slice(lastIndex).trim();
  if (tail) userParts.push(tail);
  const userText = userParts.join("\n").trim();
  if (userText) {
    results.push({
      type: "user",
      role: "user",
      content: truncate(userText),
      uuid,
      timestamp: ts,
    });
  }

  return results;
}

export function createContextDetailRpcHandler(params: {
  getCurrentSessionId: () => string | null | undefined;
  cwd: string;
}) {
  return async (args: { category?: string; summaryOnly?: boolean; subcategory?: string; limit?: number }) => {
    const category = typeof args?.category === "string" ? args.category.trim() : "";
    if (!category) {
      return { items: [], category: "", totalItems: 0 };
    }
    const summaryOnly = args?.summaryOnly === true;
    const subcategory = typeof args?.subcategory === "string" ? args.subcategory.trim() : "";
    const limit = typeof args?.limit === "number" && args.limit > 0 ? args.limit : 50;

    const currentSessionId = params.getCurrentSessionId();
    if (!currentSessionId) {
      return { items: [], category, totalItems: 0 };
    }

    try {
      const projectDir = getProjectPath(params.cwd);
      const filePath = join(projectDir, `${currentSessionId}.jsonl`);
      const rawContent = await readFile(filePath, "utf-8");
      const items: DetailItem[] = [];
      const isMessages = category.toLowerCase().includes("message");

      if (summaryOnly && isMessages) {
        const counts: Record<string, number> = {
          "user": 0,
          "system-reminder": 0,
          "assistant": 0,
        };
        for (const line of rawContent.split("\n")) {
          if (!line.trim()) continue;
          let record: Record<string, unknown>;
          try {
            record = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (!matchesCategory(record, category)) continue;
          const type = String(record.type ?? "");
          if (type === "assistant") {
            counts["assistant"]++;
          } else if (type === "user") {
            const rawMsg = extractContent(record, true);
            const sysReminderMatches = rawMsg.match(/<system-reminder>[\s\S]*?<\/system-reminder>/g);
            if (sysReminderMatches) {
              counts["system-reminder"] += sysReminderMatches.length;
            }
            const stripped = rawMsg.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
            if (stripped) counts["user"]++;
          }
        }
        const LABELS: Record<string, string> = {
          "user": "User Messages",
          "system-reminder": "System Injections",
          "assistant": "Assistant Replies",
        };
        const subcategories = Object.entries(counts)
          .filter(([, count]) => count > 0)
          .map(([name, count]) => ({ name, label: LABELS[name] ?? name, count }));
        return { items: [], category, totalItems: 0, subcategories };
      }

      for (const line of rawContent.split("\n")) {
        if (!line.trim()) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!matchesCategory(record, category)) continue;

        const msg = record.message as Record<string, unknown> | undefined;
        const needsSplit = isMessages && String(record.type) === "user";
        const content = extractContent(record, needsSplit);

        if (needsSplit && content.includes("<system-reminder>")) {
          const split = splitSystemReminders(content, record);
          if (subcategory) {
            items.push(...split.filter((item) => item.type === subcategory));
          } else {
            items.push(...split);
          }
        } else {
          const itemType = String(record.type ?? "unknown");
          if (subcategory && itemType !== subcategory) continue;
          items.push({
            type: itemType,
            role: typeof msg?.role === "string" ? msg.role : undefined,
            content,
            uuid: typeof record.uuid === "string" ? record.uuid : undefined,
            timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
          });
        }
      }

      const totalItems = items.length;
      const limitedItems = totalItems > limit ? items.slice(totalItems - limit) : items;
      return { items: limitedItems, category, totalItems };
    } catch {
      return { items: [], category, totalItems: 0 };
    }
  };
}
