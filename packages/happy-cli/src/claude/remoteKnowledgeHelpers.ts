export function inferEntryType(userMessage: string, assistantText: string): string {
  const text = `${userMessage} ${assistantText}`.toLowerCase();
  if (text.includes("fix") || text.includes("bug") || text.includes("error") || text.includes("修复")) return "fix";
  if (text.includes("决策") || text.includes("选型") || text.includes("decision") || text.includes("choose")) return "decision";
  if (text.includes("规范") || text.includes("convention") || text.includes("规则")) return "convention";
  if (text.includes("注意") || text.includes("warning") || text.includes("危险") || text.includes("雷区")) return "warning";
  return "discovery";
}

export function extractTags(fileEdits: { path: string; type: string }[]): string[] {
  const tags = new Set<string>();
  for (const edit of fileEdits) {
    const ext = edit.path.split(".").pop();
    if (ext) tags.add(ext);
    const parts = edit.path.split("/");
    if (parts.length > 1) {
      const dir = parts[parts.length - 2];
      if (dir && dir.length < 20) tags.add(dir);
    }
  }
  return [...tags].slice(0, 10);
}

export function formatKnowledgeForInjection(result: {
  profile: {
    techStack: string[];
    architectureType?: string;
    knownPitfalls: string[];
    coreConventions: string[];
  } | null;
  entries: {
    entryType: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    createdAt: string;
  }[];
  actionItems?: {
    entryType: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    createdAt: string;
  }[];
}): string {
  const parts: string[] = ["## Project Knowledge Base"];

  if (result.profile) {
    if (result.profile.techStack.length > 0) {
      parts.push(`Tech Stack: ${result.profile.techStack.join(", ")}`);
    }
    if (result.profile.architectureType) {
      parts.push(`Architecture: ${result.profile.architectureType}`);
    }
    if (result.profile.knownPitfalls.length > 0) {
      parts.push("Known Pitfalls:");
      for (const p of result.profile.knownPitfalls) parts.push(`- ⚠️ ${p}`);
    }
    if (result.profile.coreConventions.length > 0) {
      parts.push("Core Conventions:");
      for (const c of result.profile.coreConventions) parts.push(`- ${c}`);
    }
  }

  if (result.entries.length > 0) {
    parts.push("\n### Recent Knowledge");
    const icons: Record<string, string> = { discovery: "💡", decision: "📋", fix: "🔧", convention: "📏", warning: "⚠️" };
    for (const entry of result.entries) {
      parts.push(`${icons[entry.entryType] || "📝"} **${entry.title}** (${entry.confidence}, ${entry.createdAt})`);
      parts.push(`  ${entry.content.slice(0, 300)}`);
      if (entry.tags.length > 0) {
        parts.push(`  Tags: ${entry.tags.map((t) => `#${t}`).join(" ")}`);
      }
    }
  }

  if (result.actionItems && result.actionItems.length > 0) {
    parts.push("\n### 🎯 Pending Action Items");
    parts.push("The following items may need attention in this session:");
    const icons: Record<string, string> = { discovery: "💡", decision: "📋", fix: "🔧", convention: "📏", warning: "⚠️" };
    for (const item of result.actionItems) {
      parts.push(`${icons[item.entryType] || "📝"} **${item.title}** (${item.entryType}, ${item.confidence})`);
      parts.push(`  ${item.content.slice(0, 200)}`);
    }
  }

  parts.push("\n> Use the `query_project_knowledge` tool to search for additional project knowledge, past decisions, and conventions whenever you need them during this session.");

  return parts.join("\n");
}

export function extractKnowledgeHints(message: string, maxHints: number): string[] {
  const stopWords = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "let", "man", "new", "now", "old", "see", "two", "way", "who", "did", "yes", "any", "had", "its", "may"]);
  const text = message.slice(0, 300);
  const cjkHints = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]{2,6}/g) ?? []).slice(0, Math.floor(maxHints / 2));
  const asciiHints = text
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9_\-.]/g, ""))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !stopWords.has(w.toLowerCase()));
  return [...cjkHints, ...asciiHints].slice(0, maxHints);
}

export function buildWorldConfigPrefix(cfg: { narrative?: string; laws?: string }): string {
  const parts: string[] = [];
  if (cfg.narrative?.trim()) {
    parts.push(`## World Narrative\n${cfg.narrative.trim()}`);
  }
  if (cfg.laws?.trim()) {
    parts.push(`## World Laws\nThe following rules MUST be followed in all actions:\n${cfg.laws.trim()}`);
  }
  if (parts.length === 0) return "";
  return `<system-reminder>\n# World Context\n\n${parts.join("\n\n")}\n</system-reminder>\n\n`;
}
