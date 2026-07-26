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
